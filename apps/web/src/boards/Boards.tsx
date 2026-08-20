import { useEffect, useState } from "react";
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
            ? "sign in to keep a history. runs typed as a guest are scored and shown, but they are not recorded against anyone."
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

  return <Profile username={me.username} own />;
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
