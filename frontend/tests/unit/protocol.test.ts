import { describe, expect, it } from "vitest";
import { Heartbeat, HostMessage, MAX_SNAPSHOT, parseAppMessage, Timers } from "../../src/core/protocol";

class FakeTimers implements Timers {
  t = 0;
  private fns = new Map<number, { fn: () => void; ms: number; next: number }>();
  private id = 0;
  setInterval(fn: () => void, ms: number): number {
    this.fns.set(++this.id, { fn, ms, next: this.t + ms });
    return this.id;
  }
  clearInterval(id: number): void {
    this.fns.delete(id);
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    const end = this.t + ms;
    while (true) {
      const due = [...this.fns.values()].filter((f) => f.next <= end).sort((a, b) => a.next - b.next)[0];
      if (!due) break;
      this.t = due.next;
      due.next += due.ms;
      due.fn();
    }
    this.t = end;
  }
}

describe("parseAppMessage", () => {
  it("accepts only known, well-formed messages", () => {
    expect(parseAppMessage({ type: "estrella:ready" })).toEqual({ type: "estrella:ready" });
    expect(parseAppMessage({ type: "estrella:pong", n: 3 })).toEqual({ type: "estrella:pong", n: 3 });
    expect(parseAppMessage({ type: "estrella:busy", busy: true })).toEqual({ type: "estrella:busy", busy: true });
    expect(parseAppMessage({ type: "estrella:snapshot", data: "x", title: "t" })).toEqual({ type: "estrella:snapshot", data: "x", title: "t" });
  });

  it("drops anything else", () => {
    for (const bad of [null, "texto", 5, {}, { type: "otro" }, { type: "estrella:pong", n: "1" },
      { type: "estrella:busy", busy: "si" }, { type: "estrella:snapshot", data: 4 },
      { type: "estrella:snapshot", data: "x", title: 9 }, { type: "estrella:snapshot", data: "x", title: "t".repeat(201) },
      { type: "estrella:snapshot", data: "x".repeat(MAX_SNAPSHOT + 1) }]) {
      expect(parseAppMessage(bad)).toBeNull();
    }
  });
});

describe("Heartbeat", () => {
  function setup() {
    const timers = new FakeTimers();
    const sent: HostMessage[] = [];
    const frozen: number[] = [];
    const hb = new Heartbeat((m) => sent.push(m), (ms) => frozen.push(ms), timers, 2000, 8000, 60000);
    return { timers, sent, frozen, hb };
  }

  it("pings regularly and stays quiet while the program answers", () => {
    const { timers, sent, frozen, hb } = setup();
    hb.start();
    for (let i = 0; i < 10; i++) {
      timers.advance(2000);
      hb.pong();
    }
    expect(sent.filter((m) => m.type === "estrella:ping")).toHaveLength(10);
    expect(frozen).toEqual([]);
  });

  /** T-04: a frozen program is detected and reported once, not on every tick. */
  it("reports a silent program once", () => {
    const { timers, frozen, hb } = setup();
    hb.start();
    timers.advance(20000);
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toBeGreaterThanOrEqual(8000);
  });

  it("allows longer silence while the program declares a heavy task", () => {
    const { timers, frozen, hb } = setup();
    hb.start();
    hb.busy(true);
    timers.advance(30000);
    expect(frozen).toEqual([]);
    timers.advance(40000);
    expect(frozen).toHaveLength(1);
  });

  it("can report again after the program recovered and froze anew", () => {
    const { timers, frozen, hb } = setup();
    hb.start();
    timers.advance(10000);
    hb.pong();
    timers.advance(10000);
    expect(frozen).toHaveLength(2);
  });

  it("stops pinging when stopped", () => {
    const { timers, sent, hb } = setup();
    hb.start();
    hb.stop();
    timers.advance(10000);
    expect(sent).toEqual([]);
  });
});
