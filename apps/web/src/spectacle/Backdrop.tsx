import { useEffect, useRef } from "react";
import "./backdrop.css";

/**
 * Mounts the WebGL fog behind the results. The shader arrives by dynamic import,
 * so it is a separate chunk and the test route never downloads it. Skipped
 * outright under reduced motion — there is nothing to see but movement.
 */
export function Backdrop(): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let teardown: (() => void) | null = null;
    let cancelled = false;

    void import("./backdrop.js").then(({ mountBackdrop }) => {
      if (cancelled) return;
      teardown = mountBackdrop(canvas);
    });

    return () => {
      cancelled = true;
      if (teardown) teardown();
    };
  }, []);

  return <canvas ref={canvasRef} className="backdrop" aria-hidden="true" />;
}
