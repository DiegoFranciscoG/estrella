import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect, Program } from "../../apps/shared/bridge";

/** A fake panel: records what the program sends and lets the test send panel messages. */
function setup(program: Partial<Program> = {}) {
  const sent: Record<string, unknown>[] = [];
  const parent = { postMessage: (m: Record<string, unknown>) => sent.push(m) } as unknown as Window;
  let doc = "";
  const p: Program = {
    load: vi.fn((data: string) => { doc = data; }),
    serialize: vi.fn(() => doc),
    onTheme: vi.fn(),
    ...program,
  };
  const conn = connect(p, { target: parent, debounceMs: 100, periodicMs: 60_000 });
  const panel = (data: Record<string, unknown>) => window.dispatchEvent(new MessageEvent("message", { data, source: parent as unknown as MessageEventSource }));
  return { sent, conn, panel, p, edit: (v: string) => { doc = v; conn.changed(); } };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe("program bridge", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval"] }));
  afterEach(() => vi.useRealTimers());

  it("announces itself and loads the project on init", async () => {
    const { sent, panel, p } = setup();
    expect(sent[0]).toEqual({ type: "estrella:ready" });
    panel({ type: "estrella:init", projectId: "x", title: "Mi plano", data: "abc", theme: "dark", lite: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(p.load).toHaveBeenCalledWith("abc", "Mi plano");
    expect(p.onTheme).toHaveBeenCalledWith("dark");
  });

  it("ignores messages that do not come from the panel", async () => {
    const { p } = setup();
    window.dispatchEvent(new MessageEvent("message", { data: { type: "estrella:init", data: "x" }, source: window }));
    await flush();
    expect(p.load).not.toHaveBeenCalled();
  });

  it("answers heartbeats", () => {
    const { sent, panel } = setup();
    panel({ type: "estrella:ping", n: 7 });
    expect(sent).toContainEqual({ type: "estrella:pong", n: 7 });
  });

  it("debounces edits into one snapshot with the title", async () => {
    const { sent, panel, edit, conn } = setup();
    panel({ type: "estrella:init", title: "T", data: "", theme: "light" });
    await vi.advanceTimersByTimeAsync(1);
    edit("a"); edit("ab"); edit("abc");
    conn.setTitle("Nuevo título");
    await vi.advanceTimersByTimeAsync(150);
    const snaps = sent.filter((m) => m.type === "estrella:snapshot");
    expect(snaps).toEqual([{ type: "estrella:snapshot", data: "abc", title: "Nuevo título" }]);
  });

  it("does not save before the project is loaded, nor when nothing changed", async () => {
    const { sent, panel, edit } = setup();
    edit("too early");
    panel({ type: "estrella:flush" });
    await vi.advanceTimersByTimeAsync(500);
    expect(sent.filter((m) => m.type === "estrella:snapshot")).toEqual([]);
  });

  it("saves immediately when the panel asks to flush", async () => {
    const { sent, panel, edit } = setup();
    panel({ type: "estrella:init", title: "", data: "", theme: "light" });
    await vi.advanceTimersByTimeAsync(1);
    edit("x");
    panel({ type: "estrella:flush" });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.filter((m) => m.type === "estrella:snapshot")).toHaveLength(1);
  });

  it("retries after a failed serialization", async () => {
    let fail = true;
    const { sent, panel, conn } = setup({ serialize: () => { if (fail) throw new Error("busy"); return "ok"; } });
    panel({ type: "estrella:init", title: "", data: "", theme: "light" });
    await vi.advanceTimersByTimeAsync(1);
    conn.changed();
    await vi.advanceTimersByTimeAsync(150);
    fail = false;
    await conn.saveNow();
    expect(sent.filter((m) => m.type === "estrella:snapshot")).toEqual([{ type: "estrella:snapshot", data: "ok", title: "" }]);
  });

  it("wraps long tasks in busy notices", async () => {
    const { sent, conn } = setup();
    await conn.busy(async () => 1);
    expect(sent.filter((m) => m.type === "estrella:busy").map((m) => m.busy)).toEqual([true, false]);
  });
});
