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

/** The calibration rail on the speed axis. */
export function Rail({ fullScale = 160 }: { fullScale?: number }): React.JSX.Element {
  const ticks = [];
  for (let i = 0; i <= 16; i++) {
    const major = i % 4 === 0;
    const top = `${(i / 16) * 100}%`;
    ticks.push(
      <div key={`t${i}`} className="tick" data-major={major || undefined} style={{ top }} />,
    );
    if (major) {
      ticks.push(
        <div key={`l${i}`} className="tick-label tabular" style={{ top }}>
          {Math.round(fullScale - (i / 16) * fullScale)}
        </div>,
      );
    }
  }
  return (
    <div className="rail" aria-hidden="true">
      {ticks}
    </div>
  );
}
