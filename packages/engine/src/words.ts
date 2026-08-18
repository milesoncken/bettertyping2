import { COMMON_WORDS } from "./corpus.js";
import { createRng } from "./random.js";
import type { TestConfig } from "./types.js";

/**
 * Word generation is a pure function of (seed, index, modifiers).
 *
 * Two consequences that matter: an infinite `time` test can extend its word list
 * without any extra state, and the server can regenerate the exact text a player
 * was shown from the seed alone — so a client can no longer report what it typed,
 * only how.
 */

const OPENERS = ["(", "[", '"', "'"] as const;
const CLOSERS = { "(": ")", "[": "]", '"': '"', "'": "'" } as const;
const TERMINALS = [".", ".", ".", ",", ",", "!", "?", ";", ":"] as const;

/** Deterministic per-index RNG, so word N never depends on word N-1. */
function rngFor(seed: string, index: number): () => number {
  return createRng(`${seed}:${index}`);
}

function pick<T>(items: readonly T[], r: number): T {
  const item = items[Math.floor(r * items.length)];
  // `noUncheckedIndexedAccess` is on; r is always in [0, 1) so this cannot miss.
  return item as T;
}

function numberToken(rand: () => number): string {
  const digits = 1 + Math.floor(rand() * 4);
  let out = "";
  for (let i = 0; i < digits; i++) out += Math.floor(rand() * 10).toString();
  return out;
}

/** The word at `index`, with modifiers applied. Stable for a given seed. */
export function wordAt(config: TestConfig, index: number): string {
  const rand = rngFor(config.seed, index);
  const base = pick(COMMON_WORDS, rand());

  if (config.numbers && rand() < 0.12) return numberToken(rand);
  if (!config.punctuation) return base;

  let word = base;

  // Sentence-ish capitalisation: the first word, and any word following one
  // that ended a sentence. Derived from the index so it stays pure.
  const prevTerminal = index > 0 ? terminalFor(config, index - 1) : ".";
  if (index === 0 || prevTerminal === "." || prevTerminal === "!" || prevTerminal === "?") {
    word = word.charAt(0).toUpperCase() + word.slice(1);
  }

  if (rand() < 0.04) {
    const open = pick(OPENERS, rand());
    word = `${open}${word}${CLOSERS[open]}`;
  } else if (rand() < 0.05) {
    word = `${word}'s`;
  }

  const terminal = terminalFor(config, index);
  if (terminal) word += terminal;

  return word;
}

/** Punctuation that closes word `index`, or "" for none. Pure in the seed. */
function terminalFor(config: TestConfig, index: number): string {
  if (!config.punctuation) return "";
  const rand = rngFor(`${config.seed}#terminal`, index);
  return rand() < 0.22 ? pick(TERMINALS, rand()) : "";
}

/** Generate `count` words starting at `from`. */
export function generateWords(config: TestConfig, count: number, from = 0): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(wordAt(config, from + i));
  return out;
}

/**
 * How many words to materialise up front. `words` mode knows exactly; `time`
 * mode starts generous and extends as the player advances.
 */
export function initialWordCount(config: TestConfig): number {
  if (config.mode === "words") return Math.max(1, config.count ?? 25);
  const duration = config.duration ?? 30;
  // 200 wpm would be a world record; this is a comfortable ceiling either way.
  return Math.max(60, Math.ceil((duration / 60) * 200));
}
