import { findProgram, Program } from "../../core/catalog";
import { APPS_ISOLATED, APPS_ORIGIN } from "../../core/config";
import { Heartbeat, HostMessage, MAX_SNAPSHOT, parseAppMessage } from "../../core/protocol";
import { currentUser } from "../../core/session";
import { ProjectStore } from "../../core/store";
import { markProjectClosed, markProjectOpen, requestSync } from "../../core/syncManager";
import { announce, h, relativeTime } from "../dom";
import { liteActive } from "../shell";
import { starSpinner } from "../star";
import { effectiveTheme, onThemeChange } from "../theme";
import { maybeShowThanks } from "./thanks";

/**
 * Runs one program inside a sandboxed frame:
 * - served from another site (APPS_ORIGIN): its own process, so a frozen program cannot freeze the
 *   panel, and no access to the panel's session, cookies or other projects;
 * - without that separate site (local development) it falls back to an opaque origin;
 * - the panel stores every snapshot the program sends, so a crash or a closed tab loses seconds, not work;
 * - a heartbeat detects a frozen program and offers to restart only that program.
 */
// allow-modals: programs ask before destructive actions; allow-popups: their help links open in a new tab.
const FRAME_SANDBOX = APPS_ISOLATED
  ? "allow-scripts allow-same-origin allow-downloads allow-forms allow-modals allow-popups"
  : "allow-scripts allow-downloads allow-modals allow-popups";
const TARGET_ORIGIN = APPS_ISOLATED ? APPS_ORIGIN : "*";
const EXPECTED_ORIGIN = APPS_ISOLATED ? APPS_ORIGIN : "null";

export function programView(projectId: string): HTMLElement {
  const user = currentUser()!;
  const status = h("span", { class: "save-status", role: "status", "data-testid": "save-status" }, "Abriendo...");
  const title = h("span", { class: "project-title" });
  const banner = h("div", { class: "banner", hidden: true, role: "status", "data-testid": "recovered" });
  const overlay = h("div", { class: "overlay", hidden: true, role: "alertdialog", "aria-modal": "false", "data-testid": "frozen" });
  const frameBox = h("div", { class: "frame-box" }, starSpinner("Cargando el programa"));
  const main = h("main", { class: "program-view", id: "main" },
    h("div", { class: "program-bar" },
      h("a", { class: "ghost", href: "#/", "data-testid": "back", onclick: (e: Event) => void leave(e) }, "Volver al panel"),
      title,
      status,
    ),
    banner,
    frameBox,
    overlay,
  );

  let store: ProjectStore | null = null;
  let frame: HTMLIFrameElement | null = null;
  /** The program's window, kept so its last messages still count after the frame leaves the page. */
  let programWindow: Window | null = null;
  /** Saves happen in order; a flush is confirmed only after the saves before it finished. */
  let saving: Promise<void> = Promise.resolve();
  let flushed: (() => void) | null = null;
  let lastSaved = 0;
  let program: Program | undefined;
  let statusTimer = 0;
  let unsubscribeTheme: (() => void) | null = null;
  let closed = false;

  const post = (msg: HostMessage) => frame?.contentWindow?.postMessage(msg, TARGET_ORIGIN);
  const heartbeat = new Heartbeat(post, (silent) => showFrozen(silent), undefined, liteActive() ? 3000 : 2000);

  const showStatus = () => {
    status.textContent = lastSaved ? `Guardado ${relativeTime(lastSaved)} en este equipo` : "Sin cambios todavía";
  };

  const onMessage = async (event: MessageEvent) => {
    if (!programWindow || event.source !== programWindow || event.origin !== EXPECTED_ORIGIN) return;
    const msg = parseAppMessage(event.data);
    const raw = event.data as { type?: unknown; data?: unknown } | null;
    if (!msg && raw?.type === "estrella:snapshot" && typeof raw.data === "string" && raw.data.length > MAX_SNAPSHOT) {
      // Never drop a save silently: the student must know this version is not stored.
      heartbeat.pong();
      status.textContent = "Este proyecto es demasiado grande para guardarse en el navegador. Exporta o descarga tu trabajo ahora.";
      announce(status.textContent);
      return;
    }
    if (!msg || !store) return;
    switch (msg.type) {
      case "estrella:ready": {
        const project = await store.get(projectId);
        if (!project) return;
        post({ type: "estrella:init", projectId, title: project.title, data: project.data, theme: effectiveTheme(), lite: liteActive() });
        heartbeat.start();
        main.dataset.programState = "running";
        break;
      }
      case "estrella:pong":
        heartbeat.pong();
        overlay.hidden = true;
        break;
      case "estrella:busy":
        heartbeat.busy(msg.busy);
        break;
      case "estrella:snapshot": {
        heartbeat.pong();
        const s = store;
        saving = saving.then(() => s.saveSnapshot(projectId, msg.data, msg.title)).catch(() => undefined);
        await saving;
        requestSync();
        lastSaved = Date.now();
        if (msg.title) title.textContent = msg.title;
        showStatus();
        break;
      }
      case "estrella:flushed":
        void saving.then(() => flushed?.());
        break;
    }
  };

  const mountFrame = () => {
    if (!program?.appPath) return;
    frame?.remove();
    frame = h("iframe", {
      src: APPS_ORIGIN + program.appPath,
      title: `${program.name}: ${title.textContent ?? ""}`,
      sandbox: FRAME_SANDBOX,
      referrerpolicy: "no-referrer",
      allow: "",
      "data-testid": "program-frame",
    });
    frameBox.replaceChildren(frame);
    programWindow = frame.contentWindow;
  };

  /** Asks the program for its unsaved state and waits until it is stored here (at most 1.5 s). */
  const flush = () => new Promise<void>((resolve) => {
    if (!programWindow) return resolve();
    const timeout = window.setTimeout(done, 1500);
    function done() {
      window.clearTimeout(timeout);
      flushed = null;
      resolve();
    }
    flushed = done;
    post({ type: "estrella:flush" });
  });

  /** Leaving with the panel's own button: the last keystrokes are saved before the frame goes away. */
  const leave = async (e: Event) => {
    if (closed) return;
    e.preventDefault();
    status.textContent = "Guardando…";
    await flush();
    location.hash = "#/";
  };

  const showFrozen = (silentMs: number) => {
    main.dataset.programState = "frozen";
    overlay.replaceChildren(
      h("h2", {}, "El programa no responde"),
      h("p", {}, `No contesta desde hace ${Math.round(silentMs / 1000)} segundos. El panel y tus otros proyectos siguen bien.`),
      h("p", {}, lastSaved ? `Tu trabajo está guardado ${relativeTime(lastSaved)}.` : "Todavía no había cambios que guardar."),
      h("div", { class: "row" },
        h("button", { type: "button", class: "ghost", onclick: () => { overlay.hidden = true; heartbeat.pong(); } }, "Esperar"),
        h("button", { type: "button", class: "primary", "data-testid": "restart", onclick: () => { overlay.hidden = true; heartbeat.stop(); main.dataset.programState = "restarting"; mountFrame(); } }, "Reiniciar el programa"),
      ),
    );
    overlay.hidden = false;
    // The program cannot take input anyway: move focus to the way out (alertdialog pattern).
    overlay.querySelector<HTMLButtonElement>('[data-testid="restart"]')?.focus();
    announce("El programa no responde");
  };

  const close = () => {
    if (closed) return;
    closed = true;
    heartbeat.stop();
    // Keep listening a moment: a program removed by other navigation still sends its last save.
    window.setTimeout(() => window.removeEventListener("message", onMessage), 2000);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("hashchange", onLeave);
    window.clearInterval(statusTimer);
    unsubscribeTheme?.();
    // Ask the program to send its latest state, then mark the project as cleanly closed.
    post({ type: "estrella:flush" });
    const s = store;
    window.setTimeout(() => {
      void s?.markClosed(projectId).then(() => markProjectClosed(projectId));
    }, 300);
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
      markProjectOpen(projectId);
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
