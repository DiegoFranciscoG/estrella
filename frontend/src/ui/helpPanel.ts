import { ApiError } from "../core/api";
import { ask, assistantStatus, composeMessage, projectExcerpt, type AssistantStatus } from "../core/assistant";
import type { Program } from "../core/catalog";
import { guide, search } from "../core/guide";
import { currentUser } from "../core/session";
import { announce, append, h } from "./dom";
import { cardView } from "./views/guide";

export interface HelpOptions {
  program: Program;
  /** The project as stored right now, after the program saved its last changes. */
  snapshot: () => Promise<{ title: string; data: string | null } | null>;
  onClose: () => void;
}

/** Room left for the question and the fixed lines when the project text is included. */
const QUESTION_ROOM = 600;

/**
 * Help next to the running program. "Guía (sin IA)" works for everyone, including students under
 * 18, and needs no account anywhere. "Asistente IA" shows exactly what would be sent before
 * sending it, and shows the answer as text, never as HTML (OWASP LLM05).
 */
export function helpPanel(opts: HelpOptions): HTMLElement {
  const { program } = opts;
  const tabs = {
    guide: h("button", { type: "button", role: "tab", id: "help-tab-guide", "aria-controls": "help-panel-guide", "data-testid": "help-tab-guide" }, "Guía (sin IA)"),
    ai: h("button", { type: "button", role: "tab", id: "help-tab-ai", "aria-controls": "help-panel-ai", "data-testid": "help-tab-ai" }, "Asistente IA"),
  };
  const panels = {
    guide: h("section", { role: "tabpanel", id: "help-panel-guide", "aria-labelledby": "help-tab-guide" }),
    ai: h("section", { role: "tabpanel", id: "help-panel-ai", "aria-labelledby": "help-tab-ai" }),
  };
  let aiLoaded = false;

  const select = (which: keyof typeof tabs, focus = false) => {
    for (const key of Object.keys(tabs) as (keyof typeof tabs)[]) {
      const on = key === which;
      tabs[key].setAttribute("aria-selected", String(on));
      tabs[key].tabIndex = on ? 0 : -1;
      panels[key].hidden = !on;
    }
    if (which === "ai" && !aiLoaded) {
      aiLoaded = true;
      void renderAssistant(panels.ai, program, opts.snapshot);
    }
    if (focus) tabs[which].focus();
  };
  tabs.guide.addEventListener("click", () => select("guide"));
  tabs.ai.addEventListener("click", () => select("ai"));
  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const tablist = h("div", { class: "tabs", role: "tablist", "aria-label": "Tipo de ayuda" }, tabs.guide, tabs.ai);
  tablist.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next = e.key === "Home" ? "guide" : e.key === "End" ? "ai" : tabs.guide.getAttribute("aria-selected") === "true" ? "ai" : "guide";
    select(next, true);
  });

  renderGuide(panels.guide, program);
  select("guide");

  const panel = h("aside", { class: "help-panel", id: "help-panel", "aria-labelledby": "help-title", "data-testid": "help-panel" },
    h("div", { class: "help-head" },
      h("h2", { id: "help-title", tabindex: -1 }, "Ayuda"),
      h("button", { type: "button", class: "ghost small", "aria-label": "Cerrar la ayuda", onclick: () => opts.onClose() }, "Cerrar"),
    ),
    tablist,
    panels.guide,
    panels.ai,
  );
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") opts.onClose();
  });
  return panel;
}

function renderGuide(root: HTMLElement, program: Program): void {
  const query = h("input", { id: "help-q", type: "search", autocomplete: "off", maxlength: 80, placeholder: "Ej.: recortar, capas, cotas" });
  const count = h("p", { class: "muted", role: "status", "aria-live": "polite", "data-testid": "help-count" });
  const list = h("ul", { class: "guide-list", "aria-label": "Fichas de la guía" });
  const own = guide.cards.filter((c) => c.tool === program.id);
  const update = () => {
    const text = query.value.trim();
    const found = text ? search(guide.cards, { text }) : own;
    list.replaceChildren(...found.slice(0, 20).map((card) => h("li", {}, cardView(card, "h3"))));
    count.textContent = text
      ? `${found.length} ${found.length === 1 ? "ficha" : "fichas"} para «${text}»`
      : own.length ? `${own.length} ${own.length === 1 ? "ficha" : "fichas"} de ${program.name}` : `Todavía no hay fichas de ${program.name}. Busca por la tarea que quieres hacer.`;
  };
  query.addEventListener("input", update);
  update();
  root.append(
    h("p", { class: "hint" }, "Fichas con su fuente: el manual oficial o una prueba automática. No usan IA ni necesitan otra cuenta."),
    h("label", { for: "help-q" }, "Buscar en la guía"),
    query,
    count,
    list,
    h("p", { class: "hint" }, h("a", { href: "#/guia", target: "_blank", rel: "noopener" }, "Abrir la guía completa en otra pestaña")),
    h("p", { class: "hint" }, "Los nombres de programas de pago se usan solo para explicar equivalencias; pertenecen a sus dueños y ESTRELLA no tiene relación con ellos."),
  );
}

async function renderAssistant(root: HTMLElement, program: Program, snapshot: HelpOptions["snapshot"]): Promise<void> {
  if (currentUser()?.offline) {
    root.replaceChildren(h("p", {}, "Sin conexión con el servidor: el asistente necesita internet. La guía funciona igual."));
    return;
  }
  root.replaceChildren(h("p", { class: "muted" }, "Cargando…"));
  let status: AssistantStatus;
  try {
    status = await assistantStatus();
  } catch (e) {
    root.replaceChildren(h("p", { class: "error" }, e instanceof Error ? e.message : "No se pudo cargar el asistente"));
    return;
  }
  if (!status.connected) {
    root.replaceChildren(
      h("p", {}, `El asistente responde dudas sobre ${program.name} con modelos de IA gratuitos, usando tu propia cuenta de OpenRouter.`),
      h("ul", { class: "tips" },
        h("li", {}, "Es para mayores de 18 años: lo exigen los términos de OpenRouter. Si eres menor, usa la pestaña Guía."),
        h("li", {}, "No cuesta: ESTRELLA solo usa modelos gratuitos."),
        h("li", {}, "Antes de enviar ves exactamente qué sale de ESTRELLA."),
      ),
      h("a", { class: "button primary", href: "#/cuenta", "data-testid": "ai-go-connect" }, "Conectar en Mi cuenta"),
    );
    return;
  }
  root.replaceChildren(...askForm(status, program, snapshot));
}

function askForm(status: AssistantStatus, program: Program, snapshot: HelpOptions["snapshot"]): HTMLElement[] {
  const question = h("textarea", { id: "ai-question", rows: 3, maxlength: status.maxMessageChars, "data-testid": "ai-question" });
  const include = h("input", { type: "checkbox", id: "ai-include", "data-testid": "ai-include" });
  const excerpt = h("textarea", { id: "ai-excerpt", rows: 6, "data-testid": "ai-excerpt" });
  const excerptBox = h("div", { class: "field", hidden: true },
    h("label", { for: "ai-excerpt" }, "Datos del proyecto que se enviarán (puedes recortarlos o borrarlos)"), excerpt);
  const nothing = h("p", { class: "hint", hidden: true, "data-testid": "ai-nothing" },
    `${program.name} no comparte el contenido del proyecto con el asistente. Describe tu duda con tus palabras.`);
  const allow = h("input", { type: "checkbox", id: "ai-allow", "data-testid": "ai-allow" });
  const destination = h("p", { class: "hint", "data-testid": "ai-destination" });
  const preview = h("pre", { class: "ai-preview", tabindex: 0, "aria-label": "Lo que se enviará", "data-testid": "ai-preview" });
  const counter = h("p", { class: "hint", "data-testid": "ai-count" });
  const send = h("button", { type: "button", class: "primary", "data-testid": "ai-send" }, "Enviar");
  const answer = h("div", { class: "ai-answer", role: "status", "aria-live": "polite", "data-testid": "ai-answer" });

  let projectTitle = "";
  /** Null until the project was read; then whether this program shares anything. */
  let shareable: boolean | null = null;

  const message = () => composeMessage({
    program,
    question: question.value,
    project: include.checked && shareable ? { title: projectTitle, excerpt: excerpt.value } : null,
  });
  const update = () => {
    const text = message();
    preview.textContent = text;
    counter.textContent = `${text.length} de ${status.maxMessageChars} caracteres`;
    destination.textContent = allow.checked
      ? "Irá a OpenRouter (Estados Unidos) y a un proveedor gratuito que puede guardarlo y entrenar con ello. ESTRELLA no lo guarda."
      : "Irá a OpenRouter (Estados Unidos) y a un proveedor que no guarda lo que envías. ESTRELLA no lo guarda.";
    send.disabled = !question.value.trim() || text.length > status.maxMessageChars;
  };
  question.addEventListener("input", update);
  excerpt.addEventListener("input", update);
  allow.addEventListener("change", update);
  include.addEventListener("change", async () => {
    if (include.checked && shareable === null) {
      const snap = await snapshot();
      projectTitle = snap?.title ?? "";
      const text = projectExcerpt(program.id, snap?.data ?? null, Math.max(0, status.maxMessageChars - QUESTION_ROOM));
      shareable = text !== null;
      excerpt.value = text ?? "";
    }
    excerptBox.hidden = !(include.checked && shareable);
    nothing.hidden = !(include.checked && shareable === false);
    update();
  });

  send.addEventListener("click", async () => {
    const text = message();
    const allowed = allow.checked;
    send.disabled = true;
    answer.replaceChildren(h("p", { class: "muted" }, "Pensando… Los modelos gratuitos pueden tardar hasta un minuto."));
    try {
      const r = await ask(text, allowed);
      // Text node only: whatever the model writes, it cannot become markup or a live link here.
      answer.replaceChildren();
      append(answer,
        h("p", { class: "ai-text", "data-testid": "ai-text" }, r.text),
        r.truncated ? h("p", { class: "hint" }, "La respuesta se cortó por el límite de largo. Pide la parte que falta.") : null,
        h("p", { class: "hint" }, `Respondió ${r.model || "un modelo gratuito"}. Puede equivocarse: compárala con la Guía o con el manual oficial.`),
      );
      announce("Respuesta del asistente lista");
    } catch (e) {
      answer.replaceChildren(h("p", { class: "error", "data-testid": "ai-error" }, e instanceof Error ? e.message : "No se pudo enviar la pregunta"));
      if (e instanceof ApiError && (e.code === "AI_RECONNECT" || e.code === "AI_NOT_CONNECTED")) {
        answer.append(h("p", {}, h("a", { href: "#/cuenta" }, "Ir a Mi cuenta para conectar de nuevo")));
      }
      if (e instanceof ApiError && e.code === "AI_NO_PROVIDER" && e.details.privacyRestricted === true) allow.focus();
    } finally {
      // Allowing providers that keep data counts for one question only.
      allow.checked = false;
      update();
    }
  });
  update();

  return [
    h("p", { class: "hint" }, "Conectado con tu cuenta de OpenRouter. Se desconecta en ", h("a", { href: "#/cuenta" }, "Mi cuenta"), "."),
    h("div", { class: "field" }, h("label", { for: "ai-question" }, "Tu pregunta"), question),
    h("label", { class: "check" }, include, "Incluir datos de este proyecto"),
    excerptBox,
    nothing,
    h("label", { class: "check" }, allow, "Permitir, solo para esta pregunta, proveedores gratuitos que pueden guardar lo que envío y entrenar con ello"),
    h("h3", { class: "ai-heading" }, "Esto es exactamente lo que saldrá de ESTRELLA"),
    destination,
    preview,
    counter,
    h("details", {},
      h("summary", {}, "Ver las instrucciones fijas que acompañan tu pregunta"),
      h("pre", { class: "ai-preview", "data-testid": "ai-instructions" }, status.instructions),
    ),
    h("div", { class: "row" }, send),
    answer,
  ];
}
