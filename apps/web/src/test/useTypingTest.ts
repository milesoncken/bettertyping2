import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyKey, createState, expectedChar, finish } from "@bettertyping/engine";
import type { EngineState, TestConfig } from "@bettertyping/engine";
import { recordLatency } from "../lib/latency.js";
import { issueTest, toEngineConfig } from "../lib/api.js";
import { playKey } from "../lib/audio.js";
import type { Profile } from "../lib/audio.js";

/**
 * Binds the pure engine to the browser.
 *
 * The engine owns all truth. This hook does three things and nothing else:
 * feed it keystrokes, end a `time` test when its clock runs out, and keep a ref
 * in sync so the canvas and the readouts can animate without re-rendering the
 * words on every frame.
 */

const newSeed = (): string => Math.random().toString(36).slice(2, 12);

export interface TypingTest {
  state: EngineState;
  /** The server's id for this run, or null when playing unranked. */
  testIdRef: React.RefObject<string | null>;
  stateRef: React.RefObject<EngineState>;
  /** Monotonic ms of the first keystroke, or null before the test starts. */
  originRef: React.RefObject<number | null>;
  restart: () => void;
  setConfig: (patch: Partial<TestConfig>) => void;
}

export function useTypingTest(
  initial: TestConfig,
  /** Read at keypress time so changing profile never rebinds the listener. */
  profileRef: React.RefObject<Profile>,
): TypingTest {
  const [config, setConfigState] = useState<TestConfig>(initial);
  const [state, setState] = useState<EngineState>(() => createState(initial));
  const initialRef = useRef(initial);

  const stateRef = useRef<EngineState>(state);
  const originRef = useRef<number | null>(null);
  const pendingKeyAt = useRef<number | null>(null);
  const testIdRef = useRef<string | null>(null);
  /** Guards against a slow issuance landing after the player already restarted. */
  const dealRef = useRef(0);

  stateRef.current = state;

  /**
   * Deal a fresh test.
   *
   * The seed comes from the server when there is one, because a ranked run must
   * be played against text the server chose. With no server — or a failed
   * request — a local seed is used and the run is simply unranked.
   */
  const deal = useCallback((next: TestConfig) => {
    const deal = ++dealRef.current;
    testIdRef.current = null;
    originRef.current = null;
    setState(createState(next));

    void issueTest({
      mode: next.mode,
      punctuation: next.punctuation,
      numbers: next.numbers,
      ...(next.duration !== undefined ? { duration: next.duration } : {}),
      ...(next.count !== undefined ? { count: next.count } : {}),
    }).then((issued) => {
      if (deal !== dealRef.current) return;
      testIdRef.current = issued.testId;
      // Re-deal against the server's seed. Harmless before the first keystroke,
      // and skipped outright once the player has started.
      setState((current) =>
        current.phase === "idle" ? createState(toEngineConfig(next, issued.seed)) : current,
      );
    });
  }, []);

  const restart = useCallback(() => {
    setConfigState((prev) => {
      const next: TestConfig = { ...prev, seed: newSeed() };
      deal(next);
      return next;
    });
  }, [deal]);

  const setConfig = useCallback((patch: Partial<TestConfig>) => {
    setConfigState((prev) => {
      const next: TestConfig = { ...prev, ...patch, seed: newSeed() };
      deal(next);
      return next;
    });
  }, [deal]);

  // Ask for the first test's seed on mount. `deal` is stable and `initialRef`
  // never changes, so this runs exactly once.
  useEffect(() => {
    deal(initialRef.current);
  }, [deal]);

  // ── Keystrokes ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Leave browser shortcuts alone. Ctrl/Alt+Backspace is ours: it deletes a
      // word, and every text field on earth agrees.
      const wordDelete =
        event.key === "Backspace" && (event.ctrlKey || event.altKey);
      if ((event.metaKey || event.ctrlKey || event.altKey) && !wordDelete) return;

      if (event.key === "Tab") return; // never trap focus
      if (event.key === "Enter") {
        if (stateRef.current.phase === "finished") {
          event.preventDefault();
          restart();
        }
        return;
      }

      const printable = event.key.length === 1;
      if (!printable && event.key !== "Backspace") return;

      // Space scrolls the page and Backspace navigates back. Neither is welcome.
      event.preventDefault();

      const now = performance.now();
      if (originRef.current === null) originRef.current = now;
      pendingKeyAt.current = now;

      // Sound is driven by the same expectation the engine is about to check,
      // so a wrong key sounds wrong on the frame it is pressed.
      const expected = expectedChar(stateRef.current);
      playKey(profileRef.current, event.key === "Backspace" || event.key === expected);

      setState((prev) =>
        applyKey(prev, {
          key: event.key,
          code: event.code,
          t: now,
          ...(event.ctrlKey || event.altKey ? { ctrl: true } : {}),
        }),
      );
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [restart, profileRef]);

  // ── Keystroke-to-paint measurement ────────────────────────────────────────
  useLayoutEffect(() => {
    const at = pendingKeyAt.current;
    if (at === null) return;
    pendingKeyAt.current = null;
    requestAnimationFrame(() => recordLatency(performance.now() - at));
  }, [state]);

  // ── A time test ending ────────────────────────────────────────────────────
  useEffect(() => {
    if (state.phase !== "running") return;
    if (config.mode !== "time" || config.duration === undefined) return;

    const limitMs = config.duration * 1000;
    let frame = 0;

    const check = (): void => {
      const origin = originRef.current;
      if (origin !== null && performance.now() - origin >= limitMs) {
        setState((prev) => finish(prev, origin + limitMs));
        return;
      }
      frame = requestAnimationFrame(check);
    };

    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [state.phase, config.mode, config.duration]);

  return { state, stateRef, originRef, testIdRef, restart, setConfig };
}
