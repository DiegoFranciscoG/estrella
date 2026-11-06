/**
 * Key handling on the student's device (Web Crypto only, no libraries).
 *
 * password --PBKDF2-SHA256, 600k--> master secret
 *   master --HKDF "auth"--> authKey   (sent to the server, which hashes it again with Argon2id)
 *   master --HKDF "kek" --> KEK       (never leaves the device; wraps the vault key)
 * recovery code --HKDF "recovery"--> second KEK (wraps the same vault key)
 *
 * The server never receives the password, the KEKs or the vault key, so it cannot read projects.
 */

export const PBKDF2_ITERATIONS = 600_000; // OWASP Password Storage Cheat Sheet, PBKDF2-HMAC-SHA256
const VERSION_SALT = "estrella:v1:";
const enc = new TextEncoder();
/** Bytes backed by a plain ArrayBuffer, which is what Web Crypto accepts. */
type Bytes = Uint8Array<ArrayBuffer>;

export interface KeyBundle {
  kdfSalt: string;
  wrappedKeyPassword: string;
  wrappedKeyRecovery: string;
}

export interface Registration {
  authKey: string;
  keyBundle: KeyBundle;
  recoveryCode: string;
  vaultKey: CryptoKey;
}

export function toBase64(bytes: Bytes): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(value: string): Bytes {
  const s = atob(value);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function random(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function hkdf(secret: Bytes, salt: Bytes, info: string, usage: "bits" | "aes"): Promise<CryptoKey | Bytes> {
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits", "deriveKey"]);
  const params = { name: "HKDF", hash: "SHA-256", salt, info: enc.encode(info) };
  if (usage === "bits") return new Uint8Array(await crypto.subtle.deriveBits(params, base, 256));
  return crypto.subtle.deriveKey(params, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function masterSecret(email: string, password: string, iterations = PBKDF2_ITERATIONS): Promise<Bytes> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const salt = enc.encode(VERSION_SALT + normalizeEmail(email));
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, 256));
}

export async function authKeyFrom(master: Bytes): Promise<string> {
  return toBase64((await hkdf(master, new Uint8Array(0), "estrella-auth", "bits")) as Bytes);
}

async function kekFromMaster(master: Bytes, kdfSalt: Bytes): Promise<CryptoKey> {
  return (await hkdf(master, kdfSalt, "estrella-kek", "aes")) as CryptoKey;
}

async function kekFromRecovery(code: string, kdfSalt: Bytes): Promise<CryptoKey> {
  return (await hkdf(decodeRecoveryCode(code), kdfSalt, "estrella-recovery", "aes")) as CryptoKey;
}

/** iv (12 bytes) followed by AES-GCM ciphertext and tag: 60 bytes for a 32-byte key. */
async function wrap(vaultKey: CryptoKey, kek: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", vaultKey));
  const iv = random(12);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, raw));
  raw.fill(0);
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return toBase64(out);
}

async function unwrap(wrapped: string, kek: CryptoKey): Promise<CryptoKey> {
  const bytes = fromBase64(wrapped);
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, kek, bytes.slice(12));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 128 random bits as 26 Crockford base32 characters, grouped for reading aloud or writing down. */
export function newRecoveryCode(): string {
  const bytes = random(16);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

export function decodeRecoveryCode(code: string): Bytes {
  const clean = code.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (clean.length !== 26) throw new Error("El código de recuperación debe tener 26 caracteres");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = CROCKFORD.indexOf(ch);
    if (idx < 0) throw new Error("El código de recuperación tiene caracteres no válidos");
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out.slice(0, 16));
}

/** Everything a new account needs. Runs locally; only authKey and keyBundle are sent. */
export async function prepareRegistration(email: string, password: string, iterations = PBKDF2_ITERATIONS): Promise<Registration> {
  const master = await masterSecret(email, password, iterations);
  const kdfSalt = random(16);
  const vaultKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const recoveryCode = newRecoveryCode();
  const keyBundle: KeyBundle = {
    kdfSalt: toBase64(kdfSalt),
    wrappedKeyPassword: await wrap(vaultKey, await kekFromMaster(master, kdfSalt)),
    wrappedKeyRecovery: await wrap(vaultKey, await kekFromRecovery(recoveryCode, kdfSalt)),
  };
  const authKey = await authKeyFrom(master);
  master.fill(0);
  return { authKey, keyBundle, recoveryCode, vaultKey };
}

export async function unlockWithPassword(master: Bytes, kdfSalt: string, wrappedKeyPassword: string): Promise<CryptoKey> {
  return unwrap(wrappedKeyPassword, await kekFromMaster(master, fromBase64(kdfSalt)));
}

export async function unlockWithRecovery(code: string, kdfSalt: string, wrappedKeyRecovery: string): Promise<CryptoKey> {
  return unwrap(wrappedKeyRecovery, await kekFromRecovery(code, fromBase64(kdfSalt)));
}

/**
 * New password after a reset. With the vault key (recovered with the code) projects stay readable;
 * without it a fresh vault key is created and old synced projects become unreadable.
 */
export async function rekey(email: string, newPassword: string, vaultKey: CryptoKey | null, iterations = PBKDF2_ITERATIONS) {
  const master = await masterSecret(email, newPassword, iterations);
  const kdfSalt = random(16);
  const key = vaultKey ?? (await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]));
  const recoveryCode = newRecoveryCode();
  const keyBundle: KeyBundle = {
    kdfSalt: toBase64(kdfSalt),
    wrappedKeyPassword: await wrap(key, await kekFromMaster(master, kdfSalt)),
    wrappedKeyRecovery: await wrap(key, await kekFromRecovery(recoveryCode, kdfSalt)),
  };
  const authKey = await authKeyFrom(master);
  master.fill(0);
  return { authKey, keyBundle, recoveryCode, vaultKey: key };
}
