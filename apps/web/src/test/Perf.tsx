import { useEffect, useState } from "react";
import { latencyStats } from "../lib/latency.js";
import type { LatencyStats } from "../lib/latency.js";

/** Keystroke-to-paint readout. Enabled with `?perf`. */
export function Perf(): React.JSX.Element {
  const [stats, setStats] = useState<LatencyStats>(latencyStats);

  useEffect(() => {
    const id = window.setInterval(() => setStats(latencyStats()), 400);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="perf">
      <span className="label">keystroke → paint</span>
      <span className="tabular">
        p50 {stats.p50.toFixed(1)}ms · p99 {stats.p99.toFixed(1)}ms · max{" "}
        {stats.worst.toFixed(1)}ms · n {stats.count}
      </span>
    </div>
  );
}
