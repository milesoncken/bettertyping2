import { describe, expect, it } from "vitest";
import { applyKey, charStatuses, createState, expectedChar, finish, replay } from "./engine.js";
import { generateWords, wordAt } from "./words.js";
import { start, type } from "./testing.js";
import type { TestConfig } from "./types.js";

const config: TestConfig = {
  mode: "words",
  count: 5,
  seed: "fixture",
  punctuation: false,
  numbers: false,
};

const targetsOf = (state: { words: { target: string }[] }): string =>
  state.words.map((w) => w.target).join(" ");

describe("word generation", () => {
  it("is a pure function of the seed", () => {
    const a = generateWords(config, 40);
    const b = generateWords(config, 40);
    expect(a).toEqual(b);
  });

  it("produces a different list for a different seed", () => {
    const other = generateWords({ ...config, seed: "other" }, 40);
    expect(other).not.toEqual(generateWords(config, 40));
  });

  it("generates any index without generating the ones before it", () => {
    expect(wordAt(config, 137)).toBe(generateWords(config, 200)[137]);
  });

  it("adds punctuation and numbers only when asked", () => {
    const plain = generateWords(config, 80).join(" ");
    expect(plain).toMatch(/^[a-z ]+$/);

    const fancy = generateWords(
      { ...config, punctuation: true, numbers: true },
      80,
    ).join(" ");
    expect(fancy).toMatch(/[.,!?;:]/);
    expect(fancy).toMatch(/[0-9]/);
  });
});

describe("typing", () => {
  it("starts idle and begins running on the first keystroke", () => {
    const state = start();
    expect(state.phase).toBe("idle");
    expect(type(state, "t").phase).toBe("running");
  });

  it("ignores a leading space instead of starting the test with it", () => {
    const state = applyKey(start(), { key: " ", code: "Space", t: 500 });
    expect(state.phase).toBe("idle");
    expect(state.events).toHaveLength(0);
  });

  it("tracks correct and incorrect characters per word", () => {
    const state = start();
    const word = state.words[0]!.target;
    const typed = type(state, word.slice(0, 2) + "zz");
    const statuses = charStatuses(typed.words[0]!);
    expect(statuses.slice(0, 2)).toEqual(["correct", "correct"]);
    expect(statuses[2]).toBe("incorrect");
  });

  it("accepts extra characters past the end of a word", () => {
    const state = start();
    const word = state.words[0]!.target;
    const typed = type(state, word + "xyz");
    expect(charStatuses(typed.words[0]!).slice(-3)).toEqual(["extra", "extra", "extra"]);
  });

  it("advances to the next word on space and marks the remainder missed", () => {
    const state = start();
    const typed = type(state, state.words[0]!.target.slice(0, 1) + " ");
    expect(typed.cursor.word).toBe(1);
    expect(typed.cursor.char).toBe(0);
  });

  it("finishes a words test when the final word is complete", () => {
    const state = start({ count: 3 });
    const finished = type(state, targetsOf(state));
    expect(finished.phase).toBe("finished");
  });

  it("reports the character the player is expected to produce", () => {
    const state = start();
    expect(expectedChar(state)).toBe(state.words[0]!.target.charAt(0));
  });
});

describe("backspace", () => {
  it("removes the last character", () => {
    const state = start();
    const typed = type(state, "ab\b");
    expect(typed.words[0]!.typed).toBe("a");
    expect(typed.cursor.char).toBe(1);
  });

  it("steps back into a previous word only when that word has an error", () => {
    const state = start();
    const first = state.words[0]!.target;

    const clean = type(state, first + " \b");
    expect(clean.cursor.word).toBe(1);

    const dirty = type(state, first.slice(0, -1) + "z " + "\b");
    expect(dirty.cursor.word).toBe(0);
  });

  it("steps back into a correct word when freedom mode is on", () => {
    const state = start({ freedomMode: true });
    const typed = type(state, state.words[0]!.target + " \b");
    expect(typed.cursor.word).toBe(0);
  });

  it("clears the whole word on ctrl+backspace", () => {
    let state = type(start(), "abcd");
    state = applyKey(state, { key: "Backspace", code: "Backspace", t: 9000, ctrl: true });
    expect(state.words[0]!.typed).toBe("");
  });
});

describe("replay", () => {
  it("carries hold times through, rather than quietly dropping them", () => {
    // Dwell does not affect what a key typed, so the reducer ignores it — which
    // made it easy to lose here. Everything downstream reads the replayed log,
    // so a replay that dropped it would leave the field permanently empty with
    // nothing failing to say so.
    let live = createState({
      mode: "words",
      count: 2,
      seed: "hold-fixture",
      punctuation: false,
      numbers: false,
    });
    "abc".split("").forEach((key, i) => {
      live = applyKey(live, { key, code: `Key${key.toUpperCase()}`, t: 100 * i, hold: 40 + i });
    });

    const replayed = replay(live.config, live.events);
    expect(replayed.events.map((event) => event.hold)).toEqual([40, 41, 42]);
  });

  it("reconstructs an identical state from config and event log", () => {
    const live = type(start({ count: 4 }), "the quick brown fox and more text");
    const replayed = replay(live.config, live.events);

    expect(replayed.words.map((w) => w.typed)).toEqual(live.words.map((w) => w.typed));
    expect(replayed.cursor).toEqual(live.cursor);
    expect(replayed.events).toEqual(live.events);
  });

  it("reconstructs a time test that was ended from outside", () => {
    const live = finish(type(start({ mode: "time", duration: 15 }), "some words here"), 16000);
    const replayed = replay(live.config, live.events);
    expect(replayed.words.map((w) => w.typed)).toEqual(live.words.map((w) => w.typed));
  });

  it("regenerates the exact words the player was shown from the seed alone", () => {
    const live = type(start({ count: 6 }), "abc def");
    const server = createState(live.config);
    expect(server.words.map((w) => w.target)).toEqual(live.words.map((w) => w.target));
  });
});

describe("time mode", () => {
  it("extends its word list as the player advances", () => {
    let state = start({ mode: "time", duration: 60 });
    const initial = state.words.length;
    for (let i = 0; i < initial - 10; i++) {
      state = type(state, state.words[state.cursor.word]!.target + " ");
    }
    expect(state.words.length).toBeGreaterThan(initial);
  });
});
