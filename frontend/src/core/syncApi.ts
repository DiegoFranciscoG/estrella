import { api, ApiError, apiResponse } from "./api";
import { fromBase64, toBase64 } from "./crypto";
import { RemoteList, SyncError, SyncServer, Uploaded } from "./sync";
import { sha256Base64 } from "./vault";

type Bytes = Uint8Array<ArrayBuffer>;

interface ListBody {
  projects: { id: string; programId: string; name: string; version: number; sizeBytes: number }[];
  storageUsedBytes: number;
  storageQuotaBytes: number;
  maxVersionBytes: number;
  syncEpoch: string;
}

function asSyncError(e: unknown): unknown {
  if (e instanceof ApiError) {
    const current = typeof e.details.currentVersion === "number" ? e.details.currentVersion : undefined;
    return new SyncError(e.code, e.status, e.message, current);
  }
  return e;
}

async function call(path: string, opts: Parameters<typeof apiResponse>[1]): Promise<Response> {
  try {
    return await apiResponse(path, { ...opts, auth: true });
  } catch (e) {
    throw asSyncError(e);
  }
}

const versionOf = (etag: string | null): number => {
  const m = /^"(\d+)"$/.exec(etag ?? "");
  if (!m) throw new SyncError("BAD_RESPONSE", 0, "El servidor no indicó la versión");
  return Number(m[1]);
};

/** The sync API over HTTP (backend: ProjectController). Every body it sends is already encrypted. */
export const httpSyncServer: SyncServer = {
  /** From the profile's consents. When unsure (offline, for example), the sync pass decides. */
  async enabled(): Promise<boolean> {
    try {
      const profile = await api<{ consents: string[] }>("/me", { auth: true });
      return profile.consents.includes("PROJECT_SYNC");
    } catch {
      return true;
    }
  },

  async list(): Promise<RemoteList> {
    const body = (await (await call("/projects", {})).json()) as ListBody;
    return { ...body, projects: body.projects.map((p) => ({ ...p, name: fromBase64(p.name) })) };
  },

  async saveMeta(id: string, programId: string, name: Bytes): Promise<void> {
    await call(`/projects/${id}`, { method: "PUT", body: { programId, name: toBase64(name) } });
  },

  async upload(id: string, baseVersion: number, body: Bytes): Promise<Uploaded> {
    const response = await call(`/projects/${id}/content`, {
      method: "PUT",
      raw: body,
      headers: { "If-Match": `"${baseVersion}"`, "X-Content-SHA256": await sha256Base64(body) },
    });
    return (await response.json()) as Uploaded;
  },

  async download(id: string): Promise<{ version: number; body: Bytes }> {
    const response = await call(`/projects/${id}/content`, {});
    const body = new Uint8Array(await response.arrayBuffer());
    // Integrity on top of the encryption tag: a truncated download is caught before decrypting.
    const declared = response.headers.get("X-Content-SHA256");
    if (declared && declared !== (await sha256Base64(body))) {
      throw new SyncError("INTEGRITY", 0, "La descarga llegó incompleta");
    }
    return { version: versionOf(response.headers.get("ETag")), body };
  },

  async remove(id: string): Promise<void> {
    try {
      await call(`/projects/${id}`, { method: "DELETE" });
    } catch (e) {
      // Already gone (deleted from another device): that is what we wanted.
      if (!(e instanceof SyncError && e.status === 404)) throw e;
    }
  },
};
