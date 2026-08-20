import { useEffect, useState } from "react";
import { apiEnabled, fetchMe, signInUrl, signOut } from "../lib/api.js";
import type { Me } from "../lib/api.js";
import "./account.css";

/**
 * Sign-in state.
 *
 * Guests type first and sign in later — the test never waits on an account. What
 * an account buys you is a run that can rank and a history that persists.
 */
export function Account(): React.JSX.Element | null {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    void fetchMe().then((user) => {
      setMe(user);
      setChecked(true);
    });
  }, []);

  if (!apiEnabled()) return null;
  if (!checked) return <span className="label account" />;

  if (!me) {
    return (
      <a className="chip account" href={signInUrl()}>
        sign in
      </a>
    );
  }

  return (
    <div className="account">
      <span className="label account-name">{me.username}</span>
      <button
        className="chip"
        onClick={() => {
          void signOut().then(() => setMe(null));
        }}
      >
        sign out
      </button>
    </div>
  );
}
