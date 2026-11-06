/**
 * "Download all my data" (LOPDP arts. 13 and 17): one ZIP with what the server keeps about the
 * account and every project, decrypted here, in common machine-readable formats (JSON, TXT).
 */
import { programs } from "./catalog";
import { api } from "./api";
import type { User } from "./session";
import { Project, ProjectStore } from "./store";
import { syncNow, syncStatus } from "./syncManager";
import { makeZip, ZipEntry } from "./zip";

const enc = new TextEncoder();

export interface ExportResult {
  zip: Uint8Array<ArrayBuffer>;
  fileName: string;
  projects: number;
  includesServerData: boolean;
}

function slug(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "proyecto";
}

function projectFile(p: Project): ZipEntry {
  let data: unknown = p.data;
  try {
    data = p.data ? JSON.parse(p.data) : "";
  } catch {
    // Not JSON (plain text programs): kept as text.
  }
  const body = {
    formato: "estrella-proyecto/1",
    id: p.id,
    programa: p.programId,
    nombrePrograma: programs.find((x) => x.id === p.programId)?.name ?? p.programId,
    titulo: p.title,
    creado: new Date(p.createdAt).toISOString(),
    actualizado: new Date(p.updatedAt).toISOString(),
    datos: data,
  };
  return { name: `proyectos/${slug(p.title)}-${p.id.slice(0, 8)}.json`, data: enc.encode(JSON.stringify(body, null, 2)), date: new Date(p.updatedAt) };
}

function readme(user: User, count: number, server: boolean, now: Date): string {
  return [
    "ESTRELLA - Tus datos",
    `Exportado el ${now.toISOString()} para ${user.email}.`,
    "",
    "Qué contiene:",
    "- datos-personales.json: lo que el servidor guarda sobre tu cuenta (correo, fechas, consentimientos con su",
    "  versión del aviso de privacidad, sesiones, programas usados, el tamaño de cada versión sincronizada y, si",
    "  conectaste el asistente, cuándo lo conectaste y lo usaste por última vez; nunca la llave de OpenRouter).",
    server ? "" : "  No se incluyó: estabas sin conexión. Vuelve a exportar con conexión para tenerlo.",
    `- proyectos/: tus ${count} proyecto(s) de este equipo, ya descifrados, en JSON (un archivo por proyecto).`,
    "  El campo \"datos\" es el formato propio de cada programa. Para llevar un plano a otro programa, ábrelo en",
    "  Plano y usa Exportar DXF; un PDF de Folio, con Descargar PDF.",
    "- foto-de-perfil: solo si subiste una.",
    "",
    "El servidor no puede leer tus proyectos: llegan cifrados desde tu equipo. Por eso este archivo se arma aquí.",
    "Guárdalo en un lugar seguro: contiene tus proyectos sin cifrar.",
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\r\n") + "\r\n";
}

export async function exportEverything(user: User, now = new Date()): Promise<ExportResult> {
  // Bring the cloud's latest versions to this device first, so the export has everything.
  const state = syncStatus().state;
  if (state === "idle" || state === "error") await syncNow();

  const store = await ProjectStore.open(user.id);
  let projects: Project[];
  try {
    projects = await store.list();
  } finally {
    store.close();
  }

  const files: ZipEntry[] = [];
  let serverData: { account?: { hasAvatar?: boolean } } | null = null;
  if (!user.offline) {
    try {
      serverData = await api("/me/export", { auth: true });
    } catch {
      serverData = null;
    }
  }
  files.push({ name: "LEEME.txt", data: enc.encode(readme(user, projects.length, serverData !== null, now)), date: now });
  if (serverData) {
    files.push({ name: "datos-personales.json", data: enc.encode(JSON.stringify(serverData, null, 2)), date: now });
    if (serverData.account?.hasAvatar) {
      try {
        const photo = await api<Blob>("/me/avatar", { auth: true, binary: true });
        const ext = photo.type === "image/png" ? "png" : photo.type === "image/jpeg" ? "jpg" : "webp";
        files.push({ name: `foto-de-perfil.${ext}`, data: new Uint8Array(await photo.arrayBuffer()), date: now });
      } catch {
        // The photo is optional; the rest of the export still goes.
      }
    }
  }
  files.push(...projects.map(projectFile));
  return {
    zip: makeZip(files),
    fileName: `estrella-mis-datos-${now.toISOString().slice(0, 10)}.zip`,
    projects: projects.length,
    includesServerData: serverData !== null,
  };
}
