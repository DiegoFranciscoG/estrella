import { Program, programs } from "../../core/catalog";
import { ACCOUNTS_ENABLED } from "../../core/config";
import { currentUser } from "../../core/session";
import { needsUpload, Project, ProjectStore } from "../../core/store";
import { onSyncStatus, requestSync, syncStatus } from "../../core/syncManager";
import { h, relativeTime } from "../dom";
import { starIcon } from "../star";
import { syncBar } from "../syncBar";

const AVAILABILITY: Record<Program["availability"], string> = {
  web: "En el navegador",
  desktop: "Para tu computadora",
  planned: "Planificado",
};

function sizeText(p: Program): string {
  if (p.sizeKb === null) return "Peso por medir";
  return p.sizeKb >= 1024 ? `${(p.sizeKb / 1024).toFixed(1)} MB` : `${p.sizeKb} KB`;
}

function card(p: Program, onNew: (p: Program) => void): HTMLElement {
  const ready = p.status === "disponible";
  return h("li", { class: `program ${ready ? "ready" : "soon"}`, "data-program": p.id },
    h("div", { class: "program-head" },
      h("h3", {}, p.name),
      h("span", { class: "badge" }, ready ? "Disponible" : p.phase),
    ),
    h("p", {}, p.summary),
    h("dl", { class: "facts" },
      h("dt", {}, "Lo que allá se llama"), h("dd", {}, p.replaces.join(", ")),
      h("dt", {}, "Dónde corre"), h("dd", {}, AVAILABILITY[p.availability]),
      h("dt", {}, "Descarga"), h("dd", {}, sizeText(p)),
      h("dt", {}, "Exigencia"), h("dd", {}, p.demand),
    ),
    h("p", { class: "muted" }, p.honestNote),
    action(p, ready, onNew),
  );
}

/** Open it; for a free desktop program, the guide (official site, and installing it from ESTRELLA for Windows). */
function action(p: Program, ready: boolean, onNew: (p: Program) => void): HTMLElement {
  if (ready) {
    return h("button", { type: "button", class: "primary", onclick: () => onNew(p), "data-testid": `new-${p.id}` }, `Nuevo en ${p.name}`);
  }
  if (p.availability === "desktop" && p.basedOn) {
    return h("a", { class: "button", href: `#/guia?q=${encodeURIComponent(p.basedOn.name)}`, "data-testid": `get-${p.id}` },
      `Cómo conseguir ${p.basedOn.name}`);
  }
  return h("button", { type: "button", disabled: true }, "Aún no disponible");
}

/** Where this project's latest version is, in words. */
function placeOf(project: Project): string {
  if (project.syncIssue === "quota") return "No cabe en tu espacio de la nube";
  if (project.syncIssue === "too-large") return "Demasiado grande para la nube";
  const state = syncStatus().state;
  if (state === "off" || state === "locked") return "Solo en este equipo";
  return typeof project.syncedVersion === "number" && !needsUpload(project) ? "En la nube" : "Cambios por subir";
}

function projectRow(project: Project, store: ProjectStore, refresh: () => void): HTMLElement {
  const program = programs.find((p) => p.id === project.programId);
  const synced = typeof project.syncedVersion === "number";
  return h("li", { class: "project", "data-project": project.id },
    h("a", { href: `#/p/${project.id}` },
      starIcon(14, false),
      h("strong", {}, project.title),
      h("span", { class: "muted" }, ` · ${program?.name ?? project.programId} · ${relativeTime(project.updatedAt)}`),
    ),
    h("span", { class: "place", "data-testid": "place" }, placeOf(project)),
    h("button", {
      type: "button",
      class: "ghost small",
      "aria-label": `Borrar ${project.title}`,
      onclick: async () => {
        const where = synced ? "de este equipo y de la nube" : "de este equipo";
        if (!window.confirm(`¿Borrar "${project.title}" ${where}? No se puede deshacer.`)) return;
        await store.remove(project.id);
        refresh();
        if (synced) requestSync(300);
      },
    }, "Borrar"),
  );
}

export function panelView(): HTMLElement {
  const user = currentUser()!;
  const projectList = h("ul", { class: "projects", "data-testid": "projects" });
  const main = h("main", { class: "panel", id: "main" },
    user.guest
      ? h("p", { class: "notice", role: "status", "data-testid": "guest-notice" },
        "Estás probando ESTRELLA sin cuenta: tu trabajo se guarda solo en este navegador. Exporta desde cada programa lo que quieras conservar.",
        ACCOUNTS_ENABLED ? h("span", {}, " ", h("a", { href: "#/registro" }, "Crear una cuenta")) : null)
      : user.offline ? h("p", { class: "notice", role: "status" }, "Sin conexión. Trabajas con lo guardado en este equipo; se sincroniza al volver la conexión.") : null,
    h("section", {},
      h("h1", {}, "Tus programas"),
      h("p", { class: "lead" }, "Cada programa dice antes de abrirse qué hace, cuánto pesa y qué no hace."),
      h("ul", { class: "grid" }),
    ),
    h("section", {},
      h("h2", {}, "Tus proyectos"),
      user.guest ? null : syncBar(),
      projectList,
    ),
  );

  void ProjectStore.open(user.id).then((store) => {
    const refresh = async () => {
      const list = await store.list();
      projectList.replaceChildren(...(list.length
        ? list.map((p) => projectRow(p, store, () => void refresh()))
        : [h("li", { class: "muted" }, "Todavía no tienes proyectos. Empieza con uno nuevo.")]));
    };
    const onNew = async (program: Program) => {
      const project = await store.create(program.id, `${program.name} sin título`);
      location.hash = `#/p/${project.id}`;
    };
    main.querySelector(".grid")!.replaceChildren(...programs.map((p) => card(p, (x) => void onNew(x))));
    void refresh();
    // After each sync pass the list may have new, updated or deleted projects.
    const stop = onSyncStatus((s) => {
      if (!projectList.isConnected && projectList.dataset.mounted) stop();
      else if (s.state !== "syncing") void refresh();
    });
    projectList.dataset.mounted = "1";
  }).catch(() => {
    projectList.replaceChildren(h("li", { class: "error" }, "Este navegador no permite guardar datos locales. Revisa que no estés en una ventana privada."));
  });
  return main;
}
