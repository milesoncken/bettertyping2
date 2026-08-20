import { Link, useRouter } from "./lib/router.js";
import "./nav.css";

/**
 * The four places there are to be. Rendered on every screen, including the test
 * one, where it is deliberately the quietest thing in the frame.
 */
export function Nav(): React.JSX.Element {
  const { path } = useRouter();
  const on = (prefix: string): boolean =>
    prefix === "/" ? path === "/" : path.startsWith(prefix);

  return (
    <nav className="nav" aria-label="Sections">
      <Link className="nav-link" to="/" data-on={on("/") || undefined}>
        test
      </Link>
      <Link className="nav-link" to="/leaderboards" data-on={on("/leaderboards") || undefined}>
        boards
      </Link>
      <Link className="nav-link" to="/me" data-on={on("/me") || on("/u/") || undefined}>
        profile
      </Link>
    </nav>
  );
}
