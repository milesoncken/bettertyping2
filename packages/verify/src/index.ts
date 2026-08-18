import { replay } from "@bettertyping/engine";
import type { KeyEvent, TestConfig } from "@bettertyping/engine";
import { computeResults } from "@bettertyping/metrics";
import type { Results } from "@bettertyping/metrics";

/**
 * Submission verification.
 *
 * The whole point of the rewrite in one function. A client sends the keystrokes
 * it produced; the server regenerates the text from the seed it issued, replays
 * those keystrokes through the *same engine the browser ran*, recomputes the
 * results, and then asks whether a human could have produced them.
 *
 * Pure on purpose — no database, no clock, no request object — so every rule
 * below is directly testable, and so it can move to a worker later without
 * changing.
 */

export type Verification = "verified" | "flagged" | "rejected";

export interface VerifyInput {
  /** The config as issued, including the seed the server chose. */
  config: TestConfig;
  events: readonly KeyEvent[];
  /** What the client claims it scored, if it said. */
  claimed?: { wpm: number; accuracy: number } | undefined;
  /** Epoch ms the server handed out this test. */
  issuedAt: number;
  /** Epoch ms the submission arrived. */
  receivedAt: number;
}

export interface VerifyOutput {
  verification: Verification;
  /** Machine-readable rule identifiers, worst first. Empty when clean. */
  reasons: string[];
  /** Recomputed from the keystrokes. Never the client's numbers. */
  results: Results;
}

/**
 * Thresholds, gathered so they can be argued about in one place.
 *
 * These are deliberately generous. A false rejection costs a real player their
 * run and their trust; a false acceptance costs one flagged row that a stricter
 * review can still catch. Where a rule is uncertain it flags rather than rejects.
 */
export const LIMITS = {
  /** Below this, it is not a test. */
  minKeystrokes: 12,
  minDurationMs: 1_000,

  /** The client's own numbers may differ by this much before we call it a lie. */
  claimToleranceWpm: 1.5,
  claimToleranceAccuracy: 1.5,

  /**
   * No human presses two different keys this close together. The world record
   * holders sit around 20ms between keystrokes at peak; 6ms is 1,600 wpm.
   */
  impossibleIntervalMs: 6,
  /** A few may be genuine rollover on adjacent fingers. A pattern is not. */
  maxImpossibleShare: 0.02,

  /**
   * Humans are not metronomes. Real typing has a coefficient of variation in
   * inter-keystroke intervals around 0.25–0.7; a script sits near zero.
   */
  minIntervalCv: 0.08,
  /** Below this many keystrokes the CV is too noisy to judge. */
  cvMinSamples: 40,

  /** A run at or above this is held for stricter review before it ranks. */
  reviewWpm: 160,

  /**
   * Slack on wall-clock plausibility, and deliberately small.
   *
   * A late submission only makes the issue window *larger*, which is harmless.
   * A run whose duration exceeds the window it happened in is a stretched log,
   * and there is no honest reason for it — both clocks measure elapsed real
   * time. This covers measurement noise and a small NTP correction, nothing more.
   */
  wallClockSlackMs: 2_000,
} as const;

/** Intervals between successive *typed* keystrokes, in ms. */
function intervalsOf(events: readonly KeyEvent[]): number[] {
  const out: number[] = [];
  let previous: number | null = null;
  for (const event of events) {
    if (event.kind !== "char" && event.kind !== "space") continue;
    if (previous !== null) out.push(event.t - previous);
    previous = event.t;
  }
  return out;
}

function coefficientOfVariation(values: readonly number[]): number {
  if (values.length < 2) return Number.POSITIVE_INFINITY;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return 0;
  const variance =
    values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

export function verifySubmission(input: VerifyInput): VerifyOutput {
  const { config, events, claimed, issuedAt, receivedAt } = input;

  // Replay through the real engine against the text we issued. If the client
  // typed against different words, the reconstruction simply will not match.
  const state = replay(config, events);
  const results = computeResults(state);

  const reject: string[] = [];
  const flag: string[] = [];

  // ── Is it a test at all? ────────────────────────────────────────────────
  const typed = events.filter((e) => e.kind === "char" || e.kind === "space");
  if (typed.length < LIMITS.minKeystrokes) reject.push("too-few-keystrokes");
  if (results.durationMs < LIMITS.minDurationMs) reject.push("too-short");

  // ── Timestamps ──────────────────────────────────────────────────────────
  let monotonic = true;
  for (let i = 1; i < events.length; i++) {
    if ((events[i]?.t ?? 0) < (events[i - 1]?.t ?? 0)) {
      monotonic = false;
      break;
    }
  }
  if (!monotonic) reject.push("non-monotonic-timestamps");

  // The run cannot have taken longer than the window it was issued in. Tab
  // throttling and a slow upload go the other way, so this only catches a log
  // stretched to inflate a duration.
  const window = receivedAt - issuedAt;
  if (window >= 0 && results.durationMs > window + LIMITS.wallClockSlackMs) {
    reject.push("duration-exceeds-issue-window");
  }
  if (window < 0) reject.push("submitted-before-issued");

  // A time test always runs its full length; anything else is a truncated log.
  if (config.mode === "time" && config.duration !== undefined) {
    const last = events[events.length - 1];
    if (last && last.t > config.duration * 1000 + 2_000) {
      reject.push("keystrokes-after-time-expired");
    }
  }

  // ── Could hands have done this? ─────────────────────────────────────────
  const intervals = intervalsOf(events);
  if (intervals.length > 0) {
    const impossible = intervals.filter((ms) => ms < LIMITS.impossibleIntervalMs).length;
    if (impossible / intervals.length > LIMITS.maxImpossibleShare) {
      reject.push("impossible-keystroke-intervals");
    }

    if (intervals.length >= LIMITS.cvMinSamples) {
      const cv = coefficientOfVariation(intervals);
      if (cv < LIMITS.minIntervalCv) reject.push("inhuman-rhythm");
    }
  }

  // Hold times are optional, but a log where every key was held for exactly the
  // same number of milliseconds was not produced by a hand.
  const holds = events.map((e) => e.hold).filter((h): h is number => h !== undefined);
  if (holds.length >= LIMITS.cvMinSamples && coefficientOfVariation(holds) < 0.02) {
    flag.push("uniform-hold-times");
  }

  // ── Does the client agree with us? ──────────────────────────────────────
  if (claimed) {
    if (Math.abs(claimed.wpm - results.wpm) > LIMITS.claimToleranceWpm) {
      reject.push("claimed-wpm-mismatch");
    }
    if (Math.abs(claimed.accuracy - results.accuracy) > LIMITS.claimToleranceAccuracy) {
      reject.push("claimed-accuracy-mismatch");
    }
  }

  // ── Exceptional, so held for a closer look ──────────────────────────────
  if (results.wpm >= LIMITS.reviewWpm) flag.push("above-review-threshold");

  if (reject.length > 0) {
    return { verification: "rejected", reasons: reject, results };
  }
  if (flag.length > 0) {
    return { verification: "flagged", reasons: flag, results };
  }
  return { verification: "verified", reasons: [], results };
}
