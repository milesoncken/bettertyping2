import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyKey, createState, finish } from "@bettertyping/engine";
import type { EngineState, TestConfig } from "@bettertyping/engine";
import { recordLatency } from "../lib/latency.js";

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
  stateRef: React.RefObject<EngineState>;
  /** Monotonic ms of the first keystroke, or null before the test starts. */
  originRef: React.RefObject<number | null>;
  restart: () => void;
  setConfig: (patch: Partial<TestConfig>) => void;
}

export function useTypingTest(initial: TestConfig): TypingTest {
  const [config, setConfigState] = useState<TestConfig>(initial);
  const [state, setState] = useState<EngineState>(() => createState(initial));

  const stateRef = useRef<EngineState>(state);
  const originRef = useRef<number | null>(null);
  const pendingKeyAt = useRef<number | null>(null);

  stateRef.current = state;

  const restart = useCallback(() => {
    setConfigState((prev) => {
      const next: TestConfig = { ...prev, seed: newSeed() };
      originRef.current = null;
      setState(createState(next));
      return next;
    });
  }, []);

  const setConfig = useCallback((patch: Partial<TestConfig>) => {
    setConfigState((prev) => {
      const next: TestConfig = { ...prev, ...patch, seed: newSeed() };
      originRef.current = null;
      setState(createState(next));
      return next;
    });
  }, []);

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
  }, [restart]);

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

  return { state, stateRef, originRef, restart, setConfig };
}
