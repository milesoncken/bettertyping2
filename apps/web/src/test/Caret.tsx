import { useEffect, useRef } from "react";

/**
 * The caret.
 *
 * Two things matter here and CSS could do neither well.
 *
 * **It flows.** A CSS transition restarts from wherever it happens to be on
 * every keystroke, so at speed the caret never finishes a move and reads as
 * stepping and lagging behind your hands. This runs a frame-rate-independent
 * spring against a target ref instead: it is always converging, never
 * restarting, and it catches up rather than queueing.
 *
 * **It is measured, not calculated.** Height and vertical position come from the
 * character's own box, so the caret sits exactly on the text — bottom on the
 * text's bottom — in any font at any size. Deriving it from em arithmetic is
 * what put it out of alignment: `offsetTop` on an inline span is the top of the
 * font content area, not of the line box, and the two are half a line's leading
 * apart.
 */

export interface CaretTarget {
  x: number;
  y: number;
  /** Height of the character box the caret sits against. */
  h: number;
}

/**
 * Time constant of the spring, in ms — the time to close ~63% of the remaining
 * distance. Low enough to feel fastened to your fingers, high enough to read as
 * one continuous movement rather than a jump.
 */
const TAU_MS = 34;

export function Caret({
  targetRef,
  idle,
}: {
  targetRef: React.RefObject<CaretTarget | null>;
  idle: boolean;
}): React.JSX.Element {
  const elementRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<CaretTarget | null>(null);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let previous: number | null = null;

    const tick = (now: number): void => {
      const target = targetRef.current;
      if (target) {
        const dt = previous === null ? 16 : Math.min(64, now - previous);
        const pos = posRef.current;

        if (pos === null || reduced) {
          posRef.current = { ...target };
        } else {
          // A line wrap is a jump, not a glide: easing it would drag the caret
          // diagonally across the whole passage.
          const wrapped = Math.abs(target.y - pos.y) > target.h * 0.5;
          if (wrapped) {
            posRef.current = { ...target };
          } else {
            const k = 1 - Math.exp(-dt / TAU_MS);
            posRef.current = {
              x: pos.x + (target.x - pos.x) * k,
              y: pos.y + (target.y - pos.y) * k,
              h: pos.h + (target.h - pos.h) * k,
            };
          }
        }

        const settled = posRef.current;
        element.style.height = `${settled.h}px`;
        element.style.transform = `translate3d(${settled.x}px, ${settled.y}px, 0)`;
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [targetRef]);

  return <div className="caret" ref={elementRef} data-idle={idle || undefined} />;
}
