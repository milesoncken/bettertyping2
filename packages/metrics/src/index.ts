import type { EngineState, KeyEvent } from "@bettertyping/engine";

/**
 * Canonical metric definitions, computed once, here.
 *
 * Everything is derived from the finished state and its keystroke log after the
 * fact — nothing is sampled by a live timer. That is what makes a result
 * reproducible, and reproducibility is the only reason server verification can
 * work at all.
 *
 * Two v1 defects are fixed by construction rather than by patch:
 *
 *  1. Corrections are forgiven where they should be. Character counts come from
 *     the final text, so fixing a typo yields correct characters and full speed.
 *     The mistake still costs you `accuracy`, which is first-attempt by
 *     definition and is the number every other site reports.
 *  2. Speed is net WPM. v1 subtracted incorrect characters from correct ones,
 *     which penalised every error twice and could report a negative number.
 */

export interface CharCounts {
  /** Correct characters in the final text, including advanced word separators. */
  correct: number;
  /** Wrong characters sitting in words the player typed. */
  incorrect: number;
  /** Characters piled on past the end of a word. */
  extra: number;
  /** Characters of a word the player skipped past without typing. */
  missed: number;
}

export interface Sample {
  /** Seconds since the first keystroke. */
  t: number;
  wpm: number;
  rawWpm: number;
  errors: number;
}

export interface Results {
  /** Net WPM: correct characters only. */
  wpm: number;
  /** Every character the player entered, right or wrong. */
  rawWpm: number;
  /** First-attempt keystroke accuracy, 0–100. */
  accuracy: number;
  /** 100 × (1 − σ/μ) over per-second raw WPM, 0–100. */
  consistency: number;
  chars: CharCounts;
  durationMs: number;
  samples: Sample[];
}

const round = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Character tallies from the final text of every word the player reached. */
export function countChars(state: EngineState): CharCounts {
  const counts: CharCounts = { correct: 0, incorrect: 0, extra: 0, missed: 0 };
  const reached = state.cursor.word;

  state.words.forEach((word, index) => {
    const attempted = index < reached || word.typed.length > 0;
    if (!attempted) return;

    for (let i = 0; i < word.typed.length; i++) {
      if (i >= word.target.length) counts.extra += 1;
      else if (word.typed.charAt(i) === word.target.charAt(i)) counts.correct += 1;
      else counts.incorrect += 1;
    }

    if (word.typed.length < word.target.length) {
      // Only words the player moved past count as missed; the word they stopped
      // on mid-way is simply unfinished.
      if (index < reached) counts.missed += word.target.length - word.typed.length;
    }

    // The separator after a word the player completed and moved past counts as
    // a character, the way every comparable test counts it.
    if (index < reached && word.typed === word.target) counts.correct += 1;
  });

  return counts;
}

/** How long the test actually ran, in milliseconds. */
export function durationMs(state: EngineState): number {
  if (state.config.mode === "time" && state.config.duration !== undefined) {
    return state.config.duration * 1000;
  }
  if (state.endedAt !== null) return state.endedAt;
  const last = state.events[state.events.length - 1];
  return last ? last.t : 0;
}

/** First-attempt accuracy: did the keystroke land correctly the first time. */
export function keystrokeAccuracy(events: readonly KeyEvent[]): number {
  let correct = 0;
  let total = 0;
  for (const event of events) {
    if (event.kind !== "char" && event.kind !== "space") continue;
    total += 1;
    if (event.correct) correct += 1;
  }
  return total === 0 ? 0 : (correct / total) * 100;
}

/**
 * Per-second samples, reconstructed from the log rather than recorded live.
 * Two runs of the same keystrokes always produce the same curve.
 */
export function buildSamples(state: EngineState, intervalMs = 1000): Sample[] {
  const total = durationMs(state);
  if (total <= 0) return [];

  const samples: Sample[] = [];
  let index = 0;
  let correctChars = 0;
  let allChars = 0;
  let errors = 0;

  for (let end = intervalMs; end <= total + intervalMs - 1; end += intervalMs) {
    while (index < state.events.length) {
      const event = state.events[index];
      if (!event || event.t >= end) break;
      index += 1;
      if (event.kind !== "char" && event.kind !== "space") continue;
      allChars += 1;
      if (event.correct) correctChars += 1;
      else errors += 1;
    }

    const minutes = Math.min(end, total) / 60000;
    if (minutes <= 0) continue;
    samples.push({
      t: Math.round(Math.min(end, total) / 1000),
      wpm: round(correctChars / 5 / minutes),
      rawWpm: round(allChars / 5 / minutes),
      errors,
    });
  }

  return samples;
}

/** Consistency as the inverse coefficient of variation of raw WPM. */
export function consistencyOf(samples: readonly Sample[]): number {
  const values = samples.map((s) => s.rawWpm).filter((v) => v > 0);
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(0, Math.min(100, (1 - cv) * 100));
}

/** The complete result of a finished test. */
export function computeResults(state: EngineState): Results {
  const chars = countChars(state);
  const total = durationMs(state);
  const minutes = total / 60000;
  const samples = buildSamples(state);

  const typedChars = chars.correct + chars.incorrect + chars.extra;
  const wpm = minutes > 0 ? chars.correct / 5 / minutes : 0;
  const rawWpm = minutes > 0 ? typedChars / 5 / minutes : 0;

  return {
    wpm: round(Math.max(0, wpm)),
    rawWpm: round(Math.max(0, rawWpm)),
    accuracy: round(keystrokeAccuracy(state.events), 1),
    consistency: round(consistencyOf(samples), 1),
    chars,
    durationMs: total,
    samples,
  };
}
