import { useMemo, useState } from "react";
import { KEYS, handOf, type PhysicalKey } from "@bettertyping/analytics/keyboard";
import { rampColor } from "../lib/wpm.js";
import { MIN_SAMPLES, type BigramClass, type BigramStat } from "./data.js";

/**
 * The Transition Rose — every pair of keys you type, and what each one costs.
 *
 * A per-key heatmap can only ever tell you which letters are slow, and letters
 * are not what typing is made of. `e` is not slow; `ed` is slow, because one
 * finger has to leave one key and land on another before anything else can
 * happen. Transitions are the unit that carries the cost, and your slow set is
 * personal — which is exactly why no site that stores per-second samples can
 * show you this.
 *
 * **The ordering is the argument.** Keys run around the circle in finger order:
 * left pinky through left index down one side, right index through right pinky
 * back up the other. So the geometry does the classification for you —
 *
 *   short arc, hugging one side   a roll, one hand, adjacent fingers
 *   chord across the middle       an alternation, hands trading off
 *   a stub barely leaving its node  a same-finger bigram, the expensive kind
 *
 * — and a hand that is working too hard looks lopsided before you read a label.
 *
 * Thickness is how often you type it. Hue is how fast it is *for you*, against
 * your own median, so this reads the same for someone at 40 wpm and at 140.
 */

const SIZE = 460;
const CENTRE = SIZE / 2;
const RADIUS = SIZE / 2 - 46;

export type RoseFilter = "all" | "same-finger" | "rolls" | "alternate";

export const FILTERS: ReadonlyArray<{ id: RoseFilter; label: string }> = [
  { id: "all", label: "everything" },
  { id: "same-finger", label: "same finger" },
  { id: "rolls", label: "rolls" },
  { id: "alternate", label: "alternating" },
];

/** Arcs drawn at once. Past this the disc fills in and says nothing. */
const MAX_ARCS = 140;

/**
 * The nodes, in the order that makes the picture legible.
 *
 * Left hand pinky→index occupies the first half, right hand index→pinky the
 * second, so the two hands sit opposite each other and the gap between them is
 * the middle of the board. Only keys that produce a character are placed;
 * shift, tab and the like are transitions nobody wants a chord drawn for.
 */
function ringOrder(): PhysicalKey[] {
  const typing = KEYS.filter((key) => key.legend.length === 1 || key.code === "Space");
  const left = typing
    .filter((key) => handOf(key.finger) === "left")
    .sort((a, b) => a.finger - b.finger || a.row - b.row || a.x - b.x);
  const right = typing
    .filter((key) => handOf(key.finger) === "right")
    .sort((a, b) => b.finger - a.finger || a.row - b.row || a.x - b.x);
  // Right hand reversed so index fingers meet across the gap rather than pinkies.
  return [...left, ...right.reverse()];
}

interface Node {
  key: PhysicalKey;
  angle: number;
  x: number;
  y: number;
}

export function Rose({
  bigrams,
  filter,
  focus,
  legends,
}: {
  bigrams: readonly BigramStat[];
  filter: RoseFilter;
  /** A key selected on the Atlas: only transitions through it are drawn. */
  focus: string | null;
  legends: Record<string, string>;
}): React.JSX.Element {
  const [hover, setHover] = useState<BigramStat | null>(null);

  const { nodes, index } = useMemo(() => {
    const ring = ringOrder();
    const nodes: Node[] = ring.map((key, i) => {
      // Start at the top and run clockwise, so the left hand fills the right
      // half of the circle the way it faces the board.
      const angle = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
      return {
        key,
        angle,
        x: CENTRE + Math.cos(angle) * RADIUS,
        y: CENTRE + Math.sin(angle) * RADIUS,
      };
    });
    return { nodes, index: new Map(nodes.map((node) => [node.key.code, node])) };
  }, []);

  const drawn = useMemo(() => {
    const kept = bigrams.filter((bigram) => {
      if (bigram.n < MIN_SAMPLES) return false;
      if (!index.has(bigram.from) || !index.has(bigram.to)) return false;
      if (focus !== null && bigram.from !== focus && bigram.to !== focus) return false;
      return matches(bigram.kind, filter);
    });
    return kept.slice(0, MAX_ARCS);
  }, [bigrams, filter, focus, index]);

  /**
   * The player's own median transition, which every hue is relative to.
   *
   * Taken over the whole set rather than the filtered one, so switching filters
   * recolours nothing — a same-finger bigram has to look slow next to your
   * typing in general, not next to your other same-finger bigrams.
   */
  const baseline = useMemo(() => medianLatency(bigrams), [bigrams]);
  const widest = Math.max(1, ...drawn.map((bigram) => bigram.n));

  if (bigrams.length === 0) {
    return <p className="empty label">no transitions recorded yet</p>;
  }

  return (
    <div className="rose">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="rose-svg"
        role="img"
        aria-label={`${drawn.length} key transitions, hue relative to your median of ${baseline.toFixed(0)} milliseconds.`}
      >
        {/* The gap between the hands, marked so the two halves read as hands. */}
        <circle cx={CENTRE} cy={CENTRE} r={RADIUS} className="rose-ring" />

        <g className="rose-arcs">
          {drawn.map((bigram) => {
            const from = index.get(bigram.from);
            const to = index.get(bigram.to);
            if (!from || !to) return null;

            const lit = hover?.pair === bigram.pair;
            return (
              <path
                key={bigram.pair}
                d={arc(from, to)}
                stroke={hueOf(bigram, baseline)}
                strokeWidth={0.6 + (bigram.n / widest) * 3.4}
                strokeOpacity={hover === null ? 0.5 : lit ? 0.95 : 0.12}
                fill="none"
                onPointerEnter={() => setHover(bigram)}
                onPointerLeave={() => setHover(null)}
              >
                <title>
                  {bigram.label} · {bigram.kind} · {bigram.n}× ·{" "}
                  {bigram.latencyMs > 0
                    ? `${bigram.latencyMs.toFixed(0)}ms`
                    : "no clean sample"}
                </title>
              </path>
            );
          })}
        </g>

        <g className="rose-nodes">
          {nodes.map((node) => {
            const label = legends[node.key.code] ?? node.key.legend;
            const touched =
              hover?.from === node.key.code || hover?.to === node.key.code;
            return (
              <text
                key={node.key.code}
                x={CENTRE + Math.cos(node.angle) * (RADIUS + 16)}
                y={CENTRE + Math.sin(node.angle) * (RADIUS + 16)}
                className="rose-node"
                data-hand={handOf(node.key.finger)}
                data-lit={touched || undefined}
              >
                {node.key.code === "Space" ? "␣" : label}
              </text>
            );
          })}
        </g>
      </svg>

      <RoseReadout
        bigram={hover}
        baseline={baseline}
        count={drawn.length}
        focus={focus}
      />
    </div>
  );
}

function RoseReadout({
  bigram,
  baseline,
  count,
  focus,
}: {
  bigram: BigramStat | null;
  baseline: number;
  count: number;
  focus: string | null;
}): React.JSX.Element {
  if (!bigram) {
    return (
      <p className="label rose-readout">
        {count} transitions{focus !== null ? " through the selected key" : ""} ·
        thickness is how often · hue is against your own {baseline.toFixed(0)}ms median
      </p>
    );
  }

  const delta = bigram.latencyMs > 0 ? bigram.latencyMs - baseline : 0;
  return (
    <p className="rose-readout tabular">
      <b>{bigram.label}</b>
      <em>{bigram.kind.replace("-", " ")}</em>
      <em>{bigram.n}×</em>
      {bigram.latencyMs > 0 && (
        <em data-bad={delta > 0 || undefined}>
          {bigram.latencyMs.toFixed(0)}ms · {delta >= 0 ? "+" : ""}
          {delta.toFixed(0)} vs you
        </em>
      )}
      {bigram.errors > 0 && <em data-bad>{bigram.errors} wrong</em>}
    </p>
  );
}

const matches = (kind: BigramClass, filter: RoseFilter): boolean => {
  if (filter === "all") return kind !== "thumb";
  if (filter === "rolls") return kind === "in-roll" || kind === "out-roll";
  if (filter === "same-finger") return kind === "same-finger" || kind === "same-key";
  return kind === "alternate";
};

/**
 * An arc between two nodes, bowed toward the centre.
 *
 * The control point is pulled in proportionally to how far apart the nodes are,
 * so a neighbouring pair stays a short stub near the rim and a cross-hand pair
 * sweeps through the middle. That is what makes the shape of the whole picture
 * readable at a glance instead of a ball of string.
 */
function arc(from: Node, to: Node): string {
  let separation = Math.abs(from.angle - to.angle);
  if (separation > Math.PI) separation = Math.PI * 2 - separation;
  const pull = 1 - separation / Math.PI;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const cx = midX + (CENTRE - midX) * (0.15 + pull * 0.85);
  const cy = midY + (CENTRE - midY) * (0.15 + pull * 0.85);
  return `M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`;
}

/**
 * Hue against the player's own median.
 *
 * A transition at the median sits mid-ramp; twice the median is fully at the
 * slow end. Absolute milliseconds would paint a beginner's whole rose magenta
 * and an expert's whole rose cyan, and neither would have said anything about
 * which transitions to practise.
 */
function hueOf(bigram: BigramStat, baseline: number): string {
  if (bigram.latencyMs <= 0 || baseline <= 0) return "rgba(91, 107, 128, 0.6)";
  const ratio = bigram.latencyMs / baseline;
  // ratio 0.5 → fast end, 1 → middle, 2 → slow end.
  const position = Math.max(0, Math.min(1, (2 - ratio) / 1.5));
  return rampColor(position * 160, 1, 160);
}

function medianLatency(bigrams: readonly BigramStat[]): number {
  const values = bigrams
    .filter((bigram) => bigram.latencyMs > 0 && bigram.n >= MIN_SAMPLES)
    .map((bigram) => bigram.latencyMs)
    .sort((a, b) => a - b);
  if (values.length === 0) return 0;
  return values[Math.floor(values.length / 2)] ?? 0;
}
