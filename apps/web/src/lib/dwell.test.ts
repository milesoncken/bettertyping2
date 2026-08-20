import { describe, expect, it } from "vitest";
import { applyKey, createState } from "@bettertyping/engine";
import type { EngineState, TestConfig } from "@bettertyping/engine";
import {
  clampHold,
  dwellKey,
  eventsWithDwell,
  withDwell,
  type DwellLog,
} from "./dwell.js";

/**
 * The dwell side-channel.
 *
 * The one that would rot silently: holds are filed against a raw
 * `performance.now()` reading, and found again by computing `t + startedAt`.
 * Those are two different journeys to the same number, and floating point does
 * not promise they arrive at the same bits. If the key ever stopped matching,
 * every hold would quietly go missing and dwell would simply read "unavailable"
 * forever, with nothing failing.
 */

const config: TestConfig = {
  mode: "words",
  count: 3,
  seed: "dwell-fixture",
  punctuation: false,
  numbers: false,
};

const CODES: Record<string, string> = { " ": "Space" };
const codeOf = (char: string): string => CODES[char] ?? `Key${char.toUpperCase()}`;

/** Type `text` at fractional timestamps, filing a hold for each key. */
function play(
  text: string,
  origin: number,
  holdOf: (i: number) => number,
): {
  state: EngineState;
  dwells: DwellLog;
} {
  let state: EngineState = {
    ...createState(config),
    words: [
      { target: "fig", typed: "" },
      { target: "jam", typed: "" },
    ],
  };
  const dwells: DwellLog = new Map();

  let t = origin;
  [...text].forEach((char, i) => {
    const code = codeOf(char);
    dwells.set(dwellKey(code, t), holdOf(i));
    state = applyKey(state, { key: char, code, t });
    // Fractional and irregular, the way a real clock reports.
    t += 97.3117 + (i % 3) * 11.907;
  });

  return { state, dwells };
}

describe("dwell", () => {
  it("finds every hold again after the log has been normalised", () => {
    // A large, fractional origin, which is what performance.now() actually gives
    // on a page that has been open for a while.
    const { state, dwells } = play("fig jam", 1_284_913.774_5, (i) => 40 + i * 3);
    const events = eventsWithDwell(state, dwells);

    expect(events).toHaveLength(state.events.length);
    expect(events.every((event) => event.hold !== undefined)).toBe(true);
    expect(events[0]?.hold).toBe(40);
    expect(events[3]?.hold).toBe(49);
  });

  it("leaves the log alone when nothing was recorded", () => {
    const { state } = play("fig", 1000, () => 50);
    const events = eventsWithDwell(state, new Map());
    expect(events.every((event) => event.hold === undefined)).toBe(true);
    // And the state is handed straight back rather than needlessly rebuilt.
    expect(withDwell(state, new Map())).toBe(state);
  });

  it("omits a hold for a key that never came up, rather than inventing one", () => {
    const { state, dwells } = play("fig", 1000.5, () => 50);
    // The middle key's release never arrived — a tab switched away mid-press.
    for (const key of [...dwells.keys()]) {
      if (key.startsWith("KeyI:")) dwells.delete(key);
    }

    const events = eventsWithDwell(state, dwells);
    expect(events[0]?.hold).toBe(50);
    expect(events[1]?.hold).toBeUndefined();
    expect(events[2]?.hold).toBe(50);
  });

  it("keeps a hold inside what the wire contract will accept", () => {
    // The submission schema caps `hold` at a minute; a longer one must be
    // clamped rather than allowed to fail validation and sink the whole run.
    expect(clampHold(90_000)).toBe(60_000);
    expect(clampHold(-5)).toBe(0);
    expect(clampHold(73.4)).toBe(73.4);
  });

  it("files two presses of the same key separately", () => {
    const { state, dwells } = play("fig", 1000, (i) => 30 + i);
    // Three distinct keys, three distinct entries — no collision on rounding.
    expect(dwells.size).toBe(3);
    const events = eventsWithDwell(state, dwells);
    expect(events.map((event) => event.hold)).toEqual([30, 31, 32]);
  });
});
