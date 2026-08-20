import { QWERTY_LEGEND, type BigramClass } from "./keyboard.js";
import { round } from "./stats.js";
import type { BigramStat, KeyStat, RollProfile, RunAnalysis } from "./types.js";

/**
 * Rolling one run's analysis into a player's running totals.
 *
 * The awkward fact this file exists to handle: **medians do not merge.** You
 * cannot add today's median to yesterday's and get anything meaningful, and
 * keeping every raw sample forever so the true median can be recomputed is the
 * scan-the-whole-log design the rollup tables exist to avoid.
 *
 * So what accumulates is a **sum of per-run medians and a count of runs**, and
 * the aggregate figure is their mean. Each run's outliers were already killed by
 * that run's own median, so the result is robust to a sneeze in a way a running
 * mean of raw samples would not be, and it merges by addition — which is all a
 * `SET x = x + $1` upsert can do.
 *
 * The counts either side of it — strikes, misses, errors — are plain sums, and
 * mean exactly what they say.
 */

/** What one run contributes to one key's row. */
export interface KeyRollupDelta {
  code: string;
  legend: string;
  struck: number;
  intruded: number;
  wanted: number;
  missed: number;
  /** This run's median flight onto the key, ms. Zero when it had no sample. */
  flightMedianMs: number;
  /** 1 when this run contributed a flight median, else 0. */
  flightRuns: number;
  dwellMedianMs: number;
  dwellRuns: number;
}

/** What one run contributes to one transition's row. */
export interface BigramRollupDelta {
  pair: string;
  from: string;
  to: string;
  label: string;
  kind: BigramClass;
  n: number;
  errors: number;
  latencyMedianMs: number;
  latencyRuns: number;
}

/** A stored key row: every delta above, summed. */
export interface KeyRollupRow {
  code: string;
  legend: string;
  struck: number;
  intruded: number;
  wanted: number;
  missed: number;
  flightSumMs: number;
  flightRuns: number;
  dwellSumMs: number;
  dwellRuns: number;
}

/** A stored transition row. */
export interface BigramRollupRow {
  pair: string;
  from: string;
  to: string;
  label: string;
  kind: string;
  n: number;
  errors: number;
  latencySumMs: number;
  latencyRuns: number;
}

/** A player's analysis, read back out of their rollups. */
export interface AggregateAnalysis {
  keys: KeyStat[];
  bigrams: BigramStat[];
  rolls: RollProfile;
  /** Runs that have contributed at least one dwell sample. */
  dwellRuns: number;
}

const CLASSES: readonly BigramClass[] = [
  "same-key",
  "same-finger",
  "in-roll",
  "out-roll",
  "alternate",
  "thumb",
];

const isClass = (value: string): value is BigramClass =>
  (CLASSES as readonly string[]).includes(value);

/** What a finished run adds to the rollups. */
export function rollupDeltas(analysis: RunAnalysis): {
  keys: KeyRollupDelta[];
  bigrams: BigramRollupDelta[];
} {
  return {
    keys: analysis.keys.map((key) => ({
      code: key.code,
      legend: key.legend,
      struck: key.struck,
      intruded: key.intruded,
      wanted: key.wanted,
      missed: key.missed,
      flightMedianMs: key.flightMs,
      flightRuns: key.flightMs > 0 ? 1 : 0,
      dwellMedianMs: key.dwellMs ?? 0,
      dwellRuns: key.dwellMs !== null ? 1 : 0,
    })),
    bigrams: analysis.bigrams.map((bigram) => ({
      pair: bigram.pair,
      from: bigram.from,
      to: bigram.to,
      label: bigram.label,
      kind: bigram.kind,
      n: bigram.n,
      errors: bigram.errors,
      latencyMedianMs: bigram.latencyMs,
      latencyRuns: bigram.latencyMs > 0 ? 1 : 0,
    })),
  };
}

const meanOf = (sum: number, runs: number): number =>
  runs === 0 ? 0 : round(sum / runs, 1);

/** Read a player's key rows back as the same shape one run produces. */
export function keysFromRollup(rows: readonly KeyRollupRow[]): KeyStat[] {
  return rows
    .map((row) => ({
      code: row.code,
      legend: row.legend !== "" ? row.legend : QWERTY_LEGEND(row.code),
      struck: row.struck,
      intruded: row.intruded,
      wanted: row.wanted,
      missed: row.missed,
      flightMs: meanOf(row.flightSumMs, row.flightRuns),
      dwellMs: row.dwellRuns > 0 ? meanOf(row.dwellSumMs, row.dwellRuns) : null,
    }))
    .sort((a, b) => b.struck - a.struck);
}

/** Read a player's transition rows back as the same shape one run produces. */
export function bigramsFromRollup(rows: readonly BigramRollupRow[]): BigramStat[] {
  return rows
    .map((row) => ({
      pair: row.pair,
      from: row.from,
      to: row.to,
      label: row.label,
      kind: isClass(row.kind) ? row.kind : "alternate",
      n: row.n,
      errors: row.errors,
      latencyMs: meanOf(row.latencySumMs, row.latencyRuns),
    }))
    .sort((a, b) => b.n - a.n);
}

/**
 * The transition profile across a history.
 *
 * Each class's latency is the **n-weighted mean** of its pairs' figures rather
 * than a plain average: `th` happening two hundred times and `qj` twice should
 * not count equally toward what an in-roll costs you, because they do not count
 * equally toward your typing.
 */
export function rollsFrom(bigrams: readonly BigramStat[]): RollProfile {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<
    BigramClass,
    number
  >;
  const weighted = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<
    BigramClass,
    number
  >;
  const weights = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<
    BigramClass,
    number
  >;

  for (const bigram of bigrams) {
    counts[bigram.kind] += bigram.n;
    if (bigram.latencyMs > 0) {
      weighted[bigram.kind] += bigram.latencyMs * bigram.n;
      weights[bigram.kind] += bigram.n;
    }
  }

  const latencyMs = Object.fromEntries(
    CLASSES.map((c) => [c, weights[c] === 0 ? 0 : round(weighted[c] / weights[c], 1)]),
  ) as Record<BigramClass, number>;

  const handed =
    counts["same-key"] +
    counts["same-finger"] +
    counts["in-roll"] +
    counts["out-roll"] +
    counts["alternate"];
  const alternate = latencyMs["alternate"];
  const sameFinger = latencyMs["same-finger"];

  return {
    counts,
    latencyMs,
    sameFingerRate: handed === 0 ? 0 : round(counts["same-finger"] / handed, 4),
    sameFingerCostMs:
      alternate > 0 && sameFinger > 0 ? round(sameFinger - alternate, 1) : 0,
  };
}

/** A player's whole analysis, assembled from their stored rows. */
export function aggregateFromRollup(
  keyRows: readonly KeyRollupRow[],
  bigramRows: readonly BigramRollupRow[],
): AggregateAnalysis {
  const bigrams = bigramsFromRollup(bigramRows);
  return {
    keys: keysFromRollup(keyRows),
    bigrams,
    rolls: rollsFrom(bigrams),
    dwellRuns: keyRows.reduce((most, row) => Math.max(most, row.dwellRuns), 0),
  };
}
