import { useMemo } from "react";
import {
  KEYS,
  ROW_UNITS,
  handOf,
  type PhysicalKey,
} from "@bettertyping/analytics/keyboard";
import { rampColor } from "../lib/wpm.js";
import { MIN_SAMPLES, wpmOfFlight, type KeyStat } from "./data.js";

/**
 * The Atlas — your keyboard, coloured by what your hands do on it.
 *
 * v1 had a heatmap. It shaded each key by that key's **single worst
 * keystroke**, which measures the unluckiest moment of your life rather than
 * your typing: one sneeze put `k` in the red permanently. Every figure here is
 * a median over a stated sample count, and a key with too few samples is drawn
 * as unmeasured rather than given a confident colour it has not earned.
 *
 * It is laid out by **physical key**, from `KeyboardEvent.code`, so it is the
 * board under your hands whatever your layout maps onto it — and each cap is
 * lettered with the character that key actually produced in your own logs,
 * observed rather than assumed. A Dvorak player gets a Dvorak Atlas without
 * anyone having shipped a Dvorak table.
 *
 * Colour obeys the governing rule: the spectral ramp, and the ramp always runs
 * slow-and-wrong to fast-and-right, whichever metric is selected.
 */

export type AtlasMetric = "flight" | "accuracy" | "load" | "dwell";

export const METRICS: ReadonlyArray<{ id: AtlasMetric; label: string }> = [
  { id: "flight", label: "speed" },
  { id: "accuracy", label: "accuracy" },
  { id: "load", label: "load" },
  { id: "dwell", label: "dwell" },
];

/** Rendering scale. The board is 15 units wide and five rows tall. */
const UNIT = 40;
const GAP = 3;
const ROWS = 5;

interface Cell {
  key: PhysicalKey;
  stat: KeyStat | null;
  /** 0–1 along the ramp, or null when there is nothing to say. */
  value: number | null;
  /** Confident enough to colour. */
  measured: boolean;
  title: string;
}

export function Atlas({
  keys,
  metric,
  dwellAvailable,
  selected,
  onSelect,
}: {
  keys: readonly KeyStat[];
  metric: AtlasMetric;
  dwellAvailable: boolean;
  selected: string | null;
  onSelect: (code: string | null) => void;
}): React.JSX.Element {
  const cells = useMemo(
    () => buildCells(keys, metric, dwellAvailable),
    [keys, metric, dwellAvailable],
  );

  const width = ROW_UNITS * UNIT;
  const height = ROWS * UNIT;

  return (
    <div className="atlas">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="atlas-svg"
        role="img"
        aria-label={`Keyboard coloured by ${metric}. ${cells.filter((c) => c.measured).length} keys measured.`}
      >
        {cells.map((cell) => {
          const x = cell.key.x * UNIT;
          const y = cell.key.row * UNIT;
          const w = cell.key.w * UNIT - GAP;
          const h = UNIT - GAP;
          const isSelected = selected === cell.key.code;

          return (
            <g
              key={cell.key.code}
              className="atlas-key"
              data-measured={cell.measured || undefined}
              data-selected={isSelected || undefined}
              data-hand={handOf(cell.key.finger)}
              onClick={() => onSelect(isSelected ? null : cell.key.code)}
            >
              <title>{cell.title}</title>
              <rect x={x} y={y} width={w} height={h} rx={4} className="atlas-cap" />
              {cell.value !== null && (
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={4}
                  fill={rampColor(cell.value * 160, 0.9, 160)}
                  opacity={cell.measured ? 0.85 : 0.22}
                />
              )}
              <text x={x + w / 2} y={y + h / 2} className="atlas-legend">
                {legendOf(cell)}
              </text>
              {/* Sample count, as a bar along the bottom edge. A key you have
                  barely used says so, rather than being silently confident. */}
              {cell.stat !== null && (
                <rect
                  x={x}
                  y={y + h - 2}
                  width={w * confidenceOf(cell.stat)}
                  height={2}
                  className="atlas-samples"
                />
              )}
            </g>
          );
        })}
      </svg>

      <p className="label atlas-note">
        {metric === "dwell" && !dwellAvailable
          ? "no run here recorded how long a key was held — dwell arrived after these runs did"
          : "median over your verified runs · a dim key has too few samples to claim anything · click one to filter the rose"}
      </p>
    </div>
  );
}

function buildCells(
  keys: readonly KeyStat[],
  metric: AtlasMetric,
  dwellAvailable: boolean,
): Cell[] {
  const byCode = new Map(keys.map((key) => [key.code, key]));
  const busiest = Math.max(1, ...keys.map((key) => key.struck));

  return KEYS.map((key) => {
    const stat = byCode.get(key.code) ?? null;
    const measured = stat !== null && sampleOf(stat, metric) >= MIN_SAMPLES;
    return {
      key,
      stat,
      value: stat === null ? null : valueOf(stat, metric, busiest, dwellAvailable),
      measured,
      title: titleOf(key, stat, dwellAvailable),
    };
  });
}

/** How many observations stand behind the selected metric for this key. */
function sampleOf(stat: KeyStat, metric: AtlasMetric): number {
  if (metric === "accuracy") return stat.wanted;
  if (metric === "dwell") return stat.dwellMs === null ? 0 : stat.struck;
  return stat.struck;
}

/**
 * The metric as a position on the ramp, 0 slow/wrong → 1 fast/right.
 *
 * Every metric is turned the same way round on purpose. Cyan always means good
 * news and magenta always means the thing to work on, so the board can be read
 * without first checking which scale is showing.
 */
function valueOf(
  stat: KeyStat,
  metric: AtlasMetric,
  busiest: number,
  dwellAvailable: boolean,
): number | null {
  switch (metric) {
    case "flight": {
      if (stat.flightMs <= 0) return null;
      // Expressed in wpm so the ramp means what it means everywhere else.
      return Math.min(1, wpmOfFlight(stat.flightMs) / 160);
    }
    case "accuracy": {
      if (stat.wanted === 0) return null;
      const hitRate = 1 - stat.missed / stat.wanted;
      // Accuracy lives in a narrow band near the top; spreading the last 15%
      // across the whole ramp is what makes the difference between 97% and 99%
      // visible at all.
      return Math.max(0, Math.min(1, (hitRate - 0.85) / 0.15));
    }
    case "load":
      return Math.min(1, stat.struck / busiest);
    case "dwell": {
      if (!dwellAvailable || stat.dwellMs === null) return null;
      // A short hold sits at the fast end, matching every other scale here.
      return Math.max(0, Math.min(1, 1 - (stat.dwellMs - 40) / 120));
    }
  }
}

/** Sample count as a 0–1 bar, saturating at a comfortably confident count. */
const CONFIDENT_AT = 120;
const confidenceOf = (stat: KeyStat): number => Math.min(1, stat.struck / CONFIDENT_AT);

function legendOf(cell: Cell): string {
  const observed = cell.stat?.legend ?? "";
  const label = observed !== "" ? observed : cell.key.legend;
  if (label === " " || cell.key.code === "Space") return "";
  return label.length > 5 ? label.slice(0, 5) : label;
}

function titleOf(
  key: PhysicalKey,
  stat: KeyStat | null,
  dwellAvailable: boolean,
): string {
  const name =
    stat?.legend !== undefined && stat.legend !== "" ? stat.legend : key.legend;
  if (!stat || stat.struck === 0) return `${name} — never pressed`;

  const parts = [
    `${name} · ${handOf(key.finger)} hand`,
    `struck ${stat.struck}`,
    stat.flightMs > 0
      ? `median flight ${stat.flightMs.toFixed(0)}ms`
      : "no flight sample",
  ];
  if (stat.wanted > 0) {
    parts.push(
      `missed ${stat.missed} of ${stat.wanted} (${((1 - stat.missed / stat.wanted) * 100).toFixed(1)}%)`,
    );
  }
  if (dwellAvailable && stat.dwellMs !== null)
    parts.push(`held ${stat.dwellMs.toFixed(0)}ms`);
  return parts.join(" · ");
}
