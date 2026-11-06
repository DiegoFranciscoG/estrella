/**
 * OAuth PKCE (RFC 7636) with S256, the method OpenRouter recommends. The verifier stays in this
 * tab; only its SHA-256 travels to OpenRouter, so a stolen code is useless without it.
 */

/** RFC 7636 §4.1: the unreserved characters of RFC 3986. */
const UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
/** Largest multiple of 66 below 256: bytes above it are discarded so every character is equally likely. */
const ACCEPT_BELOW = 256 - (256 % UNRESERVED.length);

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export function createVerifier(length = 64, random: (n: number) => Uint8Array = randomBytes): string {
  if (length < 43 || length > 128) throw new RangeError("RFC 7636: the verifier has 43 to 128 characters");
  let out = "";
  while (out.length < length) {
    for (const b of random(length)) {
      if (b < ACCEPT_BELOW && out.length < length) out += UNRESERVED[b % UNRESERVED.length];
    }
  }
  return out;
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** S256: BASE64URL(SHA256(ASCII(verifier))). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** Random value echoed back by OpenRouter, to tie the answer to the request that started here. */
export function createState(random: (n: number) => Uint8Array = randomBytes): string {
  return base64url(random(32));
}
