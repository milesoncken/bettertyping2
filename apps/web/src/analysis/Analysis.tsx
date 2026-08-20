import { useEffect, useMemo, useState } from "react";
import { Link } from "../lib/router.js";
import { Failed, Loading } from "../boards/States.js";
import { useAsync } from "../boards/useAsync.js";
import { boardLabel, shortDate } from "../boards/data.js";
import { Atlas, METRICS, type AtlasMetric } from "./Atlas.js";
import { FILTERS, Rose, type RoseFilter } from "./Rose.js";
import { Ribbon } from "./Ribbon.js";
import {
  MIN_SAMPLES,
  fetchAnalysis,
  fetchRibbon,
  pct,
  type AnalysisResponse,
  type BigramStat,
} from "./data.js";
import "./analysis.css";

/**
 * The observatory.
 *
 * One page, three instruments, one subject: the hands rather than the score.
 * Everything above is either a median over a stated sample, or a count — there
 * is no model here and nothing is guessed. SPEC §7 justified this pillar on the
 * grounds that no other site keeps per-keystroke timing at this fidelity, so no
 * other site can compute it. This is that claim being cashed.
 *
 * Every panel has a designed thin-data state. A player with two runs gets a
 * countdown to where the figures settle, not a blank rectangle — and a run
 * recorded before dwell capture existed says so rather than drawing a
 * confident zero.
 */

export function Analysis({ username }: { username: string }): React.JSX.Element {
  const analysis = useAsync(() => fetchAnalysis(username), [username]);

  if (analysis.status === "loading") return <Loading />;
  if (analysis.status === "failed") return <Failed what="analysis" />;
  return <Observatory data={analysis.data} />;
}

function Observatory({ data }: { data: AnalysisResponse }): React.JSX.Element {
  const [metric, setMetric] = useState<AtlasMetric>("flight");
  const [filter, setFilter] = useState<RoseFilter>("all");
  const [focus, setFocus] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(data.recent[0]?.id ?? null);

  useEffect(() => {
    setRunId(data.recent[0]?.id ?? null);
  }, [data.recent]);

  const legends = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of data.keys) if (key.legend !== "") out[key.code] = key.legend;
    return out;
  }, [data.keys]);

  const dwellAvailable = data.dwellRuns > 0;

  if (data.runs === 0) {
    return (
      <div className="page-stack">
        <p className="empty label">
          nothing to analyse yet — {data.username} has no verified runs. this page is
          built from keystrokes, so it needs some.
        </p>
        <Link className="chip" to="/">
          go type
        </Link>
      </div>
    );
  }

  return (
    <div className="page-stack analysis">
      <Headline data={data} dwellAvailable={dwellAvailable} />

      {data.runsUntilConfident > 0 && (
        <p className="label thin-note">
          {data.runs} {data.runs === 1 ? "run" : "runs"} so far. the figures below are
          drawn from real keystrokes and are already true — they are just noisy.{" "}
          {data.runsUntilConfident} more and they settle.
        </p>
      )}

      {/* ── The Ribbon ─────────────────────────────────────────────────── */}
      <section className="panel">
        <h2 className="label">the rhythm ribbon — one run, keystroke by keystroke</h2>
        <RunPicker runs={data.recent} selected={runId} onSelect={setRunId} />
        {runId === null ? (
          <p className="empty label">no run selected</p>
        ) : (
          <RibbonFor id={runId} />
        )}
      </section>

      {/* ── The Atlas ──────────────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="label">the atlas — your board, by physical key</h2>
          <div className="chips">
            {METRICS.map((option) => (
              <button
                key={option.id}
                className="chip"
                data-on={metric === option.id || undefined}
                disabled={option.id === "dwell" && !dwellAvailable}
                onClick={() => setMetric(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <Atlas
          keys={data.keys}
          metric={metric}
          dwellAvailable={dwellAvailable}
          selected={focus}
          onSelect={setFocus}
        />
        {!data.qwertyLike && (
          <p className="label thin-note">
            your board does not look like qwerty. every cap above is lettered from your
            own keystrokes rather than from an assumed layout.
          </p>
        )}
      </section>

      {/* ── The Rose ───────────────────────────────────────────────────── */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="label">the transition rose — what your pairs cost</h2>
          <div className="chips">
            {FILTERS.map((option) => (
              <button
                key={option.id}
                className="chip"
                data-on={filter === option.id || undefined}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
            {focus !== null && (
              <button className="chip" data-on onClick={() => setFocus(null)}>
                {legends[focus] ?? focus} ✕
              </button>
            )}
          </div>
        </div>

        <div className="rose-layout">
          <Rose
            bigrams={data.bigrams}
            filter={filter}
            focus={focus}
            legends={legends}
          />
          <Worst bigrams={data.bigrams} />
        </div>
      </section>
    </div>
  );
}

/** The run's headline constants — the things that are true of your hands. */
function Headline({
  data,
  dwellAvailable,
}: {
  data: AnalysisResponse;
  dwellAvailable: boolean;
}): React.JSX.Element {
  const flight = medianOf(data.keys.map((key) => key.flightMs).filter((ms) => ms > 0));
  const dwell = medianOf(
    data.keys.map((key) => key.dwellMs).filter((ms): ms is number => ms !== null),
  );
  const rolls = data.rolls;
  const inRoll = rolls.counts["in-roll"];
  const outRoll = rolls.counts["out-roll"];
  const rollTotal = Math.max(1, inRoll + outRoll);

  return (
    <dl className="headline">
      <Figure term="runs analysed" value={String(data.runs)} />
      <Figure
        term="median flight"
        value={flight > 0 ? `${flight.toFixed(0)}ms` : "—"}
      />
      <Figure
        term="median dwell"
        value={dwellAvailable && dwell > 0 ? `${dwell.toFixed(0)}ms` : "—"}
        {...(dwellAvailable ? {} : { note: "not recorded on these runs" })}
      />
      <Figure
        term="same-finger rate"
        value={pct(rolls.sameFingerRate)}
        note="pairs one finger has to make alone"
      />
      <Figure
        term="same-finger cost"
        value={
          rolls.sameFingerCostMs > 0 ? `+${rolls.sameFingerCostMs.toFixed(0)}ms` : "—"
        }
        note="against your alternating pairs"
      />
      <Figure
        term="roll direction"
        value={`${((inRoll / rollTotal) * 100).toFixed(0)}% in`}
        note="inward rolls run toward the index finger"
      />
    </dl>
  );
}

function Figure({
  term,
  value,
  note,
}: {
  term: string;
  value: string;
  note?: string;
}): React.JSX.Element {
  return (
    <div className="headline-figure">
      <dt className="label">{term}</dt>
      <dd className="tabular">{value}</dd>
      {note !== undefined && <span className="label headline-note">{note}</span>}
    </div>
  );
}

/**
 * The transitions actually worth practising.
 *
 * Ranked by *total time lost*, not by how slow they are: a pair that costs you
 * 80ms extra and happens two hundred times matters more than one that costs
 * 200ms and happens nine times, and only one of those is worth a drill.
 */
function Worst({ bigrams }: { bigrams: readonly BigramStat[] }): React.JSX.Element {
  const ranked = useMemo(() => {
    const usable = bigrams.filter((b) => b.n >= MIN_SAMPLES && b.latencyMs > 0);
    if (usable.length === 0) return [];
    const sorted = [...usable].map((b) => b.latencyMs).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    return usable
      .map((bigram) => ({ bigram, lost: (bigram.latencyMs - median) * bigram.n }))
      .filter((entry) => entry.lost > 0)
      .sort((a, b) => b.lost - a.lost)
      .slice(0, 8);
  }, [bigrams]);

  if (ranked.length === 0) {
    return (
      <div className="worst">
        <h3 className="label">costing you most</h3>
        <p className="empty label">not enough repeats of any pair yet</p>
      </div>
    );
  }

  return (
    <div className="worst">
      <h3 className="label">costing you most</h3>
      <table className="board worst-table">
        <thead>
          <tr>
            <th>pair</th>
            <th>kind</th>
            <th>ms</th>
            <th>n</th>
            <th>lost</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map(({ bigram, lost }) => (
            <tr key={bigram.pair}>
              <td className="worst-pair">{bigram.label}</td>
              <td>{bigram.kind.replace("-", " ")}</td>
              <td className="tabular">{bigram.latencyMs.toFixed(0)}</td>
              <td className="tabular">{bigram.n}</td>
              <td className="tabular">{(lost / 1000).toFixed(1)}s</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="label">
        ranked by total time lost — how far past your median, multiplied by how often
        you type it
      </p>
    </div>
  );
}

function RunPicker({
  runs,
  selected,
  onSelect,
}: {
  runs: AnalysisResponse["recent"];
  selected: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="chips run-picker">
      {runs.slice(0, 10).map((run) => (
        <button
          key={run.id}
          className="chip"
          data-on={selected === run.id || undefined}
          onClick={() => onSelect(run.id)}
        >
          {run.wpm.toFixed(0)} · {boardLabel(run.mode, run.length)} ·{" "}
          {shortDate(run.createdAt)}
        </button>
      ))}
    </div>
  );
}

function RibbonFor({ id }: { id: string }): React.JSX.Element {
  const run = useAsync(() => fetchRibbon(id), [id]);
  if (run.status === "loading") return <Loading />;
  if (run.status === "failed") return <Failed what="run" />;

  return (
    <>
      <Ribbon
        keystrokes={run.data.keystrokes}
        hasDwell={run.data.hasDwell}
        durationMs={run.data.durationMs}
      />
      {!run.data.hasDwell && (
        <p className="label thin-note">
          this run predates dwell capture, so every stroke above is drawn at one
          thickness. runs from here on record how long each key was held.
        </p>
      )}
    </>
  );
}

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
