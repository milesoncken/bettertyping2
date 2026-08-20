import { and, asc, desc, eq, gt, isNotNull, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  WINDOW_MS,
  historyQuerySchema,
  leaderboardQuerySchema,
  type BoardWindow,
  type HistoryEntry,
  type HistoryResponse,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type ProfileResponse,
  type RunResponse,
  type Verification,
} from "@bettertyping/schema";
import type { KeyEvent, TestConfig } from "@bettertyping/engine";
import { replay } from "@bettertyping/engine";
import { computeResults } from "@bettertyping/metrics";
import { schema } from "../db.js";
import type { Db } from "../db.js";
import { SESSION_COOKIE, resolveSession } from "../auth/session.js";

/**
 * Leaderboards, profiles and history — the read side.
 *
 * One rule governs every query here: **a board reads `verification = 'verified'`
 * and nothing else.** A flagged run is visible to the person who typed it, in
 * their own history, labelled as held. It never reaches a board. That is the
 * whole difference between this and v1, where the client decided its own
 * `isValid` and the board believed it.
 *
 * A guest run has no `user_id` and therefore cannot appear on a board at all —
 * not by policy check, but because there is no one to attribute it to.
 */

const CHART_RUNS = 20;

/** Lower bound for a window, or null for all-time. */
function since(window: BoardWindow, now = Date.now()): Date | null {
  return window === "all" ? null : new Date(now - WINDOW_MS[window]);
}

/** The shape a run takes in every list. */
function toHistoryEntry(row: {
  id: string;
  mode: string;
  length: number;
  punctuation: boolean;
  numbers: boolean;
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number;
  durationMs: number;
  verification: string;
  createdAt: Date;
}): HistoryEntry {
  return {
    id: row.id,
    mode: row.mode === "time" ? "time" : "words",
    length: row.length,
    punctuation: row.punctuation,
    numbers: row.numbers,
    wpm: row.wpm,
    rawWpm: row.rawWpm,
    accuracy: row.accuracy,
    consistency: row.consistency,
    durationMs: row.durationMs,
    verification: row.verification as Verification,
    createdAt: row.createdAt.toISOString(),
  };
}

export function registerBoardRoutes(app: FastifyInstance, db: Db): void {
  /**
   * One row per player: their best verified run on this board.
   *
   * `DISTINCT ON (user_id)` with the matching `ORDER BY` is Postgres saying
   * "keep the first row in each group" — the alternative, a correlated
   * `MAX(wpm)` subquery, re-scans the table once per player. A tie on speed is
   * settled by who got there first.
   */
  const bestPerUser = (mode: string, length: number, from: Date | null) => {
    const conditions: SQL[] = [
      eq(schema.tests.verification, "verified"),
      isNotNull(schema.tests.userId),
      eq(schema.tests.mode, mode),
      eq(schema.tests.length, length),
    ];
    if (from) conditions.push(gt(schema.tests.createdAt, from));

    return db
      .selectDistinctOn([schema.tests.userId], {
        userId: schema.tests.userId,
        testId: schema.tests.id,
        wpm: schema.tests.wpm,
        rawWpm: schema.tests.rawWpm,
        accuracy: schema.tests.accuracy,
        consistency: schema.tests.consistency,
        punctuation: schema.tests.punctuation,
        numbers: schema.tests.numbers,
        achievedAt: schema.tests.createdAt,
      })
      .from(schema.tests)
      .where(and(...conditions))
      .orderBy(schema.tests.userId, desc(schema.tests.wpm), asc(schema.tests.createdAt))
      .as("best");
  };

  app.get("/leaderboard", async (request, reply) => {
    const parsed = leaderboardQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", detail: parsed.error.issues });
    }
    const { mode, length, window, limit } = parsed.data;
    const from = since(window);

    const board = bestPerUser(mode, length, from);
    const rows = await db
      .select({
        userId: board.userId,
        username: schema.users.username,
        testId: board.testId,
        wpm: board.wpm,
        rawWpm: board.rawWpm,
        accuracy: board.accuracy,
        consistency: board.consistency,
        punctuation: board.punctuation,
        numbers: board.numbers,
        achievedAt: board.achievedAt,
      })
      .from(board)
      .innerJoin(schema.users, eq(schema.users.id, board.userId))
      .orderBy(desc(board.wpm), asc(board.achievedAt))
      .limit(limit);

    const entries: LeaderboardEntry[] = rows.map((row, index) => ({
      rank: index + 1,
      userId: row.userId as string,
      username: row.username,
      testId: row.testId,
      wpm: row.wpm,
      rawWpm: row.rawWpm,
      accuracy: row.accuracy,
      consistency: row.consistency,
      punctuation: row.punctuation,
      numbers: row.numbers,
      achievedAt: row.achievedAt.toISOString(),
    }));

    const session = await resolveSession(db, request.cookies[SESSION_COOKIE]);
    const body: LeaderboardResponse = {
      mode,
      length,
      window,
      entries,
      you: session ? await standing(session.id, session.username) : null,
    };
    return reply.send(body);

    /**
     * Where the signed-in player sits, even a thousand rows down. Their rank is
     * counted rather than read off the page, so it is right whether or not they
     * appear in it.
     */
    async function standing(userId: string, username: string): Promise<LeaderboardEntry | null> {
      const onPage = entries.find((entry) => entry.userId === userId);
      if (onPage) return onPage;

      const conditions: SQL[] = [
        eq(schema.tests.verification, "verified"),
        eq(schema.tests.userId, userId),
        eq(schema.tests.mode, mode),
        eq(schema.tests.length, length),
      ];
      if (from) conditions.push(gt(schema.tests.createdAt, from));

      const mine = await db
        .select()
        .from(schema.tests)
        .where(and(...conditions))
        .orderBy(desc(schema.tests.wpm), asc(schema.tests.createdAt))
        .limit(1);

      const run = mine[0];
      if (!run) return null;

      const ahead = bestPerUser(mode, length, from);
      const counted = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(ahead)
        .where(
          or(
            gt(ahead.wpm, run.wpm),
            and(eq(ahead.wpm, run.wpm), lt(ahead.achievedAt, run.createdAt)),
          ),
        );

      return {
        rank: (counted[0]?.n ?? 0) + 1,
        userId,
        username,
        testId: run.id,
        wpm: run.wpm,
        rawWpm: run.rawWpm,
        accuracy: run.accuracy,
        consistency: run.consistency,
        punctuation: run.punctuation,
        numbers: run.numbers,
        achievedAt: run.createdAt.toISOString(),
      };
    }
  });

  /**
   * Your own history — every run, including the ones that did not count.
   *
   * Keyset pagination on `created_at`, which the `(user_id, created_at)` index
   * already covers. `OFFSET` would re-scan everything it skips and would shift
   * under a run finished mid-scroll.
   */
  app.get("/me/history", async (request, reply) => {
    const session = await resolveSession(db, request.cookies[SESSION_COOKIE]);
    if (!session) return reply.code(401).send({ error: "not_signed_in" });

    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", detail: parsed.error.issues });
    }
    const { limit, before, mode, length } = parsed.data;

    const conditions: SQL[] = [eq(schema.tests.userId, session.id)];
    if (before) conditions.push(lt(schema.tests.createdAt, new Date(before)));
    if (mode) conditions.push(eq(schema.tests.mode, mode));
    if (length !== undefined) conditions.push(eq(schema.tests.length, length));

    // One more than asked for: if it comes back, there is another page.
    const rows = await db
      .select()
      .from(schema.tests)
      .where(and(...conditions))
      .orderBy(desc(schema.tests.createdAt))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const body: HistoryResponse = {
      entries: page.map(toHistoryEntry),
      nextCursor:
        rows.length > limit && page.length > 0
          ? (page[page.length - 1]?.createdAt.toISOString() ?? null)
          : null,
    };
    return reply.send(body);
  });

  /**
   * A public profile.
   *
   * Every number here is taken over verified runs only, so a profile and a
   * board can never tell two different stories about the same player.
   */
  app.get<{ Params: { username: string } }>("/users/:username", async (request, reply) => {
    const found = await db
      .select({ id: schema.users.id, username: schema.users.username, createdAt: schema.users.createdAt })
      .from(schema.users)
      .where(sql`lower(${schema.users.username}) = lower(${request.params.username})`)
      .limit(1);

    const user = found[0];
    if (!user) return reply.code(404).send({ error: "unknown_user" });

    const verified = and(
      eq(schema.tests.userId, user.id),
      eq(schema.tests.verification, "verified"),
    );

    const totalsRows = await db
      .select({
        tests: sql<number>`count(*)::int`,
        durationMs: sql<number>`coalesce(sum(${schema.tests.durationMs}), 0)::bigint`,
        averageWpm: sql<number>`coalesce(avg(${schema.tests.wpm}), 0)::float8`,
        averageAccuracy: sql<number>`coalesce(avg(${schema.tests.accuracy}), 0)::float8`,
        bestWpm: sql<number>`coalesce(max(${schema.tests.wpm}), 0)::float8`,
      })
      .from(schema.tests)
      .where(verified);

    const totals = totalsRows[0];

    const bests = await db
      .select()
      .from(schema.personalBests)
      .where(eq(schema.personalBests.userId, user.id))
      .orderBy(asc(schema.personalBests.mode), asc(schema.personalBests.length));

    const recent = await db
      .select()
      .from(schema.tests)
      .where(verified)
      .orderBy(desc(schema.tests.createdAt))
      .limit(CHART_RUNS);

    const round = (value: number, places = 2): number => {
      const factor = 10 ** places;
      return Math.round(value * factor) / factor;
    };

    const body: ProfileResponse = {
      username: user.username,
      joinedAt: user.createdAt.toISOString(),
      totals: {
        tests: Number(totals?.tests ?? 0),
        secondsTyped: Math.round(Number(totals?.durationMs ?? 0) / 1000),
        averageWpm: round(Number(totals?.averageWpm ?? 0)),
        averageAccuracy: round(Number(totals?.averageAccuracy ?? 0)),
        bestWpm: round(Number(totals?.bestWpm ?? 0)),
      },
      personalBests: bests.map((best) => ({
        mode: best.mode === "time" ? "time" : "words",
        length: best.length,
        wpm: best.wpm,
        testId: best.testId,
        achievedAt: best.achievedAt.toISOString(),
      })),
      // Oldest first: a trend reads left to right.
      recent: recent.map(toHistoryEntry).reverse(),
    };
    return reply.send(body);
  });

  /**
   * One run, replayed from its own keystrokes.
   *
   * The samples this returns are not stored anywhere — they are recomputed by
   * running the keystroke log back through the engine against the seed the
   * server issued. A run's chart is therefore drawn from the same evidence the
   * verifier judged it on, and there is no second copy of the truth to drift.
   *
   * Visibility: a verified run is public, because it is on a board and a board
   * has to be auditable. Anything else is the typist's own business.
   */
  app.get<{ Params: { id: string } }>("/tests/:id", async (request, reply) => {
    // A malformed id would otherwise reach Postgres as an invalid uuid and
    // surface as a 500 rather than the 404 it plainly is.
    if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) {
      return reply.code(404).send({ error: "unknown_test" });
    }

    const rows = await db
      .select({
        test: schema.tests,
        seed: schema.issuedTests.seed,
        duration: schema.issuedTests.duration,
        count: schema.issuedTests.count,
        username: schema.users.username,
      })
      .from(schema.tests)
      .innerJoin(schema.issuedTests, eq(schema.issuedTests.id, schema.tests.issuedTestId))
      .leftJoin(schema.users, eq(schema.users.id, schema.tests.userId))
      .where(eq(schema.tests.id, request.params.id))
      .limit(1);

    const row = rows[0];
    if (!row) return reply.code(404).send({ error: "unknown_test" });

    if (row.test.verification !== "verified") {
      const session = await resolveSession(db, request.cookies[SESSION_COOKIE]);
      if (!session || session.id !== row.test.userId) {
        return reply.code(404).send({ error: "unknown_test" });
      }
    }

    const config: TestConfig = {
      mode: row.test.mode === "time" ? "time" : "words",
      seed: row.seed,
      punctuation: row.test.punctuation,
      numbers: row.test.numbers,
      ...(row.duration !== null ? { duration: row.duration } : {}),
      ...(row.count !== null ? { count: row.count } : {}),
    };

    const results = computeResults(replay(config, row.test.events as KeyEvent[]));

    const body: RunResponse = {
      ...toHistoryEntry(row.test),
      username: row.username,
      reasons: row.test.reasons as string[],
      chars: results.chars,
      samples: results.samples,
    };
    return reply.send(body);
  });
}
