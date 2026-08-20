import { describe, expect, it } from "vitest";
import { applyKey, createState, finish } from "@bettertyping/engine";
import type { EngineState, KeyInput, TestConfig } from "@bettertyping/engine";
import {
  aggregateFromRollup,
  analyseRun,
  areNeighbours,
  classifyBigram,
  keyFor,
  median,
  observeLegends,
  percentile,
  rollsFrom,
  rollupDeltas,
  slope,
  type BigramRollupRow,
  type KeyRollupRow,
} from "./index.js";

/**
 * The analysis engine's suite.
 *
 * The engine's own tests prove a run replays identically. These prove the
 * *reading* of that replay: that a finger claim is about physical position, that
 * a neighbour slip is told apart from a substitution, and — the one that would
 * silently rot — that a rollup summed across runs says the same thing as the run
 * it was built from.
 */

/** QWERTY code for a character, so fixtures type on a real physical board. */
const CODES: Record<string, string> = {
  " ": "Space",
  ",": "Comma",
  ".": "Period",
  ";": "Semicolon",
  "'": "Quote",
  "/": "Slash",
};
const codeOf = (char: string): string => {
  if (CODES[char]) return CODES[char] as string;
  if (/^[a-zA-Z]$/.test(char)) return `Key${char.toUpperCase()}`;
  if (/^[0-9]$/.test(char)) return `Digit${char}`;
  return "Unidentified";
};

const config = (over: Partial<TestConfig> = {}): TestConfig => ({
  mode: "words",
  count: 5,
  seed: "analysis-fixture",
  punctuation: false,
  numbers: false,
  ...over,
});

/**
 * Type text against a fixed word list, at a cadence, with real physical codes.
 * `\b` is a backspace. `hold` is filled so dwell has something to measure.
 */
function play(
  words: readonly string[],
  text: string,
  options: { msPerKey?: number; holdMs?: number | null } = {},
): EngineState {
  const { msPerKey = 120, holdMs = 70 } = options;
  let state: EngineState = {
    ...createState(config({ count: words.length })),
    words: words.map((target) => ({ target, typed: "" })),
  };

  let t = 1000;
  for (const char of text) {
    const key = char === "\b" ? "Backspace" : char;
    const input: KeyInput = {
      key,
      code: char === "\b" ? "Backspace" : codeOf(char),
      t,
      ...(holdMs !== null ? { hold: holdMs } : {}),
    };
    state = applyKey(state, input);
    t += msPerKey;
  }
  return state.phase === "finished" ? state : finish(state, t);
}

describe("keyboard geometry", () => {
  it("assigns fingers by physical position, not by character", () => {
    // The home row under the left index finger, whatever the layout prints.
    expect(keyFor("KeyF")?.finger).toBe(3);
    expect(keyFor("KeyJ")?.finger).toBe(6);
    expect(keyFor("KeyA")?.finger).toBe(0);
    expect(keyFor("Semicolon")?.finger).toBe(9);
  });

  it("knows which keys a hand could slip between", () => {
    expect(areNeighbours("KeyF", "KeyD")).toBe(true);
    expect(areNeighbours("KeyF", "KeyR")).toBe(true);
    expect(areNeighbours("KeyF", "KeyV")).toBe(true);
    // Two rows apart is not a slip, it is a different intention.
    expect(areNeighbours("KeyQ", "KeyZ")).toBe(false);
    // Across the board is certainly not.
    expect(areNeighbours("KeyF", "KeyL")).toBe(false);
    // A key is not its own neighbour.
    expect(areNeighbours("KeyF", "KeyF")).toBe(false);
  });

  it("classifies transitions the way hands actually make them", () => {
    // One finger having to leave a key and land on another.
    expect(classifyBigram("KeyE", "KeyD")).toBe("same-finger");
    expect(classifyBigram("KeyF", "KeyF")).toBe("same-key");
    // Different hands.
    expect(classifyBigram("KeyF", "KeyJ")).toBe("alternate");
    // Left hand, pinky toward index, is inward; the reverse is outward.
    expect(classifyBigram("KeyA", "KeyF")).toBe("in-roll");
    expect(classifyBigram("KeyF", "KeyA")).toBe("out-roll");
    // The right hand runs the other way in finger id and must still read inward.
    expect(classifyBigram("Semicolon", "KeyJ")).toBe("in-roll");
    expect(classifyBigram("KeyJ", "Semicolon")).toBe("out-roll");
    // The space bar is not a layout decision.
    expect(classifyBigram("KeyF", "Space")).toBe("thumb");
  });
});

describe("statistics", () => {
  it("takes a median rather than a worst case", () => {
    // v1's heatmap reported the worst single keystroke; one outlier owned the key.
    expect(median([100, 110, 120, 130, 9000])).toBe(120);
  });

  it("interpolates percentiles", () => {
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("reports no trend rather than NaN for a degenerate series", () => {
    expect(slope([1, 1, 1], [4, 5, 6])).toBe(0);
    expect(slope([0, 1, 2], [0, 2, 4])).toBe(2);
  });
});

describe("observed legends", () => {
  it("learns what a key prints from the run itself", () => {
    const state = play(["fig"], "fig");
    const { legends, codeForChar } = observeLegends(state.events);
    expect(legends["KeyF"]).toBe("f");
    expect(codeForChar["g"]).toBe("KeyG");
  });

  it("learns from wrong keys too, since they still printed something", () => {
    // `j` typed where `f` was wanted still proves KeyJ prints `j`.
    const state = play(["fig"], "jig");
    const { legends } = observeLegends(state.events);
    expect(legends["KeyJ"]).toBe("j");
  });
});

describe("analysing a run", () => {
  it("separates flight from dwell", () => {
    const analysis = analyseRun(play(["fig"], "fig", { msPerKey: 150, holdMs: 60 }));
    expect(analysis.hasDwell).toBe(true);
    expect(analysis.rhythm.flightMs).toBe(150);
    expect(analysis.rhythm.dwellMs).toBe(60);
  });

  it("reports no dwell at all for a run recorded before it was captured", () => {
    const analysis = analyseRun(play(["fig"], "fig", { holdMs: null }));
    expect(analysis.hasDwell).toBe(false);
    expect(analysis.rhythm.dwellMs).toBeNull();
    expect(analysis.keys.every((key) => key.dwellMs === null)).toBe(true);
  });

  it("counts a key that was wanted separately from a key that was struck", () => {
    // `d` where `f` was wanted: KeyF was wanted and missed, KeyD intruded.
    const analysis = analyseRun(play(["fig"], "dig"));
    const f = analysis.keys.find((key) => key.code === "KeyF");
    const d = analysis.keys.find((key) => key.code === "KeyD");
    expect(f?.wanted).toBe(1);
    expect(f?.missed).toBe(1);
    expect(f?.struck ?? 0).toBe(0);
    expect(d?.struck).toBe(1);
    expect(d?.intruded).toBe(1);
  });

  it("tells a neighbour slip from a substitution", () => {
    // `d` is next to `f`; `p` is nowhere near it.
    expect(analyseRun(play(["fig"], "dig")).errors.neighbour).toBe(1);
    expect(analyseRun(play(["fig"], "pig")).errors.substitution).toBe(1);
  });

  it("sees a transposition as one rolled pair, not two substitutions", () => {
    const errors = analyseRun(play(["the"], "hte")).errors;
    expect(errors.transposition).toBe(1);
    expect(errors.substitution).toBe(0);
    expect(errors.neighbour).toBe(0);
  });

  it("counts a wrong case as its own kind of mistake", () => {
    const errors = analyseRun(play(["Fig"], "fig")).errors;
    expect(errors.capitalisation).toBe(1);
    expect(errors.substitution).toBe(0);
  });

  it("counts characters piled past a word as insertions", () => {
    const errors = analyseRun(play(["fig", "jam"], "figgg jam")).errors;
    expect(errors.insertion).toBe(2);
  });

  it("counts skipped characters as omissions, which no keystroke could show", () => {
    // Space out of `figment` after three characters leaves four behind.
    const errors = analyseRun(play(["figment", "jam"], "fig jam")).errors;
    expect(errors.omission).toBe(4);
  });

  it("breaks the bigram chain across a correction", () => {
    // `fix`, backspace, `g`. The time to reach `g` is the cost of noticing and
    // undoing a mistake, not the cost of the movement from `x` to `g`, so no
    // x→g pair may be formed. The pair before the correction is untouched.
    const analysis = analyseRun(play(["fig"], "fix\bg"));
    const pairOf = (pair: string): number =>
      analysis.bigrams.find((b) => b.pair === pair)?.n ?? 0;
    expect(pairOf("KeyI>KeyX")).toBe(1);
    expect(pairOf("KeyX>KeyG")).toBe(0);
    // Typed straight through, the same two keys would pair normally.
    expect(
      analyseRun(play(["fig"], "fig")).bigrams.find((b) => b.pair === "KeyI>KeyG")?.n,
    ).toBe(1);
  });

  it("charges a wrong second key to the pair as an error, not a latency", () => {
    const analysis = analyseRun(play(["fig"], "fdg"));
    const pair = analysis.bigrams.find((b) => b.pair === "KeyF>KeyD");
    expect(pair?.n).toBe(1);
    expect(pair?.errors).toBe(1);
    expect(pair?.latencyMs).toBe(0);
  });

  it("leaves a pause out of the transition median but still counts the pair", () => {
    let state = createState(config({ count: 1 }));
    state = { ...state, words: [{ target: "fig", typed: "" }] };
    // f, then a five-second stare, then i and g at a normal cadence.
    const times = [0, 5000, 5120];
    "fig".split("").forEach((char, i) => {
      state = applyKey(state, {
        key: char,
        code: codeOf(char),
        t: 1000 + (times[i] ?? 0),
      });
    });

    const analysis = analyseRun(state);
    const paused = analysis.bigrams.find((b) => b.pair === "KeyF>KeyI");
    expect(paused?.n).toBe(1);
    expect(paused?.latencyMs).toBe(0);
    // The run's own rhythm is the 120ms it actually typed at, not 2.5 seconds.
    expect(analysis.rhythm.flightMs).toBe(120);
  });

  it("measures hand balance from physical position", () => {
    // All eight characters land on the left hand.
    const analysis = analyseRun(play(["fads", "gear"], "fads gear"));
    expect(analysis.rhythm.handBalance.right).toBe(0);
    expect(analysis.rhythm.handBalance.left).toBeGreaterThan(0);
  });

  it("prices a same-finger transition against an alternating one", () => {
    let state = createState(config({ count: 1 }));
    state = { ...state, words: [{ target: "edjkedjk", typed: "" }] };
    // `ed` and `de` are same-finger and slow; `jk`/`kj` alternate hands... no:
    // j and k are right index and right middle, so use `fj` style alternation.
    const script: Array<[string, number]> = [
      ["e", 0],
      ["d", 300], // same-finger, 300ms
      ["j", 100],
      ["k", 100],
      ["e", 100],
      ["d", 300], // same-finger again
      ["j", 100],
      ["k", 100],
    ];
    let t = 1000;
    for (const [char, gap] of script) {
      t += gap;
      state = applyKey(state, { key: char, code: codeOf(char), t });
    }

    const analysis = analyseRun(state);
    expect(analysis.rolls.latencyMs["same-finger"]).toBe(300);
    expect(analysis.rolls.counts["same-finger"]).toBe(2);
    expect(analysis.rolls.sameFingerCostMs).toBeGreaterThan(0);
  });
});

describe("rollups", () => {
  /** Sum a run's deltas into rows, the way the upsert does in SQL. */
  function apply(
    analysis: ReturnType<typeof analyseRun>,
    into: {
      keys: Map<string, KeyRollupRow>;
      bigrams: Map<string, BigramRollupRow>;
    },
  ): void {
    const deltas = rollupDeltas(analysis);
    for (const delta of deltas.keys) {
      const row = into.keys.get(delta.code) ?? {
        code: delta.code,
        legend: delta.legend,
        struck: 0,
        intruded: 0,
        wanted: 0,
        missed: 0,
        flightSumMs: 0,
        flightRuns: 0,
        dwellSumMs: 0,
        dwellRuns: 0,
      };
      row.legend = delta.legend;
      row.struck += delta.struck;
      row.intruded += delta.intruded;
      row.wanted += delta.wanted;
      row.missed += delta.missed;
      row.flightSumMs += delta.flightMedianMs;
      row.flightRuns += delta.flightRuns;
      row.dwellSumMs += delta.dwellMedianMs;
      row.dwellRuns += delta.dwellRuns;
      into.keys.set(delta.code, row);
    }
    for (const delta of deltas.bigrams) {
      const row = into.bigrams.get(delta.pair) ?? {
        pair: delta.pair,
        from: delta.from,
        to: delta.to,
        label: delta.label,
        kind: delta.kind,
        n: 0,
        errors: 0,
        latencySumMs: 0,
        latencyRuns: 0,
      };
      row.n += delta.n;
      row.errors += delta.errors;
      row.latencySumMs += delta.latencyMedianMs;
      row.latencyRuns += delta.latencyRuns;
      into.bigrams.set(delta.pair, row);
    }
  }

  it("sums counts and means the per-run medians", () => {
    const into = {
      keys: new Map<string, KeyRollupRow>(),
      bigrams: new Map<string, BigramRollupRow>(),
    };
    apply(analyseRun(play(["fig"], "fig", { msPerKey: 100 })), into);
    apply(analyseRun(play(["fig"], "fig", { msPerKey: 200 })), into);

    const aggregate = aggregateFromRollup(
      [...into.keys.values()],
      [...into.bigrams.values()],
    );
    const g = aggregate.keys.find((key) => key.code === "KeyG");
    // Struck once per run, and the two runs' medians average to 150ms.
    expect(g?.struck).toBe(2);
    expect(g?.flightMs).toBe(150);
  });

  it("says the same thing about one run as the run said about itself", () => {
    const analysis = analyseRun(play(["fig", "jam"], "fig jam"));
    const into = {
      keys: new Map<string, KeyRollupRow>(),
      bigrams: new Map<string, BigramRollupRow>(),
    };
    apply(analysis, into);

    const aggregate = aggregateFromRollup(
      [...into.keys.values()],
      [...into.bigrams.values()],
    );
    expect(aggregate.keys).toEqual(analysis.keys);
    expect(aggregate.bigrams).toEqual(analysis.bigrams);
    expect(aggregate.rolls.counts).toEqual(analysis.rolls.counts);
  });

  it("weights a class latency by how often the pair is actually typed", () => {
    // A common 100ms pair and a rare 500ms one average nearer the common one.
    const rolls = rollsFrom([
      {
        pair: "a",
        from: "KeyF",
        to: "KeyJ",
        label: "fj",
        kind: "alternate",
        n: 99,
        errors: 0,
        latencyMs: 100,
      },
      {
        pair: "b",
        from: "KeyD",
        to: "KeyK",
        label: "dk",
        kind: "alternate",
        n: 1,
        errors: 0,
        latencyMs: 500,
      },
    ]);
    expect(rolls.latencyMs["alternate"]).toBe(104);
  });

  it("reports no dwell until a run contributes one", () => {
    const into = {
      keys: new Map<string, KeyRollupRow>(),
      bigrams: new Map<string, BigramRollupRow>(),
    };
    apply(analyseRun(play(["fig"], "fig", { holdMs: null })), into);
    const aggregate = aggregateFromRollup(
      [...into.keys.values()],
      [...into.bigrams.values()],
    );
    expect(aggregate.dwellRuns).toBe(0);
    expect(aggregate.keys.every((key) => key.dwellMs === null)).toBe(true);
  });
});
