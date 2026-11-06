import { expect, request, test } from "@playwright/test";
import { accountEmail, openNew, signIn, sql, useAccount } from "./helpers";

/**
 * Phase 7 through the real panel, API and database, with the local OpenRouter simulator of
 * docker-compose (on another site, 127.0.0.1, as the real one would be): the guide works without
 * AI, an adult connects by PKCE without the key ever reaching the browser, the student sees exactly
 * what is sent, answers stay plain text, and disconnecting deletes the key.
 */

useAccount();
test.describe.configure({ mode: "serial" });

const SIM = process.env.E2E_OPENROUTER_SIM_URL ?? "http://127.0.0.1:8091";

interface SentChat {
  headers: Record<string, string | null>;
  body: { models: string[]; messages: { role: string; content: string }[]; provider: { data_collection: string }; tools?: unknown };
}

async function lastChat(): Promise<SentChat> {
  const ctx = await request.newContext();
  try {
    return await (await ctx.get(`${SIM}/__sim/last-chat`)).json();
  } finally {
    await ctx.dispose();
  }
}

const userId = () => sql(`SELECT id FROM user_account WHERE email = '${accountEmail()}';`);
const activeAiConsents = (id: string) =>
  sql(`SELECT count(*) FROM consent_record WHERE user_id = '${id}' AND purpose = 'AI_ASSISTANT' AND revoked_at IS NULL;`);

test("the guide helps inside a program, with no AI account at all", async ({ page }) => {
  await openNew(page, "plano");
  const toggle = page.getByTestId("help-toggle");
  await expect(toggle).toBeEnabled({ timeout: 30_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const panel = page.getByTestId("help-panel");
  await expect(panel.getByRole("heading", { name: "Ayuda" })).toBeFocused();
  const guideTab = panel.getByRole("tab", { name: "Guía (sin IA)" });
  await expect(guideTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("help-count")).toHaveText(/^\d+ fichas? de Plano$/);
  await panel.getByLabel("Buscar en la guía").fill("recortar");
  await expect(panel.locator(".guide-card", { hasText: "Recortar líneas que se pasan de una intersección" })).toBeVisible();

  // Keyboard: arrows move between the tabs; Escape closes and returns focus to the button.
  await guideTab.focus();
  await page.keyboard.press("ArrowRight");
  const aiTab = panel.getByRole("tab", { name: "Asistente IA" });
  await expect(aiTab).toBeFocused();
  await expect(aiTab).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByTestId("ai-go-connect")).toBeVisible();
  await expect(panel).toContainText("mayores de 18 años");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
});

test("an adult connects OpenRouter by PKCE and the key never reaches the browser", async ({ page }) => {
  const responses: Promise<string>[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/")) responses.push(r.text().catch(() => ""));
  });
  await signIn(page);
  await page.goto("/#/cuenta");
  const connect = page.getByTestId("ai-connect");
  await expect(connect).toBeDisabled();
  await page.getByTestId("ai-adult").check();
  await expect(connect).toBeEnabled();
  await connect.click();

  // OpenRouter's page (here the simulator, on another site) gets the challenge, never the verifier.
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:8091\/auth\?/);
  const auth = new URL(page.url());
  expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
  expect(auth.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(auth.searchParams.get("callback_url")).toBe("http://localhost:8088/");
  expect(auth.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(auth.searchParams.get("key_label")).toBe("ESTRELLA");
  expect(auth.searchParams.has("code_verifier")).toBe(false);
  await page.getByRole("button", { name: "Autorizar" }).click();

  // Back on ESTRELLA: connected, and the single-use code is gone from the address bar.
  await expect(page.getByTestId("ai-message")).toContainText("Asistente conectado", { timeout: 30_000 });
  await expect(page.getByTestId("ai-connected")).toContainText("Conectado desde");
  expect(page.url()).toBe("http://localhost:8088/#/cuenta");

  // The key: in no API response and nowhere in this browser; in the database only encrypted.
  for (const body of await Promise.all(responses)) expect(body).not.toContain("sk-or-");
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(storage).not.toContain("sk-or-");
  expect(storage).not.toContain("estrella:ai-pending");
  const id = userId();
  expect(sql(`SELECT count(*) FROM ai_connection WHERE user_id = '${id}';`)).toBe("1");
  expect(sql(`SELECT count(*) FROM ai_connection WHERE position(convert_to('sk-or-', 'UTF8') in key_ciphertext) > 0;`)).toBe("0");
  expect(activeAiConsents(id)).toBe("1");
});

test("the student sees exactly what is sent, and the answer stays plain text", async ({ page }) => {
  const { app } = await openNew(page, "apuntes");
  await app.locator("#title").fill("Taller de dibujo");
  await app.locator("#body").fill("Clase 3: cotas en planta.\nDato privado que no quiero enviar.");
  await expect(page.getByTestId("save-status")).toContainText("Guardado", { timeout: 15_000 });
  await page.getByTestId("help-toggle").click();
  await page.getByTestId("help-tab-ai").click();

  await page.getByTestId("ai-question").fill("¿Cómo pongo un título grande? [sim:html]");
  const preview = page.getByTestId("ai-preview");
  await expect(preview).toContainText("Pregunta: ¿Cómo pongo un título grande? [sim:html]");
  // The project goes only if the student chooses it, and only what is left in the box.
  await expect(preview).not.toContainText("Taller de dibujo");
  await page.getByTestId("ai-include").check();
  const excerpt = page.getByTestId("ai-excerpt");
  await expect(excerpt).toHaveValue(/Clase 3: cotas en planta\.\nDato privado/);
  await excerpt.fill("Clase 3: cotas en planta.");
  await expect(preview).toContainText("Datos de mi proyecto «Taller de dibujo»:\nClase 3: cotas en planta.");
  await expect(preview).not.toContainText("Dato privado");
  await expect(page.getByTestId("ai-destination")).toContainText("no guarda");
  const shown = await preview.textContent();
  await page.getByTestId("ai-send").click();

  const text = page.getByTestId("ai-text");
  await expect(text).toContainText("Respuesta simulada", { timeout: 30_000 });
  // OWASP LLM05: markup in an answer is shown as text, never run.
  await expect(text).toContainText('<img src=x onerror="document.body.dataset.inyectado=1">');
  await expect(page.getByTestId("ai-answer").locator("img, a")).toHaveCount(0);
  expect(await page.evaluate(() => document.body.dataset.inyectado)).toBeUndefined();

  // What reached "OpenRouter": exactly the preview, after fixed instructions, to free models and
  // providers that keep nothing, with the key only in the Authorization header.
  const sent = await lastChat();
  expect(sent.body.messages.map((m) => m.role)).toEqual(["system", "user"]);
  expect(sent.body.messages[1].content).toBe(shown);
  expect(sent.body.provider.data_collection).toBe("deny");
  expect(sent.body.models.every((m) => m.endsWith(":free") || m === "openrouter/free")).toBe(true);
  expect(sent.body.tools).toBeUndefined();
  expect(sent.headers.authorization).toBe("Bearer sk-or-…");
  expect(sent.headers["x-openrouter-title"]).toBe("ESTRELLA");
  expect(JSON.stringify(sent)).not.toContain(accountEmail());
  expect(JSON.stringify(sent)).not.toContain("Dato privado");
});

test("when no free provider keeps nothing, the student decides, for that question only", async ({ page }) => {
  await openNew(page, "apuntes");
  await page.getByTestId("help-toggle").click();
  await page.getByTestId("help-tab-ai").click();
  await page.getByTestId("ai-question").fill("¿Cómo exporto a PDF? [sim:solo-guardan]");
  const started = Date.now();
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-error")).toContainText("ningún modelo gratuito cumple", { timeout: 10_000 });
  // A provider's error is an answer, not a sleeping server: it is not retried for seconds.
  expect(Date.now() - started).toBeLessThan(5_000);
  const allow = page.getByTestId("ai-allow");
  await expect(allow).toBeFocused();
  await allow.check();
  await expect(page.getByTestId("ai-destination")).toContainText("puede guardarlo y entrenar");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-text")).toContainText("Respuesta simulada", { timeout: 30_000 });
  expect((await lastChat()).body.provider.data_collection).toBe("allow");
  await expect(allow).not.toBeChecked();
  await expect(page.getByTestId("ai-destination")).toContainText("no guarda");
});

test("disconnecting deletes the key here and points to the key at OpenRouter", async ({ page }) => {
  await signIn(page);
  await page.goto("/#/cuenta");
  await page.getByTestId("ai-disconnect").click();
  await expect(page.getByTestId("ai-message")).toContainText("ESTRELLA borró la llave");
  await expect(page.getByTestId("ai-key-link")).toHaveAttribute("href", /^http:\/\/127\.0\.0\.1:8091\/keys\/[0-9a-f]{64}$/);
  await expect(page.getByTestId("ai-connect")).toBeVisible();
  const id = userId();
  expect(sql(`SELECT count(*) FROM ai_connection WHERE user_id = '${id}';`)).toBe("0");
  expect(activeAiConsents(id)).toBe("0");
});
