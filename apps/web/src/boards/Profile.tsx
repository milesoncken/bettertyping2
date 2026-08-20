import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "../lib/router.js";
import { rampColor } from "../lib/wpm.js";
import { Chart } from "./Chart.js";
import { useAsync } from "./useAsync.js";
import {
  boardLabel,
  fetchHistory,
  fetchProfile,
  fullDate,
  shortDate,
  type HistoryEntry,
} from "./data.js";
import { Empty, Failed, Loading } from "./States.js";

/**
 * A player, as their runs describe them.
 *
 * Every figure above the history table is taken over verified runs only, so a
 * profile and a leaderboard can never tell two different stories about the same
 * person. The history table below is the exception and says so per row: your own
 * held and rejected runs are yours to see, labelled for what they are.
 */
export function Profile({ username, own }: { username: string; own: boolean }): React.JSX.Element {
  const profile = useAsync(() => fetchProfile(username), [username]);

  if (profile.status === "loading") return <Loading />;
  if (profile.status === "failed") return <Failed what="profile" />;

  const { data } = profile;
  const { totals } = data;

  return (
    <div className="page-stack">
      <header className="profile-head">
        <div>
          <h1 className="player-name">{data.username}</h1>
          <span className="label">joined {shortDate(data.joinedAt)}</span>
        </div>
        <dl className="totals">
          <Total term="best" value={totals.bestWpm.toFixed(1)} lit />
          <Total term="average" value={totals.averageWpm.toFixed(1)} />
          <Total term="accuracy" value={`${totals.averageAccuracy.toFixed(1)}%`} />
          <Total term="verified runs" value={String(totals.tests)} />
          <Total term="time typed" value={duration(totals.secondsTyped)} />
        </dl>
      </header>

      <section className="panel">
        <h2 className="label">recent form</h2>
        {data.recent.length === 0 ? (
          <Empty>
            no verified runs yet. {own ? "your" : "their"} first ranked run draws this chart.
          </Empty>
        ) : (
          <Chart
            points={data.recent.map((run) => ({
              label: `${boardLabel(run.mode, run.length)} · ${shortDate(run.createdAt)}`,
              value: run.wpm,
            }))}
          />
        )}
      </section>

      <section className="panel">
        <h2 className="label">personal bests</h2>
        {data.personalBests.length === 0 ? (
          <Empty>a personal best is set by the first verified run on a board.</Empty>
        ) : (
          <div className="pb-grid">
            {data.personalBests.map((best) => (
              <Link className="pb" key={`${best.mode}-${best.length}`} to={`/run/${best.testId}`}>
                <span className="label">{boardLabel(best.mode, best.length)}</span>
                <b className="tabular" style={{ color: rampColor(best.wpm, 1, 200) }}>
                  {best.wpm.toFixed(1)}
                </b>
                <span className="label">{shortDate(best.achievedAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {own && <History />}
    </div>
  );
}

/**
 * Your own history, paged.
 *
 * Keyset pagination, so a run finished in another tab cannot shuffle the page
 * under you the way an OFFSET would. Pages are appended, and the cursors already
 * requested are remembered — an effect that fires twice (which React does on
 * purpose in development) must not append the same runs twice.
 */
function History(): React.JSX.Element {
  const [runs, setRuns] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const requested = useRef<Set<string>>(new Set());

  const load = useCallback((before: string | null) => {
    const key = before ?? "first";
    if (requested.current.has(key)) return;
    requested.current.add(key);
    setStatus("loading");

    fetchHistory(before).then(
      (page) => {
        setRuns((prev) => [...prev, ...page.entries]);
        setCursor(page.nextCursor);
        setStatus("ready");
      },
      () => setStatus("failed"),
    );
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  return (
    <section className="panel">
      <h2 className="label">history</h2>
      {status === "failed" && <Failed what="history" />}
      {runs.length === 0 && status === "loading" && <Loading />}
      {runs.length === 0 && status === "ready" && (
        <Empty>nothing here yet — finish a test and it lands in this table.</Empty>
      )}

      {runs.length > 0 && (
        <table className="board">
          <thead>
            <tr>
              <th className="label">when</th>
              <th className="label">test</th>
              <th className="label num">wpm</th>
              <th className="label num">raw</th>
              <th className="label num">acc</th>
              <th className="label num">consistency</th>
              <th className="label">standing</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <Link className="label when" to={`/run/${run.id}`}>
                    {fullDate(run.createdAt)}
                  </Link>
                </td>
                <td className="label mods">
                  {boardLabel(run.mode, run.length)}
                  {run.punctuation ? " · punct" : ""}
                  {run.numbers ? " · num" : ""}
                </td>
                <td className="num tabular wpm" style={{ color: rampColor(run.wpm, 1, 200) }}>
                  {run.wpm.toFixed(1)}
                </td>
                <td className="num tabular">{run.rawWpm.toFixed(1)}</td>
                <td className="num tabular">{run.accuracy.toFixed(1)}%</td>
                <td className="num tabular">{run.consistency.toFixed(0)}%</td>
                <td>
                  <Standing verification={run.verification} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {cursor !== null && (
        <button className="chip" onClick={() => load(cursor)} disabled={status === "loading"}>
          {status === "loading" ? "loading" : "older runs"}
        </button>
      )}
    </section>
  );
}

function Standing({ verification }: { verification: HistoryEntry["verification"] }): React.JSX.Element {
  const tone = verification === "verified" ? "good" : verification === "flagged" ? "hold" : "bad";
  const text =
    verification === "verified" ? "counted" : verification === "flagged" ? "held" : "not counted";
  return (
    <span className="label standing" data-tone={tone}>
      {text}
    </span>
  );
}

function Total({
  term,
  value,
  lit,
}: {
  term: string;
  value: string;
  lit?: boolean;
}): React.JSX.Element {
  return (
    <div className="total" data-lit={lit || undefined}>
      <dt className="label">{term}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

/** Seconds as the largest unit that stays readable. */
function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
