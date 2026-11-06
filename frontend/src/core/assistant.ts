import { api } from "./api";
import type { Program } from "./catalog";
import { challengeFor, createState, createVerifier } from "./pkce";
import { safeSession, type SafeStore } from "./storage";

/**
 * The assistant, with the student's own OpenRouter account. The browser starts the PKCE flow and
 * hands the code and verifier to the ESTRELLA server, which exchanges them and keeps the key: the
 * key never reaches this page. What is sent is built here, shown whole, and sent unchanged.
 */

export interface AssistantStatus {
  connected: boolean;
  connectedAt: string | null;
  lastUsedAt: string | null;
  authUrl: string;
  models: string[];
  maxMessageChars: number;
  /** Fixed instructions that go with every question; shown to the student. */
  instructions: string;
}

export interface Answer {
  text: string;
  model: string;
  truncated: boolean;
}

export const assistantStatus = () => api<AssistantStatus>("/ai/status", { auth: true });

export const ask = (message: string, allowProviderStorage: boolean) =>
  api<Answer>("/ai/chat", { method: "POST", auth: true, body: { message, allowProviderStorage } });

export const disconnect = () => api<{ keySettingsUrl: string | null }>("/ai/connection", { method: "DELETE", auth: true });

const PENDING = "estrella:ai-pending";
const RESULT = "estrella:ai-result";
/** OpenRouter's code expires after 10 minutes; a pending start is useless after that. */
export const PENDING_TTL_MS = 10 * 60_000;
const RETURN_TO = /^#\/[a-z0-9/-]*$/;
const CODE = /^[A-Za-z0-9._~-]{8,512}$/;

interface Pending {
  verifier: string;
  state: string;
  createdAt: number;
  returnTo: string;
}

export interface ConnectionResult {
  ok: boolean;
  message: string;
}

/** Where the browser goes: only HTTPS, or plain HTTP on this computer for local development. */
export function safeAuthUrl(raw: string): URL {
  const url = new URL(raw);
  const local = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new Error("La dirección de autorización no es segura");
  return url;
}

/**
 * PKCE step 1. The student already declared being 18 or older. Returns the address to open;
 * the callback is this site's root with nothing else, so OpenRouter can add `code` and `state`.
 */
export async function startConnection(status: AssistantStatus, returnTo: string, origin: string,
                                      store: SafeStore = safeSession, now = Date.now()): Promise<string> {
  const verifier = createVerifier();
  const pending: Pending = { verifier, state: createState(), createdAt: now, returnTo: RETURN_TO.test(returnTo) ? returnTo : "#/cuenta" };
  if (!store.set(PENDING, JSON.stringify(pending))) {
    throw new Error("Este navegador no deja guardar datos de la pestaña, y sin eso no se puede completar la conexión.");
  }
  const url = safeAuthUrl(status.authUrl);
  url.searchParams.set("callback_url", `${origin}/`);
  url.searchParams.set("code_challenge", await challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", pending.state);
  url.searchParams.set("key_label", "ESTRELLA");
  return url.toString();
}

export type Callback =
  | { kind: "none" }
  | { kind: "invalid"; message: string }
  | { kind: "ready"; code: string; verifier: string; returnTo: string };

/** Reads what OpenRouter added to the callback address, checked against the start made in this tab. */
export function parseCallback(search: string, pendingRaw: string | null, now = Date.now()): Callback {
  const params = new URLSearchParams(search);
  const code = params.get("code");
  const state = params.get("state");
  if (code === null && state === null && !params.has("error")) return { kind: "none" };
  let pending: Pending | null = null;
  try {
    pending = pendingRaw ? (JSON.parse(pendingRaw) as Pending) : null;
  } catch {
    pending = null;
  }
  if (!pending || typeof pending.verifier !== "string" || typeof pending.state !== "string") {
    return { kind: "invalid", message: "Esta respuesta de OpenRouter no corresponde a una conexión iniciada en esta pestaña. No se usó." };
  }
  if (params.has("error") || code === null) {
    return { kind: "invalid", message: "No se autorizó la conexión en OpenRouter. Puedes intentarlo de nuevo cuando quieras." };
  }
  if (now - pending.createdAt > PENDING_TTL_MS) {
    return { kind: "invalid", message: "La autorización tardó más de 10 minutos y venció. Conecta de nuevo." };
  }
  if (state !== pending.state) {
    return { kind: "invalid", message: "La respuesta de OpenRouter no coincide con la conexión iniciada aquí. Por seguridad no se usó." };
  }
  if (!CODE.test(code)) return { kind: "invalid", message: "OpenRouter devolvió un código que no es válido. Conecta de nuevo." };
  return { kind: "ready", code, verifier: pending.verifier, returnTo: RETURN_TO.test(pending.returnTo) ? pending.returnTo : "#/cuenta" };
}

/**
 * Runs once when the app starts. If OpenRouter just sent the student back, removes the code from
 * the address bar and the history, hands it to the server and leaves the outcome for the page.
 * Returns whether this load was such a callback.
 */
export async function finishConnection(signedIn: boolean, store: SafeStore = safeSession,
                                       connect: (code: string, verifier: string) => Promise<unknown> = connectWithCode): Promise<boolean> {
  const parsed = parseCallback(location.search, store.get(PENDING));
  if (parsed.kind === "none") return false;
  history.replaceState(null, "", location.pathname + (parsed.kind === "ready" ? parsed.returnTo : "#/cuenta"));
  store.remove(PENDING);
  let result: ConnectionResult;
  if (parsed.kind === "invalid") {
    result = { ok: false, message: parsed.message };
  } else if (!signedIn) {
    result = { ok: false, message: "Tu sesión se cerró mientras autorizabas. Inicia sesión y conecta de nuevo." };
  } else {
    try {
      await connect(parsed.code, parsed.verifier);
      result = { ok: true, message: "Asistente conectado. Ábrelo con el botón «Ayuda» dentro de cualquier programa." };
    } catch (e) {
      result = { ok: false, message: e instanceof Error ? e.message : "No se pudo conectar el asistente" };
    }
  }
  store.set(RESULT, JSON.stringify(result));
  return true;
}

function connectWithCode(code: string, codeVerifier: string): Promise<AssistantStatus> {
  return api<AssistantStatus>("/ai/connection", { method: "PUT", auth: true, body: { code, codeVerifier, adult: true } });
}

/** The outcome of the last connection, shown once. */
export function takeConnectionResult(store: SafeStore = safeSession): ConnectionResult | null {
  const raw = store.get(RESULT);
  store.remove(RESULT);
  try {
    const r = raw ? (JSON.parse(raw) as ConnectionResult) : null;
    return r && typeof r.message === "string" ? { ok: r.ok === true, message: r.message } : null;
  } catch {
    return null;
  }
}

export interface Draft {
  program: Pick<Program, "name" | "summary">;
  question: string;
  /** Null when the student did not choose to include the project. */
  project: { title: string; excerpt: string } | null;
}

/** Exactly the text that leaves ESTRELLA after the fixed instructions; the preview shows this. */
export function composeMessage(d: Draft): string {
  const lines = [`Programa de ESTRELLA: ${d.program.name}. ${d.program.summary}`, "", `Pregunta: ${d.question.trim()}`];
  if (d.project && d.project.excerpt.trim()) {
    lines.push("", `Datos de mi proyecto «${d.project.title.trim() || "Sin título"}»:`, d.project.excerpt.trim());
  }
  return lines.join("\n");
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

const KIND_NAMES: Record<string, [string, string]> = {
  line: ["línea", "líneas"], polyline: ["polilínea", "polilíneas"], circle: ["círculo", "círculos"], arc: ["arco", "arcos"],
  text: ["texto", "textos"], dim: ["cota", "cotas"], hatch: ["sombreado", "sombreados"], insert: ["bloque insertado", "bloques insertados"],
};

/**
 * What a program can share about the project, as plain text the student can still edit. Only
 * programs whose data is text or a drawing share anything; for the rest, the student describes it.
 */
export function projectExcerpt(programId: string, data: string | null, max: number): string | null {
  if (!data) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  if (!o || typeof o !== "object") return null;
  switch (programId) {
    case "apuntes":
      return typeof o.body === "string" && o.body.trim() ? clip(o.body.trim(), max) : null;
    case "plano": {
      const entities = Array.isArray(o.entities) ? (o.entities as { kind?: unknown; text?: unknown }[]) : [];
      const layers = Array.isArray(o.layers) ? (o.layers as { name?: unknown }[]).map((l) => String(l?.name ?? "")).filter(Boolean) : [];
      const counts = new Map<string, number>();
      for (const e of entities) if (typeof e?.kind === "string" && e.kind in KIND_NAMES) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
      const texts = entities.filter((e) => e?.kind === "text" && typeof e.text === "string").map((e) => `«${e.text as string}»`);
      const blocks = o.blocks && typeof o.blocks === "object" ? Object.keys(o.blocks as object) : [];
      const parts = [
        `Unidades: milímetros.`,
        `Capas: ${layers.join(", ") || "ninguna"}.`,
        `Elementos: ${[...counts].map(([k, n]) => `${n} ${KIND_NAMES[k][n === 1 ? 0 : 1]}`).join(", ") || "ninguno"}.`,
      ];
      if (blocks.length) parts.push(`Bloques definidos: ${blocks.join(", ")}.`);
      if (texts.length) parts.push(`Textos: ${texts.join(", ")}.`);
      return clip(parts.join("\n"), max);
    }
    case "visor":
      return typeof o.name === "string" && o.name ? clip(`Archivo abierto: ${o.name}`, max) : null;
    default:
      return null;
  }
}
