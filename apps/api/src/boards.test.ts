import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { computeResults } from "@bettertyping/metrics";
import type { HistoryResponse, LeaderboardResponse, ProfileResponse, RunResponse } from "@bettertyping/schema";
import { SESSION_COOKIE } from "./auth/session.js";
import { schema } from "./db.js";
import type { Db } from "./db.js";
import { cookieFrom, createTestApp, playTest, simulateElapsed } from "./testing.js";

/**
 * The read side, end to end.
 *
 * The stage's exit criterion is "real data end to end", so the first test here
 * types a run, submits it, and then reads it back off the leaderboard through
 * the HTTP surface — no fixture stands in for the pipeline. The rest seed rows
 * directly, because ranking rules are about *which* rows a board admits, and
 * playing twenty runs at chosen speeds to prove an ORDER BY is theatre.
 */

let app: FastifyInstance;
let db: Db;
let reset: () => Promise<void>;
let close: () => Promise<void>;

/** A Google stub whose identity can change between sign-ins. */
function switchableGoogle(): { fetchImpl: typeof fetch; become: (sub: string) => void } {
  let sub = "user-a";
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

async function createUser(username: string): Promise<string> {
  const rows = await db.insert(schema.users).values({ username }).returning({ id: schema.users.id });
  return rows[0]!.id;
}

let seedCounter = 0;

/** A finished run, written straight to the tables the boards read. */
async function seedRun(run: {
  userId: string | null;
  wpm: number;
  accuracy?: number;
  mode?: "time" | "words";
  length?: number;
  verification?: "verified" | "flagged" | "rejected";
  createdAt?: Date;
  punctuation?: boolean;
}): Promise<string> {
  const mode = run.mode ?? "words";
  const length = run.length ?? 25;
  seedCounter += 1;

  const issued = await db
    .insert(schema.issuedTests)
    .values({
      userId: run.userId,
      seed: `seed-${seedCounter}`,
      mode,
      duration: mode === "time" ? length : null,
      count: mode === "words" ? length : null,
      punctuation: run.punctuation ?? false,
      numbers: false,
    })
    .returning({ id: schema.issuedTests.id });

  const rows = await db
    .insert(schema.tests)
    .values({
      issuedTestId: issued[0]!.id,
      userId: run.userId,
      mode,
      length,
      punctuation: run.punctuation ?? false,
      numbers: false,
      wpm: run.wpm,
      rawWpm: run.wpm + 4,
      accuracy: run.accuracy ?? 96,
      consistency: 80,
      durationMs: 30_000,
      chars: { correct: 100, incorrect: 2, extra: 0, missed: 0 },
      verification: run.verification ?? "verified",
      reasons: [],
      events: [],
      ...(run.createdAt ? { createdAt: run.createdAt } : {}),
    })
    .returning({ id: schema.tests.id });

  return rows[0]!.id;
}

const board = async (query: string, cookie?: string): Promise<LeaderboardResponse> => {
  const response = await app.inject({ method: "GET", url: `/leaderboard?${query}`, ...auth(cookie) });
  expect(response.statusCode).toBe(200);
  return response.json() as LeaderboardResponse;
};

const ago = (ms: number): Date => new Date(Date.now() - ms);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("leaderboard", () => {
  it("carries a real run from the keyboard to the board", async () => {
    const cookie = await signIn("boarde2e");

    const issued = (
      await app.inject({
        method: "POST",
        url: "/tests/issue",
        payload: { mode: "words", count: 25, punctuation: false, numbers: false },
        ...auth(cookie),
      })
    ).json() as { testId: string; seed: string };

    const state = playTest({
      mode: "words",
      count: 25,
      seed: issued.seed,
      punctuation: false,
      numbers: false,
    });
    const truth = computeResults(state);
    await simulateElapsed(db, issued.testId, truth.durationMs + 600);

    const submitted = await app.inject({
      method: "POST",
      url: `/tests/${issued.testId}/submit`,
      payload: { events: state.events },
      ...auth(cookie),
    });
    expect(submitted.json().verification).toBe("verified");

    const body = await board("mode=words&length=25", cookie);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      rank: 1,
      username: "boarde2e",
      wpm: submitted.json().results.wpm,
      testId: expect.any(String),
    });
    // The board agrees with the player's own standing, because they are the
    // same row read two ways.
    expect(body.you?.rank).toBe(1);
    expect(body.you?.testId).toBe(body.entries[0]?.testId);
  });

  it("ranks by speed and keeps one row per player", async () => {
    const fast = await createUser("fast");
    const slow = await createUser("slow");
    await seedRun({ userId: fast, wpm: 88 });
    await seedRun({ userId: fast, wpm: 121 });
    await seedRun({ userId: fast, wpm: 40 });
    await seedRun({ userId: slow, wpm: 95 });

    const body = await board("mode=words&length=25");
    expect(body.entries.map((entry) => [entry.rank, entry.username, entry.wpm])).toEqual([
      [1, "fast", 121],
      [2, "slow", 95],
    ]);
  });

  it("admits neither guests nor runs the verifier did not clear", async () => {
    const honest = await createUser("honest");
    const suspect = await createUser("suspect");
    await seedRun({ userId: honest, wpm: 70 });
    await seedRun({ userId: null, wpm: 300 });
    await seedRun({ userId: suspect, wpm: 280, verification: "rejected" });
    await seedRun({ userId: suspect, wpm: 240, verification: "flagged" });

    const body = await board("mode=words&length=25");
    expect(body.entries.map((entry) => entry.username)).toEqual(["honest"]);
  });

  it("keeps boards apart by mode and length", async () => {
    const user = await createUser("mixed");
    await seedRun({ userId: user, wpm: 100, mode: "words", length: 25 });
    await seedRun({ userId: user, wpm: 200, mode: "words", length: 50 });
    await seedRun({ userId: user, wpm: 300, mode: "time", length: 30 });

    expect((await board("mode=words&length=25")).entries[0]?.wpm).toBe(100);
    expect((await board("mode=words&length=50")).entries[0]?.wpm).toBe(200);
    expect((await board("mode=time&length=30")).entries[0]?.wpm).toBe(300);
  });

  it("windows to the day and the week", async () => {
    const user = await createUser("veteran");
    await seedRun({ userId: user, wpm: 150, createdAt: ago(40 * DAY) });
    await seedRun({ userId: user, wpm: 110, createdAt: ago(3 * DAY) });
    await seedRun({ userId: user, wpm: 90, createdAt: ago(2 * HOUR) });

    expect((await board("mode=words&length=25&window=all")).entries[0]?.wpm).toBe(150);
    expect((await board("mode=words&length=25&window=weekly")).entries[0]?.wpm).toBe(110);
    expect((await board("mode=words&length=25&window=daily")).entries[0]?.wpm).toBe(90);
  });

  it("reports your standing from below the fold", async () => {
    const cookie = await signIn("striver");
    await seedRun({ userId: await createUser("ace"), wpm: 180 });
    await seedRun({ userId: await createUser("champ"), wpm: 170 });

    const me = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, "striver"));
    await seedRun({ userId: me[0]!.id, wpm: 60 });

    const body = await board("mode=words&length=25&limit=1", cookie);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.username).toBe("ace");
    expect(body.you).toMatchObject({ rank: 3, username: "striver", wpm: 60 });
  });

  it("says nothing about a player with no ranked run here", async () => {
    const cookie = await signIn("newcomer");
    await seedRun({ userId: await createUser("ace"), wpm: 180 });

    expect((await board("mode=words&length=25", cookie)).you).toBeNull();
    expect((await board("mode=words&length=25")).you).toBeNull();
  });

  it("refuses a board that is not offered", async () => {
    const response = await app.inject({ method: "GET", url: "/leaderboard?mode=words&length=37" });
    expect(response.statusCode).toBe(400);
  });
});

describe("history", () => {
  it("needs an account", async () => {
    const response = await app.inject({ method: "GET", url: "/me/history" });
    expect(response.statusCode).toBe(401);
  });

  it("shows you your own runs, held ones included", async () => {
    const cookie = await signIn("historian");
    const me = (await app.inject({ method: "GET", url: "/me", ...auth(cookie) })).json() as {
      id: string;
    };
    const stranger = await createUser("stranger");

    await seedRun({ userId: me.id, wpm: 80, createdAt: ago(3 * HOUR) });
    await seedRun({ userId: me.id, wpm: 240, verification: "flagged", createdAt: ago(HOUR) });
    await seedRun({ userId: stranger, wpm: 99 });

    const response = await app.inject({ method: "GET", url: "/me/history", ...auth(cookie) });
    const body = response.json() as HistoryResponse;

    expect(body.entries).toHaveLength(2);
    // Newest first.
    expect(body.entries.map((entry) => entry.verification)).toEqual(["flagged", "verified"]);
    expect(body.nextCursor).toBeNull();
  });

  it("pages backwards through time without repeating a run", async () => {
    const cookie = await signIn("prolific");
    const me = (await app.inject({ method: "GET", url: "/me", ...auth(cookie) })).json() as {
      id: string;
    };
    for (let i = 0; i < 5; i++) {
      await seedRun({ userId: me.id, wpm: 50 + i, createdAt: ago((5 - i) * HOUR) });
    }

    const first = (
      await app.inject({ method: "GET", url: "/me/history?limit=2", ...auth(cookie) })
    ).json() as HistoryResponse;
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();

    const second = (
      await app.inject({
        method: "GET",
        url: `/me/history?limit=2&before=${encodeURIComponent(first.nextCursor as string)}`,
        ...auth(cookie),
      })
    ).json() as HistoryResponse;

    const ids = [...first.entries, ...second.entries].map((entry) => entry.id);
    expect(new Set(ids).size).toBe(4);
    expect(first.entries[0]?.wpm).toBe(54);
    expect(second.entries[1]?.wpm).toBe(51);
  });

  it("filters to one board", async () => {
    const cookie = await signIn("picky");
    const me = (await app.inject({ method: "GET", url: "/me", ...auth(cookie) })).json() as {
      id: string;
    };
    await seedRun({ userId: me.id, wpm: 70, mode: "words", length: 25 });
    await seedRun({ userId: me.id, wpm: 71, mode: "time", length: 60 });

    const body = (
      await app.inject({ method: "GET", url: "/me/history?mode=time&length=60", ...auth(cookie) })
    ).json() as HistoryResponse;
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.mode).toBe("time");
  });
});

describe("profile", () => {
  it("404s on someone who does not exist", async () => {
    const response = await app.inject({ method: "GET", url: "/users/nobody" });
    expect(response.statusCode).toBe(404);
  });

  it("averages verified runs only, and is case-insensitive about the name", async () => {
    const user = await createUser("Averaged");
    await seedRun({ userId: user, wpm: 100, accuracy: 98, createdAt: ago(2 * HOUR) });
    await seedRun({ userId: user, wpm: 60, accuracy: 90, createdAt: ago(HOUR) });
    // Neither of these may touch a single number below.
    await seedRun({ userId: user, wpm: 400, verification: "rejected" });
    await seedRun({ userId: user, wpm: 300, verification: "flagged" });

    const response = await app.inject({ method: "GET", url: "/users/averaged" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ProfileResponse;

    expect(body.username).toBe("Averaged");
    expect(body.totals).toMatchObject({
      tests: 2,
      averageWpm: 80,
      averageAccuracy: 94,
      bestWpm: 100,
      secondsTyped: 60,
    });
    // Oldest first, so a chart plots it as it stands.
    expect(body.recent.map((entry) => entry.wpm)).toEqual([100, 60]);
  });

  it("lists the personal bests a submission set", async () => {
    const cookie = await signIn("recordholder");
    const issued = (
      await app.inject({
        method: "POST",
        url: "/tests/issue",
        payload: { mode: "words", count: 25, punctuation: false, numbers: false },
        ...auth(cookie),
      })
    ).json() as { testId: string; seed: string };

    const state = playTest({
      mode: "words",
      count: 25,
      seed: issued.seed,
      punctuation: false,
      numbers: false,
    });
    await simulateElapsed(db, issued.testId, computeResults(state).durationMs + 600);
    await app.inject({
      method: "POST",
      url: `/tests/${issued.testId}/submit`,
      payload: { events: state.events },
      ...auth(cookie),
    });

    const body = (
      await app.inject({ method: "GET", url: "/users/recordholder" })
    ).json() as ProfileResponse;

    expect(body.personalBests).toHaveLength(1);
    expect(body.personalBests[0]).toMatchObject({ mode: "words", length: 25 });
    expect(body.personalBests[0]?.wpm).toBeGreaterThan(0);
  });
});

describe("a run, reopened", () => {
  async function playAndSubmit(cookie: string) {
    const issued = (
      await app.inject({
        method: "POST",
        url: "/tests/issue",
        payload: { mode: "words", count: 25, punctuation: false, numbers: false },
        ...auth(cookie),
      })
    ).json() as { testId: string; seed: string };

    const state = playTest({
      mode: "words",
      count: 25,
      seed: issued.seed,
      punctuation: false,
      numbers: false,
    });
    await simulateElapsed(db, issued.testId, computeResults(state).durationMs + 600);
    await app.inject({
      method: "POST",
      url: `/tests/${issued.testId}/submit`,
      payload: { events: state.events },
      ...auth(cookie),
    });
    return state;
  }

  it("redraws its chart from the keystrokes, not from a stored copy", async () => {
    const cookie = await signIn("replayed");
    const state = await playAndSubmit(cookie);
    const truth = computeResults(state);

    const listed = (
      await app.inject({ method: "GET", url: "/me/history", ...auth(cookie) })
    ).json() as HistoryResponse;
    const id = listed.entries[0]!.id;

    // Public, because a verified run is on a board and a board has to be auditable.
    const response = await app.inject({ method: "GET", url: `/tests/${id}` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as RunResponse;

    expect(body.username).toBe("replayed");
    expect(body.wpm).toBeCloseTo(truth.wpm, 5);
    expect(body.chars).toEqual(truth.chars);
    expect(body.samples.length).toBe(truth.samples.length);
    expect(body.samples.at(-1)?.wpm).toBeCloseTo(truth.samples.at(-1)!.wpm, 5);
  });

  it("keeps an unverified run to its owner", async () => {
    const cookie = await signIn("private");
    const me = (await app.inject({ method: "GET", url: "/me", ...auth(cookie) })).json() as {
      id: string;
    };
    const id = await seedRun({ userId: me.id, wpm: 240, verification: "flagged" });

    expect((await app.inject({ method: "GET", url: `/tests/${id}` })).statusCode).toBe(404);
    const mine = await app.inject({ method: "GET", url: `/tests/${id}`, ...auth(cookie) });
    expect(mine.statusCode).toBe(200);
    expect((mine.json() as RunResponse).verification).toBe("flagged");
  });

  it("404s on an id that is not a run", async () => {
    expect((await app.inject({ method: "GET", url: "/tests/not-a-uuid" })).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/tests/00000000-0000-4000-8000-000000000000",
        })
      ).statusCode,
    ).toBe(404);
  });
});
