import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAccessToken } from "../../src/core/api";
import { ProjectStore } from "../../src/core/store";
import { SyncError, SyncServer } from "../../src/core/sync";
import { httpSyncServer } from "../../src/core/syncApi";
import { loadKeys, markProjectClosed, markProjectOpen, onSyncStatus, rememberKeys, startSync, stopSync, syncNow, syncStatus, useSyncServer } from "../../src/core/syncManager";
import { sha256Base64, syncKeysFrom } from "../../src/core/vault";

const USER = "44444444-4444-4444-8444-444444444444";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

describe("Sync over HTTP", () => {
  beforeEach(() => setAccessToken("token"));
  afterEach(() => {
    vi.unstubAllGlobals();
    setAccessToken(null);
  });

  it("decodes the encrypted names of the listing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({
      projects: [{ id: "p1", programId: "plano", name: "AAEC", version: 3, sizeBytes: 10 }],
      storageUsedBytes: 10, storageQuotaBytes: 100, maxVersionBytes: 50, syncEpoch: "e",
    })));
    const list = await httpSyncServer.list();
    expect(list.projects[0].name).toEqual(new Uint8Array([0, 1, 2]));
    expect(list.syncEpoch).toBe("e");
  });

  it("uploads raw bytes with the base version and their hash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ version: 4, storageUsedBytes: 1, storageQuotaBytes: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = new Uint8Array([9, 8, 7]);
    expect((await httpSyncServer.upload("p1", 3, body)).version).toBe(4);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/projects/p1/content");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(body);
    expect(init.headers["If-Match"]).toBe("\"3\"");
    expect(init.headers["Content-Type"]).toBe("application/octet-stream");
    expect(init.headers["X-Content-SHA256"]).toBe(await sha256Base64(body));
    expect(init.headers.Authorization).toBe("Bearer token");
  });

  it("turns a version conflict into a SyncError with the server's current version", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ code: "VERSION_CONFLICT", detail: "Otro equipo", currentVersion: 7 }, 412)));
    const error = await httpSyncServer.upload("p1", 3, new Uint8Array([1])).catch((e) => e);
    expect(error).toBeInstanceOf(SyncError);
    expect(error).toMatchObject({ code: "VERSION_CONFLICT", status: 412, currentVersion: 7 });
  });

  it("reads the version from the ETag and rejects a truncated download", async () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { ETag: "\"5\"", "X-Content-SHA256": await sha256Base64(body) } })));
    expect(await httpSyncServer.download("p1")).toEqual({ version: 5, body });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body.slice(0, 2), { status: 200, headers: { ETag: "\"5\"", "X-Content-SHA256": await sha256Base64(body) } })));
    await expect(httpSyncServer.download("p1")).rejects.toMatchObject({ code: "INTEGRITY" });
  });

  it("treats deleting something already gone as done, and reports other failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ code: "NOT_FOUND", detail: "No existe" }, 404)));
    await expect(httpSyncServer.remove("p1")).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(httpSyncServer.remove("p1")).rejects.toMatchObject({ code: "NETWORK" });
  });
});

describe("Sync manager", () => {
  const empty = { projects: [], storageUsedBytes: 0, storageQuotaBytes: 1000, maxVersionBytes: 1000, syncEpoch: "e" };
  let server: SyncServer;

  beforeEach(() => {
    server = {
      list: vi.fn().mockResolvedValue(empty),
      saveMeta: vi.fn().mockResolvedValue(undefined),
      upload: vi.fn().mockResolvedValue({ version: 1, storageUsedBytes: 10, storageQuotaBytes: 1000 }),
      download: vi.fn(),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    useSyncServer(server);
  });

  afterEach(async () => {
    stopSync();
    await ProjectStore.deleteAll(USER);
  });

  const keys = async () => syncKeysFrom(await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]));

  it("asks for the password when this device has no keys, and remembers them once given", async () => {
    await startSync(USER, null);
    expect(syncStatus().state).toBe("locked");
    expect(await loadKeys(USER)).toBeNull();
    const k = await keys();
    await rememberKeys(USER, k);
    const loaded = await loadKeys(USER);
    expect(loaded?.content.extractable).toBe(false);
    await startSync(USER, loaded);
    expect(syncStatus()).toMatchObject({ state: "idle", report: { storageQuotaBytes: 1000 } });
  });

  it("does not ask the server for projects when the account has the cloud off", async () => {
    server.enabled = vi.fn().mockResolvedValue(false);
    await startSync(USER, await keys());
    expect(syncStatus()).toMatchObject({ state: "off", message: expect.stringContaining("desactivada") });
    expect(server.list).not.toHaveBeenCalled();
    // Turning the cloud on (Mi cuenta) runs a pass right away.
    server.enabled = vi.fn().mockResolvedValue(true);
    await syncNow();
    expect(syncStatus().state).toBe("idle");
    expect(server.list).toHaveBeenCalledTimes(1);
  });

  it("says plainly when the cloud is off or the server cannot be reached", async () => {
    const states: string[] = [];
    const stop = onSyncStatus((s) => states.push(s.state));
    server.list = vi.fn().mockRejectedValue(new SyncError("SYNC_DISABLED", 403, "off"));
    await startSync(USER, await keys());
    expect(syncStatus().state).toBe("off");
    server.list = vi.fn().mockRejectedValue(new SyncError("NETWORK", 0, "sin red"));
    await syncNow();
    expect(syncStatus()).toMatchObject({ state: "offline", message: expect.stringContaining("Sin conexión") });
    server.list = vi.fn().mockRejectedValue(new Error("raro"));
    await syncNow();
    expect(syncStatus()).toMatchObject({ state: "error", message: "raro" });
    expect(states).toContain("syncing");
    stop();
  });

  it("never runs two passes at once and runs one more after a request during a pass", async () => {
    await startSync(USER, await keys());
    let release!: () => void;
    server.list = vi.fn().mockImplementation(() => new Promise((r) => { release = () => r(empty); }));
    const first = syncNow();
    const second = syncNow();
    await vi.waitFor(() => expect(server.list).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(server.list).toHaveBeenCalledTimes(1);
    // The request made during the pass becomes exactly one more pass, shortly after.
    server.list = vi.fn().mockResolvedValue(empty);
    await vi.waitFor(() => expect(server.list).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });

  it("uploads a project open in this tab and schedules a pass when it closes", async () => {
    const store = await ProjectStore.open(USER);
    const p = await store.create("plano", "Abierto");
    await store.saveSnapshot(p.id, "x", undefined, 5);
    store.close();
    await startSync(USER, await keys());
    expect(server.upload).toHaveBeenCalledTimes(1);
    markProjectOpen(p.id);
    markProjectClosed(p.id);
    await vi.waitFor(() => expect(server.list).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });
});
