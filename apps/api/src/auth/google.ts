import { createHash, randomBytes } from "node:crypto";

/**
 * Google sign-in, by hand.
 *
 * Authorization code flow with PKCE. Written against the endpoints directly
 * rather than pulling in an OAuth framework: it is about sixty lines, and the
 * flow is worth being able to read.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkce(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(16).toString("base64url");
}

export function authorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // We want an identity, not an ongoing grant, so no refresh token is requested.
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface GoogleIdentity {
  /** Google's stable subject identifier. The account key — never the email. */
  sub: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * Read the identity out of an `id_token`.
 *
 * The signature is deliberately not verified, and that is correct here: this
 * token came back over TLS from Google's own token endpoint in a request we
 * made, so there is no untrusted party in the path. Signature verification (via
 * JWKS) is what you need when a token arrives *from a client* — if this ever
 * accepts an id_token from the browser, this function must change first.
 */
export function readIdToken(idToken: string): GoogleIdentity {
  const parts = idToken.split(".");
  const payload = parts[1];
  if (parts.length !== 3 || !payload) throw new Error("Malformed id_token");

  const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    sub?: unknown;
    email?: unknown;
    email_verified?: unknown;
  };

  if (typeof decoded.sub !== "string" || decoded.sub.length === 0) {
    throw new Error("id_token missing sub");
  }

  return {
    sub: decoded.sub,
    email: typeof decoded.email === "string" ? decoded.email : null,
    emailVerified: decoded.email_verified === true,
  };
}

export interface TokenExchange {
  idToken: string;
}

export async function exchangeCode(params: {
  code: string;
  verifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenExchange> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
    code_verifier: params.verifier,
  });

  const doFetch = params.fetchImpl ?? fetch;
  const response = await doFetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status}`);
  }

  const json = (await response.json()) as { id_token?: unknown };
  if (typeof json.id_token !== "string") throw new Error("No id_token in response");
  return { idToken: json.id_token };
}

/**
 * A username from an email local part: lowercase, safe characters, bounded.
 * Collisions are resolved by the caller against the database.
 */
export function usernameFrom(email: string | null, fallback: string): string {
  const local = (email ?? "").split("@")[0] ?? "";
  const cleaned = local.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (cleaned.length >= 3) return cleaned.slice(0, 16);
  return `typist_${fallback.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()}`;
}
