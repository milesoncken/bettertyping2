import { describe, expect, it } from "vitest";
import { finish } from "@bettertyping/engine";
import { start, type } from "@bettertyping/engine/testing";
import {
  buildSamples,
  computeResults,
  consistencyOf,
  countChars,
  keystrokeAccuracy,
} from "./index.js";

const targetsOf = (state: { words: { target: string }[] }): string =>
  state.words.map((w) => w.target).join(" ");

describe("perfect run", () => {
  it("reports 100% accuracy and no wrong characters", () => {
    const state = start({ count: 5 });
    const done = type(state, targetsOf(state));
    const results = computeResults(done);

    expect(results.accuracy).toBe(100);
    expect(results.chars.incorrect).toBe(0);
    expect(results.chars.extra).toBe(0);
    expect(results.chars.missed).toBe(0);
    expect(results.wpm).toBeGreaterThan(0);
    expect(results.wpm).toBeCloseTo(results.rawWpm, 5);
  });
});

describe("v1 regression: a corrected typo", () => {
  it("costs accuracy but not speed", () => {
    const state = start({ count: 3 });
    const text = targetsOf(state);
    const first = text.charAt(0);
    const wrong = first === "z" ? "y" : "z";

    // Type one wrong character, fix it, then type the rest correctly.
    const done = type(state, wrong + "\b" + text);
    const results = computeResults(done);

    // The final text is correct, so every character counts and WPM is unhurt.
    expect(results.chars.incorrect).toBe(0);
    // v1 charged you twice here and could report a negative speed.
    expect(results.wpm).toBeGreaterThan(0);
    // The mistake still shows up where it belongs.
    expect(results.accuracy).toBeLessThan(100);
    expect(results.accuracy).toBeGreaterThan(90);
  });

  it("never reports a negative speed, however bad the run", () => {
    const state = start({ count: 4 });
    const done = type(state, "zzzz zzzz zzzz zzzz");
    const results = computeResults(done);
    expect(results.wpm).toBeGreaterThanOrEqual(0);
    expect(results.rawWpm).toBeGreaterThan(0);
  });
});

describe("character counting", () => {
  it("counts extra characters separately from wrong ones", () => {
    const state = start({ count: 2 });
    const word = state.words[0]!.target;
    const done = type(state, word + "qq ");
    const counts = countChars(done);
    expect(counts.extra).toBe(2);
  });

  it("counts the remainder of a skipped word as missed", () => {
    const state = start({ count: 2 });
    const word = state.words[0]!.target;
    const done = type(state, word.slice(0, 1) + " ");
    expect(countChars(done).missed).toBe(word.length - 1);
  });

  it("does not count words the player never reached", () => {
    const state = start({ count: 10 });
    const done = type(state, state.words[0]!.target + " ");
    const counts = countChars(done);
    const total = counts.correct + counts.incorrect + counts.extra + counts.missed;
    expect(total).toBe(state.words[0]!.target.length + 1);
  });
});

describe("accuracy", () => {
  it("is first-attempt and ignores backspaces", () => {
    const events = [
      { t: 0, key: "a", code: "KeyA", kind: "char" as const, expected: "a", correct: true, word: 0 },
      { t: 1, key: "z", code: "KeyZ", kind: "char" as const, expected: "b", correct: false, word: 0 },
      { t: 2, key: "Backspace", code: "Backspace", kind: "backspace" as const, expected: null, correct: false, word: 0 },
      { t: 3, key: "b", code: "KeyB", kind: "char" as const, expected: "b", correct: true, word: 0 },
    ];
    // Three counted keystrokes, two right.
    expect(keystrokeAccuracy(events)).toBeCloseTo((2 / 3) * 100, 5);
  });
});

describe("samples", () => {
  it("are reconstructed from the log, not sampled live", () => {
    const state = start({ count: 6 });
    const done = type(state, targetsOf(state), 80);
    const a = buildSamples(done);
    const b = buildSamples(done);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("cover the full configured duration of a time test", () => {
    const state = start({ mode: "time", duration: 10 });
    const done = finish(type(state, "the quick brown fox jumps", 90), 10_000);
    const samples = buildSamples(done);
    expect(samples[samples.length - 1]!.t).toBe(10);
  });
});

describe("consistency", () => {
  it("is 100 for a perfectly even run and lower for a ragged one", () => {
    const even = [
      { t: 1, wpm: 60, rawWpm: 60, errors: 0 },
      { t: 2, wpm: 60, rawWpm: 60, errors: 0 },
      { t: 3, wpm: 60, rawWpm: 60, errors: 0 },
    ];
    const ragged = [
      { t: 1, wpm: 20, rawWpm: 20, errors: 0 },
      { t: 2, wpm: 90, rawWpm: 90, errors: 0 },
      { t: 3, wpm: 40, rawWpm: 40, errors: 0 },
    ];
    expect(consistencyOf(even)).toBe(100);
    expect(consistencyOf(ragged)).toBeLessThan(70);
  });
});

describe("golden fixture", () => {
  // Locks the metric definitions to exact numbers. Any drift here is either a
  // bug or a deliberate redefinition — never an accident.
  it("produces exactly these numbers for a known run", () => {
    const state = start({ count: 5, seed: "golden" });
    const text = targetsOf(state);
    expect(text).toBe("make or however caliph kilobyte");

    const done = type(state, text, 100);
    const results = computeResults(done);

    // 31 keystrokes at 100ms apart. The clock starts ON the first keystroke, so
    // the run spans 30 intervals — 3.000s — not 3.100s. 31 chars / 5 / 0.05min.
    expect(results.durationMs).toBe(3000);
    expect(results.chars).toEqual({ correct: 31, incorrect: 0, extra: 0, missed: 0 });
    expect(results.wpm).toBe(124);
    expect(results.rawWpm).toBe(124);
    expect(results.accuracy).toBe(100);
    expect(results.consistency).toBe(100);
    expect(results.samples).toHaveLength(3);
  });
});
