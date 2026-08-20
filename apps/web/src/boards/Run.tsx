import { Link } from "../lib/router.js";
import { Chart } from "./Chart.js";
import { useAsync } from "./useAsync.js";
import { boardLabel, fetchRun, fullDate } from "./data.js";
import { Loading } from "./States.js";

/**
 * One run, reopened.
 *
 * The chart here is not a stored picture of the run — the server replayed the
 * keystroke log through the same engine the browser ran and recomputed the
 * samples on request. Which is the point of the whole architecture: a result on
 * a board can be re-derived from its evidence by anyone who follows the link.
 */
export function Run({ id }: { id: string }): React.JSX.Element {
  const run = useAsync(() => fetchRun(id), [id]);

  if (run.status === "loading") return <Loading />;
  if (run.status === "failed") {
    return (
      <div className="page-stack">
        <p className="empty label" data-tone="bad">
          this run is not available — it may never have existed, or it may be a held run belonging
          to someone else
        </p>
        <Link className="chip" to="/leaderboards">
          back to the boards
        </Link>
      </div>
    );
  }

  const { data } = run;

  return (
    <div className="page-stack">
      <header className="profile-head">
        <div>
          <h1 className="player-name">
            {data.username ? (
              <Link className="player" to={`/u/${data.username}`}>
                {data.username}
              </Link>
            ) : (
              "guest"
            )}
          </h1>
          <span className="label">
            {boardLabel(data.mode, data.length)}
            {data.punctuation ? " · punct" : ""}
            {data.numbers ? " · num" : ""} · {fullDate(data.createdAt)}
          </span>
        </div>
        <dl className="totals">
          <div className="total" data-lit>
            <dt className="label">wpm</dt>
            <dd className="tabular">{data.wpm.toFixed(1)}</dd>
          </div>
          <div className="total">
            <dt className="label">raw</dt>
            <dd className="tabular">{data.rawWpm.toFixed(1)}</dd>
          </div>
          <div className="total">
            <dt className="label">accuracy</dt>
            <dd className="tabular">{data.accuracy.toFixed(1)}%</dd>
          </div>
          <div className="total">
            <dt className="label">consistency</dt>
            <dd className="tabular">{data.consistency.toFixed(0)}%</dd>
          </div>
          <div className="total">
            <dt className="label">duration</dt>
            <dd className="tabular">{(data.durationMs / 1000).toFixed(2)}s</dd>
          </div>
        </dl>
      </header>

      <section className="panel">
        <h2 className="label">the run, replayed</h2>
        <Chart
          points={data.samples.map((sample) => ({
            label: `${sample.t.toFixed(0)}s`,
            value: sample.wpm,
          }))}
        />
      </section>

      <section className="panel">
        <h2 className="label">characters</h2>
        <dl className="totals">
          <div className="total">
            <dt className="label">correct</dt>
            <dd className="tabular">{data.chars.correct}</dd>
          </div>
          <div className="total">
            <dt className="label">incorrect</dt>
            <dd className="tabular">{data.chars.incorrect}</dd>
          </div>
          <div className="total">
            <dt className="label">extra</dt>
            <dd className="tabular">{data.chars.extra}</dd>
          </div>
          <div className="total">
            <dt className="label">missed</dt>
            <dd className="tabular">{data.chars.missed}</dd>
          </div>
        </dl>
        {data.verification !== "verified" && (
          <p className="label standing" data-tone={data.verification === "flagged" ? "hold" : "bad"}>
            {data.verification === "flagged" ? "held for review" : "not counted"}
            {data.reasons.length > 0 ? ` · ${data.reasons.join(", ").replace(/-/g, " ")}` : ""}
          </p>
        )}
      </section>
    </div>
  );
}
