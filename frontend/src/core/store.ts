/**
 * Local project storage in IndexedDB. One database per account, so two students sharing a browser
 * never see each other's projects (test T-08).
 *
 * Crash recovery (test T-03): opening a project marks it "open"; closing it cleanly clears the mark.
 * If a project is found still marked open, the previous session ended abruptly and the last snapshot
 * is what we recovered.
 */

export interface Project {
  id: string;
  programId: string;
  title: string;
  data: string;
  createdAt: number;
  updatedAt: number;
  openSince: number | null;
}

export interface OpenResult {
  project: Project;
  recoveredFrom: number | null;
}

const VERSION = 1;
const PROJECTS = "projects";

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

export class ProjectStore {
  private constructor(private readonly db: IDBDatabase) {}

  static open(userId: string, factory: IDBFactory = indexedDB): Promise<ProjectStore> {
    return new Promise((resolve, reject) => {
      const request = factory.open(databaseName(userId), VERSION);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(PROJECTS, { keyPath: "id" });
        store.createIndex("byUpdated", "updatedAt");
      };
      request.onsuccess = () => resolve(new ProjectStore(request.result));
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("La base local está bloqueada por otra pestaña"));
    });
  }

  close(): void {
    this.db.close();
  }

  private tx(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(PROJECTS, mode, { durability: "strict" }).objectStore(PROJECTS);
  }

  async create(programId: string, title: string, now = Date.now()): Promise<Project> {
    const project: Project = { id: crypto.randomUUID(), programId, title, data: "", createdAt: now, updatedAt: now, openSince: null };
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
    const store = this.tx("readwrite");
    const project = await promisify(store.get(id) as IDBRequest<Project | undefined>);
    if (!project) return;
    await promisify(store.put({ ...project, data, title: title?.trim() || project.title, updatedAt: now }));
  }

  async markClosed(id: string): Promise<void> {
    const store = this.tx("readwrite");
    const project = await promisify(store.get(id) as IDBRequest<Project | undefined>);
    if (project) await promisify(store.put({ ...project, openSince: null }));
  }

  async rename(id: string, title: string): Promise<void> {
    const store = this.tx("readwrite");
    const project = await promisify(store.get(id) as IDBRequest<Project | undefined>);
    if (project) await promisify(store.put({ ...project, title: title.trim() || project.title }));
  }

  remove(id: string): Promise<undefined> {
    return promisify(this.tx("readwrite").delete(id));
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
