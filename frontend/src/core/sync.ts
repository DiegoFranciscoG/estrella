/**
 * One sync pass between this device and the server (phase 6).
 *
 * Rules, in the order they protect the student's work:
 * 1. Nothing leaves the device unencrypted: titles and content are sealed with keys only this
 *    device holds (T-09).
 * 2. Nothing is overwritten blindly: uploads say which version they started from; if another device
 *    saved first, the server refuses and both versions are kept, the local one as a copy (T-08).
 * 3. A project open in this tab is never replaced under the student's hands; it syncs after closing.
 * 4. "Missing on the server" means "deleted elsewhere" only within the same sync epoch and only if
 *    nothing changed here; otherwise the local copy is uploaded again.
 */
import type { Project, ProjectStore } from "./store";
import { needsUpload } from "./store";
import { contentAad, openName, pack, seal, sealName, SyncKeys, unpack, unseal } from "./vault";

type Bytes = Uint8Array<ArrayBuffer>;

export interface RemoteProject {
  id: string;
  programId: string;
  name: Bytes;
  version: number;
  sizeBytes: number;
}

export interface RemoteList {
  projects: RemoteProject[];
  storageUsedBytes: number;
  storageQuotaBytes: number;
  maxVersionBytes: number;
  syncEpoch: string;
}

export interface Uploaded {
  version: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
}

export class SyncError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly currentVersion?: number) {
    super(message);
  }
}

/** What the server offers. The HTTP implementation is in syncApi.ts; tests use an in-memory one. */
export interface SyncServer {
  /** Whether the account has the cloud on. Without it, sync waits instead of being refused. */
  enabled?(): Promise<boolean>;
  list(): Promise<RemoteList>;
  saveMeta(id: string, programId: string, name: Bytes): Promise<void>;
  upload(id: string, baseVersion: number, body: Bytes): Promise<Uploaded>;
  download(id: string): Promise<{ version: number; body: Bytes }>;
  remove(id: string): Promise<void>;
}

export interface SyncReport {
  uploaded: number;
  downloaded: number;
  /** Titles of the local copies kept because another device saved first. */
  conflicts: string[];
  removedHere: number;
  removedThere: number;
  issues: number;
  undecryptable: number;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  at: number;
}

/** What travels inside the encrypted content. The title travels apart, in the encrypted name. */
interface Payload {
  f: 1;
  programId: string;
  data: string;
  createdAt: number;
  updatedAt: number;
}

export interface SyncContext {
  userId: string;
  store: ProjectStore;
  keys: SyncKeys;
  server: SyncServer;
  /** Projects open in this tab: they are uploaded but never replaced while open. */
  openIds: ReadonlySet<string>;
  now?: () => number;
}

const EPOCH = "syncEpoch";

export async function syncOnce(ctx: SyncContext): Promise<SyncReport> {
  const { userId, store, keys, server, openIds } = ctx;
  const now = ctx.now ?? Date.now;
  const report: SyncReport = {
    uploaded: 0, downloaded: 0, conflicts: [], removedHere: 0, removedThere: 0, issues: 0, undecryptable: 0,
    storageUsedBytes: 0, storageQuotaBytes: 0, at: now(),
  };

  const remote = await server.list();
  const lastEpoch = await store.getMeta<string>(EPOCH);
  if (lastEpoch !== undefined && lastEpoch !== remote.syncEpoch) {
    // The cloud was emptied (sync turned off and on, or keys reset): upload everything again.
    await store.forgetSync();
  }
  await store.setMeta(EPOCH, remote.syncEpoch);
  report.storageUsedBytes = remote.storageUsedBytes;
  report.storageQuotaBytes = remote.storageQuotaBytes;

  // 1. Deletions made here travel to the server, unless another device saved a newer version since.
  const byId = new Map(remote.projects.map((r) => [r.id, r]));
  for (const t of await store.tombstones()) {
    const r = byId.get(t.id);
    if (r && r.version === t.version) {
      await server.remove(t.id);
      byId.delete(t.id);
      report.removedThere++;
    }
    await store.clearTombstone(t.id);
  }

  const upload = async (p: Project, base: number, exists: boolean): Promise<void> => {
    if (!exists || p.nameDirty !== false) {
      await server.saveMeta(p.id, p.programId, await sealName(keys, userId, p.id, p.title));
    }
    const payload: Payload = { f: 1, programId: p.programId, data: p.data, createdAt: p.createdAt, updatedAt: p.updatedAt };
    const body = await seal(keys.content, await pack(payload), contentAad(userId, p.id, base + 1));
    if (body.length > remote.maxVersionBytes) {
      await store.setIssue(p.id, "too-large");
      report.issues++;
      return;
    }
    try {
      const done = await server.upload(p.id, base, body);
      await store.markUploaded(p.id, done.version, p.updatedAt, p.title);
      report.uploaded++;
      report.storageUsedBytes = done.storageUsedBytes;
      report.storageQuotaBytes = done.storageQuotaBytes;
    } catch (e) {
      if (e instanceof SyncError && (e.code === "QUOTA_EXCEEDED" || e.code === "TOO_LARGE")) {
        await store.setIssue(p.id, e.code === "QUOTA_EXCEEDED" ? "quota" : "too-large");
        report.issues++;
        return;
      }
      // VERSION_CONFLICT: another device saved in between; the next pass keeps both versions.
      if (e instanceof SyncError && e.code === "VERSION_CONFLICT") return;
      throw e;
    }
  };

  /** Downloads and decrypts the server's latest version; null if this device cannot decrypt it. */
  const fetchRemote = async (r: RemoteProject): Promise<{ version: number; payload: Payload; title: string } | null> => {
    try {
      const { version, body } = await server.download(r.id);
      const payload = await unpack<Payload>(await unseal(keys.content, body, contentAad(userId, r.id, version)));
      return { version, payload, title: await openName(keys, userId, r.id, r.name) };
    } catch (e) {
      if (e instanceof SyncError) throw e;
      // Encrypted with a key this device does not have (or damaged): leave it on the server untouched.
      report.undecryptable++;
      return null;
    }
  };

  const keep = async (r: RemoteProject, got: { version: number; payload: Payload; title: string }): Promise<void> => {
    await store.putFromServer({
      id: r.id, programId: got.payload.programId || r.programId, title: got.title, data: got.payload.data,
      createdAt: got.payload.createdAt, updatedAt: got.payload.updatedAt,
    }, got.version);
    report.downloaded++;
  };

  // 2. Server → device, and uploads for projects both sides know.
  const local = new Map((await store.list()).map((p) => [p.id, p]));
  for (const r of byId.values()) {
    const l = local.get(r.id);
    if (r.version === 0) {
      // Only the name reached the server (the content did not fit or the upload was cut): retry it.
      if (l) await upload(l, 0, true);
      continue;
    }
    if (!l) {
      const got = await fetchRemote(r);
      if (got) await keep(r, got);
      continue;
    }
    const known = typeof l.syncedVersion === "number" ? l.syncedVersion : null;
    if (known === r.version) {
      if (needsUpload(l)) await upload(l, r.version, true);
      else if (l.nameDirty) {
        await server.saveMeta(l.id, l.programId, await sealName(keys, userId, l.id, l.title));
        await store.markNameSynced(l.id, l.title);
      }
      continue;
    }
    if (known !== null && known > r.version) {
      // The server has less than this device saw (it lost versions): this copy is the reference.
      await upload(l, r.version, true);
      continue;
    }
    // The server has a version this device has not seen.
    if (openIds.has(l.id)) continue;
    const got = await fetchRemote(r);
    if (!got) continue;
    if (needsUpload(l) && l.data !== "" && l.data !== got.payload.data) {
      // Changed here and elsewhere: keep this device's version as a copy, then take the server's.
      const title = `${l.title} (copia de este equipo)`;
      await store.copy(l, title, now());
      report.conflicts.push(title);
    }
    await keep(r, got);
  }

  // 3. Projects only on this device: new ones go up; synced ones that vanished were deleted elsewhere.
  for (const l of await store.list()) {
    if (byId.has(l.id)) continue;
    const wasSynced = typeof l.syncedVersion === "number";
    if (wasSynced && !needsUpload(l) && !openIds.has(l.id)) {
      await store.removeLocal(l.id);
      report.removedHere++;
      continue;
    }
    // A project marked "no space" is retried too: space may have been freed since.
    await upload({ ...l, nameDirty: true }, 0, false);
  }
  return report;
}
