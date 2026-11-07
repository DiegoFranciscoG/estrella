/**
 * Messages between the ESTRELLA panel and a program running in its sandboxed frame.
 * Programs run with an opaque origin, so every message is validated by shape and by source window.
 */

export type HostMessage =
  /** `offline`: the program may keep itself for offline use (production, on the programs' own site). */
  | { type: "estrella:init"; projectId: string; title: string; data: string; theme: "light" | "dark"; lite: boolean; offline: boolean }
  | { type: "estrella:ping"; n: number }
  | { type: "estrella:theme"; theme: "light" | "dark" }
  | { type: "estrella:flush" };

export type AppMessage =
  | { type: "estrella:ready" }
  | { type: "estrella:pong"; n: number }
  | { type: "estrella:snapshot"; data: string; title?: string }
  | { type: "estrella:busy"; busy: boolean }
  /** Answer to a flush: everything unsaved was already sent (possibly nothing). */
  | { type: "estrella:flushed" };

/** Largest snapshot accepted from a program (characters, about 35 MB of binary content). */
export const MAX_SNAPSHOT = 50_000_000;

export function parseAppMessage(value: unknown): AppMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;
  switch (m.type) {
    case "estrella:ready":
      return { type: "estrella:ready" };
    case "estrella:flushed":
      return { type: "estrella:flushed" };
    case "estrella:pong":
      return Number.isSafeInteger(m.n) ? { type: "estrella:pong", n: m.n as number } : null;
    case "estrella:busy":
      return typeof m.busy === "boolean" ? { type: "estrella:busy", busy: m.busy } : null;
    case "estrella:snapshot": {
      if (typeof m.data !== "string" || m.data.length > MAX_SNAPSHOT) return null;
      if (m.title !== undefined && (typeof m.title !== "string" || m.title.length > 200)) return null;
      return { type: "estrella:snapshot", data: m.data, title: m.title as string | undefined };
    }
    default:
      return null;
  }
}

export interface Timers {
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
  now(): number;
}

export const browserTimers: Timers = {
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (id) => window.clearInterval(id),
  now: () => Date.now(),
};

/**
 * Detects a frozen program: the panel pings every `intervalMs`; if no answer arrives within
 * `timeoutMs` the program is declared unresponsive. While the program says it is busy with a long
 * task the deadline is extended, so a legitimate heavy operation is not mistaken for a hang.
 */
export class Heartbeat {
  private n = 0;
  private lastPong: number;
  private busySince: number | null = null;
  private timer: number | null = null;
  private reported = false;

  constructor(
    private readonly send: (msg: HostMessage) => void,
    private readonly onUnresponsive: (silentMs: number) => void,
    private readonly timers: Timers = browserTimers,
    readonly intervalMs = 2000,
    readonly timeoutMs = 8000,
    readonly busyTimeoutMs = 60000,
  ) {
    this.lastPong = timers.now();
  }

  start(): void {
    this.stop();
    this.lastPong = this.timers.now();
    this.reported = false;
    this.timer = this.timers.setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) this.timers.clearInterval(this.timer);
    this.timer = null;
  }

  pong(): void {
    this.lastPong = this.timers.now();
    this.reported = false;
  }

  busy(isBusy: boolean): void {
    this.busySince = isBusy ? this.timers.now() : null;
    this.lastPong = this.timers.now();
  }

  private tick(): void {
    const silent = this.timers.now() - this.lastPong;
    const limit = this.busySince !== null ? this.busyTimeoutMs : this.timeoutMs;
    if (silent >= limit && !this.reported) {
      this.reported = true;
      this.onUnresponsive(silent);
    }
    this.send({ type: "estrella:ping", n: ++this.n });
  }
}
