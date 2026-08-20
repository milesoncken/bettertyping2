import { useEffect, useState } from "react";

export type Async<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "failed"; error: string };

/**
 * A fetch bound to a screen's lifetime.
 *
 * The generation counter is the whole point: switching boards twice quickly
 * must not let the first response overwrite the second. A stale result is
 * dropped, not rendered.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): Async<T> {
  const [state, setState] = useState<Async<T>>({ status: "loading" });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    load().then(
      (data) => {
        if (live) setState({ status: "ready", data });
      },
      (error: unknown) => {
        if (live) setState({ status: "failed", error: String(error) });
      },
    );
    return () => {
      live = false;
    };
    // The caller owns the dependency list: `load` is a fresh closure on every
    // render, so depending on it would refetch forever.
  }, deps);

  return state;
}
