/**
 * Keystroke-to-paint instrumentation.
 *
 * Stage 2's exit criterion is a measured p99, not a hoped-for one. Every
 * keystroke records the gap between the browser handing us the event and the
 * frame that shows its result. Open with `?perf` to see the readout.
 */

const CAPACITY = 512;
const samples: number[] = [];

export function recordLatency(ms: number): void {
  samples.push(ms);
  if (samples.length > CAPACITY) samples.shift();
}

export interface LatencyStats {
  count: number;
  p50: number;
  p99: number;
  worst: number;
}

export function latencyStats(): LatencyStats {
  if (samples.length === 0) return { count: 0, p50: 0, p99: 0, worst: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  return {
    count: sorted.length,
    p50: at(0.5),
    p99: at(0.99),
    worst: sorted[sorted.length - 1] ?? 0,
  };
}

export const perfEnabled = (): boolean =>
  typeof window !== "undefined" && window.location.search.includes("perf");
