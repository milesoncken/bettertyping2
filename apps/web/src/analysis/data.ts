import { apiGet } from "../lib/api.js";
import type { AnalysisResponse, RibbonResponse } from "@bettertyping/schema/contracts";

/**
 * The analysis screen's reads.
 *
 * Type-only imports from `@bettertyping/schema`, like every other screen: the
 * package pulls Zod and Drizzle at runtime and neither belongs in a browser.
 * Geometry comes from `@bettertyping/analytics/keyboard`, which is a value
 * import — but only of that one file, so nothing drags the analysis engine or
 * its dependencies into the bundle to draw a keyboard.
 */

export type {
  AnalysisResponse,
  BigramClass,
  BigramStat,
  HistoryEntry,
  KeyStat,
  Keystroke,
  RibbonResponse,
  RollProfile,
} from "@bettertyping/schema/contracts";

export const fetchAnalysis = (username: string): Promise<AnalysisResponse> =>
  apiGet<AnalysisResponse>(`/users/${encodeURIComponent(username)}/analysis`);

export const fetchRibbon = (id: string): Promise<RibbonResponse> =>
  apiGet<RibbonResponse>(`/tests/${encodeURIComponent(id)}/ribbon`);

/**
 * Speed implied by one keystroke's flight time.
 *
 * The ramp encodes words per minute everywhere else in the product, so a
 * keystroke is converted into the same unit rather than given a private scale:
 * five characters to a word means a 120 ms gap is 100 wpm. Colour therefore
 * means the same thing on the Ribbon as it does on the Line.
 */
export const wpmOfFlight = (flightMs: number): number =>
  flightMs <= 0 ? 0 : 12_000 / flightMs;

/** Samples below which a per-key or per-bigram figure is noise wearing a colour. */
export const MIN_SAMPLES = 8;

export const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
