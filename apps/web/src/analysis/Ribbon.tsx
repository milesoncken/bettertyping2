import { useCallback, useEffect, useRef, useState } from "react";
import { rampColor } from "../lib/wpm.js";
import { wpmOfFlight, type Keystroke } from "./data.js";

/**
 * The Rhythm Ribbon — a run at keystroke resolution.
 *
 * Every other chart in this product buckets time: the Line samples every 200 ms
 * and the results chart plots one point per second. Both are the right call for
 * what they show, and both hide the thing that actually varies. Typing is not a
 * smooth curve — it is bursts of three or four characters separated by hitches,
 * and at one-second resolution a burst and a hitch average into a flat line that
 * describes neither.
 *
 * So this plots the keystrokes themselves. One stroke per key:
 *
 *   x          when it happened, in real time
 *   height     how fast it was — the speed implied by its flight time
 *   thickness  how long the key was held
 *   hue        the same spectral ramp, meaning the same thing it always means
 *
 * A wrong key is drawn below the axis instead of above it, so mistakes read as
 * a texture along the bottom rather than as a colour you have to decode.
 *
 * Canvas, because a 60-second run at speed is well over a thousand marks and
 * that many SVG nodes would make the pan interaction stutter. It is drawn once
 * per interaction rather than every frame — nothing here animates on its own.
 */

const HEIGHT = 260;
const PAD = { top: 16, right: 12, bottom: 46, left: 12 };
/** The strip under the plot showing the whole run and the window into it. */
const OVERVIEW_HEIGHT = 26;
const ERROR_DEPTH = 22;

/** Speed axis ceiling, in wpm. Above this a keystroke is drawn at full height. */
const CEILING = 220;

/** Tightest window the wheel will zoom to: a second of typing, fully spread. */
const MIN_SPAN_MS = 800;

interface Window {
  from: number;
  to: number;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

export function Ribbon({
  keystrokes,
  hasDwell,
  durationMs,
}: {
  keystrokes: readonly Keystroke[];
  hasDwell: boolean;
  durationMs: number;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [window_, setWindow] = useState<Window>({
    from: 0,
    to: Math.max(1, durationMs),
  });
  const [hover, setHover] = useState<Keystroke | null>(null);
  const dragRef = useRef<{ x: number; from: number; to: number } | null>(null);

  const total = Math.max(1, durationMs);

  // A new run resets the window; otherwise the previous run's zoom would be
  // applied to a timeline it says nothing about.
  useEffect(() => {
    setWindow({ from: 0, to: total });
    setHover(null);
  }, [keystrokes, total]);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  /** Dwell range across the run, so thickness uses the whole scale it has. */
  const dwellRange = useDwellRange(keystrokes);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);

    const plotW = Math.max(1, width - PAD.left - PAD.right);
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const baseline = PAD.top + plotH;
    const span = Math.max(1, window_.to - window_.from);

    const xAt = (t: number): number => PAD.left + ((t - window_.from) / span) * plotW;
    const yAt = (wpm: number): number => baseline - clamp(wpm / CEILING, 0, 1) * plotH;

    // ── Grid ────────────────────────────────────────────────────────────────
    ctx.strokeStyle = "rgba(22, 28, 36, 1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      const y = Math.round(yAt(CEILING * fraction)) + 0.5;
      ctx.moveTo(PAD.left, y);
      ctx.lineTo(PAD.left + plotW, y);
    }
    ctx.stroke();

    ctx.font = '500 9px "Azeret Mono", ui-monospace, monospace';
    ctx.fillStyle = "rgba(91, 107, 128, 0.9)";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const fraction of [0.5, 1]) {
      ctx.fillText(
        `${Math.round(CEILING * fraction)}`,
        PAD.left - 2,
        yAt(CEILING * fraction),
      );
    }

    // The axis itself, which errors hang below.
    ctx.strokeStyle = "rgba(58, 71, 89, 0.8)";
    ctx.beginPath();
    ctx.moveTo(PAD.left, baseline + 0.5);
    ctx.lineTo(PAD.left + plotW, baseline + 0.5);
    ctx.stroke();

    // ── The keystrokes ──────────────────────────────────────────────────────
    ctx.lineCap = "butt";
    for (const stroke of keystrokes) {
      if (stroke.t < window_.from || stroke.t > window_.to) continue;
      if (stroke.kind === "backspace" || stroke.kind === "word-back") continue;

      const x = xAt(stroke.t);
      const speed = stroke.flight === null ? 0 : wpmOfFlight(stroke.flight);

      // Thickness is dwell. With no dwell recorded every stroke is a hairline,
      // which is the honest rendering of "this run cannot tell you".
      ctx.lineWidth = hasDwell ? thicknessOf(stroke.dwell, dwellRange) : 1;

      if (!stroke.correct) {
        // Errors hang below the axis. They are the same marks upside down, so
        // a burst of them reads as texture without needing a second encoding.
        ctx.strokeStyle = "rgba(255, 61, 184, 0.85)";
        ctx.beginPath();
        ctx.moveTo(x, baseline + 1);
        ctx.lineTo(x, baseline + ERROR_DEPTH);
        ctx.stroke();
        continue;
      }

      ctx.strokeStyle = rampColor(speed, 0.92, CEILING);
      ctx.beginPath();
      ctx.moveTo(x, baseline);
      ctx.lineTo(x, yAt(speed));
      ctx.stroke();
    }

    // ── The hovered stroke, marked ──────────────────────────────────────────
    if (hover && hover.t >= window_.from && hover.t <= window_.to) {
      ctx.strokeStyle = "rgba(231, 238, 247, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(xAt(hover.t)) + 0.5, PAD.top);
      ctx.lineTo(Math.round(xAt(hover.t)) + 0.5, baseline + ERROR_DEPTH);
      ctx.stroke();
    }

    // ── Overview: the whole run, with the window drawn on it ────────────────
    const overviewTop = HEIGHT - OVERVIEW_HEIGHT;
    ctx.fillStyle = "rgba(10, 14, 20, 1)";
    ctx.fillRect(PAD.left, overviewTop, plotW, OVERVIEW_HEIGHT);

    ctx.lineWidth = 1;
    for (const stroke of keystrokes) {
      if (stroke.kind === "backspace" || stroke.kind === "word-back") continue;
      const x = PAD.left + (stroke.t / total) * plotW;
      const speed = stroke.flight === null ? 0 : wpmOfFlight(stroke.flight);
      const h = clamp(speed / CEILING, 0, 1) * (OVERVIEW_HEIGHT - 6);
      ctx.strokeStyle = stroke.correct
        ? rampColor(speed, 0.5, CEILING)
        : "rgba(255, 61, 184, 0.5)";
      ctx.beginPath();
      ctx.moveTo(x, overviewTop + OVERVIEW_HEIGHT - 3);
      ctx.lineTo(x, overviewTop + OVERVIEW_HEIGHT - 3 - h);
      ctx.stroke();
    }

    // The window, as a bracket over the overview.
    const wx = PAD.left + (window_.from / total) * plotW;
    const ww = Math.max(2, ((window_.to - window_.from) / total) * plotW);
    ctx.fillStyle = "rgba(231, 238, 247, 0.07)";
    ctx.fillRect(wx, overviewTop, ww, OVERVIEW_HEIGHT);
    ctx.strokeStyle = "rgba(231, 238, 247, 0.3)";
    ctx.strokeRect(
      Math.round(wx) + 0.5,
      overviewTop + 0.5,
      Math.round(ww),
      OVERVIEW_HEIGHT - 1,
    );
  }, [keystrokes, width, window_, hover, hasDwell, dwellRange, total]);

  /** Time under a pointer position, in run milliseconds. */
  const timeAt = useCallback(
    (clientX: number): number => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const plotW = Math.max(1, rect.width - PAD.left - PAD.right);
      const fraction = (clientX - rect.left - PAD.left) / plotW;
      return window_.from + fraction * (window_.to - window_.from);
    },
    [window_],
  );

  /**
   * Wheel zooms about the cursor rather than about the centre, so the keystroke
   * you are looking at stays where it is while the scale changes under it.
   */
  const onWheel = (event: React.WheelEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const focus = timeAt(event.clientX);
    const span = window_.to - window_.from;
    const next = clamp(span * (event.deltaY > 0 ? 1.25 : 0.8), MIN_SPAN_MS, total);
    const share = clamp((focus - window_.from) / span, 0, 1);
    let from = focus - next * share;
    let to = from + next;
    if (from < 0) [from, to] = [0, next];
    if (to > total) [from, to] = [total - next, total];
    setWindow({ from: Math.max(0, from), to });
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, from: window_.from, to: window_.to };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (drag) {
      const rect = canvas.getBoundingClientRect();
      const plotW = Math.max(1, rect.width - PAD.left - PAD.right);
      const span = drag.to - drag.from;
      const shift = ((drag.x - event.clientX) / plotW) * span;
      const from = clamp(drag.from + shift, 0, total - span);
      setWindow({ from, to: from + span });
      return;
    }

    const t = timeAt(event.clientX);
    setHover(nearest(keystrokes, t));
  };

  const endDrag = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (dragRef.current) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  };

  const zoomed = window_.to - window_.from < total - 1;

  return (
    <figure className="ribbon">
      <div className="ribbon-host" ref={hostRef} style={{ height: HEIGHT }}>
        <canvas
          ref={canvasRef}
          className="ribbon-canvas"
          style={{ width: "100%", height: HEIGHT }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={`${keystrokes.length} keystrokes over ${(durationMs / 1000).toFixed(1)} seconds.`}
        />
      </div>

      <figcaption className="ribbon-foot">
        <Readout stroke={hover} hasDwell={hasDwell} />
        <span className="label">
          {zoomed
            ? `${(window_.from / 1000).toFixed(1)}–${(window_.to / 1000).toFixed(1)}s of ${(total / 1000).toFixed(1)}s`
            : `${(total / 1000).toFixed(1)}s · scroll to zoom, drag to pan`}
          {zoomed && (
            <button
              className="ribbon-reset"
              onClick={() => setWindow({ from: 0, to: total })}
            >
              reset
            </button>
          )}
        </span>
      </figcaption>
    </figure>
  );
}

/** What the hovered keystroke was, in words. */
function Readout({
  stroke,
  hasDwell,
}: {
  stroke: Keystroke | null;
  hasDwell: boolean;
}): React.JSX.Element {
  if (!stroke) {
    return (
      <span className="label ribbon-readout">
        height is speed · thickness is how long the key was held · below the axis is a
        mistake
      </span>
    );
  }

  const label = stroke.key === " " ? "space" : stroke.key;
  return (
    <span className="ribbon-readout tabular">
      <b>{label}</b>
      <em>{(stroke.t / 1000).toFixed(2)}s</em>
      {stroke.flight === null ? (
        <em>first key</em>
      ) : (
        <em>
          {stroke.flight.toFixed(0)}ms · {wpmOfFlight(stroke.flight).toFixed(0)} wpm
        </em>
      )}
      <em>
        {hasDwell && stroke.dwell !== null
          ? `held ${stroke.dwell.toFixed(0)}ms`
          : "no dwell"}
      </em>
      {!stroke.correct && (
        <em data-bad>
          wanted {stroke.expected === " " ? "space" : (stroke.expected ?? "—")}
        </em>
      )}
    </span>
  );
}

/** The keystroke closest to a time, so hovering never falls between marks. */
function nearest(keystrokes: readonly Keystroke[], t: number): Keystroke | null {
  let best: Keystroke | null = null;
  let bestGap = Infinity;
  for (const stroke of keystrokes) {
    const gap = Math.abs(stroke.t - t);
    if (gap < bestGap) {
      bestGap = gap;
      best = stroke;
    }
  }
  return best;
}

/**
 * The run's own dwell range.
 *
 * Fixed thresholds would render most players' runs at a single thickness, since
 * one person's holds might all sit between 60 and 90 ms. The scale is therefore
 * the run's own spread — the thickness says "long for you", which is the only
 * comparison that means anything.
 */
function useDwellRange(keystrokes: readonly Keystroke[]): {
  low: number;
  high: number;
} {
  const dwells = keystrokes
    .map((stroke) => stroke.dwell)
    .filter((dwell): dwell is number => dwell !== null)
    .sort((a, b) => a - b);

  if (dwells.length < 4) return { low: 0, high: 1 };
  const at = (p: number): number => dwells[Math.floor((dwells.length - 1) * p)] ?? 0;
  const low = at(0.05);
  const high = at(0.95);
  return { low, high: high > low ? high : low + 1 };
}

const MIN_THICK = 0.9;
const MAX_THICK = 3.2;

function thicknessOf(
  dwell: number | null,
  range: { low: number; high: number },
): number {
  if (dwell === null) return 1;
  const share = clamp((dwell - range.low) / (range.high - range.low), 0, 1);
  return MIN_THICK + share * (MAX_THICK - MIN_THICK);
}
