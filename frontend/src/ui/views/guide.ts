import { desktopBridge, installOfficialProgram, type InstallOutcome } from "../../core/desktop";
import { guide, paidPrograms, resolveTool, search, type Area, type Card } from "../../core/guide";
import { isSignedIn } from "../../core/session";
import { h } from "../dom";

const AREAS: [Area | "", string][] = [["", "Todas"], ["arquitectura", "Arquitectura"], ["diseno", "Diseño gráfico"]];

/** Public page: it needs no account, so a student can check it before signing up. */
export function guideView(query: URLSearchParams): HTMLElement {
  const text = h("input", {
    id: "guide-q", type: "search", autocomplete: "off", maxlength: 80,
    placeholder: "Ej.: recortar, capas, muros, PDF", value: query.get("q") ?? "",
  });
  const area = h("select", { id: "guide-area" }, ...AREAS.map(([value, label]) => h("option", { value }, label)));
  area.value = AREAS.some(([v]) => v === query.get("area")) ? query.get("area")! : "";
  const from = h("select", { id: "guide-from" },
    h("option", { value: "" }, "Cualquier programa"),
    ...paidPrograms(guide.cards).map((p) => h("option", { value: p }, p)),
  );
  from.value = paidPrograms(guide.cards).includes(query.get("de") ?? "") ? query.get("de")! : "";

  const count = h("p", { id: "guide-count", class: "muted", role: "status", "aria-live": "polite" });
  const list = h("ul", { class: "guide-list", "aria-label": "Fichas" });

  const update = () => {
    const found = search(guide.cards, { text: text.value, area: area.value as Area | "", from: from.value });
    list.replaceChildren(...found.map((card) => h("li", {}, cardView(card))));
    count.textContent = found.length === 1 ? "1 ficha" : `${found.length} fichas`;
    if (!found.length) {
      list.append(h("li", { class: "card" },
        h("p", {}, "No hay fichas para esa búsqueda. Prueba con otra palabra, quita los filtros, o describe la tarea en lugar del nombre del comando (por ejemplo, «recortar» en vez de TRIM)."),
      ));
    }
    // The search lives in the address, so a teacher can share "#/guia?q=muros".
    const params = new URLSearchParams();
    if (text.value.trim()) params.set("q", text.value.trim());
    if (area.value) params.set("area", area.value);
    if (from.value) params.set("de", from.value);
    const next = `#/guia${params.size ? `?${params}` : ""}`;
    if (location.hash !== next) history.replaceState(null, "", next);
  };
  text.addEventListener("input", update);
  area.addEventListener("change", update);
  from.addEventListener("change", update);
  update();

  return h("main", { class: "guide", id: "main" },
    h("h1", {}, "Guía: cómo se hace aquí"),
    h("p", { class: "lead" }, "Busca lo que sabías hacer en un programa de pago y mira cómo se hace con programas libres: en ESTRELLA o, cuando hace falta, en uno de escritorio gratuito. Cada ficha dice de dónde sale."),
    h("form", { class: "guide-filters", role: "search", "aria-label": "Buscar en la guía", onsubmit: (e: Event) => e.preventDefault() },
      h("div", { class: "field" }, h("label", { for: "guide-q" }, "Qué quieres hacer"), text),
      h("div", { class: "field" }, h("label", { for: "guide-area" }, "Área"), area),
      h("div", { class: "field" }, h("label", { for: "guide-from" }, "Vengo de"), from),
    ),
    count,
    list,
    h("p", { class: "muted" },
      `Fuentes consultadas el ${guide.consulted}. Los nombres de programas de pago se usan solo para explicar equivalencias; pertenecen a sus dueños y ESTRELLA no tiene relación con ellos.`,
    ),
  );
}

const INSTALL_RESULT: Record<InstallOutcome, (name: string) => string> = {
  started: (name) => `Se abrió la instalación de ${name} en otra ventana. Al terminar, búscalo en el menú Inicio.`,
  cancelled: () => "No se instaló.",
  unavailable: (name) => `Este Windows no tiene winget: se abrió la página oficial de ${name}.`,
  rejected: () => "Ese programa no está en la lista de ESTRELLA.",
};

/** Only in ESTRELLA for Windows: the app confirms in its own window and installs with winget. */
function installButton(toolId: string, name: string): HTMLElement {
  const status = h("span", { class: "hint", role: "status" });
  const button = h("button", { type: "button", class: "ghost small", "data-testid": `install-${toolId}` }, "Instalar en este equipo");
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "Confirma en la ventana de ESTRELLA…";
    try {
      status.textContent = INSTALL_RESULT[await installOfficialProgram(toolId)](name);
    } catch (e) {
      status.textContent = e instanceof Error ? e.message : "No se pudo instalar";
    } finally {
      button.disabled = false;
    }
  });
  return h("span", { class: "guide-install" }, button, " ", status);
}

/** One card. Inside the program's help panel its title is one level lower than on the guide page. */
export function cardView(card: Card, heading: "h2" | "h3" = "h2"): HTMLElement {
  const tool = resolveTool(card.tool);
  const where = tool.kind === "estrella"
    ? h("p", { class: "guide-tool" },
      h("span", { class: "badge" }, "En ESTRELLA"), " ", h("strong", {}, tool.name), " ",
      tool.available ? h("a", { href: isSignedIn() ? "#/" : "#/registro" }, isSignedIn() ? "Abrir desde el panel" : "Crear cuenta para usarlo") : "(en construcción)")
    : h("p", { class: "guide-tool" },
      h("span", { class: "badge" }, "Escritorio, gratis"), " ", h("strong", {}, tool.name), " ",
      h("a", { href: tool.site, target: "_blank", rel: "noopener noreferrer" }, "Sitio oficial"),
      desktopBridge() ? installButton(tool.id, tool.name) : null);
  const source = card.source.kind === "official"
    ? h("p", { class: "guide-source" }, "Fuente: ", h("a", { href: card.source.url, target: "_blank", rel: "noopener noreferrer" }, card.source.title))
    // ESTRELLA's own programs are backed by a test in this repository that does exactly this.
    : h("p", { class: "guide-source" }, "Comprobado por una prueba automática del proyecto: ",
      h("code", {}, `${card.source.file} — «${card.source.test}»`));

  return h("article", { class: "card guide-card", "data-card": card.id, "aria-labelledby": `g-${card.id}` },
    h("p", { class: "guide-area muted" }, card.area === "arquitectura" ? "Arquitectura" : "Diseño gráfico"),
    h(heading, { id: `g-${card.id}` }, card.task),
    h("p", { class: "guide-from" }, "Antes: ", card.from.map((f) => `${f.program} (${f.term})`).join(" · ")),
    where,
    h("ol", { class: "guide-steps" }, ...card.steps.map((s) => h("li", {}, s))),
    card.limits ? h("p", { class: "guide-limits" }, h("strong", {}, "Límite: "), card.limits) : null,
    source,
  );
}
