import type { TestConfig } from "@bettertyping/engine";
import "./modebar.css";

/**
 * Mode selection. Real buttons in the tab order — no key hijacking, so Tab and
 * Enter behave exactly as a keyboard user expects while still being the fastest
 * route to a restart.
 */

interface ModeBarProps {
  config: TestConfig;
  onChange: (patch: Partial<TestConfig>) => void;
  onRestart: () => void;
}

const WORD_COUNTS = [25, 50, 100] as const;
const DURATIONS = [15, 30, 60] as const;

export function ModeBar({ config, onChange, onRestart }: ModeBarProps): React.JSX.Element {
  const isTime = config.mode === "time";

  return (
    <div className="modebar">
      <div className="group" role="group" aria-label="Test mode">
        <Chip on={!isTime} onClick={() => onChange({ mode: "words", count: 25 })}>
          words
        </Chip>
        <Chip on={isTime} onClick={() => onChange({ mode: "time", duration: 30 })}>
          time
        </Chip>
      </div>

      <div className="group" role="group" aria-label="Test length">
        {isTime
          ? DURATIONS.map((d) => (
              <Chip
                key={d}
                on={config.duration === d}
                onClick={() => onChange({ mode: "time", duration: d })}
              >
                {d}
              </Chip>
            ))
          : WORD_COUNTS.map((c) => (
              <Chip
                key={c}
                on={config.count === c}
                onClick={() => onChange({ mode: "words", count: c })}
              >
                {c}
              </Chip>
            ))}
      </div>

      <div className="group" role="group" aria-label="Modifiers">
        <Chip
          on={config.punctuation}
          onClick={() => onChange({ punctuation: !config.punctuation })}
        >
          punctuation
        </Chip>
        <Chip on={config.numbers} onClick={() => onChange({ numbers: !config.numbers })}>
          numbers
        </Chip>
      </div>

      <button className="chip restart" onClick={onRestart}>
        restart
      </button>
    </div>
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
