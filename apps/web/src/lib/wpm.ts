import type { EngineState } from "@bettertyping/engine";

/**
 * Live speed for the Line and the readouts.
 *
 * This is display only. Authoritative results come from `@bettertyping/metrics`
 * once the test finishes, computed from the event log — which is why they are
 * reproducible and these are not required to be.
 */

/** Net WPM over the whole run so far. */
export function liveWpm(state: EngineState, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  let correct = 0;
  for (const event of state.events) {
    if (event.kind !== "char" && event.kind !== "space") continue;
    if (event.correct) correct += 1;
  }
  return correct / 5 / (elapsedMs / 60000);
}

/** Speed over a trailing window, so the Line responds to what you're doing now. */
export function instantWpm(state: EngineState, atMs: number, windowMs = 3000): number {
  const from = Math.max(0, atMs - windowMs);
  const span = atMs - from;
  if (span <= 0) return 0;

  let correct = 0;
  for (let i = state.events.length - 1; i >= 0; i--) {
    const event = state.events[i];
    if (!event || event.t < from) break;
    if (event.kind !== "char" && event.kind !== "space") continue;
    if (event.correct) correct += 1;
  }
  return correct / 5 / (span / 60000);
}

/** First-attempt accuracy so far, 0–100. */
export function liveAccuracy(state: EngineState): number {
  let correct = 0;
  let total = 0;
  for (const event of state.events) {
    if (event.kind !== "char" && event.kind !== "space") continue;
    total += 1;
    if (event.correct) correct += 1;
  }
  return total === 0 ? 100 : (correct / total) * 100;
}
