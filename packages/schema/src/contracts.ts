import { z } from "zod";

/**
 * The wire. Every request body is parsed through these, so a malformed or
 * hostile payload is rejected at the edge rather than deep inside the
 * verification pipeline.
 */

export const modeSchema = z.enum(["time", "words"]);

export const DURATIONS = [15, 30, 60] as const;
export const WORD_COUNTS = [25, 50, 100] as const;

/**
 * What a client may ask for. Length is constrained to the offered set: an
 * arbitrary duration would fragment every leaderboard and give a cheat a
 * bespoke category to top.
 */
export const issueRequestSchema = z
  .object({
    mode: modeSchema,
    duration: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
    count: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional(),
    punctuation: z.boolean(),
    numbers: z.boolean(),
  })
  .refine((value) => (value.mode === "time" ? value.duration !== undefined : true), {
    message: "duration is required for time mode",
  })
  .refine((value) => (value.mode === "words" ? value.count !== undefined : true), {
    message: "count is required for words mode",
  });

export type IssueRequest = z.infer<typeof issueRequestSchema>;

export interface IssueResponse {
  testId: string;
  seed: string;
  mode: "time" | "words";
  duration?: number;
  count?: number;
  punctuation: boolean;
  numbers: boolean;
  issuedAt: string;
}

/** One recorded keystroke, mirroring the engine's `KeyEvent`. */
export const keyEventSchema = z.object({
  t: z.number().finite().min(0).max(3_600_000),
  key: z.string().min(1).max(16),
  code: z.string().max(32),
  kind: z.enum(["char", "space", "backspace", "word-back"]),
  expected: z.string().max(4).nullable(),
  correct: z.boolean(),
  word: z.number().int().min(0).max(20_000),
  hold: z.number().finite().min(0).max(60_000).optional(),
});

export const submitRequestSchema = z.object({
  // Capped so one request cannot be used to exhaust memory. 20k keystrokes is
  // far beyond any legitimate 60-second run.
  events: z.array(keyEventSchema).min(1).max(20_000),
  /**
   * What the client believes it scored. The server recomputes everything from
   * the events regardless; this exists so a disagreement is detectable rather
   * than silently papered over.
   */
  claimed: z
    .object({
      wpm: z.number().finite(),
      accuracy: z.number().finite(),
    })
    .optional(),
});

export type SubmitRequest = z.infer<typeof submitRequestSchema>;

export type Verification = "verified" | "flagged" | "rejected";

export interface SubmitResponse {
  verification: Verification;
  reasons: string[];
  results: {
    wpm: number;
    rawWpm: number;
    accuracy: number;
    consistency: number;
    durationMs: number;
    chars: { correct: number; incorrect: number; extra: number; missed: number };
  };
  /** Present when this run set a personal best. */
  personalBest?: { previous: number | null; wpm: number };
}

export interface MeResponse {
  id: string;
  username: string;
}
