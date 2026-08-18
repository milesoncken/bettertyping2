import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { computeResults } from "@bettertyping/metrics";
import type { TestConfig } from "@bettertyping/engine";
import { SESSION_COOKIE } from "./auth/session.js";
import {
  cookieFrom,
  createTestApp,
  fakeGoogle,
  playTest,
  simulateElapsed,
  TEST_ENV,
} from "./testing.js";
import type { Db } from "./db.js";

/**
 * End to end against a real Postgres, with the committed migration applied.
 *
 * The stage's exit criterion lives here: a forged submission has to be rejected
 * by the running server, not merely by a unit test of the rules.
 */

let app: FastifyInstance;
let db: Db;
let reset: () => Promise<void>;
let close: () => Promise<void>;

const WORDS_25 = { mode: "words" as const, count: 25, punctuation: false, numbers: false };

async function issue(cookie?: string) {
  const response = await app.inject({
    method: "POST",
    url: "/tests/issue",
    payload: WORDS_25,
    ...(cookie ? { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } } : {}),
  });
  expect(response.statusCode).toBe(200);
  return response.json() as {
    testId: string;
    seed: string;
    mode: "words";
    count: number;
    punctuation: boolean;
    numbers: boolean;
  };
}

function configOf(issued: { seed: string; count: number }): TestConfig {
  return {
    mode: "words",
    count: issued.count,
    seed: issued.seed,
    punctuation: false,
    numbers: false,
  };
}

async function submit(testId: string, payload: unknown, cookie?: string) {
  return app.inject({
    method: "POST",
    url: `/tests/${testId}/submit`,
    payload: payload as Record<string, unknown>,
    ...(cookie ? { headers: { cookie: `${SESSION_COOKIE}=${cookie}` } } : {}),
  });
}

/**
 * Sign in through the real callback route.
 *
 * The identity is fixed by the harness's Google stub, so every call here is the
 * same person coming back — which is exactly what the repeat-sign-in test needs.
 */
async function signIn() {
  const started = await app.inject({ method: "GET", url: "/auth/google" });
  expect(started.statusCode).toBe(302);

  const location = new URL(started.headers.location as string);
  const state = location.searchParams.get("state");
  expect(state).toBeTruthy();
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");

  const handshake = started.headers["set-cookie"];
  const stateCookie = cookieFrom(handshake, "bt_oauth_state");
  const verifierCookie = cookieFrom(handshake, "bt_oauth_verifier");

  const callback = await app.inject({
    method: "GET",
    url: `/auth/google/callback?code=abc&state=${state}`,
    headers: {
      cookie: `bt_oauth_state=${stateCookie}; bt_oauth_verifier=${verifierCookie}`,
    },
  });
  expect(callback.statusCode).toBe(302);
  const session = cookieFrom(callback.headers["set-cookie"], SESSION_COOKIE);
  expect(session).toBeTruthy();
  return session as string;
}

beforeAll(async () => {
  const harness = await createTestApp(
    fakeGoogle({ sub: "google-user-1", email: "miles@example.com" }),
  );
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

/** Submit a played run, having first told the server it took as long as it did. */
async function playSubmit(
  issued: { testId: string; seed: string; count: number },
  state: ReturnType<typeof playTest>,
  cookie?: string,
) {
  const results = computeResults(state);
  await simulateElapsed(db, issued.testId, results.durationMs + 600);
  const payload = { events: state.events };
  return submit(issued.testId, payload, cookie);
}

describe("health", () => {
  it("responds", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.json()).toEqual({ ok: true });
  });
});

describe("issuance", () => {
  it("hands out a seed the client did not choose", async () => {
    const a = await issue();
    const b = await issue();
    expect(a.seed).not.toBe(b.seed);
    expect(a.testId).not.toBe(b.testId);
  });

  it("rejects a length outside the offered set", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tests/issue",
      payload: { mode: "words", count: 37, punctuation: false, numbers: false },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("an honest run", () => {
  it("verifies and returns server-computed results", async () => {
    const issued = await issue();
    const state = playTest(configOf(issued));
    const truth = computeResults(state);

    await simulateElapsed(db, issued.testId, truth.durationMs + 600);
    const response = await submit(issued.testId, {
      events: state.events,
      claimed: { wpm: truth.wpm, accuracy: truth.accuracy },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.verification).toBe("verified");
    expect(body.reasons).toEqual([]);
    expect(body.results.wpm).toBeCloseTo(truth.wpm, 4);
  });

  it("accepts the fractional timestamps a real browser produces", async () => {
    // performance.now() does not return whole milliseconds. This is a
    // regression test: the duration column is an integer, and an unrounded
    // float made the server 500 on every submission from an actual browser.
    const issued = await issue();
    const state = playTest(configOf(issued), { fractional: true });

    const response = await playSubmit(issued, state);
    expect(response.statusCode).toBe(200);
    expect(response.json().verification).toBe("verified");
  });

  it("cannot be submitted twice", async () => {
    const issued = await issue();
    const state = playTest(configOf(issued));

    const first = await playSubmit(issued, state);
    expect(first.statusCode).toBe(200);
    expect(first.json().verification).toBe("verified");

    const second = await submit(issued.testId, { events: state.events });
    expect(second.statusCode).toBe(409);
  });
});

describe("forgery is rejected by the running server", () => {
  it("refuses a log typed against a text the server never issued", async () => {
    const issued = await issue();

    // The attacker plays a test they generated themselves, then submits it
    // against the server's issuance. The replay is against the server's text.
    const attacker = playTest({ ...configOf(issued), seed: "seed-i-picked-myself" });

    const response = await submit(issued.testId, { events: attacker.events });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.verification).toBe("rejected");
    // Replayed against the real words, almost nothing lines up.
    expect(body.results.accuracy).toBeLessThan(40);
  });

  it("refuses a hand-written result with no keystrokes behind it", async () => {
    const issued = await issue();
    const response = await submit(issued.testId, {
      events: [
        {
          t: 0,
          key: "a",
          code: "KeyA",
          kind: "char",
          expected: "a",
          correct: true,
          word: 0,
        },
      ],
      claimed: { wpm: 250, accuracy: 100 },
    });

    const body = response.json();
    expect(body.verification).toBe("rejected");
    expect(body.results.wpm).toBeLessThan(10);
  });

  it("refuses a metronomic log", async () => {
    const issued = await issue();
    const state = playTest(configOf(issued), { cadence: [40] });
    const response = await submit(issued.testId, { events: state.events });
    expect(response.json().verification).toBe("rejected");
    expect(response.json().reasons).toContain("inhuman-rhythm");
  });

  it("refuses a payload that is not a keystroke log at all", async () => {
    const issued = await issue();
    const response = await submit(issued.testId, { events: [{ nonsense: true }] });
    expect(response.statusCode).toBe(400);
  });
});

describe("ownership", () => {
  it("will not let an account submit a guest's issuance", async () => {
    const issued = await issue();
    const session = await signIn();
    const state = playTest(configOf(issued));

    const response = await playSubmit(issued, state, session);
    expect(response.statusCode).toBe(403);
  });

  it("will not let a guest submit an account's issuance", async () => {
    const session = await signIn();
    const issued = await issue(session);
    const state = playTest(configOf(issued));

    const response = await playSubmit(issued, state);
    expect(response.statusCode).toBe(403);
  });
});

describe("sign-in", () => {
  it("creates an account and a session through the callback", async () => {
    const session = await signIn();
    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().username).toBe("miles");
  });

  it("returns the same account on a second sign-in", async () => {
    const first = await signIn();
    const a = await app.inject({ method: "GET", url: "/me", headers: { cookie: `${SESSION_COOKIE}=${first}` } });
    const second = await signIn();
    const b = await app.inject({ method: "GET", url: "/me", headers: { cookie: `${SESSION_COOKIE}=${second}` } });
    expect(a.json().id).toBe(b.json().id);
  });

  it("refuses a callback whose state does not match the handshake", async () => {
    const started = await app.inject({ method: "GET", url: "/auth/google" });
    const handshake = started.headers["set-cookie"];
    const stateCookie = cookieFrom(handshake, "bt_oauth_state");
    const verifierCookie = cookieFrom(handshake, "bt_oauth_verifier");

    const callback = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=abc&state=not-the-state-we-issued",
      headers: { cookie: `bt_oauth_state=${stateCookie}; bt_oauth_verifier=${verifierCookie}` },
    });
    expect(callback.headers.location).toContain("reason=state_mismatch");
  });

  it("refuses a callback with no handshake cookies at all", async () => {
    const callback = await app.inject({
      method: "GET",
      url: "/auth/google/callback?code=abc&state=anything",
    });
    expect(callback.headers.location).toContain("reason=bad_handshake");
  });

  it("signs out", async () => {
    const session = await signIn();
    const out = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    });
    expect(out.statusCode).toBe(200);

    const me = await app.inject({
      method: "GET",
      url: "/me",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    });
    expect(me.statusCode).toBe(401);
  });
});

describe("personal bests", () => {
  it("records a best for a signed-in player and only improves on it", async () => {
    const session = await signIn();

    const first = await issue(session);
    const slow = playTest(configOf(first), { cadence: [140, 190, 165, 210, 150] });
    const slowBody = (await playSubmit(first, slow, session)).json();
    expect(slowBody.verification).toBe("verified");
    expect(slowBody.personalBest.previous).toBeNull();

    const second = await issue(session);
    const fast = playTest(configOf(second), { cadence: [70, 95, 82, 110, 76] });
    const fastBody = (await playSubmit(second, fast, session)).json();
    expect(fastBody.personalBest.previous).toBeCloseTo(slowBody.results.wpm, 4);
    expect(fastBody.personalBest.wpm).toBeGreaterThan(slowBody.results.wpm);

    // A slower run afterwards must not overwrite it.
    const third = await issue(session);
    const slower = playTest(configOf(third), { cadence: [180, 220, 200, 240, 190] });
    const slowerBody = (await playSubmit(third, slower, session)).json();
    expect(slowerBody.personalBest).toBeUndefined();
  });

  it("does not record one for a guest", async () => {
    const issued = await issue();
    const state = playTest(configOf(issued));
    const body = (await playSubmit(issued, state)).json();
    expect(body.verification).toBe("verified");
    expect(body.personalBest).toBeUndefined();
  });
});

describe("cors", () => {
  it("allows the web origin with credentials", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/tests/issue",
      headers: {
        origin: TEST_ENV.WEB_ORIGIN,
        "access-control-request-method": "POST",
      },
    });
    expect(response.headers["access-control-allow-origin"]).toBe(TEST_ENV.WEB_ORIGIN);
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });
});
