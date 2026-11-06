/**
 * Encryption of synced projects, on the student's device (Web Crypto only).
 *
 * vault key --HKDF "content"--> content key   (AES-GCM 256, encrypts project content)
 *           --HKDF "name"   --> name key      (AES-GCM 256, encrypts project titles)
 *
 * Both derived keys are created non-extractable, so they can be kept in IndexedDB across reloads
 * without anyone (not even a script running in the page) being able to read their bytes.
 *
 * Every sealed value is nonce (12 random bytes) || ciphertext || tag. Associated data binds it to
 * its account, project and version: the server cannot swap one project's content into another, or
 * present an old version as the latest, without decryption failing. With random 96-bit nonces NIST
 * SP 800-38D §8.3 allows 2^32 encryptions per key; a student saves far fewer than that.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
type Bytes = Uint8Array<ArrayBuffer>;

export interface SyncKeys {
  content: CryptoKey;
  names: CryptoKey;
}

const HKDF_SALT = enc.encode("estrella:v1:sync");

/** Derives the sync keys from the vault key. The vault key's raw bytes are wiped right after. */
export async function syncKeysFrom(vaultKey: CryptoKey): Promise<SyncKeys> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", vaultKey));
  try {
    const base = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
    const derive = (info: string) => crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: enc.encode(info) },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    return { content: await derive("estrella:v1:content"), names: await derive("estrella:v1:name") };
  } finally {
    raw.fill(0);
  }
}

export const contentAad = (userId: string, projectId: string, version: number) => `estrella:v1:content:${userId}:${projectId}:${version}`;
export const nameAad = (userId: string, projectId: string) => `estrella:v1:name:${userId}:${projectId}`;

export async function seal(key: CryptoKey, plain: Bytes, aad: string): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, plain));
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return out;
}

/** Throws if the bytes were altered, belong to another project or version, or use another key. */
export async function unseal(key: CryptoKey, sealed: Bytes, aad: string): Promise<Bytes> {
  if (sealed.length < 12 + 16) throw new Error("Contenido cifrado incompleto");
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: sealed.slice(0, 12), additionalData: enc.encode(aad) },
    key,
    sealed.slice(12),
  ));
}

/** Plaintext format, first byte: 1 = gzip of UTF-8 JSON, 0 = UTF-8 JSON (no CompressionStream). */
const GZIP = 1;
const PLAIN = 0;

async function through(bytes: Bytes, stream: CompressionStream | DecompressionStream): Promise<Bytes> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const reader = source.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** JSON, compressed when the browser can (every major browser since 2023), with a format byte. */
export async function pack(value: unknown): Promise<Bytes> {
  const json = enc.encode(JSON.stringify(value));
  const canCompress = typeof CompressionStream === "function";
  const body = canCompress ? await through(json, new CompressionStream("gzip")) : json;
  const out = new Uint8Array(body.length + 1);
  out[0] = canCompress ? GZIP : PLAIN;
  out.set(body, 1);
  return out;
}

export async function unpack<T>(bytes: Bytes): Promise<T> {
  const body = bytes.slice(1);
  if (bytes[0] === GZIP) return JSON.parse(dec.decode(await through(body, new DecompressionStream("gzip")))) as T;
  if (bytes[0] === PLAIN) return JSON.parse(dec.decode(body)) as T;
  throw new Error("Formato de contenido desconocido");
}

export async function sealName(keys: SyncKeys, userId: string, projectId: string, title: string): Promise<Bytes> {
  return seal(keys.names, enc.encode(title.slice(0, 120)), nameAad(userId, projectId));
}

export async function openName(keys: SyncKeys, userId: string, projectId: string, sealed: Bytes): Promise<string> {
  return dec.decode(await unseal(keys.names, sealed, nameAad(userId, projectId)));
}

export async function sha256Base64(bytes: Bytes): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let s = "";
  for (const b of digest) s += String.fromCharCode(b);
  return btoa(s);
}
