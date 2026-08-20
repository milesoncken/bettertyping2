/** Lifecycle of a single test. Named — v1 used -1, 0, 1, 3, 4, 5 with no 2. */
export type Phase = "idle" | "running" | "finished";

export type TestMode = "time" | "words";

export interface TestConfig {
  mode: TestMode;
  /** Seconds. Required for `time` mode, ignored otherwise. */
  duration?: number;
  /** Word count. Required for `words` mode, ignored otherwise. */
  count?: number;
  /** Issued by the server. The word list is a pure function of this. */
  seed: string;
  punctuation: boolean;
  numbers: boolean;
  /**
   * Allow backspacing into words that were already typed correctly.
   * Off by default, matching the convention players expect.
   */
  freedomMode?: boolean;
}

/** What the host hands the engine for a single physical key press. */
export interface KeyInput {
  /** The produced character, or a named key such as `Backspace`. */
  key: string;
  /** Physical key, layout independent. Recorded for analytics, never for logic. */
  code: string;
  /** Monotonic milliseconds. Origin is arbitrary; the engine normalises. */
  t: number;
  ctrl?: boolean;
  alt?: boolean;
  /** Milliseconds the key was held, filled in on keyup. */
  hold?: number;
}

export type KeyEventKind = "char" | "space" | "backspace" | "word-back";

/**
 * One recorded keystroke. The log is the complete, replayable record of a test:
 * every reported number is derived from it, so the server can recompute results
 * from scratch and compare.
 */
export interface KeyEvent {
  /** Milliseconds since the first keystroke of the test. */
  t: number;
  key: string;
  code: string;
  kind: KeyEventKind;
  /** The character expected at the moment this key landed, if any. */
  expected: string | null;
  /** Whether this keystroke was correct on its first attempt. */
  correct: boolean;
  /** Word index this keystroke acted on. */
  word: number;
  hold?: number;
}

export interface WordState {
  target: string;
  /** What the player actually entered. May exceed `target` in length. */
  typed: string;
}

export interface EngineState {
  phase: Phase;
  config: TestConfig;
  words: WordState[];
  cursor: { word: number; char: number };
  events: KeyEvent[];
  /** Raw monotonic timestamp of the first keystroke. */
  startedAt: number | null;
  /** Milliseconds since `startedAt` when the test ended. */
  endedAt: number | null;
}

/** Per-character render status. The view reads this; it never stores its own. */
export type CharStatus = "pending" | "correct" | "incorrect" | "extra";
