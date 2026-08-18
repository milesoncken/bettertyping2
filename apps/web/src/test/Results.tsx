import { useMemo } from "react";
import type { EngineState } from "@bettertyping/engine";
import { computeResults } from "@bettertyping/metrics";
import "./results.css";

/**
 * Stage 2 results: the numbers, honestly presented.
 *
 * Stage 3 replaces this with the choreographed moment — the trace detaching from
 * beneath the text and settling into the chart, plus E3's confidence band.
 */

export function Results({
  state,
  onRestart,
}: {
  state: EngineState;
  onRestart: () => void;
}): React.JSX.Element {
  const results = useMemo(() => computeResults(state), [state]);

  return (
    <div className="results">
      <div className="results-head">
        <span className="label">run complete</span>
        <span className="label">
          {state.config.mode === "time"
            ? `${state.config.duration}s`
            : `${state.config.count} words`}
          {state.config.punctuation ? " · punct" : ""}
          {state.config.numbers ? " · num" : ""}
        </span>
      </div>

      <div className="results-primary">
        <Figure value={results.wpm.toFixed(1)} label="words per minute" lit />
        <Figure value={`${results.accuracy.toFixed(1)}%`} label="accuracy" />
        <Figure value={`${results.consistency.toFixed(0)}%`} label="consistency" />
        <Figure value={results.rawWpm.toFixed(1)} label="raw" />
      </div>

      <dl className="results-chars">
        <Pair term="correct" value={results.chars.correct} />
        <Pair term="incorrect" value={results.chars.incorrect} />
        <Pair term="extra" value={results.chars.extra} />
        <Pair term="missed" value={results.chars.missed} />
        <Pair term="duration" value={`${(results.durationMs / 1000).toFixed(2)}s`} />
      </dl>

      <button className="chip" onClick={onRestart}>
        again — enter
      </button>
    </div>
  );
}

function Figure({
  value,
  label,
  lit,
}: {
  value: string;
  label: string;
  lit?: boolean;
}): React.JSX.Element {
  return (
    <div className="figure" data-lit={lit || undefined}>
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
