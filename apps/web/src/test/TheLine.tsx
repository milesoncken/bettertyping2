import { useEffect, useRef } from "react";
import type { EngineState } from "@bettertyping/engine";
import { instantWpm } from "../lib/wpm.js";
import "./line.css";

/**
 * The Line.
 *
 * A spectral trace drawn beneath the text while you type. Height is speed, hue
 * is speed, and the marks along its baseline are your actual keystrokes.
 *
 * It runs entirely on `requestAnimationFrame` against a ref — no React state,
 * no motion library, nothing on the keystroke path. At the finish it hands its
 * points to the results view, which is where it detaches and becomes the chart.
 */

const SAMPLE_EVERY_MS = 200;
const FULL_SCALE_WPM = 160;

export interface TracePoint {
  t: number;
  wpm: number;
}

/** Spectral ramp: slow → mid → fast. The only colour in the product. */
function rampColor(wpm: number): string {
  const stops: Array<[number, number, number]> = [
    [0xff, 0x3d, 0xb8],
    [0x7a, 0x6b, 0xff],
    [0x35, 0xe8, 0xff],
  ];
  const x = Math.max(0, Math.min(1, wpm / FULL_SCALE_WPM)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i] ?? stops[0]!;
  const b = stops[i + 1] ?? stops[stops.length - 1]!;
  const mix = (n: 0 | 1 | 2): number => Math.round(a[n] + (b[n] - a[n]) * f);
  return `rgb(${mix(0)}, ${mix(1)}, ${mix(2)})`;
}

interface TheLineProps {
  stateRef: React.RefObject<EngineState>;
  originRef: React.RefObject<number | null>;
  /** Filled as the test runs, then read by the results view. */
  pointsRef: React.RefObject<TracePoint[]>;
  /**
   * Total run length in ms for a `time` test, so the trace advances left to
   * right at a known rate. Null for `words`, where there is no known end and the
   * trace instead grows to fill the width.
   */
  spanMs: number | null;
  running: boolean;
}

export function TheLine({
  stateRef,
  originRef,
  pointsRef,
  spanMs,
  running,
}: TheLineProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastSampleRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let frame = 0;
    let width = 0;
    let height = 0;

    // Reset the sample clock whenever a run begins. Without this, a restart
    // compares a near-zero elapsed against the previous run's final timestamp
    // and the trace stays empty until it catches up.
    lastSampleRef.current = 0;

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);

    const draw = (): void => {
      const state = stateRef.current;
      const origin = originRef.current;
      const points = pointsRef.current;

      const elapsed = origin === null ? 0 : performance.now() - origin;

      if (running && origin !== null && elapsed - lastSampleRef.current >= SAMPLE_EVERY_MS) {
        lastSampleRef.current = elapsed;
        points.push({ t: elapsed, wpm: instantWpm(state, elapsed) });
      }

      ctx.clearRect(0, 0, width, height);

      const top = 10;
      const bottom = height - 16;
      // A time test maps to its full duration; a words test rescales as it goes,
      // with a floor so the first few seconds are not a vertical cliff.
      const span = spanMs === null ? Math.max(elapsed, 4000) : Math.max(spanMs, elapsed, 1);
      const xAt = (t: number): number => (t / span) * width;
      const yAt = (wpm: number): number =>
        bottom - Math.min(1, wpm / FULL_SCALE_WPM) * (bottom - top);

      // Keystroke marks — the raw events, not a smoothed abstraction.
      ctx.strokeStyle = "#22303f";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const event of state.events) {
        if (event.kind !== "char" && event.kind !== "space") continue;
        const x = Math.round(xAt(event.t)) + 0.5;
        ctx.moveTo(x, bottom + 4);
        ctx.lineTo(x, bottom + (event.correct ? 8 : 12));
      }
      ctx.stroke();

      if (points.length > 1) {
        // Fill under the curve, faint, keyed to the current speed.
        const lastPoint = points[points.length - 1]!;
        const fill = ctx.createLinearGradient(0, top, 0, bottom);
        const tint = rampColor(lastPoint.wpm);
        fill.addColorStop(0, tint.replace("rgb", "rgba").replace(")", ", 0.16)"));
        fill.addColorStop(1, tint.replace("rgb", "rgba").replace(")", ", 0)"));
        ctx.beginPath();
        ctx.moveTo(xAt(points[0]!.t), bottom);
        for (const point of points) ctx.lineTo(xAt(point.t), yAt(point.wpm));
        ctx.lineTo(xAt(lastPoint.t), bottom);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();

        // The trace itself, coloured segment by segment: hue *is* speed.
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1]!;
          const b = points[i]!;
          ctx.beginPath();
          ctx.moveTo(xAt(a.t), yAt(a.wpm));
          ctx.lineTo(xAt(b.t), yAt(b.wpm));
          ctx.strokeStyle = rampColor((a.wpm + b.wpm) / 2);
          ctx.stroke();
        }

        // The head — a caret, because that is what it is.
        const hx = xAt(lastPoint.t);
        const hy = yAt(lastPoint.wpm);
        ctx.strokeStyle = rampColor(lastPoint.wpm);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hx, hy - 7);
        ctx.lineTo(hx, hy + 7);
        ctx.stroke();
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [stateRef, originRef, pointsRef, spanMs, running]);

  return (
    <div className="line-wrap">
      <canvas ref={canvasRef} className="line-canvas" aria-hidden="true" />
      <div className="line-legend">
        <span className="label">slow</span>
        <span className="line-ramp" />
        <span className="label">fast</span>
      </div>
    </div>
  );
}
