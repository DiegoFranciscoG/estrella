/**
 * Only inside ESTRELLA for Windows (desktop/windows): WebView2 gives the page one channel to the
 * app, and the app accepts a single request, "install this program from the guide", which it
 * confirms with the student in a window of its own before running winget.
 */

export interface DesktopBridge {
  postMessage(message: string): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export type InstallOutcome = "started" | "cancelled" | "unavailable" | "rejected";

const REPLY = /^estrella:desktop:(started|cancelled|unavailable|rejected):([a-z]{2,20})$/;

/** The app's channel, or null in a browser (including other apps built on WebView2). */
export function desktopBridge(ua: string = navigator.userAgent, w: Window = window): DesktopBridge | null {
  const bridge = (w as Window & { chrome?: { webview?: DesktopBridge } }).chrome?.webview;
  return /EstrellaDesktop\//.test(ua) && typeof bridge?.postMessage === "function" ? bridge : null;
}

/** Asks the app to install a program of the guide; resolves with what the student chose. */
export function installOfficialProgram(tool: string, bridge: DesktopBridge | null = desktopBridge()): Promise<InstallOutcome> {
  if (!bridge) return Promise.reject(new Error("Solo disponible en ESTRELLA para Windows"));
  if (!/^[a-z]{2,20}$/.test(tool)) return Promise.reject(new Error("Programa no válido"));
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const match = REPLY.exec(String(event.data));
      if (!match || match[2] !== tool) return;
      bridge.removeEventListener("message", onMessage);
      resolve(match[1] as InstallOutcome);
    };
    bridge.addEventListener("message", onMessage);
    bridge.postMessage(`estrella:desktop:install:${tool}`);
  });
}
