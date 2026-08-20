import type { EngineState } from "@bettertyping/engine";

/**
 * How long the run has been going, in milliseconds.
 *
 * A finished test is frozen at the moment it ended. Without this the readouts
 * kept counting after the last keystroke: the countdown ran to zero and the
 * reported speed decayed while the player stared at their own result.
 */
export function elapsedOf(
  state: EngineState,
  origin: number | null,
): number {
  if (state.phase === "finished") {
    if (state.endedAt !== null) return state.endedAt;
    const last = state.events[state.events.length - 1];
    return last ? last.t : 0;
  }
  if (origin === null) return 0;
  return performance.now() - origin;
}
