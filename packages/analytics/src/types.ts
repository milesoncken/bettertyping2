import type { KeyEventKind } from "@bettertyping/engine";
import type { BigramClass, Hand } from "./keyboard.js";

/**
 * One keystroke with its two timings separated.
 *
 * `flight` is the gap since the previous key went down — the cost of *getting
 * to* this key. `dwell` is how long it stayed down. Two players at the same
 * speed can have opposite profiles, and only one of those numbers is visible in
 * a words-per-minute figure.
 *
 * `dwell` is null for any run recorded before dwell capture existed, and for any
 * key still held when the test ended. A surface that draws it has to say so
 * rather than draw zero.
 */
export interface Keystroke {
  i: number;
  /** Milliseconds since the first keystroke of the run. */
  t: number;
  code: string;
  key: string;
  expected: string | null;
  correct: boolean;
  kind: KeyEventKind;
  word: number;
  flight: number | null;
  dwell: number | null;
}

/** What one physical key did across whatever population it was measured over. */
export interface KeyStat {
  code: string;
  /** The character this key produces, observed from the log. */
  legend: string;
  /** Times this key went down. */
  struck: number;
  /** Times it went down when a different key was wanted. */
  intruded: number;
  /** Times this key was the one the text asked for. */
  wanted: number;
  /** Times it was asked for and something else arrived. */
  missed: number;
  /** Median flight onto this key, ms. 0 when there is no sample. */
  flightMs: number;
  /** Median dwell, ms, or null where nothing recorded a hold. */
  dwellMs: number | null;
}

/** One physical transition — the unit layout arguments are actually about. */
export interface BigramStat {
  /** `${from}>${to}`, on physical codes. */
  pair: string;
  from: string;
  to: string;
  /** The two characters, for a label a human can read. */
  label: string;
  kind: BigramClass;
  /** Times this transition was attempted. */
  n: number;
  /** Times the second key of it was wrong. */
  errors: number;
  /** Median transition latency, ms. */
  latencyMs: number;
}

/**
 * Why a keystroke was wrong.
 *
 * `neighbour` is the split that matters and the one only physical geometry can
 * make: hitting `d` for `f` is a hand missing its mark, and hitting `x` for `f`
 * is a mind losing its place. Practising them the same way helps neither.
 */
export type ErrorKind =
  | "neighbour"
  | "substitution"
  | "transposition"
  | "capitalisation"
  | "insertion"
  | "omission";

export type ErrorTally = Record<ErrorKind, number>;

/** How the run was played, as opposed to how fast. */
export interface Rhythm {
  /** Median flight across every keystroke, ms. */
  flightMs: number;
  /** Median dwell, ms, or null when the run predates dwell capture. */
  dwellMs: number | null;
  /**
   * Seconds before flight times settle to within 10% of the run's steady state.
   * Null when the run was too short to have a steady state to reach.
   */
  warmUpS: number | null;
  /** Change in WPM per second across the run. Negative is fatigue. */
  fatigueSlope: number;
  /** Share of keystrokes per hand, summing to 1. */
  handBalance: Record<Hand, number>;
  /** Share of keystrokes per finger, index 0–9, summing to 1. */
  fingerLoad: number[];
}

/** The transition profile: what shapes your hands make, and what they cost. */
export interface RollProfile {
  counts: Record<BigramClass, number>;
  /** Median latency for each class of transition, ms. */
  latencyMs: Record<BigramClass, number>;
  /** Same-finger transitions as a share of all two-handed classified pairs. */
  sameFingerRate: number;
  /**
   * How much longer a same-finger transition takes than an alternating one, ms.
   * The cost of the layout you are typing on, measured on your own hands.
   */
  sameFingerCostMs: number;
}

/**
 * What the player's board prints, learned from their own keystrokes.
 *
 * Shipping a table per layout would be wrong for anyone on a layout we did not
 * anticipate, and stale for everyone eventually. Every keystroke is a (code,
 * character) pair, so the log tells us directly — and a wrong key is evidence
 * too, since it still printed what it prints.
 */
export interface CharMap {
  /** Physical code → the character it produces. */
  legends: Record<string, string>;
  /** Character → the physical key that produces it. */
  codeForChar: Record<string, string>;
  /**
   * Whether the observed keys agree with QWERTY well enough to guess the ones
   * that have not been pressed yet. False for a player on another layout, whose
   * unpressed keys are then simply left unattributed.
   */
  qwertyLike: boolean;
}

/** Everything one run has to say about itself. */
export interface RunAnalysis {
  keystrokes: Keystroke[];
  keys: KeyStat[];
  bigrams: BigramStat[];
  errors: ErrorTally;
  rhythm: Rhythm;
  rolls: RollProfile;
  /** Observed code → character for this run. */
  legends: Record<string, string>;
  /** Whether this run was typed on something that looks like QWERTY. */
  qwertyLike: boolean;
  /** False for every run recorded before dwell capture landed. */
  hasDwell: boolean;
}
