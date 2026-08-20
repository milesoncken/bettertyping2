import { generateWords, initialWordCount, wordAt } from "./words.js";
import type {
  CharStatus,
  EngineState,
  KeyEvent,
  KeyInput,
  TestConfig,
  WordState,
} from "./types.js";

/**
 * The typing engine: a pure reducer over keystrokes.
 *
 * No DOM, no React, no timers, no ambient clock. Every output is a function of
 * (config, keystrokes), which is what lets the same code run in the browser for
 * feedback and on the server for verification.
 */

/** Characters a player may pile on past the end of a word before we stop taking them. */
const MAX_EXTRA_CHARS = 12;

/** Words to append to a `time` test whenever the player approaches the end. */
const EXTEND_CHUNK = 30;
const EXTEND_MARGIN = 20;

export function createState(config: TestConfig): EngineState {
  const targets = generateWords(config, initialWordCount(config));
  return {
    phase: "idle",
    config,
    words: targets.map((target) => ({ target, typed: "" })),
    cursor: { word: 0, char: 0 },
    events: [],
    startedAt: null,
    endedAt: null,
  };
}

const isPrintable = (key: string): boolean =>
  key.length === 1 && key !== "\n" && key !== "\r";

/** The character the player is expected to produce right now, if any. */
export function expectedChar(state: EngineState): string | null {
  const word = state.words[state.cursor.word];
  if (!word) return null;
  if (state.cursor.char < word.target.length) {
    return word.target.charAt(state.cursor.char);
  }
  // Past the end of the word, the next correct keystroke is the space.
  return " ";
}

function wordHasError(word: WordState): boolean {
  if (word.typed.length !== word.target.length) return true;
  return word.typed !== word.target;
}

function extendIfNeeded(state: EngineState): void {
  if (state.config.mode === "words") return;
  if (state.cursor.word < state.words.length - EXTEND_MARGIN) return;
  const from = state.words.length;
  for (let i = 0; i < EXTEND_CHUNK; i++) {
    state.words.push({ target: wordAt(state.config, from + i), typed: "" });
  }
}

/**
 * Apply one keystroke. Returns a new state; the input state is never mutated.
 *
 * `t` is normalised against the first keystroke, so the recorded log always
 * starts at 0 regardless of what clock the host is using.
 */
export function applyKey(prev: EngineState, input: KeyInput): EngineState {
  if (prev.phase === "finished") return prev;

  const isBackspace = input.key === "Backspace";
  if (!isBackspace && !isPrintable(input.key)) return prev;

  // A leading space is not a keystroke, it is a stray thumb. Ignore it outright
  // so it can neither start the clock nor land in the log.
  const startingWord = prev.words[prev.cursor.word];
  if (input.key === " " && prev.cursor.char === 0 && startingWord?.typed === "") {
    return prev;
  }
  if (isBackspace && prev.phase === "idle") return prev;

  const state: EngineState = {
    ...prev,
    words: prev.words.map((w) => ({ ...w })),
    cursor: { ...prev.cursor },
    events: prev.events.slice(),
  };

  if (state.phase === "idle") {
    state.phase = "running";
    state.startedAt = input.t;
  }

  const t = input.t - (state.startedAt ?? input.t);
  const expected = expectedChar(state);
  const word = state.words[state.cursor.word];
  if (!word) return prev;

  const record = (kind: KeyEvent["kind"], correct: boolean): void => {
    const event: KeyEvent = {
      t,
      key: input.key,
      code: input.code,
      kind,
      expected,
      correct,
      word: state.cursor.word,
    };
    if (input.hold !== undefined) event.hold = input.hold;
    state.events.push(event);
  };

  if (isBackspace) {
    if (input.ctrl === true || input.alt === true) {
      // Whole-word delete. On an empty word, step back into the previous one.
      if (state.cursor.char === 0) {
        stepBackWord(state);
      } else {
        word.typed = "";
        state.cursor.char = 0;
      }
      record("word-back", false);
      return state;
    }

    if (state.cursor.char > 0) {
      word.typed = word.typed.slice(0, -1);
      state.cursor.char = word.typed.length;
      record("backspace", false);
    } else {
      stepBackWord(state);
      record("word-back", false);
    }
    return state;
  }

  if (input.key === " ") {
    const correct = word.typed === word.target;
    record("space", correct);

    // Advancing leaves any unfinished remainder of the word behind as missed.
    state.cursor.word += 1;
    state.cursor.char = 0;

    if (state.config.mode === "words" && state.cursor.word >= state.words.length) {
      finishNow(state, t);
      return state;
    }
    extendIfNeeded(state);
    return state;
  }

  // An ordinary character.
  if (word.typed.length >= word.target.length + MAX_EXTRA_CHARS) return prev;

  const correct = expected !== null && input.key === expected;
  word.typed += input.key;
  state.cursor.char = word.typed.length;
  record("char", correct);

  // The last word of a `words` test ends the test the moment it is complete,
  // with no trailing space required.
  const isLastWord = state.cursor.word === state.words.length - 1;
  if (
    state.config.mode === "words" &&
    isLastWord &&
    word.typed.length === word.target.length
  ) {
    finishNow(state, t);
  }

  return state;
}

function stepBackWord(state: EngineState): void {
  if (state.cursor.word === 0) return;
  const previous = state.words[state.cursor.word - 1];
  if (!previous) return;
  // Only step back into a word that still has something wrong with it, unless
  // the player has explicitly asked for free movement.
  if (state.config.freedomMode !== true && !wordHasError(previous)) return;
  state.cursor.word -= 1;
  state.cursor.char = previous.typed.length;
}

function finishNow(state: EngineState, t: number): void {
  state.phase = "finished";
  state.endedAt = t;
}

/**
 * End the test from the outside — a `time` test running out, or the player
 * bailing. `t` uses the host's clock and is normalised like any keystroke.
 */
export function finish(prev: EngineState, t: number): EngineState {
  if (prev.phase === "finished") return prev;
  const startedAt = prev.startedAt ?? t;
  return { ...prev, phase: "finished", endedAt: Math.max(0, t - startedAt) };
}

/**
 * Rebuild a finished test from its config and recorded keystrokes.
 *
 * This is the verification entry point: the server regenerates the words from
 * the seed, replays the log through the same reducer the browser ran, and
 * compares the result to what the client claimed.
 */
export function replay(config: TestConfig, events: readonly KeyEvent[]): EngineState {
  let state = createState(config);
  for (const event of events) {
    // `hold` is carried through rather than dropped. It is not used by the
    // reducer — a key's dwell cannot change what it typed — but a replay claims
    // to rebuild the run from its keystrokes, and a replay that quietly loses a
    // recorded field makes that claim false for everything downstream of it.
    const hold = event.hold !== undefined ? { hold: event.hold } : {};
    if (event.kind === "word-back" && event.key === "Backspace") {
      state = applyKey(state, {
        key: event.key,
        code: event.code,
        t: event.t,
        ctrl: true,
        ...hold,
      });
      continue;
    }
    state = applyKey(state, { key: event.key, code: event.code, t: event.t, ...hold });
  }
  const last = events.length > 0 ? events[events.length - 1] : undefined;
  if (state.phase !== "finished" && last) state = finish(state, last.t);
  return state;
}

/** Per-character status for rendering. The view owns no state of its own. */
export function charStatuses(word: WordState): CharStatus[] {
  const out: CharStatus[] = [];
  for (let i = 0; i < Math.max(word.target.length, word.typed.length); i++) {
    if (i >= word.target.length) out.push("extra");
    else if (i >= word.typed.length) out.push("pending");
    else out.push(word.typed.charAt(i) === word.target.charAt(i) ? "correct" : "incorrect");
  }
  return out;
}
