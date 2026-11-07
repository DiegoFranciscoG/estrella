/** Thin client for the ESTRELLA API. The access token lives only in memory. */

const BASE: string = import.meta.env.VITE_API_BASE ?? "/api/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: string[] = [],
    /** Extra fields of the problem, e.g. the current version in a conflict. */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;
let onSession: ((body: TokenResponse | null) => void) | null = null;

export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  email: string;
  keys: { kdfSalt: string; wrappedKeyPassword: string };
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

/** Called after every successful refresh, or with null when the session ended. */
export function onSessionChange(listener: (body: TokenResponse | null) => void): void {
  onSession = listener;
}

interface Options {
  method?: string;
  body?: unknown;
  form?: FormData;
  /** Raw bytes, sent as application/octet-stream (encrypted sync content). */
  raw?: Uint8Array<ArrayBuffer>;
  headers?: Record<string, string>;
  auth?: boolean;
  binary?: boolean;
}

async function send(path: string, opts: Options): Promise<Response> {
  const headers: Record<string, string> = { "X-Estrella-Client": "web", ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.raw) {
    headers["Content-Type"] = "application/octet-stream";
    body = opts.raw;
  }
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (opts.auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let response: Response;
  try {
    response = await fetch(BASE + path, { method: opts.method ?? "GET", headers, body, credentials: "include", cache: "no-store" });
  } catch {
    throw new ApiError(0, "NETWORK", "No hay conexión con el servidor. Tu trabajo local sigue guardado.");
  }
  // An answer from the API itself (not a proxy's or host's error or loading page) means it is awake.
  if (!waking(response) && !(response.headers.get("Content-Type") ?? "").startsWith("text/html")) lastAnswer = Date.now();
  return response;
}

async function toError(response: Response): Promise<ApiError> {
  try {
    const p = await response.json();
    const { code, detail, fields, ...details } = p;
    return new ApiError(response.status, code ?? "ERROR", detail ?? "Ocurrió un error", fields ?? [], details);
  } catch {
    return new ApiError(response.status, "ERROR", "El servidor respondió de forma inesperada");
  }
}

/** Rotates the refresh cookie. Concurrent callers share a single attempt. */
export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      // Rotation must never be cut halfway: a lost answer would leave the old cookie, whose reuse
      // closes every session of the account (reuse detection).
      await ensureAwake(sleep);
      const response = await send("/auth/refresh", { method: "POST" });
      if (!response.ok) {
        accessToken = null;
        onSession?.(null);
        return false;
      }
      const body = (await response.json()) as TokenResponse;
      accessToken = body.accessToken;
      onSession?.(body);
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Free hosting sleeps when idle: while the server wakes up the proxy answers 502-504. */
const WAKING = new Set([502, 503, 504]);
export const WAKE_RETRIES = 6;
export const WAKE_DELAY_MS = 2500;
const WAKING_MESSAGE = "El servidor está despertando. Intenta de nuevo en unos segundos; tu trabajo local sigue guardado.";
/** The free host puts the API to sleep after 15 idle minutes; after 10 the app checks before writing. */
export const IDLE_MS = 10 * 60_000;
/** Safe to send twice (RFC 9110 §9.2.2): only these are repeated while the server wakes up. */
const IDEMPOTENT = new Set(["GET", "HEAD", "PUT", "DELETE"]);

let lastAnswer = 0;
let wakingUp: Promise<void> | null = null;

/**
 * Before a request that changes data, after a while without contact: ask the cheap, repeatable
 * /health until the API itself answers. A proxy can cut a request to a server still starting while
 * the server goes on to run it, and repeating it would then do it twice.
 */
async function ensureAwake(wait: (ms: number) => Promise<void>): Promise<void> {
  if (Date.now() - lastAnswer < IDLE_MS) return;
  wakingUp ??= (async () => {
    try {
      for (let attempt = 0; ; attempt++) {
        await send("/health", {});
        if (Date.now() - lastAnswer < IDLE_MS) return;
        if (attempt >= WAKE_RETRIES) throw new ApiError(503, "WAKING", WAKING_MESSAGE);
        await wait(WAKE_DELAY_MS);
      }
    } finally {
      wakingUp = null;
    }
  })();
  return wakingUp;
}

/**
 * A sleeping server answers through its proxy, never with the API's own problem details. A 502-504
 * that is a problem (for example, the assistant's provider is down) is a real answer: no retries.
 */
function waking(response: Response): boolean {
  return WAKING.has(response.status) && !(response.headers.get("Content-Type") ?? "").includes("application/problem+json");
}

async function sendWaiting(path: string, opts: Options, wait: (ms: number) => Promise<void>): Promise<Response> {
  const repeatable = IDEMPOTENT.has(opts.method ?? "GET");
  if (!repeatable) await ensureAwake(wait);
  let response = await send(path, opts);
  for (let i = 0; i < WAKE_RETRIES && repeatable && waking(response); i++) {
    await wait(WAKE_DELAY_MS);
    response = await send(path, opts);
  }
  if (waking(response)) throw new ApiError(response.status, "WAKING", WAKING_MESSAGE);
  return response;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The response itself, for callers that need its headers or a 304. Errors still throw ApiError. */
export async function apiResponse(path: string, opts: Options = {}, wait: (ms: number) => Promise<void> = sleep): Promise<Response> {
  let response = await sendWaiting(path, opts, wait);
  if (response.status === 401 && opts.auth) {
    if (await refresh()) response = await sendWaiting(path, opts, wait);
  }
  if (!response.ok && response.status !== 304) throw await toError(response);
  return response;
}

export async function api<T>(path: string, opts: Options = {}, wait: (ms: number) => Promise<void> = sleep): Promise<T> {
  const response = await apiResponse(path, opts, wait);
  if (response.status === 204) return undefined as T;
  if (opts.binary) return (await response.blob()) as T;
  return (await response.json()) as T;
}

export function userIdFromToken(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Token inválido");
  const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  const sub = JSON.parse(json).sub;
  if (typeof sub !== "string") throw new Error("Token inválido");
  return sub;
}

export function currentAccessToken(): string | null {
  return accessToken;
}
