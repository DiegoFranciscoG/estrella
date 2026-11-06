import { findProgram, Program } from "../../core/catalog";
import { Heartbeat, HostMessage, parseAppMessage } from "../../core/protocol";
import { currentUser } from "../../core/session";
import { ProjectStore } from "../../core/store";
import { announce, h, relativeTime } from "../dom";
import { liteActive } from "../shell";
import { starSpinner } from "../star";
import { effectiveTheme, onThemeChange } from "../theme";
import { maybeShowThanks } from "./thanks";

/**
 * Runs one program inside a sandboxed frame:
 * - opaque origin (no allow-same-origin): the program cannot read the session, cookies or other projects;
 * - the panel stores every snapshot the program sends, so a crash or a closed tab loses seconds, not work;
 * - a heartbeat detects a frozen program and offers to restart only that program.
 */
export function programView(projectId: string): HTMLElement {
  const user = currentUser()!;
  const status = h("span", { class: "save-status", role: "status", "data-testid": "save-status" }, "Abriendo...");
  const title = h("span", { class: "project-title" });
  const banner = h("div", { class: "banner", hidden: true, role: "status", "data-testid": "recovered" });
  const overlay = h("div", { class: "overlay", hidden: true, role: "alertdialog", "aria-modal": "false", "data-testid": "frozen" });
  const frameBox = h("div", { class: "frame-box" }, starSpinner("Cargando el programa"));
  const main = h("main", { class: "program-view", id: "main" },
    h("div", { class: "program-bar" },
      h("a", { class: "ghost", href: "#/", "data-testid": "back" }, "Volver al panel"),
      title,
      status,
    ),
    banner,
    frameBox,
    overlay,
  );

  let store: ProjectStore | null = null;
  let frame: HTMLIFrameElement | null = null;
  let lastSaved = 0;
  let program: Program | undefined;
  let statusTimer = 0;
  let unsubscribeTheme: (() => void) | null = null;
  let closed = false;

  const post = (msg: HostMessage) => frame?.contentWindow?.postMessage(msg, "*");
  const heartbeat = new Heartbeat(post, (silent) => showFrozen(silent), undefined, liteActive() ? 3000 : 2000);

  const showStatus = () => {
    status.textContent = lastSaved ? `Guardado ${relativeTime(lastSaved)} en este equipo` : "Sin cambios todavía";
  };

  const onMessage = async (event: MessageEvent) => {
    if (!frame || event.source !== frame.contentWindow) return;
    const msg = parseAppMessage(event.data);
    if (!msg || !store) return;
    switch (msg.type) {
      case "estrella:ready": {
        const project = await store.get(projectId);
        if (!project) return;
        post({ type: "estrella:init", projectId, title: project.title, data: project.data, theme: effectiveTheme(), lite: liteActive() });
        heartbeat.start();
        break;
      }
      case "estrella:pong":
        heartbeat.pong();
        overlay.hidden = true;
        break;
      case "estrella:busy":
        heartbeat.busy(msg.busy);
        break;
      case "estrella:snapshot":
        heartbeat.pong();
        await store.saveSnapshot(projectId, msg.data, msg.title);
        lastSaved = Date.now();
        if (msg.title) title.textContent = msg.title;
        showStatus();
        break;
    }
  };

  const mountFrame = () => {
    if (!program?.appPath) return;
    frame?.remove();
    frame = h("iframe", {
      src: program.appPath,
      title: `${program.name}: ${title.textContent ?? ""}`,
      sandbox: "allow-scripts allow-downloads",
      referrerpolicy: "no-referrer",
      allow: "",
      "data-testid": "program-frame",
    });
    frameBox.replaceChildren(frame);
  };

  const showFrozen = (silentMs: number) => {
    overlay.replaceChildren(
      h("h2", {}, "El programa no responde"),
      h("p", {}, `No contesta desde hace ${Math.round(silentMs / 1000)} segundos. El panel y tus otros proyectos siguen bien.`),
      h("p", {}, lastSaved ? `Tu trabajo está guardado ${relativeTime(lastSaved)}.` : "Todavía no había cambios que guardar."),
      h("div", { class: "row" },
        h("button", { type: "button", class: "ghost", onclick: () => { overlay.hidden = true; heartbeat.pong(); } }, "Esperar"),
        h("button", { type: "button", class: "primary", "data-testid": "restart", onclick: () => { overlay.hidden = true; heartbeat.stop(); mountFrame(); } }, "Reiniciar el programa"),
      ),
    );
    overlay.hidden = false;
    announce("El programa no responde");
  };

  const close = () => {
    if (closed) return;
    closed = true;
    heartbeat.stop();
    window.removeEventListener("message", onMessage);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("hashchange", onLeave);
    window.clearInterval(statusTimer);
    unsubscribeTheme?.();
    // Ask the program to send its latest state, then mark the project as cleanly closed.
    post({ type: "estrella:flush" });
    const s = store;
    window.setTimeout(() => { void s?.markClosed(projectId); }, 300);
  };
  const onPageHide = () => {
    // Closing the tab: flush; the "open" mark stays so the next visit can say what was recovered.
    post({ type: "estrella:flush" });
  };
  const onLeave = () => { if (!location.hash.startsWith(`#/p/${projectId}`)) close(); };

  window.addEventListener("message", onMessage);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("hashchange", onLeave);

  void (async () => {
    try {
      store = await ProjectStore.open(user.id);
      const opened = await store.open(projectId);
      program = findProgram(opened.project.programId);
      title.textContent = opened.project.title;
      lastSaved = opened.project.data ? opened.project.updatedAt : 0;
      if (!program?.appPath) {
        frameBox.replaceChildren(h("p", { class: "error" }, "Este programa todavía no está disponible."));
        return;
      }
      if (opened.recoveredFrom !== null) {
        banner.replaceChildren(
          h("strong", {}, "Recuperamos tu trabajo. "),
          `La sesión anterior se cerró de golpe; abrimos lo guardado ${relativeTime(opened.recoveredFrom)}.`,
          h("button", { type: "button", class: "ghost small", onclick: () => (banner.hidden = true) }, "Entendido"),
        );
        banner.hidden = false;
      }
      showStatus();
      statusTimer = window.setInterval(showStatus, 10000);
      unsubscribeTheme = onThemeChange((t) => post({ type: "estrella:theme", theme: t }));
      mountFrame();
      maybeShowThanks(program, main);
    } catch (e) {
      frameBox.replaceChildren(h("p", { class: "error" }, e instanceof Error ? e.message : "No se pudo abrir el proyecto"));
    }
  })();

  return main;
}
