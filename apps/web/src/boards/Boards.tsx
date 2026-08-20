import { Suspense, lazy, useEffect, useState } from "react";
import { Frame } from "../test/Chrome.js";
import { Nav } from "../Nav.js";
import { Account } from "../test/Account.js";
import { Link, useRouter } from "../lib/router.js";
import { apiEnabled, fetchMe, signInUrl } from "../lib/api.js";
import { Leaderboard } from "./Leaderboard.js";
import { Profile } from "./Profile.js";
import { Run } from "./Run.js";
import "./boards.css";

/**
 * The observatory is lazy inside a lazy chunk.
 *
 * It carries the keyboard geometry and three drawing surfaces, and nobody
 * reading a leaderboard needs any of it. The test route never loaded this chunk
 * to begin with; this keeps the boards from loading it either.
 */
const Analysis = lazy(async () => {
  const module = await import("../analysis/Analysis.js");
  return { default: module.Analysis };
});

/**
 * Everything that is not the test, in one lazily-loaded chunk.
 *
 * Routing is resolved here rather than in `App` so the entry bundle never
 * contains a board screen — the test route's budget is measured in a single
 * frame of input latency, and none of this is on that path.
 */
export function Boards({ path }: { path: string }): React.JSX.Element {
  const screen = resolve(path);

  return (
    <main className="screen">
      <Frame />
      <div className="screen-inner page">
        <header className="bar">
          <div className="bar-left">
            <div className="ident">
              bettertyping<em>//</em>
              {screen.title}
            </div>
            <Nav />
          </div>
          <div className="bar-right">
            <Account />
          </div>
        </header>

        <div className="page-body">{screen.body}</div>
      </div>
    </main>
  );
}

function resolve(path: string): { title: string; body: React.JSX.Element } {
  if (path === "/leaderboards") return { title: "leaderboards", body: <Leaderboard /> };
  if (path === "/me") return { title: "profile", body: <Me /> };

  if (path === "/analysis") return { title: "analysis", body: <MyAnalysis /> };

  const analysed = /^\/analysis\/([^/]+)$/.exec(path);
  if (analysed?.[1]) {
    const username = decodeURIComponent(analysed[1]);
    return { title: `${username} · analysis`, body: <Deferred><Analysis username={username} /></Deferred> };
  }

  const user = /^\/u\/([^/]+)$/.exec(path);
  if (user?.[1]) {
    const username = decodeURIComponent(user[1]);
    return { title: username, body: <Profile username={username} own={false} /> };
  }

  const run = /^\/run\/([^/]+)$/.exec(path);
  if (run?.[1]) return { title: "run", body: <Run id={decodeURIComponent(run[1])} /> };

  return { title: "lost", body: <NotFound /> };
}

/**
 * Your own profile.
 *
 * `/me` resolves to a username and then renders the same screen anyone else
 * would see of you, plus your history. One profile screen, two audiences.
 */
function Me(): React.JSX.Element {
  return (
    <WhenSignedIn
      prompt="sign in to keep a history. runs typed as a guest are scored and shown, but they are not recorded against anyone."
      render={(username) => <Profile username={username} own />}
    />
  );
}

/**
 * The signed-out state, designed once.
 *
 * Both `/me` and `/analysis` are about a person, and neither can say anything
 * about a guest. The prompt differs because the reason differs; the shape does
 * not, so it lives here rather than being written twice and drifting.
 */
function WhenSignedIn({
  prompt,
  render,
}: {
  prompt: string;
  render: (username: string) => React.JSX.Element;
}): React.JSX.Element {
  const [me, setMe] = useState<{ username: string } | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void fetchMe().then((user) => {
      setMe(user);
      setChecked(true);
    });
  }, []);

  if (!checked) return <p className="empty label">loading</p>;

  if (!me) {
    return (
      <div className="page-stack">
        <p className="empty label">
          {apiEnabled()
            ? prompt
            : "this build has no server configured, so there is nothing to record. typing still works."}
        </p>
        {apiEnabled() && (
          <a className="chip" href={signInUrl()}>
            sign in with google
          </a>
        )}
      </div>
    );
  }

  return render(me.username);
}

/** Your own analysis, which is the same screen anyone else's resolves to. */
function MyAnalysis(): React.JSX.Element {
  return (
    <WhenSignedIn
      prompt="sign in to keep the keystrokes this page is built from. a guest run is scored and shown, but nothing is recorded against anyone."
      render={(username) => (
        <Deferred>
          <Analysis username={username} />
        </Deferred>
      )}
    />
  );
}

function Deferred({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Suspense fallback={<p className="empty label">loading</p>}>{children}</Suspense>;
}

function NotFound(): React.JSX.Element {
  const { path } = useRouter();
  return (
    <div className="page-stack">
      <p className="empty label">nothing at {path}</p>
      <Link className="chip" to="/">
        back to typing
      </Link>
    </div>
  );
}
