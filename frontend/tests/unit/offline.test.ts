import { describe, expect, it, vi } from "vitest";
import { filesToKeep, keepForOffline } from "../../apps/shared/offline";
import {
  canPromptInstall, captureInstallPrompt, detectPlatform, isInstalledApp, onInstallAvailability, promptInstall, protectAfterSaving,
  protectStorage, registerPanelWorker, storageState, UPDATE_CHECK_MS,
} from "../../src/core/offline";
import type { SafeStore } from "../../src/core/storage";
import { buildVersion, fillTemplate, panelPrecache, programsAssets } from "../../scripts/sw-build";

function memoryStore(): SafeStore {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); return true; }, remove: (k) => { data.delete(k); } };
}

function fakeStorage(persisted: boolean, grant: boolean) {
  let state = persisted;
  return {
    persisted: vi.fn(async () => state),
    persist: vi.fn(async () => { state = grant; return grant; }),
  } as unknown as StorageManager & { persisted: ReturnType<typeof vi.fn>; persist: ReturnType<typeof vi.fn> };
}

interface FakeWorker extends EventTarget {
  state: string;
  postMessage: ReturnType<typeof vi.fn>;
}

interface FakeRegistration extends EventTarget {
  installing: FakeWorker | null;
  waiting: FakeWorker | null;
  update: ReturnType<typeof vi.fn>;
}

function fakeWorker(): FakeWorker {
  return Object.assign(new EventTarget(), { state: "installing", postMessage: vi.fn() });
}

/** A registration whose new worker installs while an older one controls the page. */
function fakeWorkerEnv(withController: boolean, waiting: FakeWorker | null = null) {
  const registration: FakeRegistration = Object.assign(new EventTarget(), { installing: null, waiting, update: vi.fn(async () => undefined) });
  const container = Object.assign(new EventTarget(), { controller: withController ? {} : null, register: vi.fn(async () => registration) });
  const env = { serviceWorker: container as unknown as ServiceWorkerContainer, reload: vi.fn(), every: vi.fn() };
  return { registration, container, env };
}

describe("updates of the installed app", () => {
  it("offers a new version only when one already runs, and applies it only on request", async () => {
    const { registration, container, env } = fakeWorkerEnv(true);
    const offers: { activate(): void }[] = [];
    await registerPanelWorker((o) => offers.push(o), env);
    expect(container.register).toHaveBeenCalledWith("/sw.js");
    expect(env.every).toHaveBeenCalledWith(UPDATE_CHECK_MS, expect.any(Function));

    const worker = fakeWorker();
    registration.installing = worker;
    registration.dispatchEvent(new Event("updatefound"));
    worker.state = "installed";
    worker.dispatchEvent(new Event("statechange"));
    expect(offers).toHaveLength(1);
    expect(worker.postMessage).not.toHaveBeenCalled();
    // Another tab accepting the update does not reload this one under the student.
    container.dispatchEvent(new Event("controllerchange"));
    expect(env.reload).not.toHaveBeenCalled();
    offers[0].activate();
    expect(worker.postMessage).toHaveBeenCalledWith("estrella:activate-update");

    // The page reloads once when the accepted version takes over.
    container.dispatchEvent(new Event("controllerchange"));
    container.dispatchEvent(new Event("controllerchange"));
    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads on the very first install, and offers a version already waiting", async () => {
    const first = fakeWorkerEnv(false);
    const offers: unknown[] = [];
    await registerPanelWorker((o) => offers.push(o), first.env);
    const worker = fakeWorker();
    first.registration.installing = worker;
    first.registration.dispatchEvent(new Event("updatefound"));
    worker.state = "installed";
    worker.dispatchEvent(new Event("statechange"));
    expect(offers).toHaveLength(0);
    // clients.claim() on the first install changes the controller: that must not reload a form.
    first.container.dispatchEvent(new Event("controllerchange"));
    expect(first.env.reload).not.toHaveBeenCalled();

    const waiting = fakeWorker();
    const second = fakeWorkerEnv(true, waiting);
    await registerPanelWorker((o) => offers.push(o), second.env);
    expect(offers).toHaveLength(1);
  });
});

describe("protecting the student's data", () => {
  it("reads and requests persistent storage, and survives browsers without it", async () => {
    expect(await storageState(fakeStorage(true, true))).toBe("persistent");
    expect(await storageState(fakeStorage(false, false))).toBe("best-effort");
    expect(await storageState(undefined)).toBe("unsupported");
    expect(await storageState({ persisted: () => Promise.reject(new Error("blocked")) } as unknown as StorageManager)).toBe("unsupported");
    expect(await protectStorage(fakeStorage(false, true))).toBe(true);
    expect(await protectStorage(undefined)).toBe(false);
  });

  it("asks once per session after saving, never in Firefox (it would show a prompt out of context)", async () => {
    const storage = fakeStorage(false, true);
    const session = memoryStore();
    expect(await protectAfterSaving("Chrome/140", storage, session)).toBe("persistent");
    expect(storage.persist).toHaveBeenCalledTimes(1);
    expect(await protectAfterSaving("Chrome/140", storage, session)).toBeNull();
    expect(storage.persist).toHaveBeenCalledTimes(1);

    const firefox = fakeStorage(false, true);
    expect(await protectAfterSaving("Mozilla/5.0 Firefox/150.0", firefox, memoryStore())).toBeNull();
    expect(firefox.persist).not.toHaveBeenCalled();
  });
});

describe("installing", () => {
  it("knows which instructions to show first", () => {
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 15; Pixel 7)")).toBe("android");
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe("ios");
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe("mac");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(detectPlatform("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)")).toBe("linux");
    expect(detectPlatform("curl/8")).toBe("other");
  });

  it("detects the installed app in every way browsers report it", () => {
    expect(isInstalledApp((q) => q === "(display-mode: standalone)", undefined)).toBe(true);
    expect(isInstalledApp((q) => q === "(display-mode: window-controls-overlay)", undefined)).toBe(true);
    expect(isInstalledApp(() => false, true)).toBe(true);
    expect(isInstalledApp(() => false, undefined)).toBe(false);
  });

  it("keeps the browser's install offer for its own button", async () => {
    const target = new EventTarget();
    captureInstallPrompt(target);
    const changes = vi.fn();
    const stop = onInstallAvailability(changes);
    expect(canPromptInstall()).toBe(false);
    expect(await promptInstall()).toBe("unavailable");

    const offer = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: vi.fn(async () => undefined),
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    target.dispatchEvent(offer);
    expect(offer.defaultPrevented).toBe(true);
    expect(canPromptInstall()).toBe(true);
    expect(await promptInstall()).toBe("accepted");
    expect(offer.prompt).toHaveBeenCalled();
    expect(canPromptInstall()).toBe(false);

    target.dispatchEvent(Object.assign(new Event("beforeinstallprompt"), { prompt: vi.fn(), userChoice: Promise.resolve({ outcome: "dismissed" as const }) }));
    target.dispatchEvent(new Event("appinstalled"));
    expect(canPromptInstall()).toBe(false);
    expect(changes).toHaveBeenCalledTimes(4);
    stop();
  });
});

describe("programs kept for offline use", () => {
  const env = {
    origin: "https://apps.example",
    pageUrl: "https://apps.example/apps/plano/index.html#x",
    loaded: () => [
      "https://apps.example/apps/assets/plano-abc.js",
      "https://apps.example/apps/assets/plano-abc.js",
      "https://apps.example/healthz",
      "https://cdn.example/apps/assets/evil.js",
      "data:image/png;base64,AAAA",
    ],
  };

  it("lists the page and its own files only", () => {
    expect(filesToKeep(env)).toEqual(["https://apps.example/apps/plano/index.html", "https://apps.example/apps/assets/plano-abc.js"]);
  });

  it("registers the programs' worker and hands it the list, or does nothing where it cannot", async () => {
    const postMessage = vi.fn();
    const serviceWorker = {
      register: vi.fn(async () => ({})),
      ready: Promise.resolve({ active: { postMessage } }),
    } as unknown as ServiceWorkerContainer;
    expect(await keepForOffline({ ...env, serviceWorker, secure: true })).toBe(true);
    expect(serviceWorker.register).toHaveBeenCalledWith("/apps/sw.js", { scope: "/apps/" });
    expect(postMessage).toHaveBeenCalledWith({ type: "estrella:keep", urls: filesToKeep(env) });

    expect(await keepForOffline({ ...env, serviceWorker, secure: false })).toBe(false);
    expect(await keepForOffline({ ...env, serviceWorker, secure: true, origin: "null" })).toBe(false);
    expect(await keepForOffline({ ...env, serviceWorker: undefined, secure: true })).toBe(false);
    const blocked = { register: vi.fn(async () => { throw new Error("SecurityError"); }) } as unknown as ServiceWorkerContainer;
    expect(await keepForOffline({ ...env, serviceWorker: blocked, secure: true })).toBe(false);
  });
});

describe("service workers written by the build", () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it("keeps the whole panel but not the programs, the worker or the notices", () => {
    expect(panelPrecache(["index.html", "assets/index-a.js", "apps/plano/index.html", "sw.js", "THIRD-PARTY-NOTICES.txt", "icons/icon-192.png", ".vite/x"]))
      .toEqual(["/assets/index-a.js", "/icons/icon-192.png", "/index.html"]);
    expect(programsAssets(["assets/b.js", "plano/index.html", "assets/a.wasm"])).toEqual(["/apps/assets/a.wasm", "/apps/assets/b.js"]);
  });

  it("changes version with any change to the build, and only then", async () => {
    const a = [{ path: "index.html", bytes: bytes("<html>") }, { path: "assets/a.js", bytes: bytes("x") }];
    const v = await buildVersion(a);
    expect(v).toMatch(/^[0-9a-f]{12}$/);
    expect(await buildVersion([...a].reverse())).toBe(v);
    expect(await buildVersion([a[0], { path: "assets/a.js", bytes: bytes("y") }])).not.toBe(v);
    expect(await buildVersion([a[0], { path: "assets/b.js", bytes: bytes("x") }])).not.toBe(v);
  });

  it("fills every placeholder or fails the build", () => {
    const template = 'const VERSION = "__VERSION__";\nconst PRECACHE = __PRECACHE__;';
    expect(fillTemplate(template, { VERSION: JSON.stringify("abc"), PRECACHE: JSON.stringify(["/a"]) }))
      .toBe('const VERSION = "abc";\nconst PRECACHE = ["/a"];');
    expect(() => fillTemplate(template, { VERSION: '"abc"' })).toThrow(/__PRECACHE__/);
    expect(() => fillTemplate(template, { VERSION: '"abc"', PRECACHE: "[]", ASSETS: "[]" })).toThrow(/__ASSETS__ not found/);
  });
});
