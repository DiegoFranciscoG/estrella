import { describe, expect, it, vi } from "vitest";
import { desktopBridge, installOfficialProgram, type DesktopBridge } from "../../src/core/desktop";

/** WebView2's channel as the app exposes it: replies arrive as "message" events. */
function fakeBridge(reply: (message: string) => string | null) {
  const target = new EventTarget();
  const sent: string[] = [];
  const bridge: DesktopBridge = {
    postMessage: (message) => {
      sent.push(message);
      const answer = reply(message);
      if (answer !== null) queueMicrotask(() => target.dispatchEvent(new MessageEvent("message", { data: answer })));
    },
    addEventListener: (type, listener) => target.addEventListener(type, listener as EventListener),
    removeEventListener: (type, listener) => target.removeEventListener(type, listener as EventListener),
  };
  return { bridge, sent };
}

describe("ESTRELLA for Windows", () => {
  it("is recognised only by its own user agent and channel", () => {
    const webview = { chrome: { webview: { postMessage: vi.fn() } } } as unknown as Window;
    expect(desktopBridge("Mozilla/5.0 Edg/140 EstrellaDesktop/0.8.0", webview)).not.toBeNull();
    // Another app on WebView2, or a browser pretending in its user agent: no channel to trust.
    expect(desktopBridge("Mozilla/5.0 Edg/140", webview)).toBeNull();
    expect(desktopBridge("Mozilla/5.0 EstrellaDesktop/0.8.0", {} as Window)).toBeNull();
  });

  it("asks the app for one program by its guide key and reports what the student chose", async () => {
    const { bridge, sent } = fakeBridge(() => "estrella:desktop:started:freecad");
    await expect(installOfficialProgram("freecad", bridge)).resolves.toBe("started");
    expect(sent).toEqual(["estrella:desktop:install:freecad"]);

    // A reply for another program, or anything malformed, is not this answer.
    const noisy = fakeBridge(() => "estrella:desktop:started:blender");
    let settled = false;
    void installOfficialProgram("freecad", noisy.bridge).then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(settled).toBe(false);

    const { bridge: cancelled } = fakeBridge(() => "estrella:desktop:cancelled:gimp");
    await expect(installOfficialProgram("gimp", cancelled)).resolves.toBe("cancelled");
  });

  it("refuses outside the app and invalid keys before sending anything", async () => {
    await expect(installOfficialProgram("freecad", null)).rejects.toThrow(/ESTRELLA para Windows/);
    const { bridge, sent } = fakeBridge(() => null);
    await expect(installOfficialProgram("free cad; calc", bridge)).rejects.toThrow(/no válido/);
    expect(sent).toEqual([]);
  });
});
