/**
 * Small statistics, gathered so the choices are visible in one place.
 *
 * The important one is `median`. v1's heatmap reported each key's *worst single
 * keystroke*, which is a measure of the unluckiest moment of your life rather
 * than of your typing: one sneeze puts `k` in the red forever. A median over a
 * stated sample count is a claim you can act on, and every latency figure in
 * this package is one.
 */

export function median(values: readonly number[]): number {
  return percentile(values, 0.5);
}

/** The p-th percentile, linearly interpolated. Input need not be sorted. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = sorted[low] ?? 0;
  if (low === high) return lowValue;
  const highValue = sorted[high] ?? lowValue;
  return lowValue + (highValue - lowValue) * (rank - low);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mu = mean(values);
  let sum = 0;
  for (const value of values) sum += (value - mu) ** 2;
  return Math.sqrt(sum / values.length);
}

/**
 * Least-squares slope of y against x.
 *
 * Used for the fatigue line — whether a run decays, and by how much per second.
 * Returns 0 rather than NaN for a degenerate series, because "no measurable
 * trend" is the honest reading of two identical points.
 */
export function slope(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - mx;
    num += dx * ((ys[i] ?? 0) - my);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

export const round = (value: number, places = 2): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * A sample count below which a figure is noise dressed as a fact.
 *
 * Every per-key and per-bigram number carries its own `n` so a surface can say
 * so rather than quietly drawing a confident colour over four keystrokes.
 */
export const MIN_CONFIDENT_SAMPLES = 8;
