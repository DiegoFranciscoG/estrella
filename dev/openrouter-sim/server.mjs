// Local stand-in for OpenRouter, for development and end-to-end tests only. It is NOT OpenRouter
// and talks to no one: it follows the documented OAuth PKCE flow and chat completions, keeps
// everything in memory, and only sends students back to addresses on this computer.
// Docs followed: https://openrouter.ai/docs/guides/overview/auth/oauth

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8091);
const CODE_TTL_MS = 10 * 60_000;
const FREE = /^(openrouter\/free|[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*:free)$/;

/** code -> { challenge, createdAt } */
const codes = new Map();
const keys = new Set();
let lastChat = null;

const s256 = (verifier) => createHash("sha256").update(verifier, "ascii").digest("base64url");
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

const fail = (res, status, message, headers) => send(res, status, { error: { code: status, message } }, headers);

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The simulator only redirects to this computer, so it cannot be used to send anyone elsewhere. */
function localUrl(raw) {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

function page(res, status, title, body) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    // form-action also covers the redirect that follows the form, so it lists where students return.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' http://localhost:* http://127.0.0.1:* https://localhost:*; frame-ancestors 'none'; base-uri 'none'",
    "Cache-Control": "no-store",
  });
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px}
.warn{border:2px dashed #111;padding:10px 14px}button{font:inherit;min-height:44px;padding:8px 16px;margin:4px 8px 4px 0}</style></head>
<body>${body}</body></html>`);
}

function authorizePage(res, params) {
  const callback = localUrl(params.get("callback_url") ?? "");
  const challenge = params.get("code_challenge") ?? "";
  if (!callback) return page(res, 400, "Dirección de vuelta no permitida", "<p>El simulador solo devuelve a direcciones de este equipo.</p>");
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
    return page(res, 400, "Falta PKCE", "<p>Se necesita <code>code_challenge</code> con el método S256.</p>");
  }
  const hidden = ["callback_url", "code_challenge", "code_challenge_method", "state"]
    .map((name) => `<input type="hidden" name="${name}" value="${escape(params.get(name) ?? "")}">`).join("");
  page(res, 200, "Autorizar (simulado)", `
<p class="warn"><strong>Simulador local de OpenRouter.</strong> No es el servicio real: sirve para desarrollar y probar ESTRELLA sin cuentas ni llaves de verdad.</p>
<h1>¿Autorizar a «${escape(params.get("key_label") ?? "una app")}»?</h1>
<p>Se creará una llave simulada y volverás a <code>${escape(callback.origin)}</code>.</p>
<form method="post" action="/auth/approve">${hidden}<button type="submit">Autorizar</button></form>
<form method="post" action="/auth/deny">${hidden}<button type="submit">Cancelar</button></form>`);
}

async function decide(req, res, approve) {
  const form = new URLSearchParams(await readBody(req, 10_000));
  const callback = localUrl(form.get("callback_url") ?? "");
  if (!callback) return page(res, 400, "Dirección de vuelta no permitida", "<p>El simulador solo devuelve a direcciones de este equipo.</p>");
  if (approve) {
    const code = `sim-${randomBytes(24).toString("base64url")}`;
    codes.set(code, { challenge: form.get("code_challenge") ?? "", createdAt: Date.now() });
    callback.searchParams.set("code", code);
    if (form.get("state")) callback.searchParams.set("state", form.get("state"));
  } else {
    // As documented, no state when access is denied.
    callback.searchParams.set("error", "access_denied");
  }
  res.writeHead(302, { Location: callback.toString(), "Cache-Control": "no-store" });
  res.end();
}

async function exchange(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return fail(res, 400, "Invalid JSON");
  }
  if (body.code_challenge_method !== "S256") return fail(res, 400, "Invalid code_challenge_method");
  const entry = codes.get(body.code);
  codes.delete(body.code); // single use
  if (!entry || typeof body.code_verifier !== "string" || s256(body.code_verifier) !== entry.challenge) {
    return fail(res, 403, "Invalid code or code_verifier");
  }
  if (Date.now() - entry.createdAt > CODE_TTL_MS) return fail(res, 403, "Authorization code expired");
  const key = `sk-or-v1-sim-${randomBytes(24).toString("hex")}`;
  keys.add(key);
  send(res, 200, { key, user_id: "user_sim" });
}

async function chat(req, res) {
  const auth = req.headers.authorization ?? "";
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return fail(res, 400, "Invalid JSON");
  }
  lastChat = {
    headers: {
      authorization: auth.startsWith("Bearer sk-or-") ? "Bearer sk-or-…" : auth ? "otro" : null,
      "http-referer": req.headers["http-referer"] ?? null,
      "x-openrouter-title": req.headers["x-openrouter-title"] ?? null,
    },
    body,
  };
  if (!auth.startsWith("Bearer ") || !keys.has(auth.slice(7))) return fail(res, 401, "User not found.");
  const models = Array.isArray(body.models) ? body.models : [body.model];
  if (!models.length || !models.every((m) => FREE.test(String(m)))) return fail(res, 400, "Only free models in this simulator");
  const question = String(body.messages?.at(-1)?.content ?? "");
  const deny = body.provider?.data_collection === "deny";
  // Tags in the question choose a documented case, so tests can reach each one.
  if (question.includes("[sim:solo-guardan]") && deny) return fail(res, 503, "No endpoints found matching your data policy");
  if (question.includes("[sim:limite]")) return fail(res, 429, "Rate limit exceeded: free-models-per-day", { "Retry-After": "60" });
  const html = question.includes("[sim:html]") ? '\nPrueba: <img src=x onerror="document.body.dataset.inyectado=1"> <a href="https://example.com">enlace</a>' : "";
  send(res, 200, {
    id: `gen-sim-${randomBytes(6).toString("hex")}`,
    model: models[0],
    choices: [{
      index: 0,
      finish_reason: "stop",
      message: { role: "assistant", content: `Respuesta simulada (no es un modelo real).\n1. Revisa la Guía de este programa.\n2. Tu mensaje tenía ${question.length} caracteres.${html}` },
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0 },
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/auth") return authorizePage(res, url.searchParams);
    if (req.method === "POST" && url.pathname === "/auth/approve") return await decide(req, res, true);
    if (req.method === "POST" && url.pathname === "/auth/deny") return await decide(req, res, false);
    if (url.pathname === "/api/v1/auth/keys") return req.method === "POST" ? await exchange(req, res) : fail(res, 405, "Method Not Allowed");
    if (req.method === "POST" && url.pathname === "/api/v1/chat/completions") return await chat(req, res);
    if (req.method === "GET" && /^\/keys\/[0-9a-f]{64}$/.test(url.pathname)) {
      return page(res, 200, "Llave simulada", "<p class=\"warn\">Simulador local: aquí OpenRouter muestra la llave y permite borrarla.</p>");
    }
    // For end-to-end tests: the last request exactly as it arrived, without the key.
    if (req.method === "GET" && url.pathname === "/__sim/last-chat") return send(res, 200, lastChat ?? {});
    fail(res, 404, "Not found");
  } catch {
    fail(res, 400, "Bad request");
  }
}).listen(PORT, "0.0.0.0", () => console.log(`OpenRouter simulator on port ${PORT} (local development only)`));
