import { api, ApiError, currentAccessToken, onSessionChange, refresh, setAccessToken, TokenResponse, userIdFromToken } from "./api";
import { authKeyFrom, KeyBundle, masterSecret, prepareRegistration, rekey, unlockWithPassword, unlockWithRecovery } from "./crypto";
import { safeStorage } from "./storage";
import { forgetKeys, loadKeys, rememberKeys, startSync, stopSync } from "./syncManager";
import { syncKeysFrom } from "./vault";

export interface User {
  id: string;
  email: string;
  offline: boolean;
}

export type Consent = "ACCOUNT" | "PROJECT_SYNC" | "SECURITY_EMAIL";

const LAST_USER = "estrella:last-user";

let user: User | null = null;
/**
 * Root key of the account's encryption. Only in memory: it is extractable (a password change must
 * re-wrap it). What survives a reload are the derived, non-extractable sync keys (syncManager).
 */
let vaultKey: CryptoKey | null = null;
/** Wrapped vault key from the last sign-in or refresh: lets the student unlock sync with the password. */
let wrapped: TokenResponse["keys"] | null = null;
const listeners = new Set<(u: User | null) => void>();

function setUser(next: User | null): void {
  user = next;
  if (next && !next.offline) safeStorage.set(LAST_USER, JSON.stringify({ id: next.id, email: next.email }));
  listeners.forEach((l) => l(next));
}

onSessionChange((body: TokenResponse | null) => {
  if (body) {
    wrapped = body.keys;
    setUser({ id: userIdFromToken(body.accessToken), email: body.email, offline: false });
  } else if (user && !user.offline) {
    vaultKey = null;
    wrapped = null;
    stopSync();
    setUser(null);
  }
});

/** Starts syncing on this device with the keys it kept, or asks for the password if it has none. */
async function resumeSync(userId: string): Promise<void> {
  await startSync(userId, await loadKeys(userId));
}

export function currentUser(): User | null {
  return user;
}

export function hasVaultKey(): boolean {
  return vaultKey !== null;
}

export function onUserChange(listener: (u: User | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Restores the session from the refresh cookie; offline, reopens the last account on this device. */
export async function restore(): Promise<User | null> {
  // Nobody has signed in on this device: there is no session cookie to try.
  if (!safeStorage.get(LAST_USER)) return null;
  try {
    if (await refresh()) {
      if (user) void resumeSync(user.id);
      return user;
    }
    return null;
  } catch (e) {
    if (e instanceof ApiError && e.code === "NETWORK") {
      const last = safeStorage.get(LAST_USER);
      if (last) {
        try {
          const parsed = JSON.parse(last) as { id: string; email: string };
          setUser({ id: parsed.id, email: parsed.email, offline: true });
          void resumeSync(parsed.id);
          return user;
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

export async function register(email: string, password: string, consents: Consent[]): Promise<string> {
  const reg = await prepareRegistration(email, password);
  await api("/auth/register", {
    method: "POST",
    body: { email, authKey: reg.authKey, keyBundle: reg.keyBundle, ageConfirmed: true, consents },
  });
  return reg.recoveryCode;
}

export async function login(email: string, password: string): Promise<User> {
  const master = await masterSecret(email, password);
  try {
    const body = await api<TokenResponse>("/auth/login", { method: "POST", body: { email, authKey: await authKeyFrom(master) } });
    setAccessToken(body.accessToken);
    vaultKey = await unlockWithPassword(master, body.keys.kdfSalt, body.keys.wrappedKeyPassword);
    wrapped = body.keys;
    const id = userIdFromToken(body.accessToken);
    setUser({ id, email: body.email, offline: false });
    const keys = await syncKeysFrom(vaultKey);
    await rememberKeys(id, keys).catch(() => undefined);
    void startSync(id, keys);
    return user!;
  } finally {
    master.fill(0);
  }
}

export async function logout(): Promise<void> {
  try {
    await api("/auth/logout", { method: "POST" });
  } catch {
    // Offline logout still clears this device.
  }
  stopSync();
  if (user) await forgetKeys(user.id);
  setAccessToken(null);
  vaultKey = null;
  wrapped = null;
  safeStorage.remove(LAST_USER);
  setUser(null);
}

export async function deleteAccount(password: string): Promise<void> {
  if (!user) throw new Error("Sin sesión");
  const master = await masterSecret(user.email, password);
  try {
    await api("/me/delete", { method: "POST", auth: true, body: { authKey: await authKeyFrom(master) } });
  } finally {
    master.fill(0);
  }
  stopSync();
  setAccessToken(null);
  vaultKey = null;
  wrapped = null;
  safeStorage.remove(LAST_USER);
  setUser(null);
}

/**
 * After a reload on a device that has no sync keys (or after clearing site data): the password
 * unwraps the vault key again, here, and sync resumes. Nothing about the password is sent.
 */
export async function unlockSync(password: string): Promise<void> {
  if (!user || !wrapped) throw new ApiError(0, "OFFLINE", "Necesitas conexión para desbloquear la sincronización.");
  const master = await masterSecret(user.email, password);
  let key: CryptoKey;
  try {
    key = await unlockWithPassword(master, wrapped.kdfSalt, wrapped.wrappedKeyPassword);
  } catch {
    throw new ApiError(400, "BAD_PASSWORD", "La contraseña no coincide.");
  } finally {
    master.fill(0);
  }
  vaultKey = key;
  const keys = await syncKeysFrom(key);
  await rememberKeys(user.id, keys);
  await startSync(user.id, keys);
}

/** Password reset: with the recovery code the projects stay readable; without it they are discarded. */
export async function completeReset(token: string, email: string, newPassword: string, recoveryCode: string | null): Promise<string> {
  let key: CryptoKey | null = null;
  if (recoveryCode) {
    const bundle = await api<{ kdfSalt: string; wrappedKeyRecovery: string }>("/auth/password-reset/bundle", { method: "POST", body: { token } });
    try {
      key = await unlockWithRecovery(recoveryCode, bundle.kdfSalt, bundle.wrappedKeyRecovery);
    } catch {
      throw new ApiError(400, "BAD_RECOVERY_CODE", "El código de recuperación no coincide");
    }
  }
  const next = await rekey(email, newPassword, key);
  const keyBundle: KeyBundle = next.keyBundle;
  await api("/auth/password-reset/confirm", {
    method: "POST",
    body: { token, authKey: next.authKey, keyBundle, discardEncryptedData: key === null },
  });
  return next.recoveryCode;
}

export function isSignedIn(): boolean {
  return currentAccessToken() !== null || user?.offline === true;
}
