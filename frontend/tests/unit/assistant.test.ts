import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/core/api";
import {
  composeMessage, finishConnection, parseCallback, PENDING_TTL_MS, projectExcerpt, safeAuthUrl, startConnection,
  takeConnectionResult, type AssistantStatus,
} from "../../src/core/assistant";
import { base64url, challengeFor, createState, createVerifier } from "../../src/core/pkce";
import type { SafeStore } from "../../src/core/storage";

function memoryStore(): SafeStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => { data.set(k, v); return true; },
    remove: (k) => { data.delete(k); },
  };
}

const status: AssistantStatus = {
  connected: false, connectedAt: null, lastUsedAt: null, authUrl: "https://openrouter.ai/auth",
  models: ["google/gemma-4-31b-it:free", "openrouter/free"], maxMessageChars: 4000, instructions: "Reglas fijas",
};

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("PKCE (RFC 7636)", () => {
  it("matches the S256 example of appendix B", async () => {
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("builds verifiers from unreserved characters only, without bias", () => {
    const v = createVerifier();
    expect(v).toMatch(/^[A-Za-z0-9._~-]{64}$/);
    expect(createVerifier(43)).toHaveLength(43);
    expect(() => createVerifier(42)).toThrow(RangeError);
    expect(() => createVerifier(129)).toThrow(RangeError);
    // Bytes from 198 up would favour the first characters: they are skipped, not folded.
    let calls = 0;
    const biased = (n: number) => { calls++; return new Uint8Array(n).fill(calls === 1 ? 200 : 0); };
    expect(createVerifier(43, biased)).toBe("A".repeat(43));
    expect(calls).toBe(2);
  });

  it("encodes base64url without padding and makes a 256-bit state", () => {
    expect(base64url(new Uint8Array([251, 255]))).toBe("-_8");
    expect(createState()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe("starting a connection", () => {
  it("sends the challenge, never the verifier, and returns to the site's root", async () => {
    const store = memoryStore();
    const url = new URL(await startConnection(status, "#/cuenta", "https://estrella.example", store, 1000));
    const pending = JSON.parse(store.data.get("estrella:ai-pending")!);
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(url.searchParams.get("callback_url")).toBe("https://estrella.example/");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(await challengeFor(pending.verifier));
    expect(url.searchParams.get("state")).toBe(pending.state);
    expect(url.searchParams.get("key_label")).toBe("ESTRELLA");
    expect(url.toString()).not.toContain(pending.verifier);
    expect(pending).toMatchObject({ createdAt: 1000, returnTo: "#/cuenta" });
  });

  it("refuses unsafe authorization pages and storage that does not keep the verifier", async () => {
    expect(() => safeAuthUrl("http://openrouter.example/auth")).toThrow();
    expect(safeAuthUrl("http://127.0.0.1:8091/auth").host).toBe("127.0.0.1:8091");
    expect(() => safeAuthUrl("javascript:alert(1)")).toThrow();
    const full: SafeStore = { get: () => null, set: () => false, remove: () => undefined };
    await expect(startConnection(status, "#/cuenta", "https://e.example", full)).rejects.toThrow(/no deja guardar/);
    const store = memoryStore();
    await startConnection(status, "https://evil.example/", "https://e.example", store);
    expect(JSON.parse(store.data.get("estrella:ai-pending")!).returnTo).toBe("#/cuenta");
  });
});

describe("coming back from OpenRouter", () => {
  const pending = JSON.stringify({ verifier: "v".repeat(64), state: "estado-123", createdAt: 1000, returnTo: "#/cuenta" });

  it("accepts only the answer to the start made in this tab, within 10 minutes", () => {
    expect(parseCallback("", pending, 2000)).toEqual({ kind: "none" });
    expect(parseCallback("?code=abcdefgh123&state=estado-123", pending, 2000))
      .toEqual({ kind: "ready", code: "abcdefgh123", verifier: "v".repeat(64), returnTo: "#/cuenta" });
    expect(parseCallback("?code=abcdefgh123&state=otro", pending, 2000)).toMatchObject({ kind: "invalid", message: /no coincide/ });
    expect(parseCallback("?code=abcdefgh123", pending, 2000)).toMatchObject({ kind: "invalid" });
    expect(parseCallback("?code=abcdefgh123&state=estado-123", null, 2000)).toMatchObject({ kind: "invalid", message: /esta pestaña/ });
    expect(parseCallback("?code=abcdefgh123&state=estado-123", "{roto", 2000)).toMatchObject({ kind: "invalid" });
    expect(parseCallback("?code=abcdefgh123&state=estado-123", pending, 1000 + PENDING_TTL_MS + 1)).toMatchObject({ kind: "invalid", message: /10 minutos/ });
    expect(parseCallback("?error=access_denied", pending, 2000)).toMatchObject({ kind: "invalid", message: /No se autorizó/ });
    expect(parseCallback("?code=<script>&state=estado-123", pending, 2000)).toMatchObject({ kind: "invalid" });
  });

  it("removes the code from the address bar and hands it to the server", async () => {
    const store = memoryStore();
    await startConnection(status, "#/cuenta", location.origin, store);
    const { state, verifier } = JSON.parse(store.data.get("estrella:ai-pending")!);
    history.replaceState(null, "", `/?code=codigo-de-prueba&state=${state}`);
    const connect = vi.fn().mockResolvedValue({});

    expect(await finishConnection(true, store, connect)).toBe(true);
    expect(connect).toHaveBeenCalledWith("codigo-de-prueba", verifier);
    expect(location.search).toBe("");
    expect(location.hash).toBe("#/cuenta");
    expect(store.data.has("estrella:ai-pending")).toBe(false);
    expect(takeConnectionResult(store)).toMatchObject({ ok: true, message: /conectado/i });
    expect(takeConnectionResult(store)).toBeNull();
  });

  it("explains a failed exchange, a closed session, and does nothing on normal loads", async () => {
    const store = memoryStore();
    expect(await finishConnection(true, store, vi.fn())).toBe(false);

    await startConnection(status, "#/cuenta", location.origin, store);
    let { state } = JSON.parse(store.data.get("estrella:ai-pending")!);
    history.replaceState(null, "", `/?code=codigo-de-prueba&state=${state}`);
    await finishConnection(true, store, vi.fn().mockRejectedValue(new Error("OpenRouter no aceptó la autorización")));
    expect(takeConnectionResult(store)).toEqual({ ok: false, message: "OpenRouter no aceptó la autorización" });

    await startConnection(status, "#/cuenta", location.origin, store);
    ({ state } = JSON.parse(store.data.get("estrella:ai-pending")!));
    history.replaceState(null, "", `/?code=codigo-de-prueba&state=${state}`);
    const connect = vi.fn();
    await finishConnection(false, store, connect);
    expect(connect).not.toHaveBeenCalled();
    expect(takeConnectionResult(store)?.message).toMatch(/Inicia sesión/);
  });

  it("connects through the API with the 18+ declaration", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...status, connected: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = memoryStore();
    await startConnection(status, "#/cuenta", location.origin, store);
    const { state, verifier } = JSON.parse(store.data.get("estrella:ai-pending")!);
    history.replaceState(null, "", `/?code=codigo-de-prueba&state=${state}`);
    await finishConnection(true, store);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/ai/connection");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ code: "codigo-de-prueba", codeVerifier: verifier, adult: true });
  });
});

describe("what is sent", () => {
  const program = { name: "Plano", summary: "Dibujo 2D a escala." };

  it("is the program, the question and, only if chosen, the project", () => {
    expect(composeMessage({ program, question: "  ¿Cómo acoto?  ", project: null }))
      .toBe("Programa de ESTRELLA: Plano. Dibujo 2D a escala.\n\nPregunta: ¿Cómo acoto?");
    expect(composeMessage({ program, question: "¿Cómo acoto?", project: { title: "Casa", excerpt: "Capas: Muros." } }))
      .toBe("Programa de ESTRELLA: Plano. Dibujo 2D a escala.\n\nPregunta: ¿Cómo acoto?\n\nDatos de mi proyecto «Casa»:\nCapas: Muros.");
    // An emptied excerpt sends nothing about the project, not even its title.
    expect(composeMessage({ program, question: "¿Y?", project: { title: "Casa", excerpt: "   " } })).not.toContain("Casa");
    expect(composeMessage({ program, question: "¿Y?", project: { title: " ", excerpt: "x" } })).toContain("«Sin título»");
  });

  it("summarizes what each program can share, and nothing for the rest", () => {
    expect(projectExcerpt("apuntes", JSON.stringify({ v: 1, body: "  Clase 1: el orden dórico.  " }), 100)).toBe("Clase 1: el orden dórico.");
    expect(projectExcerpt("apuntes", JSON.stringify({ v: 1, body: "abcdefghij" }), 5)).toBe("abcd…");
    const drawing = {
      v: 1, units: "mm", layers: [{ name: "0" }, { name: "Muros" }], current: "0", blocks: { Puerta: { base: { x: 0, y: 0 }, entities: [] } },
      entities: [{ kind: "line" }, { kind: "line" }, { kind: "circle" }, { kind: "text", text: "Dormitorio" }, { kind: "desconocido" }],
    };
    expect(projectExcerpt("plano", JSON.stringify(drawing), 1000)).toBe(
      "Unidades: milímetros.\nCapas: 0, Muros.\nElementos: 2 líneas, 1 círculo, 1 texto.\nBloques definidos: Puerta.\nTextos: «Dormitorio».");
    expect(projectExcerpt("plano", JSON.stringify({ v: 1 }), 1000)).toContain("Elementos: ninguno.");
    expect(projectExcerpt("visor", JSON.stringify({ v: 1, name: "planta.dxf", file: "AAAA" }), 1000)).toBe("Archivo abierto: planta.dxf");
    expect(projectExcerpt("lienzo", JSON.stringify({ elements: [] }), 1000)).toBeNull();
    expect(projectExcerpt("apuntes", "no es JSON", 1000)).toBeNull();
    expect(projectExcerpt("apuntes", "", 1000)).toBeNull();
    expect(projectExcerpt("apuntes", "null", 1000)).toBeNull();
  });
});

describe("errors of the assistant's provider", () => {
  it("are answers, not a sleeping server: no retries", async () => {
    const wait = vi.fn(async () => undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "AI_NO_PROVIDER", detail: "Ningún modelo", privacyRestricted: true }), {
      status: 503, headers: { "Content-Type": "application/problem+json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api("/ai/chat", { method: "POST", body: {} }, wait)).rejects.toMatchObject({ code: "AI_NO_PROVIDER", details: { privacyRestricted: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });
});
