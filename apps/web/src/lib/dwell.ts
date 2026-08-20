import type { EngineState, KeyEvent } from "@bettertyping/engine";

/**
 * Dwell time — how long a key stays down — recorded without touching the frame.
 *
 * The awkwardness this file exists to absorb: a keystroke is recorded when the
 * key goes *down*, and its hold is not known until it comes back *up*. Writing
 * the hold back into engine state on `keyup` would mean a second render per
 * keystroke, on the one path in this product with a one-frame budget.
 *
 * So holds are filed off to the side, in a plain `Map`, and merged into the
 * event log exactly once — when the run is over and the numbers are wanted.
 * Nothing here runs during a render, and `keyup` costs one map write.
 *
 * Entries are keyed by physical key plus the whole millisecond the key went
 * down. Rounding matters: the log stores `t` normalised against the first
 * keystroke, so looking a hold up again means computing `t + startedAt`, and
 * `(a - b) + b` is not obliged to give back exactly `a` in floating point.
 * Whole milliseconds are far coarser than that error and far finer than two
 * presses of the same key, so the key is stable in both directions.
 */

export type DwellLog = Map<string, number>;

export const dwellKey = (code: string, rawT: number): string =>
  `${code}:${Math.round(rawT)}`;

/**
 * The wire contract caps a hold at a minute. A key that was somehow held longer
 * — a tab switched away mid-press — is clamped rather than allowed to fail
 * validation and take an otherwise good run down with it.
 */
const MAX_HOLD_MS = 60_000;

export const clampHold = (ms: number): number => Math.min(MAX_HOLD_MS, Math.max(0, ms));

/**
 * The event log with holds filled in.
 *
 * A run typed before dwell capture existed, or a key still down when the test
 * ended, simply has no hold — the field stays absent, and every surface that
 * draws dwell has to handle that rather than draw a confident zero.
 */
export function eventsWithDwell(state: EngineState, dwells: DwellLog): KeyEvent[] {
  const startedAt = state.startedAt;
  if (startedAt === null || dwells.size === 0) return state.events.slice();

  return state.events.map((event) => {
    const hold = dwells.get(dwellKey(event.code, event.t + startedAt));
    return hold === undefined ? event : { ...event, hold };
  });
}

/** The same state, with dwell merged in, for anything that analyses it locally. */
export function withDwell(state: EngineState, dwells: DwellLog): EngineState {
  if (dwells.size === 0) return state;
  return { ...state, events: eventsWithDwell(state, dwells) };
}
