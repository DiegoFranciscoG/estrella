/**
 * Connects a program to the ESTRELLA panel. The program only describes how to load and serialize
 * its document; the bridge handles the protocol: ready/init, heartbeat answers, debounced
 * snapshots, periodic saves, flush on request and theme changes.
 */

export type Theme = "light" | "dark";

export interface Program {
  /** Puts a saved document on screen. `data` is "" for a new project. */
  load(data: string, title: string): void | Promise<void>;
  /** Current document as a string. Called only when something changed. */
  serialize(): string | Promise<string>;
  onTheme?(theme: Theme): void;
}

export interface Connection {
  /** Call after every change the student makes. */
  changed(): void;
  /** Declare a long task (import, export, filter) so the panel waits instead of calling it frozen. */
  busy<T>(work: () => Promise<T>): Promise<T>;
  /** Current project title, editable from the program. */
  title(): string;
  setTitle(title: string): void;
  /** Saves now, for actions that must not wait for the debounce (closing a document, exporting). */
  saveNow(): Promise<void>;
  readonly lite: boolean;
}

export interface BridgeOptions {
  debounceMs?: number;
  periodicMs?: number;
  target?: Window;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

function panelOrigin(): string {
  const ancestors = (location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  const first = ancestors && ancestors.length ? ancestors[0] : "*";
  return first === "null" ? "*" : first;
}

export function connect(program: Program, options: BridgeOptions = {}): Connection {
  const debounceMs = options.debounceMs ?? 1200;
  const periodicMs = options.periodicMs ?? 20000;
  const parent = options.target ?? window.parent;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const origin = panelOrigin();

  let title = "";
  let ready = false;
  let dirty = false;
  let saving: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lite = false;

  const send = (message: unknown) => parent.postMessage(message, origin);

  const snapshot = async (): Promise<void> => {
    if (!ready || !dirty) return;
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (saving) {
      await saving;
      if (!dirty) return;
    }
    dirty = false;
    saving = (async () => {
      try {
        send({ type: "estrella:snapshot", data: await program.serialize(), title });
      } catch {
        dirty = true; // Retry on the next change or periodic save.
      } finally {
        saving = null;
      }
    })();
    await saving;
  };

  const connection: Connection = {
    changed() {
      if (!ready) return;
      dirty = true;
      if (timer !== null) clearTimer(timer);
      timer = setTimer(() => void snapshot(), debounceMs);
    },
    async busy(work) {
      send({ type: "estrella:busy", busy: true });
      try {
        return await work();
      } finally {
        send({ type: "estrella:busy", busy: false });
      }
    },
    title: () => title,
    setTitle(next) {
      title = next.slice(0, 120);
      connection.changed();
    },
    saveNow: () => snapshot(),
    get lite() {
      return lite;
    },
  };

  window.addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const m = event.data as { type?: string; [k: string]: unknown } | null;
    if (!m || typeof m.type !== "string") return;
    switch (m.type) {
      case "estrella:init":
        title = typeof m.title === "string" ? m.title : "";
        lite = m.lite === true;
        program.onTheme?.(m.theme === "dark" ? "dark" : "light");
        void Promise.resolve(program.load(typeof m.data === "string" ? m.data : "", title)).then(() => {
          ready = true;
        });
        break;
      case "estrella:ping":
        send({ type: "estrella:pong", n: m.n });
        break;
      case "estrella:theme":
        program.onTheme?.(m.theme === "dark" ? "dark" : "light");
        break;
      case "estrella:flush":
        // Send what is pending, then confirm so the panel can leave without waiting longer.
        void snapshot().then(() => send({ type: "estrella:flushed" }));
        break;
    }
  });

  window.setInterval(() => void snapshot(), periodicMs);
  window.addEventListener("pagehide", () => void snapshot());
  send({ type: "estrella:ready" });
  return connection;
}
