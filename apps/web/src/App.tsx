import { Suspense, lazy } from "react";
import { RouterProvider, useRouter } from "./lib/router.js";
import { TestScreen } from "./test/TestScreen.js";

/**
 * The one decision this file makes: **the test screen is never behind a
 * dynamic import, and everything else always is.**
 *
 * Typing is the product and it is the latency-critical path, so it ships in the
 * entry chunk. The boards are read at leisure, over the network, by someone who
 * has stopped typing — a spinner there costs nothing and keeps the test route
 * inside its 100 KB budget however large the analytics surface grows.
 */

const Boards = lazy(async () => {
  const module = await import("./boards/Boards.js");
  return { default: module.Boards };
});

export function App(): React.JSX.Element {
  return (
    <RouterProvider>
      <Routes />
    </RouterProvider>
  );
}

function Routes(): React.JSX.Element {
  const { path } = useRouter();
  if (path === "/") return <TestScreen />;
  return (
    <Suspense fallback={<div className="boot label">loading</div>}>
      <Boards path={path} />
    </Suspense>
  );
}
