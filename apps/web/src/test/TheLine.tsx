import { useEffect, useRef } from "react";
import type { EngineState, Phase } from "@bettertyping/engine";
import { instantWpm, rampColor } from "../lib/wpm.js";
import { elapsedOf } from "../lib/clock.js";
import { bandOf } from "../lib/band.js";
import "./line.css";

/**
 * The Line — the signature interaction.
 *
 * While you type it is a spectral trace beneath the text: height is speed, hue
 * is speed, and the marks along its baseline are your actual keystrokes. When
 * the run ends it *detaches*, flies up, and settles into the results chart. The
 * chart was never generated. You drew it.
 *
 * It is one full-area overlay canvas, and the thing that animates is the
 * rectangle it plots into — lerped between two measured anchors. Nothing
 * resizes, no element relayouts, and the canvas never leaves the compositor's
 * good books. The whole thing is raw requestAnimationFrame; the test route
 * carries no motion library.
 */

const SAMPLE_EVERY_MS = 200;
const FLIGHT_MS = 900;
const FLIGHT_DELAY_MS = 140;
export interface TracePoint {
  t: number;
  wpm: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Floor for the speed axis. The scale grows past this to fit the run, because
 * clipping a fast player's trace against a ceiling is worse than a moving axis —
 * a flat line along the top is a lie about what they just did.
 */
const MIN_FULL_SCALE = 160;
const SCALE_STEP = 40;

/** The axis ceiling for a run: the floor, or the peak rounded up to a step. */
export function scaleFor(points: readonly TracePoint[]): number {
  let peak = 0;
  for (const point of points) if (point.wpm > peak) peak = point.wpm;
  if (peak <= MIN_FULL_SCALE) return MIN_FULL_SCALE;
  return Math.ceil((peak * 1.05) / SCALE_STEP) * SCALE_STEP;
}

const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface TheLineProps {
  stateRef: React.RefObject<EngineState>;
  originRef: React.RefObject<number | null>;
  pointsRef: React.RefObject<TracePoint[]>;
  /** Run length in ms for a `time` test; null for `words`, which rescales. */
  spanMs: number | null;
  phase: Phase;
  /** The element the canvas overlays and that anchors are measured against. */
  hostRef: React.RefObject<HTMLElement | null>;
  /** Where the trace lives while typing. */
  testAnchorRef: React.RefObject<HTMLElement | null>;
  /** Where it settles once the run is over. */
  chartAnchorRef: React.RefObject<HTMLElement | null>;
}

export function TheLine({
  stateRef,
  originRef,
  pointsRef,
  spanMs,
  phase,
  hostRef,
  testAnchorRef,
  chartAnchorRef,
}: TheLineProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastSampleRef = useRef(0);
  const flightRef = useRef(0);
  const flightStartRef = useRef<number | null>(null);

  // Reset the flight whenever a fresh run is dealt.
  useEffect(() => {
    if (phase !== "finished") {
      flightRef.current = 0;
      flightStartRef.current = null;
    }
  }, [phase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let width = 0;
    let height = 0;

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

    /** An anchor's box in canvas coordinates. */
    const rectOf = (el: HTMLElement | null): Rect | null => {
      const host = hostRef.current;
      if (!el || !host) return null;
      const a = el.getBoundingClientRect();
      const h = host.getBoundingClientRect();
      return { x: a.left - h.left, y: a.top - h.top, w: a.width, h: a.height };
    };

    const draw = (now: number): void => {
      const state = stateRef.current;
      const points = pointsRef.current;
      const elapsed = elapsedOf(state, originRef.current);
      const running = state.phase === "running";

      if (running && originRef.current !== null) {
        if (elapsed - lastSampleRef.current >= SAMPLE_EVERY_MS) {
          lastSampleRef.current = elapsed;
          points.push({ t: elapsed, wpm: instantWpm(state, elapsed) });
        }
      }

      // ── Flight ────────────────────────────────────────────────────────────
      if (state.phase === "finished") {
        if (flightStartRef.current === null) flightStartRef.current = now + FLIGHT_DELAY_MS;
        const t = (now - flightStartRef.current) / FLIGHT_MS;
        flightRef.current = reduced ? 1 : Math.max(0, Math.min(1, t));
      }
      const flight = easeOut(flightRef.current);

      const testRect = rectOf(testAnchorRef.current);
      const chartRect = rectOf(chartAnchorRef.current);
      const plot: Rect | null =
        testRect === null
          ? chartRect
          : chartRect === null || flight === 0
            ? testRect
            : {
                x: lerp(testRect.x, chartRect.x, flight),
                y: lerp(testRect.y, chartRect.y, flight),
                w: lerp(testRect.w, chartRect.w, flight),
                h: lerp(testRect.h, chartRect.h, flight),
              };

      ctx.clearRect(0, 0, width, height);
      if (!plot || points.length === 0) {
        frame = requestAnimationFrame(draw);
        return;
      }

      const span =
        spanMs === null ? Math.max(elapsed, 4000) : Math.max(spanMs, elapsed, 1);
      const scale = scaleFor(points);
      const baseline = plot.y + plot.h;
      const xAt = (t: number): number => plot.x + (t / span) * plot.w;
      const yAt = (wpm: number): number =>
        baseline - Math.min(1, wpm / scale) * plot.h;

      // ── The axis ──────────────────────────────────────────────────────────
      // Drawn here rather than in the DOM so the labels and the plot can never
      // disagree about the scale, whatever the run pushes it to.
      const divisions = [0.25, 0.5, 0.75, 1] as const;
      if (flight > 0.15) {
        ctx.strokeStyle = `rgba(58, 71, 89, ${0.5 * flight})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const fraction of divisions.slice(0, 3)) {
          const y = Math.round(yAt(scale * fraction)) + 0.5;
          ctx.moveTo(plot.x, y);
          ctx.lineTo(plot.x + plot.w, y);
        }
        ctx.stroke();
      }

      ctx.font = '500 9px "Azeret Mono", ui-monospace, monospace';
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(91, 107, 128, 0.9)";
      for (const fraction of divisions) {
        ctx.fillText(
          Math.round(scale * fraction).toString(),
          plot.x - 8,
          yAt(scale * fraction),
        );
      }
      ctx.fillText("0", plot.x - 8, baseline);

      // ── Keystroke marks, which belong to the live test ────────────────────
      if (flight < 1) {
        ctx.strokeStyle = `rgba(34, 48, 63, ${1 - flight})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const event of state.events) {
          if (event.kind !== "char" && event.kind !== "space") continue;
          const x = Math.round(xAt(event.t)) + 0.5;
          ctx.moveTo(x, baseline + 4);
          ctx.lineTo(x, baseline + (event.correct ? 8 : 12));
        }
        ctx.stroke();
      }

      // ── The confidence band, revealed as the chart lands ─────────────────
      const bandAlpha = Math.max(0, (flight - 0.45) / 0.55);
      if (bandAlpha > 0 && points.length > 2) {
        const band = bandOf(points.map((point) => point.wpm));
        ctx.beginPath();
        points.forEach((point, i) => {
          const x = xAt(point.t);
          const y = yAt(band[i]!.hi);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        for (let i = points.length - 1; i >= 0; i--) {
          ctx.lineTo(xAt(points[i]!.t), yAt(band[i]!.lo));
        }
        ctx.closePath();
        ctx.fillStyle = `rgba(231, 238, 247, ${0.055 * bandAlpha})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(231, 238, 247, ${0.10 * bandAlpha})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Where the run broke its own rhythm, mark it.
        ctx.fillStyle = rampColor(scale, 0.9 * bandAlpha, scale);
        points.forEach((point, i) => {
          if (point.wpm <= band[i]!.hi) return;
          ctx.beginPath();
          ctx.arc(xAt(point.t), yAt(point.wpm), 1.7, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // ── Fill under the curve ─────────────────────────────────────────────
      const last = points[points.length - 1]!;
      const fill = ctx.createLinearGradient(0, plot.y, 0, baseline);
      fill.addColorStop(0, rampColor(last.wpm, 0.16, scale));
      fill.addColorStop(1, rampColor(last.wpm, 0, scale));
      ctx.beginPath();
      ctx.moveTo(xAt(points[0]!.t), baseline);
      for (const point of points) ctx.lineTo(xAt(point.t), yAt(point.wpm));
      ctx.lineTo(xAt(last.t), baseline);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();

      // ── The trace: hue is speed, segment by segment ───────────────────────
      ctx.lineWidth = lerp(1.6, 1.9, flight);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        ctx.beginPath();
        ctx.moveTo(xAt(a.t), yAt(a.wpm));
        ctx.lineTo(xAt(b.t), yAt(b.wpm));
        ctx.strokeStyle = rampColor((a.wpm + b.wpm) / 2, 1, scale);
        ctx.stroke();
      }

      // ── The head: a caret while running, a terminal dot once landed ───────
      const hx = xAt(last.t);
      const hy = yAt(last.wpm);
      ctx.strokeStyle = rampColor(last.wpm, 1, scale);
      ctx.fillStyle = rampColor(last.wpm, 1, scale);
      if (flight < 0.5) {
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hx, hy - 7);
        ctx.lineTo(hx, hy + 7);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(hx, hy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [stateRef, originRef, pointsRef, spanMs, hostRef, testAnchorRef, chartAnchorRef]);

  return <canvas ref={canvasRef} className="line-canvas" aria-hidden="true" />;
}
