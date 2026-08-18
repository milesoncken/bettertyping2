import { describe, expect, it } from "vitest";
import { applyKey, finish } from "@bettertyping/engine";
import type { EngineState, KeyEvent, TestConfig } from "@bettertyping/engine";
import { start, type } from "@bettertyping/engine/testing";
import { computeResults } from "@bettertyping/metrics";
import { LIMITS, verifySubmission } from "./index.js";

/**
 * Type `text` with an explicit cadence, in ms between keystrokes.
 *
 * The engine's `type` helper uses a fixed interval, which would trip our own
 * rhythm check — so every fixture here drives `applyKey` directly and supplies
 * a varying cadence, the way hands do.
 */
function typeWithCadence(
  state: EngineState,
  text: string,
  cadence: readonly number[],
): EngineState {
  let current = state;
  let t = 0;
  let i = 0;
  for (const char of text) {
    t += cadence[i % cadence.length]!;
    i += 1;
    current = applyKey(current, { key: char, code: `Key_${char}`, t });
  }
  return current;
}

const HUMAN_CADENCE = [88, 145, 102, 63, 197, 119, 74, 156, 91, 128, 210, 82] as const;

/** A believable run against the seed the server issued. */
function honestRun(config: Partial<TestConfig> = {}): EngineState {
  const state = start({ count: 10, seed: "issued-seed", ...config });
  const text = state.words.map((w) => w.target).join(" ");
  return typeWithCadence(state, text, HUMAN_CADENCE);
}

const ISSUED_AT = 1_700_000_000_000;

function verify(state: EngineState, over: Record<string, unknown> = {}) {
  const results = computeResults(state);
  return verifySubmission({
    config: state.config,
    events: state.events,
    claimed: { wpm: results.wpm, accuracy: results.accuracy },
    issuedAt: ISSUED_AT,
    receivedAt: ISSUED_AT + results.durationMs + 400,
    ...over,
  });
}

describe("an honest run", () => {
  it("verifies", () => {
    const outcome = verify(honestRun());
    expect(outcome.verification).toBe("verified");
    expect(outcome.reasons).toEqual([]);
  });

  it("recomputes the results rather than trusting the client", () => {
    const state = honestRun();
    const truth = computeResults(state);
    const outcome = verifySubmission({
      config: state.config,
      events: state.events,
      claimed: { wpm: 999, accuracy: 100 },
      issuedAt: ISSUED_AT,
      receivedAt: ISSUED_AT + truth.durationMs + 400,
    });
    expect(outcome.results.wpm).toBeCloseTo(truth.wpm, 5);
    expect(outcome.verification).toBe("rejected");
    expect(outcome.reasons).toContain("claimed-wpm-mismatch");
  });
});

describe("forgery", () => {
  it("rejects a log typed against a different text", () => {
    // The classic attack: type a passage you generated yourself, then submit it
    // against the seed the server issued. The replay simply will not line up.
    const attacker = honestRun({ seed: "attacker-chose-this" });
    const outcome = verifySubmission({
      config: { ...attacker.config, seed: "issued-seed" },
      events: attacker.events,
      claimed: undefined,
      issuedAt: ISSUED_AT,
      receivedAt: ISSUED_AT + 20_000,
    });
    // Replayed against the real text, almost nothing matches.
    expect(outcome.results.accuracy).toBeLessThan(40);
    expect(outcome.results.wpm).toBeLessThan(30);
  });

  it("rejects a metronomic log", () => {
    // The naive script: every keystroke exactly 40ms apart.
    const state = start({ count: 12, seed: "issued-seed" });
    const text = state.words.map((w) => w.target).join(" ");
    const done = type(state, text, 40);
    const outcome = verify(done);
    expect(outcome.verification).toBe("rejected");
    expect(outcome.reasons).toContain("inhuman-rhythm");
  });

  it("rejects impossibly fast keystrokes", () => {
    const state = start({ count: 12, seed: "issued-seed" });
    const text = state.words.map((w) => w.target).join(" ");
    // Jittered so the rhythm check passes, but far faster than hands move.
    const current = typeWithCadence(state, text, [1, 4, 2]);
    const outcome = verify(current);
    expect(outcome.verification).toBe("rejected");
    expect(outcome.reasons).toContain("impossible-keystroke-intervals");
  });

  it("rejects a log with rewound timestamps", () => {
    const state = honestRun();
    const events: KeyEvent[] = state.events.map((event, i) =>
      i === 20 ? { ...event, t: 5 } : event,
    );
    const outcome = verifySubmission({
      config: state.config,
      events,
      claimed: undefined,
      issuedAt: ISSUED_AT,
      receivedAt: ISSUED_AT + 20_000,
    });
    expect(outcome.reasons).toContain("non-monotonic-timestamps");
    expect(outcome.verification).toBe("rejected");
  });

  it("rejects a run that claims to be longer than the window it was issued in", () => {
    const state = honestRun();
    const outcome = verifySubmission({
      config: state.config,
      events: state.events,
      claimed: undefined,
      issuedAt: ISSUED_AT,
      // Submitted a quarter of a second after issue, claiming a much longer run.
      receivedAt: ISSUED_AT + 250,
    });
    expect(outcome.reasons).toContain("duration-exceeds-issue-window");
  });

  it("rejects a submission that predates its issuance", () => {
    const state = honestRun();
    const outcome = verifySubmission({
      config: state.config,
      events: state.events,
      claimed: undefined,
      issuedAt: ISSUED_AT,
      receivedAt: ISSUED_AT - 1,
    });
    expect(outcome.reasons).toContain("submitted-before-issued");
  });

  it("rejects a run too small to mean anything", () => {
    const state = start({ count: 25, seed: "issued-seed" });
    const done = type(state, "the", 120);
    const outcome = verify(done);
    expect(outcome.verification).toBe("rejected");
    expect(outcome.reasons).toContain("too-few-keystrokes");
  });
});

describe("review band", () => {
  it("flags an exceptional run rather than rejecting it", () => {
    const state = start({ count: 12, seed: "issued-seed" });
    const text = state.words.map((w) => w.target).join(" ");
    // Fast, but with human variance.
    const current = typeWithCadence(state, text, [26, 41, 19, 33, 48, 22, 37, 29]);
    const outcome = verify(current);
    expect(outcome.results.wpm).toBeGreaterThan(LIMITS.reviewWpm);
    expect(outcome.verification).toBe("flagged");
    expect(outcome.reasons).toContain("above-review-threshold");
  });
});

describe("time mode", () => {
  it("rejects keystrokes recorded after the clock expired", () => {
    const state = start({ mode: "time", duration: 15, seed: "issued-seed" });
    // Long enough at this cadence to run well past the 15 second limit — the
    // shape of a log that kept recording after the clock should have stopped it.
    const text = state.words.map((w) => w.target).join(" ").slice(0, 220);
    const current = typeWithCadence(state, text, [95, 140, 110, 70, 180]);
    const done = finish(current, current.events[current.events.length - 1]?.t ?? 0);
    const outcome = verifySubmission({
      config: done.config,
      events: done.events,
      claimed: undefined,
      issuedAt: ISSUED_AT,
      receivedAt: ISSUED_AT + 40_000,
    });
    expect(outcome.reasons).toContain("keystrokes-after-time-expired");
  });
});
