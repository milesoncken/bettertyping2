import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineState } from "@bettertyping/engine";
import { computeResults } from "@bettertyping/metrics";
import { submitTest } from "../lib/api.js";
import { eventsWithDwell, type DwellLog } from "../lib/dwell.js";

/**
 * Sends a finished run to the server and holds its verdict.
 *
 * The submission carries the keystroke log, not a score. The server replays it
 * and decides — this hook only reports what came back.
 */

export type SubmissionState =
  | { status: "idle" }
  /** No server, or the issuance failed: playable, but it cannot rank. */
  | { status: "unranked" }
  | { status: "submitting" }
  | { status: "verified"; personalBest?: { previous: number | null; wpm: number } }
  | { status: "flagged"; reasons: string[] }
  | { status: "rejected"; reasons: string[] };

export function useSubmission(
  state: EngineState,
  testIdRef: React.RefObject<string | null>,
  /** Holds collected on `keyup`, merged into the log here and nowhere earlier. */
  dwellRef: React.RefObject<DwellLog>,
): SubmissionState {
  const [submission, setSubmission] = useState<SubmissionState>({ status: "idle" });
  const sentRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    setSubmission({ status: "idle" });
  }, []);

  useEffect(() => {
    if (state.phase !== "finished") {
      if (sentRef.current !== null) {
        sentRef.current = null;
        reset();
      }
      return;
    }

    const testId = testIdRef.current;
    if (testId === null) {
      setSubmission({ status: "unranked" });
      return;
    }
    // One submission per run, however many times this effect re-runs.
    if (sentRef.current === testId) return;
    sentRef.current = testId;

    const results = computeResults(state);
    setSubmission({ status: "submitting" });

    // The one place dwell joins the log: after the run, on the way out. The
    // server stores what it verifies, so this is also what the analytics read.
    void submitTest(testId, eventsWithDwell(state, dwellRef.current), {
      wpm: results.wpm,
      accuracy: results.accuracy,
    }).then((outcome) => {
      if (!outcome) {
        setSubmission({ status: "unranked" });
        return;
      }
      if (outcome.verification === "verified") {
        setSubmission({
          status: "verified",
          ...(outcome.personalBest ? { personalBest: outcome.personalBest } : {}),
        });
        return;
      }
      setSubmission({ status: outcome.verification, reasons: outcome.reasons });
    });
  }, [state, testIdRef, dwellRef, reset]);

  return submission;
}
