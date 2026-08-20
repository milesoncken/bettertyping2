import { useState } from "react";
import { Link } from "../lib/router.js";
import { rampColor } from "../lib/wpm.js";
import { useAsync } from "./useAsync.js";
import {
  DURATIONS,
  WINDOWS,
  WORD_COUNTS,
  fetchLeaderboard,
  fullDate,
  type BoardWindow,
  type LeaderboardEntry,
} from "./data.js";
import { Empty, Failed, Loading } from "./States.js";

/**
 * The leaderboard.
 *
 * A board is a (mode, length) pair. Modifiers are shown per row rather than
 * splitting the boards: quartering the population by punctuation and numbers
 * would hand anyone willing to pick an unpopular combination a rank they did
 * not earn.
 *
 * Every row here is a run the server replayed from its own keystrokes. That is
 * why each one links to its own trace — a board nobody can audit is just a
 * claim.
 */
export function Leaderboard(): React.JSX.Element {
  const [mode, setMode] = useState<"time" | "words">("words");
  const [length, setLength] = useState<number>(25);
  const [window, setWindow] = useState<BoardWindow>("all");

  const board = useAsync(() => fetchLeaderboard(mode, length, window), [mode, length, window]);
  const lengths = mode === "time" ? DURATIONS : WORD_COUNTS;

  const pick = (next: "time" | "words"): void => {
    setMode(next);
    setLength(next === "time" ? 30 : 25);
  };

  return (
    <div className="page-stack">
      <div className="controls">
        <div className="group" role="group" aria-label="Mode">
          <Chip on={mode === "words"} onClick={() => pick("words")}>
            words
          </Chip>
          <Chip on={mode === "time"} onClick={() => pick("time")}>
            time
          </Chip>
        </div>
        <div className="group" role="group" aria-label="Length">
          {lengths.map((value) => (
            <Chip key={value} on={length === value} onClick={() => setLength(value)}>
              {value}
            </Chip>
          ))}
        </div>
        <div className="group right" role="group" aria-label="Window">
          {WINDOWS.map((value) => (
            <Chip key={value} on={window === value} onClick={() => setWindow(value)}>
              {value === "all" ? "all time" : value}
            </Chip>
          ))}
        </div>
      </div>

      {board.status === "loading" && <Loading />}
      {board.status === "failed" && <Failed what="leaderboard" />}

      {board.status === "ready" && (
        <>
          {board.data.entries.length === 0 ? (
            <Empty>
              nobody has set a verified run on this board yet. be first — a signed-in run on{" "}
              {mode === "time" ? `time ${length}` : `words ${length}`} lands here the moment the
              server verifies it.
            </Empty>
          ) : (
            <Table entries={board.data.entries} you={board.data.you} />
          )}

          {/* Your own standing, spelled out when the page does not reach it. */}
          {board.data.you && !board.data.entries.some((entry) => entry.rank === board.data.you?.rank) && (
            <div className="standing-note">
              <span className="label">your standing</span>
              <Table entries={[board.data.you]} you={board.data.you} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Table({
  entries,
  you,
}: {
  entries: readonly LeaderboardEntry[];
  you: LeaderboardEntry | null;
}): React.JSX.Element {
  return (
    <table className="board">
      <thead>
        <tr>
          <th className="label num">#</th>
          <th className="label">player</th>
          <th className="label num">wpm</th>
          <th className="label num">acc</th>
          <th className="label num">consistency</th>
          <th className="label">modifiers</th>
          <th className="label">set</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.testId} data-you={entry.userId === you?.userId || undefined}>
            <td className="num tabular rank">{entry.rank}</td>
            <td>
              <Link className="player" to={`/u/${entry.username}`}>
                {entry.username}
              </Link>
            </td>
            <td className="num tabular wpm" style={{ color: rampColor(entry.wpm, 1, 200) }}>
              {entry.wpm.toFixed(1)}
            </td>
            <td className="num tabular">{entry.accuracy.toFixed(1)}%</td>
            <td className="num tabular">{entry.consistency.toFixed(0)}%</td>
            <td className="label mods">
              {[entry.punctuation ? "punct" : null, entry.numbers ? "num" : null]
                .filter(Boolean)
                .join(" · ") || "—"}
            </td>
            <td>
              <Link className="label when" to={`/run/${entry.testId}`}>
                {fullDate(entry.achievedAt)}
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button className="chip" data-on={on || undefined} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}
