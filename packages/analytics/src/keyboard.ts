/**
 * The physical keyboard, as geometry.
 *
 * Everything in this file is keyed on `KeyboardEvent.code` — the physical key —
 * never on the character it produced. That distinction is the whole point: a
 * Dvorak player's `KeyS` sits under the same finger as a QWERTY player's, and a
 * claim about fingers, hands or rolls is only true if it is made about position.
 *
 * The characters go the other way. Rather than shipping a table per layout, the
 * legend for a key is *observed*: every correct keystroke is a (code, key) pair,
 * so a player's own log tells us what their board prints. That works for layouts
 * nobody here has heard of, and it cannot drift out of date. `QWERTY_LEGEND` is
 * only the fallback for a key that has never been pressed.
 */

export type Hand = "left" | "right";

/**
 * Finger ids: left pinky 0 → left thumb 4, right thumb 5 → right pinky 9.
 * Ordered across the hands so that "toward the index finger" is a comparison.
 */
export type Finger = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface PhysicalKey {
  code: string;
  /** 0 is the digit row, 4 the space row. */
  row: number;
  /** Left edge, in key units. */
  x: number;
  /** Width, in key units. */
  w: number;
  finger: Finger;
  /** What an ANSI QWERTY board prints here. Display fallback only. */
  legend: string;
}

/** Row width in key units. Every row below adds up to this. */
export const ROW_UNITS = 15;

const ROWS: ReadonlyArray<ReadonlyArray<[string, number, Finger, string]>> = [
  // [code, width, finger, legend] — laid out left to right, x accumulated below.
  [
    ["Backquote", 1, 0, "`"],
    ["Digit1", 1, 0, "1"],
    ["Digit2", 1, 1, "2"],
    ["Digit3", 1, 2, "3"],
    ["Digit4", 1, 3, "4"],
    ["Digit5", 1, 3, "5"],
    ["Digit6", 1, 6, "6"],
    ["Digit7", 1, 6, "7"],
    ["Digit8", 1, 7, "8"],
    ["Digit9", 1, 8, "9"],
    ["Digit0", 1, 9, "0"],
    ["Minus", 1, 9, "-"],
    ["Equal", 1, 9, "="],
    ["Backspace", 2, 9, "⌫"],
  ],
  [
    ["Tab", 1.5, 0, "⇥"],
    ["KeyQ", 1, 0, "q"],
    ["KeyW", 1, 1, "w"],
    ["KeyE", 1, 2, "e"],
    ["KeyR", 1, 3, "r"],
    ["KeyT", 1, 3, "t"],
    ["KeyY", 1, 6, "y"],
    ["KeyU", 1, 6, "u"],
    ["KeyI", 1, 7, "i"],
    ["KeyO", 1, 8, "o"],
    ["KeyP", 1, 9, "p"],
    ["BracketLeft", 1, 9, "["],
    ["BracketRight", 1, 9, "]"],
    ["Backslash", 1.5, 9, "\\"],
  ],
  [
    ["CapsLock", 1.75, 0, "⇪"],
    ["KeyA", 1, 0, "a"],
    ["KeyS", 1, 1, "s"],
    ["KeyD", 1, 2, "d"],
    ["KeyF", 1, 3, "f"],
    ["KeyG", 1, 3, "g"],
    ["KeyH", 1, 6, "h"],
    ["KeyJ", 1, 6, "j"],
    ["KeyK", 1, 7, "k"],
    ["KeyL", 1, 8, "l"],
    ["Semicolon", 1, 9, ";"],
    ["Quote", 1, 9, "'"],
    ["Enter", 2.25, 9, "⏎"],
  ],
  [
    ["ShiftLeft", 2.25, 0, "⇧"],
    ["KeyZ", 1, 0, "z"],
    ["KeyX", 1, 1, "x"],
    ["KeyC", 1, 2, "c"],
    ["KeyV", 1, 3, "v"],
    ["KeyB", 1, 3, "b"],
    ["KeyN", 1, 6, "n"],
    ["KeyM", 1, 6, "m"],
    ["Comma", 1, 7, ","],
    ["Period", 1, 8, "."],
    ["Slash", 1, 9, "/"],
    ["ShiftRight", 2.75, 9, "⇧"],
  ],
  [
    // The bottom row, reduced to the only key a test ever records.
    ["ControlLeft", 1.25, 0, "ctrl"],
    ["AltLeft", 1.25, 0, "alt"],
    ["Space", 6.25, 4, "space"],
    ["AltRight", 1.25, 9, "alt"],
    ["ControlRight", 1.25, 9, "ctrl"],
  ],
];

function buildKeys(): PhysicalKey[] {
  const keys: PhysicalKey[] = [];
  ROWS.forEach((row, index) => {
    let x = index === 4 ? 2.5 : 0;
    for (const [code, w, finger, legend] of row) {
      keys.push({ code, row: index, x, w, finger, legend });
      x += w;
    }
  });
  return keys;
}

/** Every physical key the board knows about, in reading order. */
export const KEYS: readonly PhysicalKey[] = buildKeys();

const BY_CODE = new Map(KEYS.map((key) => [key.code, key]));

export function keyFor(code: string): PhysicalKey | null {
  return BY_CODE.get(code) ?? null;
}

/** The QWERTY legend for a code, for keys with no observed character. */
export const QWERTY_LEGEND = (code: string): string => keyFor(code)?.legend ?? "";

const QWERTY_CODES = new Map<string, string>([
  ...KEYS.filter((key) => key.legend.length === 1).map(
    (key) => [key.legend, key.code] as const,
  ),
  [" ", "Space"],
]);

/**
 * Which key would print this character on an ANSI QWERTY board.
 *
 * A guess of last resort, for a character the player has not yet typed even
 * once. Callers must check `qwertyLike` first: applying it to someone on Dvorak
 * would credit the wrong finger, which is worse than reporting nothing.
 */
export const qwertyCodeFor = (char: string): string | null =>
  QWERTY_CODES.get(char) ?? null;

export const centerOf = (key: PhysicalKey): number => key.x + key.w / 2;

export const handOf = (finger: Finger): Hand => (finger <= 4 ? "left" : "right");

export const isThumb = (finger: Finger): boolean => finger === 4 || finger === 5;

/**
 * Are two keys physically neighbours?
 *
 * This is what separates a fat-fingered `d` for `f` from typing an `x` when you
 * meant `f` — the first is a motor slip and the second is not, and they call for
 * completely different practice. One row apart at most, and roughly one key
 * width apart horizontally, which the row stagger is already baked into.
 */
const NEIGHBOUR_UNITS = 1.05;

export function areNeighbours(a: string, b: string): boolean {
  const keyA = keyFor(a);
  const keyB = keyFor(b);
  if (!keyA || !keyB || keyA.code === keyB.code) return false;
  if (Math.abs(keyA.row - keyB.row) > 1) return false;
  return Math.abs(centerOf(keyA) - centerOf(keyB)) <= NEIGHBOUR_UNITS;
}

/**
 * How a pair of keys is typed, which is the thing layout arguments are actually
 * about.
 *
 * `same-finger` is the one that hurts: one finger has to leave a key and land on
 * another before the next character can happen, and no amount of practice makes
 * that as fast as using two fingers. A roll is the opposite — adjacent fingers
 * falling in sequence — and it runs inward (toward the index) faster than out.
 */
export type BigramClass =
  "same-key" | "same-finger" | "in-roll" | "out-roll" | "alternate" | "thumb";

export function classifyBigram(fromCode: string, toCode: string): BigramClass | null {
  const from = keyFor(fromCode);
  const to = keyFor(toCode);
  if (!from || !to) return null;
  if (isThumb(from.finger) || isThumb(to.finger)) return "thumb";
  if (from.code === to.code) return "same-key";
  if (from.finger === to.finger) return "same-finger";
  if (handOf(from.finger) !== handOf(to.finger)) return "alternate";
  // Within a hand, "inward" means moving toward the index finger — which is
  // upward in finger id on the left and downward on the right.
  const inward =
    handOf(from.finger) === "left" ? to.finger > from.finger : to.finger < from.finger;
  return inward ? "in-roll" : "out-roll";
}
