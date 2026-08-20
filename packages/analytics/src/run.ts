import type { EngineState, KeyEvent } from "@bettertyping/engine";
import { countChars } from "@bettertyping/metrics";
import {
  KEYS,
  QWERTY_LEGEND,
  areNeighbours,
  classifyBigram,
  handOf,
  keyFor,
  qwertyCodeFor,
  type BigramClass,
  type Hand,
} from "./keyboard.js";
import { median, round, slope } from "./stats.js";
import type {
  BigramStat,
  CharMap,
  ErrorTally,
  KeyStat,
  Keystroke,
  Rhythm,
  RollProfile,
  RunAnalysis,
} from "./types.js";

/**
 * The analysis of a single run, from its keystrokes alone.
 *
 * Pure, like the engine it reads: the same log always yields the same analysis,
 * in the browser and on the server. That is what lets a rollup written on the
 * server and a chart drawn in the browser be the same numbers.
 */

/**
 * A gap longer than this was a pause, not a transition.
 *
 * Someone glancing at their phone mid-run should not have that second charged to
 * the `he` bigram. The pair is still counted — it happened — but its latency is
 * left out of the median, because a median of "how long this movement takes" is
 * the thing every surface here claims to be showing.
 */
export const MAX_TRANSITION_MS = 1500;

/** Keystrokes either side of the boundary used to find the warm-up point. */
const WARM_WINDOW = 5;

const TYPED = new Set(["char", "space"]);
const isTyped = (event: KeyEvent): boolean => TYPED.has(event.kind);

const EMPTY_ERRORS = (): ErrorTally => ({
  neighbour: 0,
  substitution: 0,
  transposition: 0,
  capitalisation: 0,
  insertion: 0,
  omission: 0,
});

const CLASSES: readonly BigramClass[] = [
  "same-key",
  "same-finger",
  "in-roll",
  "out-roll",
  "alternate",
  "thumb",
];

/**
 * What each physical key produces, learned from the run itself.
 *
 * Every keystroke is evidence — a wrong key still tells us truthfully what that
 * key prints — so this is built from the whole log, not just the correct part.
 * The alternative is a lookup table per layout, which would be wrong for anyone
 * on a layout we did not anticipate and stale for everyone eventually.
 */
export function observeLegends(events: readonly KeyEvent[]): CharMap {
  const codeKey = new Map<string, Map<string, number>>();
  const charCode = new Map<string, Map<string, number>>();

  for (const event of events) {
    if (!isTyped(event) || event.key.length !== 1) continue;
    if (!keyFor(event.code)) continue;
    tally(codeKey, event.code, event.key);
    tally(charCode, event.key, event.code);
  }

  const legends = modes(codeKey);
  return { legends, codeForChar: modes(charCode), qwertyLike: looksQwerty(legends) };
}

/**
 * Enough evidence to guess the rest of the board?
 *
 * The observed map only covers keys the player has actually pressed, so a
 * character wanted but never typed has no code — and that is exactly the
 * character an error lands on. Guessing it from QWERTY is right for almost
 * everyone and wrong in a specific, silent way for anyone on another layout, so
 * the guess is only allowed when the keys we *have* seen agree with QWERTY.
 *
 * With almost no evidence either way, the guess is allowed: a first-run analysis
 * on the overwhelmingly common layout beats an empty one.
 */
const QWERTY_AGREEMENT = 0.8;
const LAYOUT_EVIDENCE = 6;

export function looksQwerty(legends: Record<string, string>): boolean {
  let seen = 0;
  let agreed = 0;
  for (const [code, char] of Object.entries(legends)) {
    const expected = QWERTY_LEGEND(code);
    if (expected.length !== 1) continue;
    seen += 1;
    if (expected === char.toLowerCase()) agreed += 1;
  }
  if (seen < LAYOUT_EVIDENCE) return true;
  return agreed / seen >= QWERTY_AGREEMENT;
}

function tally(
  into: Map<string, Map<string, number>>,
  outer: string,
  inner: string,
): void {
  const bucket = into.get(outer) ?? new Map<string, number>();
  bucket.set(inner, (bucket.get(inner) ?? 0) + 1);
  into.set(outer, bucket);
}

/** The most frequently observed value for each key. Ties go to the first seen. */
function modes(counts: Map<string, Map<string, number>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [outer, bucket] of counts) {
    let best = "";
    let bestN = 0;
    for (const [inner, n] of bucket) {
      if (n > bestN) {
        best = inner;
        bestN = n;
      }
    }
    if (best !== "") out[outer] = best;
  }
  return out;
}

/** The physical key a character is produced by, as far as this run can tell. */
function codeOf(char: string, map: CharMap): string | null {
  const observed =
    map.codeForChar[char] ??
    map.codeForChar[char.toLowerCase()] ??
    map.codeForChar[char.toUpperCase()];
  if (observed !== undefined) return observed;
  if (!map.qwertyLike) return null;
  return qwertyCodeFor(char) ?? qwertyCodeFor(char.toLowerCase()) ?? null;
}

/** The per-keystroke series: the raw material of the Ribbon. */
export function keystrokesOf(events: readonly KeyEvent[]): Keystroke[] {
  return events.map((event, i) => {
    const previous = i > 0 ? events[i - 1] : undefined;
    return {
      i,
      t: event.t,
      code: event.code,
      key: event.key,
      expected: event.expected,
      correct: event.correct,
      kind: event.kind,
      word: event.word,
      flight: previous ? round(event.t - previous.t, 1) : null,
      dwell: event.hold !== undefined ? round(event.hold, 1) : null,
    };
  });
}

/** Per physical key, over one run. */
function keyStatsOf(keystrokes: readonly Keystroke[], map: CharMap): KeyStat[] {
  const { legends } = map;
  interface Acc {
    struck: number;
    intruded: number;
    wanted: number;
    missed: number;
    flights: number[];
    dwells: number[];
  }
  const acc = new Map<string, Acc>();
  const at = (code: string): Acc => {
    const found = acc.get(code);
    if (found) return found;
    const fresh: Acc = {
      struck: 0,
      intruded: 0,
      wanted: 0,
      missed: 0,
      flights: [],
      dwells: [],
    };
    acc.set(code, fresh);
    return fresh;
  };

  for (const stroke of keystrokes) {
    if (!TYPED.has(stroke.kind) || !keyFor(stroke.code)) continue;

    const struck = at(stroke.code);
    struck.struck += 1;
    if (stroke.flight !== null && stroke.flight <= MAX_TRANSITION_MS) {
      struck.flights.push(stroke.flight);
    }
    if (stroke.dwell !== null) struck.dwells.push(stroke.dwell);
    if (!stroke.correct) struck.intruded += 1;

    // The key the text asked for, which is not always the key that arrived.
    const wantedCode = stroke.expected === null ? null : codeOf(stroke.expected, map);
    if (wantedCode !== null && keyFor(wantedCode)) {
      const wanted = at(wantedCode);
      wanted.wanted += 1;
      if (!stroke.correct) wanted.missed += 1;
    }
  }

  const out: KeyStat[] = [];
  for (const [code, value] of acc) {
    out.push({
      code,
      legend: legends[code] ?? QWERTY_LEGEND(code),
      struck: value.struck,
      intruded: value.intruded,
      wanted: value.wanted,
      missed: value.missed,
      flightMs: round(median(value.flights), 1),
      dwellMs: value.dwells.length > 0 ? round(median(value.dwells), 1) : null,
    });
  }
  return out.sort((a, b) => b.struck - a.struck);
}

/**
 * Per transition, over one run.
 *
 * Pairs are taken from *adjacent* entries in the raw log, so a backspace between
 * two characters breaks the chain. That is deliberate: the time to type `e`
 * after correcting a mistake is the cost of the correction, not the cost of the
 * movement, and averaging the two together would hide both.
 */
function bigramStatsOf(
  events: readonly KeyEvent[],
  keystrokes: readonly Keystroke[],
  legends: Record<string, string>,
): { bigrams: BigramStat[]; rolls: RollProfile } {
  interface Acc {
    kind: BigramClass;
    n: number;
    errors: number;
    latencies: number[];
  }
  const acc = new Map<string, Acc>();
  const byClass = new Map<BigramClass, number[]>();

  for (let i = 1; i < events.length; i++) {
    const from = events[i - 1];
    const to = events[i];
    if (!from || !to || !isTyped(from) || !isTyped(to)) continue;

    const kind = classifyBigram(from.code, to.code);
    if (kind === null) continue;

    const pair = `${from.code}>${to.code}`;
    const found = acc.get(pair) ?? { kind, n: 0, errors: 0, latencies: [] };
    found.n += 1;

    const latency = keystrokes[i]?.flight ?? null;
    if (to.correct) {
      if (latency !== null && latency <= MAX_TRANSITION_MS) {
        found.latencies.push(latency);
        byClass.set(kind, [...(byClass.get(kind) ?? []), latency]);
      }
    } else {
      found.errors += 1;
    }
    acc.set(pair, found);
  }

  const bigrams: BigramStat[] = [];
  for (const [pair, value] of acc) {
    const [from = "", to = ""] = pair.split(">");
    bigrams.push({
      pair,
      from,
      to,
      label: `${legends[from] ?? QWERTY_LEGEND(from)}${legends[to] ?? QWERTY_LEGEND(to)}`,
      kind: value.kind,
      n: value.n,
      errors: value.errors,
      latencyMs: round(median(value.latencies), 1),
    });
  }
  bigrams.sort((a, b) => b.n - a.n);

  return { bigrams, rolls: rollProfileOf(acc, byClass) };
}

function rollProfileOf(
  acc: Map<string, { kind: BigramClass; n: number }>,
  byClass: Map<BigramClass, number[]>,
): RollProfile {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0])) as Record<
    BigramClass,
    number
  >;
  for (const value of acc.values()) counts[value.kind] += value.n;

  const latencyMs = Object.fromEntries(
    CLASSES.map((c) => [c, round(median(byClass.get(c) ?? []), 1)]),
  ) as Record<BigramClass, number>;

  // Thumbs are excluded from the denominator: the space bar is not a choice the
  // layout made, and counting it would dilute every rate below into meaninglessness.
  const handed =
    counts["same-key"] +
    counts["same-finger"] +
    counts["in-roll"] +
    counts["out-roll"] +
    counts["alternate"];

  const alternate = latencyMs["alternate"];
  const sameFinger = latencyMs["same-finger"];

  return {
    counts,
    latencyMs,
    sameFingerRate: handed === 0 ? 0 : round(counts["same-finger"] / handed, 4),
    sameFingerCostMs:
      alternate > 0 && sameFinger > 0 ? round(sameFinger - alternate, 1) : 0,
  };
}

/** Why the wrong keys were wrong. */
function errorsOf(
  state: EngineState,
  events: readonly KeyEvent[],
  map: CharMap,
): ErrorTally {
  const tally = EMPTY_ERRORS();
  // A transposition is one mistake spread over two keystrokes. The second is
  // marked here when the first is classified, so it is not counted again as a
  // substitution in its own right.
  const consumed = new Set<number>();

  events.forEach((event, i) => {
    if (!isTyped(event) || event.correct || consumed.has(i)) return;
    const expected = event.expected;
    if (expected === null) {
      tally.substitution += 1;
      return;
    }

    // Past the end of a word the engine expects a space; a letter there is a
    // character piled on rather than a character got wrong.
    if (expected === " " && event.key !== " ") {
      tally.insertion += 1;
      return;
    }

    if (
      event.key.length === 1 &&
      event.key !== expected &&
      event.key.toLowerCase() === expected.toLowerCase()
    ) {
      tally.capitalisation += 1;
      return;
    }

    // A transposition is a pair rolled out of order: this key is the character
    // that was wanted next, and the next key is the one that was wanted now.
    const next = events[i + 1];
    if (
      next !== undefined &&
      isTyped(next) &&
      next.key === expected &&
      event.key === next.expected
    ) {
      tally.transposition += 1;
      consumed.add(i + 1);
      return;
    }

    const wantedCode = codeOf(expected, map);
    if (wantedCode !== null && areNeighbours(wantedCode, event.code)) {
      tally.neighbour += 1;
      return;
    }

    tally.substitution += 1;
  });

  // Characters of a word skipped past. Not a keystroke at all, which is exactly
  // why an event-only taxonomy would never see them.
  tally.omission = countChars(state).missed;

  return tally;
}

/** How the run was played: load, warm-up, decay. */
function rhythmOf(keystrokes: readonly Keystroke[]): Rhythm {
  const typed = keystrokes.filter((stroke) => TYPED.has(stroke.kind));

  const flights = typed
    .map((stroke) => stroke.flight)
    .filter(
      (flight): flight is number => flight !== null && flight <= MAX_TRANSITION_MS,
    );
  const dwells = typed
    .map((stroke) => stroke.dwell)
    .filter((dwell): dwell is number => dwell !== null);

  const handBalance: Record<Hand, number> = { left: 0, right: 0 };
  const fingerLoad = new Array<number>(10).fill(0);
  let placed = 0;
  for (const stroke of typed) {
    const key = keyFor(stroke.code);
    if (!key) continue;
    placed += 1;
    handBalance[handOf(key.finger)] += 1;
    fingerLoad[key.finger] = (fingerLoad[key.finger] ?? 0) + 1;
  }
  if (placed > 0) {
    handBalance.left = round(handBalance.left / placed, 4);
    handBalance.right = round(handBalance.right / placed, 4);
    for (let i = 0; i < fingerLoad.length; i++) {
      fingerLoad[i] = round((fingerLoad[i] ?? 0) / placed, 4);
    }
  }

  return {
    flightMs: round(median(flights), 1),
    dwellMs: dwells.length > 0 ? round(median(dwells), 1) : null,
    warmUpS: warmUpOf(typed),
    fatigueSlope: fatigueOf(typed),
    handBalance,
    fingerLoad,
  };
}

/**
 * When the hands stopped warming up.
 *
 * Steady state is the median flight over the back half of the run; the warm-up
 * point is the first moment a trailing window of keystrokes gets within 10% of
 * it. It is reported per run so that, across a history, it becomes a personal
 * constant — "you take about seven seconds" — rather than a fact about one run.
 */
function warmUpOf(typed: readonly Keystroke[]): number | null {
  if (typed.length < WARM_WINDOW * 4) return null;

  const flightAt = (stroke: Keystroke): number | null =>
    stroke.flight !== null && stroke.flight <= MAX_TRANSITION_MS ? stroke.flight : null;

  const half = Math.floor(typed.length / 2);
  const steady = median(
    typed
      .slice(half)
      .map(flightAt)
      .filter((f): f is number => f !== null),
  );
  if (steady <= 0) return null;

  for (let i = WARM_WINDOW; i < half; i++) {
    const window = typed
      .slice(i - WARM_WINDOW, i)
      .map(flightAt)
      .filter((f): f is number => f !== null);
    if (window.length < WARM_WINDOW) continue;
    if (median(window) <= steady * 1.1) return round((typed[i]?.t ?? 0) / 1000, 2);
  }
  return null;
}

/** WPM change per second across the run. Negative means the run decayed. */
function fatigueOf(typed: readonly Keystroke[]): number {
  const last = typed[typed.length - 1];
  if (!last || last.t < 8000) return 0;

  const seconds = Math.floor(last.t / 1000);
  const buckets = new Array<number>(seconds).fill(0);
  for (const stroke of typed) {
    if (!stroke.correct) continue;
    const bucket = Math.floor(stroke.t / 1000);
    if (bucket < seconds) buckets[bucket] = (buckets[bucket] ?? 0) + 1;
  }

  const xs = buckets.map((_, i) => i);
  const ys = buckets.map((chars) => (chars / 5) * 60);
  return round(slope(xs, ys), 3);
}

/** Everything one run has to say about itself. */
export function analyseRun(state: EngineState): RunAnalysis {
  const events = state.events;
  const map = observeLegends(events);
  const keystrokes = keystrokesOf(events);
  const { bigrams, rolls } = bigramStatsOf(events, keystrokes, map.legends);

  return {
    keystrokes,
    keys: keyStatsOf(keystrokes, map),
    bigrams,
    errors: errorsOf(state, events, map),
    rhythm: rhythmOf(keystrokes),
    rolls,
    legends: map.legends,
    qwertyLike: map.qwertyLike,
    hasDwell: events.some((event) => event.hold !== undefined),
  };
}

/** Every physical key, so a heatmap can draw the ones you never pressed. */
export const allKeys = (): readonly string[] => KEYS.map((key) => key.code);
