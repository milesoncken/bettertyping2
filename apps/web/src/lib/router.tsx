import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * The router, in full.
 *
 * A routing library would cost more gzip than every board screen put together,
 * for four static paths and no nested layouts. This is the History API with a
 * subscription — `pushState` does not emit an event, so navigation goes through
 * `navigate()`, which pushes and then tells the tree.
 */

interface RouterValue {
  path: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

const currentPath = (): string =>
  typeof window === "undefined" ? "/" : window.location.pathname;

export function RouterProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onPop = (): void => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (to === currentPath()) return;
    window.history[options?.replace === true ? "replaceState" : "pushState"]({}, "", to);
    setPath(to);
    // A fresh screen starts at the top; the browser only restores scroll on a
    // real navigation, which this is not.
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error("useRouter outside RouterProvider");
  return value;
}

/**
 * An anchor that behaves like one.
 *
 * Middle-click, ⌘-click and "open in new tab" all reach a real `href`, so the
 * routes stay linkable and the browser keeps its own affordances. Only a plain
 * left click is intercepted.
 */
export function Link({
  to,
  className,
  children,
  ...rest
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">): React.JSX.Element {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
