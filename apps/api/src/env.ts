import { z } from "zod";

/**
 * Configuration, validated once at boot.
 *
 * A missing OAuth secret should stop the process immediately with a readable
 * message, not surface as a confusing redirect failure for the first person who
 * tries to sign in.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1),
  /** Where the browser app is served from. Used for CORS and post-login redirect. */
  WEB_ORIGIN: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  /** Must match the redirect URI registered in the Google console, exactly. */
  GOOGLE_REDIRECT_URI: z.string().url(),
  /** Signs the short-lived OAuth state cookie. 32+ random bytes. */
  SESSION_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
