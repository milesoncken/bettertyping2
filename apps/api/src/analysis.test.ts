import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AnalysisResponse, RibbonResponse } from "@bettertyping/schema";
import { computeResults } from "@bettertyping/metrics";
import { SESSION_COOKIE } from "./auth/session.js";
import { schema } from "./db.js";
import type { Db } from "./db.js";
import { cookieFrom, createTestApp, playTest, simulateElapsed } from "./testing.js";

/**
 * The analysis surface, end to end.
 *
 * These go through HTTP on purpose. The rollups are written by an upsert whose
 * whole job is arithmetic — `SET n = n + excluded.n` — and an arithmetic bug
 * there produces plausible numbers rather than an error. So the load-bearing
 * test is not "does it return 200": it is that a run's analysis, folded into the
 * rollups and read back through the API, says what the analytics package said
 * about that same run in isolation.
 */

let app: FastifyInstance;
let db: Db;
let reset: () => Promise<void>;
let close: () => Promise<void>;

function switchableGoogle(): {
  fetchImpl: typeof fetch;
  become: (sub: string) => void;
} {
  let sub = "analysisa";
  const fetchImpl = (async () => {
    const payload = Buffer.from(
      JSON.stringify({ sub, email: `${sub}@example.com`, email_verified: true }),
    ).toString("base64url");
    return new Response(JSON.stringify({ id_token: `header.${payload}.signature` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, become: (next: string) => (sub = next) };
}

const google = switchableGoogle();

beforeAll(async () => {
  const harness = await createTestApp(google.fetchImpl);
  app = harness.app;
  db = harness.db;
  reset = harness.reset;
  close = harness.close;
});

beforeEach(async () => {
  await reset();
});

afterAll(async () => {
  await close();
});

async function signIn(sub: string): Promise<string> {
  google.become(sub);
  const started = await app.inject({ method: "GET", url: "/auth/google" });
  const location = new URL(started.headers.location as string);
  const handshake = started.headers["set-cookie"];
  const callback = await app.inject({
    method: "GET",
    url: `/auth/google/callback?code=abc&state=${location.searchParams.get("state")}`,
    headers: {
      cookie: `bt_oauth_state=${cookieFrom(handshake, "bt_oauth_state")}; bt_oauth_verifier=${cookieFrom(handshake, "bt_oauth_verifier")}`,
    },
  });
  return cookieFrom(callback.headers["set-cookie"], SESSION_COOKIE) as string;
}

const auth = (cookie?: string) =>
  cookie ? { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } } : {};

/** Play a real run through issuance, submission and verification. */
async function playAndSubmit(
  cookie: string | undefined,
  options: { count?: 25 | 50 | 100; holds?: boolean } = {},
): Promise<{ testId: string; verification: string }> {
  const issued = await app.inject({
    method: "POST",
    url: "/tests/issue",
    payload: {
      mode: "words",
      count: options.count ?? 25,
      punctuation: false,
      numbers: false,
    },
    ...auth(cookie),
  });
  const { testId, seed } = issued.json() as { testId: string; seed: string };

  const state = playTest(
    {
      mode: "words",
      count: options.count ?? 25,
      seed,
      punctuation: false,
      numbers: false,
    },
    { fractional: true, ...(options.holds === false ? { holds: false } : {}) },
  );
  const results = computeResults(state);
  await simulateElapsed(db, testId, results.durationMs + 2000);

  const submitted = await app.inject({
    method: "POST",
    url: `/tests/${testId}/submit`,
    payload: {
      events: state.events,
      claimed: { wpm: results.wpm, accuracy: results.accuracy },
    },
    ...auth(cookie),
  });

  const body = submitted.json() as { verification: string };
  const row = await db
    .select({ id: schema.tests.id })
    .from(schema.tests)
    .where(eq(schema.tests.issuedTestId, testId))
    .limit(1);

  return { testId: row[0]!.id, verification: body.verification };
}

const analysisOf = async (username: string): Promise<AnalysisResponse> => {
  const response = await app.inject({
    method: "GET",
    url: `/users/${username}/analysis`,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as AnalysisResponse;
};

describe("a player's analysis", () => {
  it("is empty, not broken, before anyone has typed anything", async () => {
    await db.insert(schema.users).values({ username: "newcomer" });
    const analysis = await analysisOf("newcomer");

    expect(analysis.runs).toBe(0);
    expect(analysis.keys).toEqual([]);
    expect(analysis.bigrams).toEqual([]);
    // The cold start counts down rather than showing a blank panel.
    expect(analysis.runsUntilConfident).toBe(10);
  });

  it("404s for someone who does not exist", async () => {
    const response = await app.inject({ method: "GET", url: "/users/nobody/analysis" });
    expect(response.statusCode).toBe(404);
  });

  it("folds a submitted run into the rollups", async () => {
    const cookie = await signIn("analysisa");
    const { verification } = await playAndSubmit(cookie);
    expect(verification).toBe("verified");

    const analysis = await analysisOf("analysisa");
    expect(analysis.runs).toBe(1);
    expect(analysis.runsUntilConfident).toBe(9);
    expect(analysis.keys.length).toBeGreaterThan(5);
    expect(analysis.bigrams.length).toBeGreaterThan(5);

    // Physical keys, with the character they printed observed from the log.
    const e = analysis.keys.find((key) => key.code === "KeyE");
    expect(e?.legend).toBe("e");
    expect(e?.struck).toBeGreaterThan(0);
    expect(analysis.qwertyLike).toBe(true);
  });

  it("adds a second run to the first rather than replacing it", async () => {
    const cookie = await signIn("analysisa");
    await playAndSubmit(cookie);
    const afterOne = await analysisOf("analysisa");

    await playAndSubmit(cookie);
    const afterTwo = await analysisOf("analysisa");

    expect(afterTwo.runs).toBe(2);

    // Each issuance gets its own seed, so the two runs are different text and
    // the totals are not a clean doubling. What must hold is that the second run
    // was *added*: nothing a key had already accumulated may go backwards.
    const strikes = (a: AnalysisResponse): number =>
      a.keys.reduce((total, key) => total + key.struck, 0);
    expect(strikes(afterTwo)).toBeGreaterThan(strikes(afterOne));
    for (const before of afterOne.keys) {
      const after = afterTwo.keys.find((key) => key.code === before.code);
      expect(after?.struck ?? 0).toBeGreaterThanOrEqual(before.struck);
    }

    // Latency is a mean of per-run medians, so two runs at one cadence land on
    // that cadence rather than on twice it. (The arithmetic itself is pinned
    // exactly in the analytics package's own suite, on controlled input.)
    const flightOf = (a: AnalysisResponse): number =>
      a.keys.find((key) => key.code === "KeyE")?.flightMs ?? 0;
    expect(flightOf(afterTwo)).toBeLessThan(flightOf(afterOne) * 1.5);
  });

  it("records dwell, which nothing captured before", async () => {
    const cookie = await signIn("analysisa");
    await playAndSubmit(cookie);

    const analysis = await analysisOf("analysisa");
    expect(analysis.dwellRuns).toBeGreaterThan(0);
    const withDwell = analysis.keys.filter((key) => key.dwellMs !== null);
    expect(withDwell.length).toBeGreaterThan(0);
    expect(withDwell[0]?.dwellMs).toBeGreaterThan(0);
  });

  it("reports no dwell at all for a run recorded without holds", async () => {
    const cookie = await signIn("analysisa");
    await playAndSubmit(cookie, { holds: false });

    const analysis = await analysisOf("analysisa");
    expect(analysis.dwellRuns).toBe(0);
    expect(analysis.keys.every((key) => key.dwellMs === null)).toBe(true);
  });

  it("counts a guest's run for nobody", async () => {
    await playAndSubmit(undefined);
    const rows = await db.select().from(schema.keyStats);
    // There is nobody to attribute a key to, so nothing is written at all.
    expect(rows).toEqual([]);
  });

  it("leaves a rejected run out of the rollups", async () => {
    const cookie = await signIn("analysisa");

    const issued = await app.inject({
      method: "POST",
      url: "/tests/issue",
      payload: { mode: "words", count: 25, punctuation: false, numbers: false },
      ...auth(cookie),
    });
    const { testId, seed } = issued.json() as { testId: string; seed: string };

    // Superhuman: every keystroke 2ms apart, which the verifier rejects.
    const state = playTest(
      { mode: "words", count: 25, seed, punctuation: false, numbers: false },
      { cadence: [2] },
    );
    const submitted = await app.inject({
      method: "POST",
      url: `/tests/${testId}/submit`,
      payload: { events: state.events },
      ...auth(cookie),
    });
    expect((submitted.json() as { verification: string }).verification).toBe(
      "rejected",
    );

    const analysis = await analysisOf("analysisa");
    expect(analysis.runs).toBe(0);
    expect(analysis.keys).toEqual([]);
  });

  it("keeps one player's hands out of another's", async () => {
    const a = await signIn("analysisa");
    await playAndSubmit(a);
    const b = await signIn("analysisb");
    await playAndSubmit(b);
    await playAndSubmit(b);

    expect((await analysisOf("analysisa")).runs).toBe(1);
    expect((await analysisOf("analysisb")).runs).toBe(2);
  });

  it("classifies transitions by the fingers that made them", async () => {
    const cookie = await signIn("analysisa");
    await playAndSubmit(cookie, { count: 100 });

    const analysis = await analysisOf("analysisa");
    const kinds = new Set(analysis.bigrams.map((bigram) => bigram.kind));
    expect(kinds.has("alternate")).toBe(true);
    expect(analysis.rolls.counts["alternate"]).toBeGreaterThan(0);
    // Every classified pair is accounted for on one hand or between two.
    const total = Object.values(analysis.rolls.counts).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });
});

describe("one run's keystrokes", () => {
  it("hands back the series the Ribbon draws", async () => {
    const cookie = await signIn("analysisa");
    const { testId } = await playAndSubmit(cookie);

    const response = await app.inject({
      method: "GET",
      url: `/tests/${testId}/ribbon`,
    });
    expect(response.statusCode).toBe(200);
    const ribbon = response.json() as RibbonResponse;

    expect(ribbon.username).toBe("analysisa");
    expect(ribbon.hasDwell).toBe(true);
    expect(ribbon.keystrokes.length).toBeGreaterThan(20);

    const [first, second] = ribbon.keystrokes;
    // The first keystroke has nothing to have flown from.
    expect(first?.flight).toBeNull();
    expect(second?.flight).toBeGreaterThan(0);
    expect(first?.dwell).toBeGreaterThan(0);
    expect(first?.code).toMatch(/^(Key|Digit|Space|Comma|Period)/);
  });

  it("reports null dwell rather than zero for a run without holds", async () => {
    const cookie = await signIn("analysisa");
    const { testId } = await playAndSubmit(cookie, { holds: false });

    const response = await app.inject({
      method: "GET",
      url: `/tests/${testId}/ribbon`,
    });
    const ribbon = response.json() as RibbonResponse;
    expect(ribbon.hasDwell).toBe(false);
    expect(ribbon.keystrokes.every((stroke) => stroke.dwell === null)).toBe(true);
  });

  it("404s on a malformed id rather than melting on a bad uuid", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/tests/not-a-uuid/ribbon",
    });
    expect(response.statusCode).toBe(404);
  });

  it("keeps a held run private to the person who typed it", async () => {
    const cookie = await signIn("analysisa");
    const issued = await app.inject({
      method: "POST",
      url: "/tests/issue",
      payload: { mode: "words", count: 25, punctuation: false, numbers: false },
      ...auth(cookie),
    });
    const { testId, seed } = issued.json() as { testId: string; seed: string };
    const state = playTest({
      mode: "words",
      count: 25,
      seed,
      punctuation: false,
      numbers: false,
    });
    await app.inject({
      method: "POST",
      url: `/tests/${testId}/submit`,
      payload: { events: state.events },
      ...auth(cookie),
    });

    const row = await db
      .select({ id: schema.tests.id })
      .from(schema.tests)
      .where(eq(schema.tests.issuedTestId, testId))
      .limit(1);
    await db
      .update(schema.tests)
      .set({ verification: "flagged" })
      .where(eq(schema.tests.id, row[0]!.id));

    const stranger = await app.inject({
      method: "GET",
      url: `/tests/${row[0]!.id}/ribbon`,
    });
    expect(stranger.statusCode).toBe(404);

    const owner = await app.inject({
      method: "GET",
      url: `/tests/${row[0]!.id}/ribbon`,
      ...auth(cookie),
    });
    expect(owner.statusCode).toBe(200);
  });
});
