import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  RUNS_FOR_CONFIDENCE,
  type AnalysisResponse,
  type HistoryEntry,
  type RibbonResponse,
  type Verification,
} from "@bettertyping/schema";
import type { KeyEvent, TestConfig } from "@bettertyping/engine";
import { replay } from "@bettertyping/engine";
import {
  aggregateFromRollup,
  keystrokesOf,
  looksQwerty,
  rollupDeltas,
  type BigramRollupRow,
  type KeyRollupRow,
  type RunAnalysis,
} from "@bettertyping/analytics";
import { schema } from "../db.js";
import type { Db } from "../db.js";
import { SESSION_COOKIE, resolveSession } from "../auth/session.js";

/**
 * The analysis surface.
 *
 * Two shapes, because the dashboard asks two different questions. *What are my
 * hands like* is a question about a history, answered from the rollups in one
 * indexed read. *What happened in that run* is a question about one log, and is
 * answered by replaying it — the same way `/tests/:id` recomputes its chart,
 * and for the same reason: the drawing and the verdict must come from one piece
 * of evidence, or they will eventually disagree.
 */

/** Transitions returned to a dashboard. Beyond this the Rose is a solid disc. */
const BIGRAM_LIMIT = 300;

/** Recent runs offered as Ribbon subjects. */
const RECENT_RUNS = 20;

/**
 * Transitions written per run.
 *
 * A run is bounded by the wire contract at 20,000 keystrokes, which would be
 * 20,000 upserts in one statement. The tail of that list is pairs typed once,
 * which no figure here is computed from, so the statement is bounded to the
 * transitions that actually carry weight.
 */
const BIGRAM_WRITE_LIMIT = 800;

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

/**
 * Fold one verified run into a player's rollups.
 *
 * Two statements, not four hundred. Each is a multi-row insert whose conflict
 * clause adds the new row to the stored one — `SET n = n + excluded.n` — so a
 * run of any size costs two round trips, and two runs submitted at the same
 * moment cannot lose an update to each other the way a read-modify-write would.
 */
export async function writeRollups(
  db: Db,
  userId: string,
  analysis: RunAnalysis,
): Promise<void> {
  const deltas = rollupDeltas(analysis);

  if (deltas.keys.length > 0) {
    await db
      .insert(schema.keyStats)
      .values(
        deltas.keys.map((delta) => ({
          userId,
          code: delta.code,
          legend: delta.legend,
          struck: delta.struck,
          intruded: delta.intruded,
          wanted: delta.wanted,
          missed: delta.missed,
          flightSumMs: delta.flightMedianMs,
          flightRuns: delta.flightRuns,
          dwellSumMs: delta.dwellMedianMs,
          dwellRuns: delta.dwellRuns,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.keyStats.userId, schema.keyStats.code],
        set: {
          // The legend is a fact about the board, not a running total: the most
          // recent observation replaces the old one, so remapping a keyboard
          // shows up rather than being averaged with the layout before it.
          legend: sql`excluded.legend`,
          struck: sql`${schema.keyStats.struck} + excluded.struck`,
          intruded: sql`${schema.keyStats.intruded} + excluded.intruded`,
          wanted: sql`${schema.keyStats.wanted} + excluded.wanted`,
          missed: sql`${schema.keyStats.missed} + excluded.missed`,
          flightSumMs: sql`${schema.keyStats.flightSumMs} + excluded.flight_sum_ms`,
          flightRuns: sql`${schema.keyStats.flightRuns} + excluded.flight_runs`,
          dwellSumMs: sql`${schema.keyStats.dwellSumMs} + excluded.dwell_sum_ms`,
          dwellRuns: sql`${schema.keyStats.dwellRuns} + excluded.dwell_runs`,
        },
      });
  }

  const bigrams = deltas.bigrams.slice(0, BIGRAM_WRITE_LIMIT);
  if (bigrams.length > 0) {
    await db
      .insert(schema.bigramStats)
      .values(
        bigrams.map((delta) => ({
          userId,
          pair: delta.pair,
          fromCode: delta.from,
          toCode: delta.to,
          label: delta.label,
          kind: delta.kind,
          n: delta.n,
          errors: delta.errors,
          latencySumMs: delta.latencyMedianMs,
          latencyRuns: delta.latencyRuns,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.bigramStats.userId, schema.bigramStats.pair],
        set: {
          label: sql`excluded.label`,
          n: sql`${schema.bigramStats.n} + excluded.n`,
          errors: sql`${schema.bigramStats.errors} + excluded.errors`,
          latencySumMs: sql`${schema.bigramStats.latencySumMs} + excluded.latency_sum_ms`,
          latencyRuns: sql`${schema.bigramStats.latencyRuns} + excluded.latency_runs`,
        },
      });
  }
}

export function registerAnalysisRoutes(app: FastifyInstance, db: Db): void {
  /**
   * A player's hands, folded from every verified run they have finished.
   *
   * Verified only, matching every other aggregate in the product: a profile, a
   * board and this page are all computed over one population, so they can never
   * tell three different stories about the same person.
   */
  app.get<{ Params: { username: string } }>(
    "/users/:username/analysis",
    async (request, reply) => {
      const found = await db
        .select({ id: schema.users.id, username: schema.users.username })
        .from(schema.users)
        .where(sql`lower(${schema.users.username}) = lower(${request.params.username})`)
        .limit(1);

      const user = found[0];
      if (!user) return reply.code(404).send({ error: "unknown_user" });

      const verified = and(
        eq(schema.tests.userId, user.id),
        eq(schema.tests.verification, "verified"),
      );

      const [keyRows, bigramRows, countRows, recentRows] = await Promise.all([
        db.select().from(schema.keyStats).where(eq(schema.keyStats.userId, user.id)),
        db
          .select()
          .from(schema.bigramStats)
          .where(eq(schema.bigramStats.userId, user.id))
          .orderBy(desc(schema.bigramStats.n))
          .limit(BIGRAM_LIMIT),
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.tests)
          .where(verified),
        db
          .select()
          .from(schema.tests)
          .where(verified)
          .orderBy(desc(schema.tests.createdAt))
          .limit(RECENT_RUNS),
      ]);

      const keys: KeyRollupRow[] = keyRows.map((row) => ({
        code: row.code,
        legend: row.legend,
        struck: row.struck,
        intruded: row.intruded,
        wanted: row.wanted,
        missed: row.missed,
        flightSumMs: row.flightSumMs,
        flightRuns: row.flightRuns,
        dwellSumMs: row.dwellSumMs,
        dwellRuns: row.dwellRuns,
      }));

      const bigrams: BigramRollupRow[] = bigramRows.map((row) => ({
        pair: row.pair,
        from: row.fromCode,
        to: row.toCode,
        label: row.label,
        kind: row.kind,
        n: row.n,
        errors: row.errors,
        latencySumMs: row.latencySumMs,
        latencyRuns: row.latencyRuns,
      }));

      const aggregate = aggregateFromRollup(keys, bigrams);
      const runs = Number(countRows[0]?.n ?? 0);

      const legends: Record<string, string> = {};
      for (const row of keys) if (row.legend !== "") legends[row.code] = row.legend;

      const body: AnalysisResponse = {
        username: user.username,
        runs,
        runsUntilConfident: Math.max(0, RUNS_FOR_CONFIDENCE - runs),
        keys: aggregate.keys,
        bigrams: aggregate.bigrams,
        rolls: aggregate.rolls,
        qwertyLike: looksQwerty(legends),
        dwellRuns: aggregate.dwellRuns,
        recent: recentRows.map(toHistoryEntry),
      };
      return reply.send(body);
    },
  );

  /**
   * One run, keystroke by keystroke — the Ribbon's raw material.
   *
   * Visibility follows `/tests/:id` exactly: a verified run is public because it
   * is on a board and a board has to be auditable; anything else is the typist's
   * own business.
   */
  app.get<{ Params: { id: string } }>("/tests/:id/ribbon", async (request, reply) => {
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
      .innerJoin(
        schema.issuedTests,
        eq(schema.issuedTests.id, schema.tests.issuedTestId),
      )
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

    // Replayed, not read: these are the keystrokes the engine accepted, which
    // are the keystrokes the verifier judged.
    const state = replay(config, row.test.events as KeyEvent[]);

    const body: RibbonResponse = {
      ...toHistoryEntry(row.test),
      username: row.username,
      hasDwell: state.events.some((event) => event.hold !== undefined),
      keystrokes: keystrokesOf(state.events),
    };
    return reply.send(body);
  });
}
