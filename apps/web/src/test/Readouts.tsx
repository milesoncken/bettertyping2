import { useEffect, useState } from "react";
import type { EngineState } from "@bettertyping/engine";
import { liveAccuracy, liveWpm } from "../lib/wpm.js";
import "./readouts.css";

/**
 * Live telemetry. Runs on its own 10 Hz ticker reading refs, so updating the
 * numbers never re-renders the words. v1 re-rendered the entire test on every
 * timer tick.
 */

interface ReadoutsProps {
  stateRef: React.RefObject<EngineState>;
  originRef: React.RefObject<number | null>;
  running: boolean;
  /** Seconds remaining, for time mode. */
  duration?: number;
}

interface Live {
  wpm: number;
  accuracy: number;
  meanMs: number;
  remaining: number | null;
}

export function Readouts({
  stateRef,
  originRef,
  running,
  duration,
}: ReadoutsProps): React.JSX.Element {
  const [live, setLive] = useState<Live>({
    wpm: 0,
    accuracy: 100,
    meanMs: 0,
    remaining: duration ?? null,
  });

  useEffect(() => {
    const tick = (): void => {
      const state = stateRef.current;
      const origin = originRef.current;
      const elapsed = origin === null ? 0 : performance.now() - origin;

      const strokes = state.events.filter(
        (e) => e.kind === "char" || e.kind === "space",
      );
      const meanMs = strokes.length > 1 ? elapsed / (strokes.length - 1) : 0;

      setLive({
        wpm: liveWpm(state, elapsed),
        accuracy: liveAccuracy(state),
        meanMs,
        remaining:
          duration === undefined ? null : Math.max(0, duration - elapsed / 1000),
      });
    };

    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [stateRef, originRef, duration, running]);

  return (
    <div className="readouts">
      {live.remaining !== null && (
        <Readout label="left" value={live.remaining.toFixed(0)} lit />
      )}
      <Readout label="wpm" value={live.wpm.toFixed(1)} lit={live.remaining === null} />
      <Readout label="acc" value={live.accuracy.toFixed(1)} />
      <Readout label="mean s" value={(live.meanMs / 1000).toFixed(3)} />
    </div>
  );
}

function Readout({
  label,
  value,
  lit,
}: {
  label: string;
  value: string;
  lit?: boolean;
}): React.JSX.Element {
  return (
    <div className="readout" data-lit={lit || undefined}>
      <b className="tabular">{value}</b>
      <span className="label">{label}</span>
    </div>
  );
}
