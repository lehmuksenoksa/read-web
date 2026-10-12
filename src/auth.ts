// Sign in with Dropbox in the browser (OAuth PKCE, made for public code: no secret anywhere).
// The sign-in is short-lived and kept in this tab's session only; closing it forgets it.

const AUTHORIZE = "https://www.dropbox.com/oauth2/authorize";
const TOKEN = "https://api.dropboxapi.com/oauth2/token";
const SCOPES = "files.metadata.read files.content.read files.content.write";

const KEY_TOKEN = "read.token";
const KEY_VERIFIER = "read.verifier";
const KEY_STATE = "read.state";

/** The Dropbox app's key (Read Web): public by design, set at build time. */
export const APP_KEY: string = import.meta.env.VITE_DROPBOX_APP_KEY ?? "";

/** This page's address: the only one Dropbox sends a sign-in back to. */
export function redirectUri(): string {
  return location.origin + location.pathname;
}

export function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomString(bytes = 48): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** Off to Dropbox to sign in; it comes back to this page with a code. */
export async function signIn(): Promise<void> {
  const verifier = randomString();
  const state = randomString(16);
  sessionStorage.setItem(KEY_VERIFIER, verifier);
  sessionStorage.setItem(KEY_STATE, state);
  const params = new URLSearchParams({
    client_id: APP_KEY,
    response_type: "code",
    code_challenge: await codeChallenge(verifier),
    code_challenge_method: "S256",
    redirect_uri: redirectUri(),
    token_access_type: "online",
    scope: SCOPES,
    state,
  });
  location.assign(`${AUTHORIZE}?${params}`);
}

/** Back from Dropbox: the code becomes a sign-in for this session. False when this isn't a return from Dropbox. */
export async function finishSignIn(): Promise<boolean> {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const state = params.get("state");
  if (!code && !params.get("error")) return false;
  history.replaceState(null, "", redirectUri());
  const verifier = sessionStorage.getItem(KEY_VERIFIER);
  const expected = sessionStorage.getItem(KEY_STATE);
  sessionStorage.removeItem(KEY_VERIFIER);
  sessionStorage.removeItem(KEY_STATE);
  if (!code || !verifier || !state || state !== expected) return false;
  const response = await fetch(TOKEN, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    body: new URLSearchParams({ code, grant_type: "authorization_code", code_verifier: verifier, client_id: APP_KEY, redirect_uri: redirectUri() }),
  });
  if (!response.ok) return false;
  const body = (await response.json()) as { access_token: string; expires_in: number };
  sessionStorage.setItem(KEY_TOKEN, JSON.stringify({ token: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 }));
  return true;
}

/** The sign-in, while it lasts. */
export function currentToken(): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY_TOKEN) ?? "null") as { token: string; expiresAt: number } | null;
    if (saved && saved.expiresAt > Date.now()) return saved.token;
  } catch {
    // Unreadable: signed out.
  }
  sessionStorage.removeItem(KEY_TOKEN);
  return null;
}

export function forgetSignIn(): void {
  sessionStorage.removeItem(KEY_TOKEN);
}
