import { describe, expect, it } from "vitest";
import {
  authKeyFrom, decodeRecoveryCode, fromBase64, masterSecret, newRecoveryCode, prepareRegistration, rekey,
  toBase64, unlockWithPassword, unlockWithRecovery,
} from "../../src/core/crypto";

// Fewer iterations keep the suite fast; the production value is asserted separately.
const FAST = 1000;

async function sameKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const ra = new Uint8Array(await crypto.subtle.exportKey("raw", a));
  const rb = new Uint8Array(await crypto.subtle.exportKey("raw", b));
  return toBase64(ra) === toBase64(rb);
}

describe("key derivation", () => {
  it("uses the OWASP iteration count by default", async () => {
    const { PBKDF2_ITERATIONS } = await import("../../src/core/crypto");
    expect(PBKDF2_ITERATIONS).toBe(600_000);
  });

  it("derives the same auth key for the same email regardless of case and spaces", async () => {
    const a = await authKeyFrom(await masterSecret(" Ana@Example.com ", "una frase larga", FAST));
    const b = await authKeyFrom(await masterSecret("ana@example.com", "una frase larga", FAST));
    expect(a).toBe(b);
    expect(fromBase64(a)).toHaveLength(32);
  });

  it("gives different auth keys for different passwords or emails", async () => {
    const base = await authKeyFrom(await masterSecret("ana@example.com", "una frase larga", FAST));
    expect(await authKeyFrom(await masterSecret("ana@example.com", "otra frase larga", FAST))).not.toBe(base);
    expect(await authKeyFrom(await masterSecret("eva@example.com", "una frase larga", FAST))).not.toBe(base);
  });
});

describe("registration bundle", () => {
  it("matches the sizes the server accepts", async () => {
    const reg = await prepareRegistration("ana@example.com", "una frase larga", FAST);
    expect(reg.authKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(reg.keyBundle.kdfSalt).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(fromBase64(reg.keyBundle.wrappedKeyPassword)).toHaveLength(60);
    expect(fromBase64(reg.keyBundle.wrappedKeyRecovery)).toHaveLength(60);
  });

  it("never contains the password or the raw vault key", async () => {
    const reg = await prepareRegistration("ana@example.com", "una frase larga", FAST);
    const raw = toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", reg.vaultKey)));
    const sent = JSON.stringify({ authKey: reg.authKey, keyBundle: reg.keyBundle });
    expect(sent).not.toContain("una frase larga");
    expect(sent).not.toContain(raw);
  });

  it("unlocks the same vault key with the password and with the recovery code", async () => {
    const reg = await prepareRegistration("ana@example.com", "una frase larga", FAST);
    const master = await masterSecret("ana@example.com", "una frase larga", FAST);
    const viaPassword = await unlockWithPassword(master, reg.keyBundle.kdfSalt, reg.keyBundle.wrappedKeyPassword);
    const viaCode = await unlockWithRecovery(reg.recoveryCode.toLowerCase(), reg.keyBundle.kdfSalt, reg.keyBundle.wrappedKeyRecovery);
    expect(await sameKey(viaPassword, reg.vaultKey)).toBe(true);
    expect(await sameKey(viaCode, reg.vaultKey)).toBe(true);
  });

  it("rejects a wrong password or a wrong code", async () => {
    const reg = await prepareRegistration("ana@example.com", "una frase larga", FAST);
    const wrong = await masterSecret("ana@example.com", "no es esta", FAST);
    await expect(unlockWithPassword(wrong, reg.keyBundle.kdfSalt, reg.keyBundle.wrappedKeyPassword)).rejects.toThrow();
    await expect(unlockWithRecovery(newRecoveryCode(), reg.keyBundle.kdfSalt, reg.keyBundle.wrappedKeyRecovery)).rejects.toThrow();
  });

  it("keeps the vault key across a password reset that used the recovery code", async () => {
    const reg = await prepareRegistration("ana@example.com", "una frase larga", FAST);
    const recovered = await unlockWithRecovery(reg.recoveryCode, reg.keyBundle.kdfSalt, reg.keyBundle.wrappedKeyRecovery);
    const next = await rekey("ana@example.com", "frase nueva distinta", recovered, FAST);
    const master = await masterSecret("ana@example.com", "frase nueva distinta", FAST);
    const unlocked = await unlockWithPassword(master, next.keyBundle.kdfSalt, next.keyBundle.wrappedKeyPassword);
    expect(await sameKey(unlocked, reg.vaultKey)).toBe(true);
    expect(next.recoveryCode).not.toBe(reg.recoveryCode);
  });

  it("creates a new vault key when the student has no recovery code", async () => {
    const reg = await prepareRegistration("ana@example.com", "una frase larga", FAST);
    const next = await rekey("ana@example.com", "frase nueva distinta", null, FAST);
    expect(await sameKey(next.vaultKey, reg.vaultKey)).toBe(false);
  });
});

describe("recovery code", () => {
  it("has 26 readable characters in groups of four", () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{2}$/);
    expect(decodeRecoveryCode(code)).toHaveLength(16);
  });

  it("tolerates lowercase, spaces and look-alike letters", () => {
    const code = newRecoveryCode();
    const typed = code.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l");
    expect(toBase64(decodeRecoveryCode(typed))).toBe(toBase64(decodeRecoveryCode(code)));
  });

  it("rejects codes of the wrong length or with invalid letters", () => {
    expect(() => decodeRecoveryCode("ABCD")).toThrow(/26 caracteres/);
    expect(() => decodeRecoveryCode("U".repeat(26))).toThrow(/no válidos/);
  });
});
