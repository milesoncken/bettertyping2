import { and, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  issueRequestSchema,
  submitRequestSchema,
  type IssueResponse,
  type SubmitResponse,
} from "@bettertyping/schema";
import type { KeyEvent, TestConfig } from "@bettertyping/engine";
import { verifySubmission } from "@bettertyping/verify";
import { analyseRun } from "@bettertyping/analytics";
import { replay } from "@bettertyping/engine";
import { writeRollups } from "./analysis.js";
import { randomBytes } from "node:crypto";
import { schema } from "../db.js";
import type { Db } from "../db.js";
import { SESSION_COOKIE, resolveSession } from "../auth/session.js";

/**
 * Test issuance and submission.
 *
 * The shape that makes the leaderboard mean anything: **the server chooses the
 * seed**, remembers it, and will only accept keystrokes replayed against the
 * text that seed generates. A client can no longer report what it typed — only
 * how it typed.
 */

/** Naive per-key rate limiting. Per-instance, which is honest about its limits. */
function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return function allow(key: string): boolean {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

export function registerTestRoutes(app: FastifyInstance, db: Db): void {
  const issueLimiter = createRateLimiter(60, 60_000);
  const submitLimiter = createRateLimiter(40, 60_000);

  app.post("/tests/issue", async (request, reply) => {
    const parsed = issueRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", detail: parsed.error.issues });
    }

    const session = await resolveSession(db, request.cookies[SESSION_COOKIE]);
    const key = session?.id ?? request.ip;
    if (!issueLimiter(key)) return reply.code(429).send({ error: "rate_limited" });

    const config = parsed.data;
    const seed = randomBytes(9).toString("base64url");

    const inserted = await db
      .insert(schema.issuedTests)
      .values({
        userId: session?.id ?? null,
        seed,
        mode: config.mode,
        duration: config.duration ?? null,
        count: config.count ?? null,
        punctuation: config.punctuation,
        numbers: config.numbers,
      })
      .returning({ id: schema.issuedTests.id, issuedAt: schema.issuedTests.issuedAt });

    const row = inserted[0];
    if (!row) return reply.code(500).send({ error: "issue_failed" });

    const body: IssueResponse = {
      testId: row.id,
      seed,
      mode: config.mode,
      punctuation: config.punctuation,
      numbers: config.numbers,
      issuedAt: row.issuedAt.toISOString(),
      ...(config.duration !== undefined ? { duration: config.duration } : {}),
      ...(config.count !== undefined ? { count: config.count } : {}),
    };
    return reply.send(body);
  });

  app.post<{ Params: { id: string } }>("/tests/:id/submit", async (request, reply) => {
    const parsed = submitRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", detail: parsed.error.issues });
    }

    const session = await resolveSession(db, request.cookies[SESSION_COOKIE]);
    const key = session?.id ?? request.ip;
    if (!submitLimiter(key)) return reply.code(429).send({ error: "rate_limited" });

    const issuedRows = await db
      .select()
      .from(schema.issuedTests)
      .where(eq(schema.issuedTests.id, request.params.id))
      .limit(1);

    const issued = issuedRows[0];
    if (!issued) return reply.code(404).send({ error: "unknown_test" });

    // An issuance belongs to whoever it was handed to. A guest issuance cannot
    // later be claimed by an account, and one account cannot submit another's.
    if (issued.userId !== (session?.id ?? null)) {
      return reply.code(403).send({ error: "not_your_test" });
    }

    // Single use. Claiming the consumption before verifying means a replayed
    // request loses the race rather than producing a second row.
    const claimed = await db
      .update(schema.issuedTests)
      .set({ consumedAt: new Date() })
      .where(and(eq(schema.issuedTests.id, issued.id), isNull(schema.issuedTests.consumedAt)))
      .returning({ id: schema.issuedTests.id });

    if (claimed.length === 0) return reply.code(409).send({ error: "already_submitted" });

    const config: TestConfig = {
      mode: issued.mode === "time" ? "time" : "words",
      seed: issued.seed,
      punctuation: issued.punctuation,
      numbers: issued.numbers,
      ...(issued.duration !== null ? { duration: issued.duration } : {}),
      ...(issued.count !== null ? { count: issued.count } : {}),
    };

    // Normalise at the edge: the parser yields an explicit `hold: undefined`
    // where the engine's type says the key is simply absent.
    const events: KeyEvent[] = parsed.data.events.map((event) => ({
      t: event.t,
      key: event.key,
      code: event.code,
      kind: event.kind,
      expected: event.expected,
      correct: event.correct,
      word: event.word,
      ...(event.hold !== undefined ? { hold: event.hold } : {}),
    }));

    const outcome = verifySubmission({
      config,
      events,
      claimed: parsed.data.claimed,
      issuedAt: issued.issuedAt.getTime(),
      receivedAt: Date.now(),
    });

    const length = config.mode === "time" ? (config.duration ?? 0) : (config.count ?? 0);

    const testRows = await db
      .insert(schema.tests)
      .values({
        issuedTestId: issued.id,
        userId: session?.id ?? null,
        mode: config.mode,
        length,
        punctuation: config.punctuation,
        numbers: config.numbers,
        wpm: outcome.results.wpm,
        rawWpm: outcome.results.rawWpm,
        accuracy: outcome.results.accuracy,
        consistency: outcome.results.consistency,
        // Real keystroke timestamps come from performance.now() and are
        // fractional; the column is whole milliseconds, and sub-millisecond
        // precision on a whole run is noise.
        durationMs: Math.round(outcome.results.durationMs),
        chars: outcome.results.chars,
        verification: outcome.verification,
        reasons: outcome.reasons,
        events,
      })
      .returning({ id: schema.tests.id });

    const testRow = testRows[0];
    const body: SubmitResponse = {
      verification: outcome.verification,
      reasons: outcome.reasons,
      results: {
        wpm: outcome.results.wpm,
        rawWpm: outcome.results.rawWpm,
        accuracy: outcome.results.accuracy,
        consistency: outcome.results.consistency,
        // Real keystroke timestamps come from performance.now() and are
        // fractional; the column is whole milliseconds, and sub-millisecond
        // precision on a whole run is noise.
        durationMs: Math.round(outcome.results.durationMs),
        chars: outcome.results.chars,
      },
    };

    /**
     * Fold the run into the player's analytics.
     *
     * Verified runs only, and only for an account — the same population every
     * other aggregate is taken over. A guest has nobody to attribute a key to,
     * and a rejected run is not evidence of how anyone's hands work.
     *
     * The replay is a second pass over a log the verifier already replayed. It
     * costs microseconds on a few hundred events, and the alternative is
     * threading engine state out through the verifier's result purely to save
     * it — which would make the verifier's job less clear to save nothing.
     */
    if (session && outcome.verification === "verified") {
      await writeRollups(db, session.id, analyseRun(replay(config, events)));
    }

    // Only a verified run held by an account can move a personal best.
    if (session && testRow && outcome.verification === "verified") {
      const best = await upsertPersonalBest(db, {
        userId: session.id,
        testId: testRow.id,
        mode: config.mode,
        length,
        wpm: outcome.results.wpm,
      });
      if (best) body.personalBest = best;
    }

    return reply.send(body);
  });
}

async function upsertPersonalBest(
  db: Db,
  entry: { userId: string; testId: string; mode: string; length: number; wpm: number },
): Promise<{ previous: number | null; wpm: number } | null> {
  const existing = await db
    .select({ wpm: schema.personalBests.wpm })
    .from(schema.personalBests)
    .where(
      and(
        eq(schema.personalBests.userId, entry.userId),
        eq(schema.personalBests.mode, entry.mode),
        eq(schema.personalBests.length, entry.length),
      ),
    )
    .limit(1);

  const previous = existing[0]?.wpm ?? null;
  if (previous !== null && previous >= entry.wpm) return null;

  await db
    .insert(schema.personalBests)
    .values({
      userId: entry.userId,
      testId: entry.testId,
      mode: entry.mode,
      length: entry.length,
      wpm: entry.wpm,
      achievedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.personalBests.userId,
        schema.personalBests.mode,
        schema.personalBests.length,
      ],
      set: { wpm: entry.wpm, testId: entry.testId, achievedAt: new Date() },
    });

  return { previous, wpm: entry.wpm };
}
