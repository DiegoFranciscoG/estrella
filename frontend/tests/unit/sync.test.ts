import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { databaseName, ProjectStore } from "../../src/core/store";
import { RemoteList, RemoteProject, SyncError, SyncReport, SyncServer, syncOnce, Uploaded } from "../../src/core/sync";
import { contentAad, openName, pack, seal, sealName, syncKeysFrom, SyncKeys, unpack, unseal } from "../../src/core/vault";

type Bytes = Uint8Array<ArrayBuffer>;
const USER = "33333333-3333-4333-8333-333333333333";

/** In-memory server with the backend's rules: ownership aside, versions, 412, quota, size and epoch. */
class FakeServer implements SyncServer {
  projects = new Map<string, { programId: string; name: Bytes; versions: Map<number, Bytes>; current: number }>();
  epoch = "epoch-1";
  quota = 1_000_000;
  maxVersionBytes = 200_000;
  /** Every byte the server ever received, to prove none of it is readable (T-09). */
  received: Bytes[] = [];

  used(): number {
    let n = 0;
    for (const p of this.projects.values()) for (const v of p.versions.values()) n += v.length;
    return n;
  }

  async list(): Promise<RemoteList> {
    const projects: RemoteProject[] = [...this.projects.entries()].map(([id, p]) => ({
      id, programId: p.programId, name: p.name, version: p.current, sizeBytes: p.versions.get(p.current)?.length ?? 0,
    }));
    return { projects, storageUsedBytes: this.used(), storageQuotaBytes: this.quota, maxVersionBytes: this.maxVersionBytes, syncEpoch: this.epoch };
  }

  async saveMeta(id: string, programId: string, name: Bytes): Promise<void> {
    this.received.push(name);
    const p = this.projects.get(id);
    if (p) p.name = name;
    else this.projects.set(id, { programId, name, versions: new Map(), current: 0 });
  }

  async upload(id: string, base: number, body: Bytes): Promise<Uploaded> {
    this.received.push(body);
    const p = this.projects.get(id);
    if (!p) throw new SyncError("NOT_FOUND", 404, "no");
    if (p.current !== base) throw new SyncError("VERSION_CONFLICT", 412, "conflict", p.current);
    if (body.length > this.maxVersionBytes) throw new SyncError("TOO_LARGE", 413, "big");
    if (this.used() + body.length > this.quota) throw new SyncError("QUOTA_EXCEEDED", 507, "full");
    p.current += 1;
    p.versions.set(p.current, body);
    return { version: p.current, storageUsedBytes: this.used(), storageQuotaBytes: this.quota };
  }

  async download(id: string): Promise<{ version: number; body: Bytes }> {
    const p = this.projects.get(id)!;
    // Like the real API: a project with only its name has no content to download.
    if (p.current === 0) throw new SyncError("EMPTY", 404, "sin contenido");
    return { version: p.current, body: p.versions.get(p.current)! };
  }

  async remove(id: string): Promise<void> {
    this.projects.delete(id);
  }

  /** Sync turned off and on again, or keys reset: the cloud is emptied and the epoch changes. */
  wipe(): void {
    this.projects.clear();
    this.epoch = `epoch-${Math.random()}`;
  }
}

let server: FakeServer;
let keys: SyncKeys;
let open: ProjectStore[] = [];

/** Each device has its own browser storage. */
async function device(): Promise<ProjectStore> {
  const s = await ProjectStore.open(USER, new IDBFactory());
  open.push(s);
  return s;
}

const sync = (store: ProjectStore, openIds: string[] = []): Promise<SyncReport> =>
  syncOnce({ userId: USER, store, keys, server, openIds: new Set(openIds) });

async function edit(store: ProjectStore, id: string, data: string, at: number): Promise<void> {
  await store.saveSnapshot(id, data, undefined, at);
}

beforeEach(async () => {
  server = new FakeServer();
  const vault = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  keys = await syncKeysFrom(vault);
});

afterEach(() => {
  open.splice(0).forEach((s) => s.close());
  open = [];
});

describe("Sync encryption", () => {
  it("seals and opens content bound to its account, project and version", async () => {
    const plain = await pack({ f: 1, data: "Planta baja: muro de 15 cm" });
    const sealed = await seal(keys.content, plain, contentAad(USER, "p1", 3));
    expect(await unpack<{ data: string }>(await unseal(keys.content, sealed, contentAad(USER, "p1", 3)))).toMatchObject({ data: "Planta baja: muro de 15 cm" });
    // The server cannot move it to another project, present it as another version, or alter one bit.
    await expect(unseal(keys.content, sealed, contentAad(USER, "p2", 3))).rejects.toThrow();
    await expect(unseal(keys.content, sealed, contentAad(USER, "p1", 4))).rejects.toThrow();
    const tampered = sealed.slice();
    tampered[20] ^= 1;
    await expect(unseal(keys.content, tampered, contentAad(USER, "p1", 3))).rejects.toThrow();
  });

  it("uses a fresh nonce every time and keeps derived keys unexportable", async () => {
    const plain = await pack("igual");
    const a = await seal(keys.content, plain, "x");
    const b = await seal(keys.content, plain, "x");
    expect(a.slice(0, 12)).not.toEqual(b.slice(0, 12));
    await expect(crypto.subtle.exportKey("raw", keys.content)).rejects.toThrow();
    expect(await openName(keys, USER, "p", await sealName(keys, USER, "p", "Casa en Loja"))).toBe("Casa en Loja");
  });

  it("compresses before encrypting", async () => {
    const repetitive = "muro ".repeat(10_000);
    const packed = await pack({ data: repetitive });
    expect(packed[0]).toBe(1);
    expect(packed.length).toBeLessThan(repetitive.length / 20);
  });
});

describe("Sync between devices", () => {
  it("uploads new projects once, then has nothing to do", async () => {
    const a = await device();
    const p = await a.create("plano", "Casa");
    await edit(a, p.id, "{\"muros\":4}", 1000);
    expect((await sync(a)).uploaded).toBe(1);
    const second = await sync(a);
    expect(second.uploaded + second.downloaded).toBe(0);
    expect((await a.get(p.id))?.syncedVersion).toBe(1);
    // Closing a program repeats its last save: that is not a change and uploads nothing.
    await edit(a, p.id, "{\"muros\":4}", 5000);
    expect((await sync(a)).uploaded).toBe(0);
  });

  it("a second device receives titles and content, and edits travel both ways", async () => {
    const a = await device();
    const b = await device();
    const p = await a.create("plano", "Casa en Loja");
    await edit(a, p.id, "v1", 1000);
    await sync(a);
    expect((await sync(b)).downloaded).toBe(1);
    expect(await b.get(p.id)).toMatchObject({ title: "Casa en Loja", data: "v1", programId: "plano", syncedVersion: 1, dirty: false });

    await edit(b, p.id, "v2 desde B", 2000);
    await sync(b);
    await sync(a);
    expect((await a.get(p.id))?.data).toBe("v2 desde B");
  });

  /** T-08: two devices editing the same project never lose either version. */
  it("keeps both versions when two devices edited the same project", async () => {
    const a = await device();
    const b = await device();
    const p = await a.create("pizarra", "Ideas");
    await edit(a, p.id, "base", 1000);
    await sync(a);
    await sync(b);
    await edit(a, p.id, "versión de A", 2000);
    await edit(b, p.id, "versión de B", 2100);
    await sync(a);
    const report = await sync(b);
    expect(report.conflicts).toEqual(["Ideas (copia de este equipo)"]);
    const onB = await b.list();
    expect(onB.find((x) => x.id === p.id)?.data).toBe("versión de A");
    expect(onB.find((x) => x.id !== p.id)).toMatchObject({ title: "Ideas (copia de este equipo)", data: "versión de B" });
    // The copy reaches the other device too.
    await sync(b);
    await sync(a);
    expect((await a.list()).map((x) => x.data).sort()).toEqual(["versión de A", "versión de B"]);
  });

  it("does not create a copy when both sides already have the same content", async () => {
    const a = await device();
    const b = await device();
    const p = await a.create("apuntes", "Notas");
    await edit(a, p.id, "lo mismo", 1000);
    await sync(a);
    await sync(b);
    server.wipe();
    await sync(a);
    const report = await sync(b);
    expect(report.conflicts).toEqual([]);
    expect(await b.list()).toHaveLength(1);
  });

  it("propagates deletions, but never deletes a version saved elsewhere afterwards", async () => {
    const a = await device();
    const b = await device();
    const keep = await a.create("plano", "Se queda");
    const gone = await a.create("plano", "Se borra");
    await edit(a, keep.id, "x", 1000);
    await edit(a, gone.id, "y", 1000);
    await sync(a);
    await sync(b);

    await a.remove(gone.id);
    expect((await sync(a)).removedThere).toBe(1);
    expect((await sync(b)).removedHere).toBe(1);
    expect((await b.list()).map((x) => x.title)).toEqual(["Se queda"]);

    // A deletes "Se queda" offline while B saves a newer version: B's work wins and comes back to A.
    await a.remove(keep.id);
    await edit(b, keep.id, "cambio de B", 3000);
    await sync(b);
    const back = await sync(a);
    expect(back.removedThere).toBe(0);
    expect((await a.get(keep.id))?.data).toBe("cambio de B");
  });

  it("re-uploads instead of deleting when the server was emptied (new epoch)", async () => {
    const a = await device();
    const p = await a.create("plano", "Tesis");
    await edit(a, p.id, "capítulo 1", 1000);
    await sync(a);
    server.wipe();
    const report = await sync(a);
    expect(report.removedHere).toBe(0);
    expect(report.uploaded).toBe(1);
    expect(server.projects.has(p.id)).toBe(true);
  });

  it("marks what does not fit and keeps syncing the rest", async () => {
    const a = await device();
    const small = await a.create("apuntes", "Pequeño");
    const big = await a.create("lienzo", "Enorme");
    await edit(a, small.id, "hola", 1000);
    // Random text barely compresses, like a photo: it cannot fit in 200 KB.
    const random = new Uint8Array(300_000);
    for (let i = 0; i < random.length; i += 65_536) crypto.getRandomValues(random.subarray(i, i + 65_536));
    const noise = Array.from(random, (b) => String.fromCharCode(33 + (b % 90))).join("");
    await edit(a, big.id, noise, 1000);
    const report = await sync(a);
    expect(report.uploaded).toBe(1);
    expect(report.issues).toBe(1);
    expect((await a.get(big.id))?.syncIssue).toBe("too-large");
    server.maxVersionBytes = 10_000_000;
    server.quota = 1000;
    await sync(a);
    expect((await a.get(big.id))?.syncIssue).toBe("quota");
  });

  it("never replaces a project open in this tab, but still uploads its changes", async () => {
    const a = await device();
    const b = await device();
    const p = await a.create("plano", "Abierto");
    await edit(a, p.id, "v1", 1000);
    await sync(a);
    await sync(b);
    await edit(b, p.id, "v2 de B", 2000);
    await sync(b);
    await sync(a, [p.id]);
    expect((await a.get(p.id))?.data).toBe("v1");
    await sync(a);
    expect((await a.get(p.id))?.data).toBe("v2 de B");
  });

  it("leaves untouched what this device cannot decrypt", async () => {
    const a = await device();
    const p = await a.create("plano", "Secreto");
    await edit(a, p.id, "x", 1000);
    await sync(a);
    const other = await device();
    keys = await syncKeysFrom(await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]));
    const report = await sync(other);
    expect(report.undecryptable).toBe(1);
    expect(await other.list()).toEqual([]);
    expect(server.projects.get(p.id)?.current).toBe(1);
  });

  /** T-09 at the protocol level: nothing the server receives contains the title or the content. */
  it("never sends a readable title or content", async () => {
    const a = await device();
    const p = await a.create("apuntes", "Diario íntimo de Ana");
    await edit(a, p.id, "MARCADOR-SECRETO-123 y más texto", 1000);
    await sync(a);
    expect(server.received.length).toBeGreaterThan(0);
    const latin = (b: Bytes) => Array.from(b, (c) => String.fromCharCode(c)).join("");
    for (const bytes of server.received) {
      expect(latin(bytes)).not.toContain("MARCADOR-SECRETO-123");
      expect(latin(bytes)).not.toContain("Diario");
    }
  });
});

describe("Local store upgrade", () => {
  it("keeps version 1 projects and treats them as never uploaded", async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const req = factory.open(databaseName(USER), 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore("projects", { keyPath: "id" });
        s.createIndex("byUpdated", "updatedAt");
        s.add({ id: "old", programId: "apuntes", title: "Antiguo", data: "texto", createdAt: 1, updatedAt: 2, openSince: null });
      };
      req.onsuccess = () => { req.result.close(); resolve(); };
      req.onerror = () => reject(req.error);
    });
    const store = await ProjectStore.open(USER, factory);
    open.push(store);
    expect((await store.get("old"))?.title).toBe("Antiguo");
    const report = await sync(store);
    expect(report.uploaded).toBe(1);
  });
});
