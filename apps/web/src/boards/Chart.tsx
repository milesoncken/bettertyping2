import { useEffect, useMemo, useRef, useState } from "react";
import { bandOf } from "../lib/band.js";
import { rampColor } from "../lib/wpm.js";

/**
 * A series with its ±1σ band, in SVG.
 *
 * The test screen draws its trace on a canvas because it repaints every frame
 * against a one-frame budget. Nothing here moves: a chart of finished runs is
 * drawn once, and it belongs in the accessibility tree. SVG is the right
 * instrument for a still.
 *
 * It is drawn at the size it is actually displayed, measured — a `viewBox` with
 * `preserveAspectRatio="none"` would be less code and would stretch every dot
 * into an ellipse the moment the window was not the assumed width.
 *
 * The band is the same centred rolling ±1σ the Line uses, from the same
 * function: a point above it is a run that broke the player's own form.
 */

const HEIGHT = 210;
const PAD = { top: 16, right: 10, bottom: 6, left: 10 };

export interface ChartPoint {
  label: string;
  value: number;
}

/** The element's own width, kept current across resizes. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function Chart({
  points,
  unit = "wpm",
}: {
  points: readonly ChartPoint[];
  unit?: string;
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const width = useWidth(hostRef);

  const geometry = useMemo(() => {
    const values = points.map((point) => point.value);
    const band = bandOf(values);

    /**
     * The axis fits the data, and says so.
     *
     * A zero-based axis is the honest default for a bar chart, and the wrong
     * one here: the whole subject of this chart is the difference between a
     * player's runs, and against a 0–120 scale a ±1σ band two words wide is a
     * hairline. The axis is therefore zoomed to the series and its band — and
     * both bounds are printed under it, so a steep-looking line can be read for
     * what it actually is.
     */
    const low = Math.min(...values, ...band.map((b) => b.lo));
    const high = Math.max(...values, ...band.map((b) => b.hi));
    const pad = Math.max(2, (high - low) * 0.18);
    const lo = Math.max(0, Math.floor((low - pad) / 5) * 5);
    const hi = Math.max(lo + 10, Math.ceil((high + pad) / 5) * 5);

    const plotW = Math.max(1, width - PAD.left - PAD.right);
    const plotH = HEIGHT - PAD.top - PAD.bottom;

    const x = (i: number): number =>
      values.length <= 1 ? PAD.left + plotW / 2 : PAD.left + (i / (values.length - 1)) * plotW;
    const y = (value: number): number =>
      PAD.top + plotH - ((value - lo) / (hi - lo)) * plotH;

    const line = values.map((value, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(value)}`).join(" ");
    const area =
      values.length > 2
        ? `${band.map((b, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(b.hi)}`).join(" ")} ` +
          `${band
            .map((_, i) => band.length - 1 - i)
            .map((i) => `L${x(i)} ${y(band[i]!.lo)}`)
            .join(" ")} Z`
        : "";

    return { lo, hi, band, x, y, line, area, values };
  }, [points, width]);

  if (points.length === 0) {
    return <p className="empty label">no runs to plot yet</p>;
  }

  const { lo, hi, band, x, y, line, area, values } = geometry;
  const best = Math.max(...values);

  return (
    <figure className="chart-figure">
      <div className="chart-host" ref={hostRef} style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            className="chart-svg"
            role="img"
            aria-label={`${values.length} runs. Latest ${values[values.length - 1]?.toFixed(0)} ${unit}, best ${best.toFixed(0)} ${unit}.`}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
              <line
                key={fraction}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(lo + (hi - lo) * fraction)}
                y2={y(lo + (hi - lo) * fraction)}
                className="grid"
              />
            ))}

            {area ? <path d={area} className="band" /> : null}
            <path d={line} className="trace" />

            {points.map((point, i) => {
              const beat = band[i] !== undefined && point.value > band[i]!.hi;
              return (
                <circle
                  key={`${point.label}-${i}`}
                  cx={x(i)}
                  cy={y(point.value)}
                  r={beat ? 5 : 3}
                  fill={rampColor(point.value, beat ? 1 : 0.8, Math.max(hi, 120))}
                  className="dot"
                >
                  <title>
                    {point.label} · {point.value.toFixed(1)} {unit}
                  </title>
                </circle>
              );
            })}
          </svg>
        )}
      </div>

      <figcaption className="chart-axis">
        <span className="label tabular">
          axis {lo}–{hi} {unit}
        </span>
        <span className="label">
          {values.length} {values.length === 1 ? "point" : "points"} · band ±1σ of the series' own
          form
        </span>
      </figcaption>
    </figure>
  );
}
