/**
 * Local project storage in IndexedDB. One database per account, so two students sharing a browser
 * never see each other's projects (test T-08).
 *
 * Crash recovery (test T-03): opening a project marks it "open"; closing it cleanly clears the mark.
 * If a project is found still marked open, the previous session ended abruptly and the last snapshot
 * is what we recovered.
 *
 * Sync bookkeeping (phase 6): each project remembers which server version it matches and whether it
 * changed here since; deletions wait in their own store until the server confirms them.
 */

export type SyncIssue = "quota" | "too-large" | "undecryptable";

export interface Project {
  id: string;
  programId: string;
  title: string;
  data: string;
  createdAt: number;
  updatedAt: number;
  openSince: number | null;
  /** Server version this copy matches; null or missing when it was never uploaded. */
  syncedVersion?: number | null;
  /** Content changed on this device since the last upload (missing means yes: never uploaded). */
  dirty?: boolean;
  /** Title changed on this device since the last upload. */
  nameDirty?: boolean;
  /** Why it could not be uploaded, shown to the student. */
  syncIssue?: SyncIssue | null;
}

export interface Tombstone {
  id: string;
  /** Server version that was deleted here; a newer one (saved elsewhere) is not deleted. */
  version: number;
  deletedAt: number;
}

export interface OpenResult {
  project: Project;
  recoveredFrom: number | null;
}

const VERSION = 2;
const PROJECTS = "projects";
const DELETED = "deleted";
const META = "meta";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function databaseName(userId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid user id");
  return `estrella-${userId.toLowerCase()}`;
}

/** True when the project has something this device has not uploaded yet. */
export function needsUpload(p: Project): boolean {
  return p.dirty !== false || p.syncedVersion === null || p.syncedVersion === undefined;
}

export class ProjectStore {
  private constructor(private readonly db: IDBDatabase) {
    // Another tab upgrading the database must not be blocked by this one: close and let it in.
    db.onversionchange = () => db.close();
  }

  static open(userId: string, factory: IDBFactory = indexedDB): Promise<ProjectStore> {
    return new Promise((resolve, reject) => {
      const request = factory.open(databaseName(userId), VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (event.oldVersion < 1) {
          const store = db.createObjectStore(PROJECTS, { keyPath: "id" });
          store.createIndex("byUpdated", "updatedAt");
        }
        if (event.oldVersion < 2) {
          db.createObjectStore(DELETED, { keyPath: "id" });
          db.createObjectStore(META);
        }
      };
      request.onsuccess = () => resolve(new ProjectStore(request.result));
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("La base local está bloqueada por otra pestaña"));
    });
  }

  close(): void {
    this.db.close();
  }

  private tx(mode: IDBTransactionMode, name = PROJECTS): IDBObjectStore {
    return this.db.transaction(name, mode, { durability: "strict" }).objectStore(name);
  }

  private async update(id: string, change: (p: Project) => Project | null): Promise<Project | undefined> {
    const store = this.tx("readwrite");
    const project = await promisify(store.get(id) as IDBRequest<Project | undefined>);
    if (!project) return undefined;
    const next = change(project);
    if (next) await promisify(store.put(next));
    return next ?? project;
  }

  async create(programId: string, title: string, now = Date.now()): Promise<Project> {
    const project: Project = {
      id: crypto.randomUUID(), programId, title, data: "", createdAt: now, updatedAt: now, openSince: null,
      syncedVersion: null, dirty: true, nameDirty: true, syncIssue: null,
    };
    await promisify(this.tx("readwrite").add(project));
    return project;
  }

  /** A second copy of a project under a new id (used to keep both sides of a conflict). */
  async copy(source: Project, title: string, now = Date.now()): Promise<Project> {
    const project: Project = {
      id: crypto.randomUUID(), programId: source.programId, title, data: source.data, createdAt: now,
      updatedAt: source.updatedAt, openSince: null, syncedVersion: null, dirty: true, nameDirty: true, syncIssue: null,
    };
    await promisify(this.tx("readwrite").add(project));
    return project;
  }

  get(id: string): Promise<Project | undefined> {
    return promisify(this.tx("readonly").get(id));
  }

  async list(): Promise<Project[]> {
    const all = await promisify(this.tx("readonly").getAll() as IDBRequest<Project[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async open(id: string, now = Date.now()): Promise<OpenResult> {
    const project = await this.get(id);
    if (!project) throw new Error("El proyecto no existe en este dispositivo");
    const recoveredFrom = project.openSince !== null && project.data !== "" ? project.updatedAt : null;
    const updated = { ...project, openSince: now };
    await promisify(this.tx("readwrite").put(updated));
    return { project: updated, recoveredFrom };
  }

  async saveSnapshot(id: string, data: string, title: string | undefined, now = Date.now()): Promise<void> {
    await this.update(id, (p) => {
      const nextTitle = title?.trim() || p.title;
      // The final flush when closing repeats the last state: nothing changed, nothing to upload.
      if (data === p.data && nextTitle === p.title) return null;
      return { ...p, data, title: nextTitle, updatedAt: now, dirty: true, nameDirty: p.nameDirty || nextTitle !== p.title };
    });
  }

  async markClosed(id: string): Promise<void> {
    await this.update(id, (p) => ({ ...p, openSince: null }));
  }

  async rename(id: string, title: string): Promise<void> {
    await this.update(id, (p) => ({ ...p, title: title.trim() || p.title, nameDirty: true }));
  }

  /** Deletes here; a project that exists on the server is remembered so the server copy goes too. */
  async remove(id: string, now = Date.now()): Promise<undefined> {
    const project = await this.get(id);
    if (project && typeof project.syncedVersion === "number") {
      await promisify(this.tx("readwrite", DELETED).put({ id, version: project.syncedVersion, deletedAt: now } satisfies Tombstone));
    }
    return promisify(this.tx("readwrite").delete(id));
  }

  /** Deletes here only (it was already deleted on another device). */
  removeLocal(id: string): Promise<undefined> {
    return promisify(this.tx("readwrite").delete(id));
  }

  tombstones(): Promise<Tombstone[]> {
    return promisify(this.tx("readonly", DELETED).getAll() as IDBRequest<Tombstone[]>);
  }

  clearTombstone(id: string): Promise<undefined> {
    return promisify(this.tx("readwrite", DELETED).delete(id));
  }

  /**
   * After an upload of `version`: the project is clean only if nothing changed while it was in
   * flight (same updatedAt and title as what was sent).
   */
  async markUploaded(id: string, version: number, sentUpdatedAt: number, sentTitle: string): Promise<void> {
    await this.update(id, (p) => ({
      ...p,
      syncedVersion: version,
      dirty: p.updatedAt !== sentUpdatedAt,
      nameDirty: p.title !== sentTitle,
      syncIssue: null,
    }));
  }

  async markNameSynced(id: string, sentTitle: string): Promise<void> {
    await this.update(id, (p) => ({ ...p, nameDirty: p.title !== sentTitle }));
  }

  async setIssue(id: string, issue: SyncIssue | null): Promise<void> {
    await this.update(id, (p) => (p.syncIssue === issue ? null : { ...p, syncIssue: issue }));
  }

  /** Puts the server's version here, replacing the local copy (which had no unsent changes). */
  async putFromServer(p: Omit<Project, "openSince" | "dirty" | "nameDirty" | "syncIssue" | "syncedVersion">, version: number): Promise<void> {
    const store = this.tx("readwrite");
    const existing = await promisify(store.get(p.id) as IDBRequest<Project | undefined>);
    await promisify(store.put({
      ...p, openSince: existing?.openSince ?? null, syncedVersion: version, dirty: false, nameDirty: false, syncIssue: null,
    } satisfies Project));
  }

  /** The server's copy was emptied (new sync epoch): every project here counts as never uploaded. */
  async forgetSync(): Promise<void> {
    const store = this.tx("readwrite");
    const all = await promisify(store.getAll() as IDBRequest<Project[]>);
    for (const p of all) await promisify(store.put({ ...p, syncedVersion: null, dirty: true, nameDirty: true, syncIssue: null }));
    const deleted = this.tx("readwrite", DELETED);
    await promisify(deleted.clear());
  }

  getMeta<T>(key: string): Promise<T | undefined> {
    return promisify(this.tx("readonly", META).get(key) as IDBRequest<T | undefined>);
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await promisify(this.tx("readwrite", META).put(value, key));
  }

  async deleteMeta(key: string): Promise<void> {
    await promisify(this.tx("readwrite", META).delete(key));
  }

  /** Approximate bytes used by this account's projects (strings are UTF-16 in memory). */
  async usedBytes(): Promise<number> {
    const all = await this.list();
    return all.reduce((sum, p) => sum + (p.data.length + p.title.length) * 2, 0);
  }

  static deleteAll(userId: string, factory: IDBFactory = indexedDB): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = factory.deleteDatabase(databaseName(userId));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
