import { useMemo } from "react";
import type { EngineState } from "@bettertyping/engine";
import { computeResults } from "@bettertyping/metrics";
import { Backdrop } from "../spectacle/Backdrop.js";
import type { SubmissionState } from "./useSubmission.js";
import "./results.css";

/**
 * The results, which the trace flies into.
 *
 * `chartAnchorRef` marks the box the Line settles into — it is measured, never
 * hard-coded, so the flight lands exactly on the chart however the page reflows.
 * Everything else fades in behind the landing, late enough that the eye follows
 * the trace first.
 */

export function Results({
  state,
  chartAnchorRef,
  submission,
  onRestart,
}: {
  state: EngineState;
  chartAnchorRef: React.RefObject<HTMLDivElement | null>;
  /** The server's word on this run, once it has given one. */
  submission: SubmissionState;
  onRestart: () => void;
}): React.JSX.Element {
  const results = useMemo(() => computeResults(state), [state]);

  return (
    <div className="results">
      <Backdrop />

      <div className="results-head reveal" style={{ animationDelay: "620ms" }}>
        <Standing submission={submission} />
        <span className="label">
          {state.config.mode === "time"
            ? `${state.config.duration}s`
            : `${state.config.count} words`}
          {state.config.punctuation ? " · punct" : ""}
          {state.config.numbers ? " · num" : ""}
        </span>
      </div>

      <div className="results-primary">
        <Figure value={results.wpm.toFixed(1)} label="words per minute" lit delay={680} />
        <Figure value={`${results.accuracy.toFixed(1)}%`} label="accuracy" delay={760} />
        <Figure value={`${results.consistency.toFixed(0)}%`} label="consistency" delay={840} />
        <Figure value={results.rawWpm.toFixed(1)} label="raw" delay={920} />
      </div>

      {/* Where the Line lands. Its axis labels are drawn by the trace. */}
      <div className="chart">
        <div className="chart-plot" ref={chartAnchorRef} />
      </div>

      <div className="results-foot reveal" style={{ animationDelay: "1100ms" }}>
        <dl className="results-chars">
          <Pair term="correct" value={results.chars.correct} />
          <Pair term="incorrect" value={results.chars.incorrect} />
          <Pair term="extra" value={results.chars.extra} />
          <Pair term="missed" value={results.chars.missed} />
          <Pair term="duration" value={`${(results.durationMs / 1000).toFixed(2)}s`} />
        </dl>
        <p className="chart-note label">
          band ±1σ of your own rhythm · dots mark where you broke it
        </p>
        <button className="chip" onClick={onRestart}>
          again — enter
        </button>
      </div>
    </div>
  );
}

/**
 * What the server made of the run.
 *
 * Stated plainly, including when it is bad news: a rejected run says so and says
 * why. A leaderboard nobody can read the rules of is not trustworthy, it is just
 * opaque.
 */
function Standing({ submission }: { submission: SubmissionState }): React.JSX.Element {
  switch (submission.status) {
    case "idle":
    case "unranked":
      return <span className="label">run complete</span>;

    case "submitting":
      return <span className="label">verifying…</span>;

    case "verified": {
      const best = submission.personalBest;
      return (
        <span className="label standing" data-tone="good">
          {best
            ? `personal best${best.previous === null ? "" : ` · was ${best.previous.toFixed(1)}`}`
            : "verified"}
        </span>
      );
    }

    case "flagged":
      return (
        <span className="label standing" data-tone="hold">
          held for review
        </span>
      );

    case "rejected":
      return (
        <span className="label standing" data-tone="bad">
          not counted
          {submission.reasons[0] ? ` · ${submission.reasons[0].replace(/-/g, " ")}` : ""}
        </span>
      );
  }
}

function Figure({
  value,
  label,
  lit,
  delay,
}: {
  value: string;
  label: string;
  lit?: boolean;
  delay: number;
}): React.JSX.Element {
  return (
    <div className="figure reveal" data-lit={lit || undefined} style={{ animationDelay: `${delay}ms` }}>
      <b className="tabular">{value}</b>
      <span className="label">{label}</span>
    </div>
  );
}

function Pair({ term, value }: { term: string; value: number | string }): React.JSX.Element {
  return (
    <div className="pair">
      <dt className="label">{term}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
