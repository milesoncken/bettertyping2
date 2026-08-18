import { applyKey, createState } from "./engine.js";
import type { EngineState, TestConfig } from "./types.js";

/**
 * Helpers for tests and fixtures. Kept in the package so the engine's own suite
 * and every consumer's suite drive it exactly the same way.
 */

/** Type a string one character at a time at a fixed cadence. `\b` is a backspace. */
export function type(
  state: EngineState,
  text: string,
  msPerKey = 100,
  startAt = 1000,
): EngineState {
  let next = state;
  const base = next.startedAt ?? startAt;
  let t = base + next.events.length * msPerKey;

  for (const char of text) {
    const key = char === "\b" ? "Backspace" : char;
    next = applyKey(next, { key, code: `Key_${key}`, t });
    t += msPerKey;
  }
  return next;
}

/** A test in its idle state, with sensible fixture defaults. */
export function start(config: Partial<TestConfig> = {}): EngineState {
  return createState({
    mode: "words",
    count: 5,
    seed: "fixture",
    punctuation: false,
    numbers: false,
    ...config,
  });
}
