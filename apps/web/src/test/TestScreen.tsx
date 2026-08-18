import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TestConfig } from "@bettertyping/engine";
import { useTypingTest } from "./useTypingTest.js";
import { Words } from "./Words.js";
import { Readouts } from "./Readouts.js";
import { Frame, Rail } from "./Chrome.js";
import { ModeBar } from "./ModeBar.js";
import { Results } from "./Results.js";
import { Perf } from "./Perf.js";
import { TheLine } from "./TheLine.js";
import type { TracePoint } from "./TheLine.js";
import { perfEnabled } from "../lib/latency.js";
import { loadProfile, playSwell, saveProfile } from "../lib/audio.js";
import type { Profile } from "../lib/audio.js";
import "./test-screen.css";

const INITIAL: TestConfig = {
  mode: "words",
  count: 25,
  seed: Math.random().toString(36).slice(2, 12),
  punctuation: false,
  numbers: false,
};

/** How many lines of text stay visible. The rest scrolls under them. */
const VISIBLE_LINES = 3;

export function TestScreen(): React.JSX.Element {
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const profileRef = useRef<Profile>(profile);
  profileRef.current = profile;

  const { state, stateRef, originRef, restart, setConfig } = useTypingTest(
    INITIAL,
    profileRef,
  );

  const pointsRef = useRef<TracePoint[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const testAnchorRef = useRef<HTMLDivElement>(null);
  const chartAnchorRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLDivElement>(null);

  const finished = state.phase === "finished";

  // Reset the trace whenever a new test is dealt.
  useLayoutEffect(() => {
    if (state.phase === "idle") pointsRef.current = [];
  }, [state.phase, state.config.seed]);

  // The swell lands with the trace, not with the last keystroke.
  useEffect(() => {
    if (finished) playSwell(profileRef.current);
  }, [finished]);

  const changeProfile = (next: Profile): void => {
    setProfile(next);
    saveProfile(next);
  };

  /**
   * Caret placement and line scrolling, measured from the active character's own
   * box — one querySelector per keystroke. v1 diffed the bounding rects of every
   * letter to guess where lines broke; this asks the element where it is.
   */
  useLayoutEffect(() => {
    const track = trackRef.current;
    const caret = caretRef.current;
    if (!track || !caret) return;

    const activeWord = track.querySelector<HTMLElement>("[data-active]");
    if (!activeWord) return;

    const chars = activeWord.querySelectorAll<HTMLElement>(".char");
    const target = chars[state.cursor.char];

    let x: number;
    let y: number;
    if (target) {
      x = target.offsetLeft;
      y = target.offsetTop;
    } else {
      const last = chars[chars.length - 1];
      x = last ? last.offsetLeft + last.offsetWidth : activeWord.offsetLeft;
      y = last ? last.offsetTop : activeWord.offsetTop;
    }

    caret.style.transform = `translate(${x}px, ${y}px)`;

    const lineHeight = activeWord.offsetHeight;
    const line = Math.round(activeWord.offsetTop / Math.max(1, lineHeight));
    const scrollLines = Math.max(0, line - (VISIBLE_LINES - 2));
    track.style.transform = `translateY(${-scrollLines * lineHeight}px)`;
  }, [state]);

  const spanMs =
    state.config.mode === "time" && state.config.duration !== undefined
      ? state.config.duration * 1000
      : null;

  return (
    <main className="screen">
      <Frame />

      <div className="screen-inner" ref={hostRef}>
        <TheLine
          stateRef={stateRef}
          originRef={originRef}
          pointsRef={pointsRef}
          spanMs={spanMs}
          phase={state.phase}
          hostRef={hostRef}
          testAnchorRef={testAnchorRef}
          chartAnchorRef={chartAnchorRef}
        />

        <header className="bar">
          <div className="ident">
            bettertyping<em>//</em>
            {state.config.mode === "time"
              ? `time ${state.config.duration}`
              : `words ${state.config.count}`}
            <em>·</em>
            {state.config.punctuation ? "punct on" : "punct off"}
          </div>
          <Readouts
            stateRef={stateRef}
            originRef={originRef}
            running={state.phase === "running"}
            {...(state.config.mode === "time" && state.config.duration !== undefined
              ? { duration: state.config.duration }
              : {})}
          />
        </header>

        {finished ? (
          <Results state={state} chartAnchorRef={chartAnchorRef} onRestart={restart} />
        ) : (
          <section className="field">
            <div className="viewport" data-idle={state.phase === "idle" || undefined}>
              <div className="track" ref={trackRef}>
                <div
                  className="caret"
                  ref={caretRef}
                  data-idle={state.phase === "idle" || undefined}
                />
                <Words words={state.words} cursorWord={state.cursor.word} />
              </div>
            </div>
          </section>
        )}

        {/* The strip the trace occupies while typing, and its departure point.
            It stays in the layout when finished so the flight has somewhere to
            leave from — only its chrome fades. */}
        <section className="trace-block" data-departed={finished || undefined}>
          <Rail />
          <div className="trace-anchor" ref={testAnchorRef} />
          <div className="line-legend">
            <span className="label">slow</span>
            <span className="line-ramp" />
            <span className="label">fast</span>
          </div>
        </section>

        <footer className="bar bottom">
          <ModeBar
            config={state.config}
            profile={profile}
            onChange={setConfig}
            onProfileChange={changeProfile}
            onRestart={restart}
          />
        </footer>
      </div>

      {perfEnabled() && <Perf />}
    </main>
  );
}
