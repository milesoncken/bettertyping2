import "./chrome.css";

/** Hairline frame with corner registration marks. Pure chrome, never data. */
export function Frame(): React.JSX.Element {
  return (
    <div className="frame" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </div>
  );
}

/**
 * The calibration rail. Tick marks only — the numeric labels are drawn by the
 * trace itself, against whatever scale the run actually needed, so the two can
 * never disagree.
 */
export function Rail(): React.JSX.Element {
  const ticks = [];
  for (let i = 0; i <= 16; i++) {
    ticks.push(
      <div
        key={i}
        className="tick"
        data-major={i % 4 === 0 || undefined}
        style={{ top: `${(i / 16) * 100}%` }}
      />,
    );
  }
  return (
    <div className="rail" aria-hidden="true">
      {ticks}
    </div>
  );
}
