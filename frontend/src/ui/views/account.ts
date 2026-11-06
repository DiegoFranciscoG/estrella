import { api, ApiError } from "../../core/api";
import { currentUser, deleteAccount } from "../../core/session";
import { ProjectStore } from "../../core/store";
import { h } from "../dom";

interface Profile {
  email: string;
  hasAvatar: boolean;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  consents: string[];
}

const AVATAR_SIZE = 256;
const MAX_AVATAR_BYTES = 262_144;

/** Crops to a centered square and compresses on the device, so the upload is small and metadata-free. */
async function compressAvatar(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Elige una imagen");
  if (file.size > 20 * 1048576) throw new Error("La imagen pesa demasiado");
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", quality));
    if (blob && blob.size <= MAX_AVATAR_BYTES && blob.type === "image/webp") return blob;
    const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (jpeg && jpeg.size <= MAX_AVATAR_BYTES) return jpeg;
  }
  throw new Error("No se pudo comprimir la imagen");
}

export function accountView(): HTMLElement {
  const user = currentUser()!;
  const avatar = h("img", { class: "avatar", alt: "Tu foto de perfil", width: 96, height: 96, hidden: true });
  const info = h("dl", { class: "facts" });
  const message = h("p", { role: "status" });
  const fileInput = h("input", { id: "avatar", type: "file", accept: "image/png,image/jpeg,image/webp" });
  const removeAvatar = h("button", { type: "button", class: "ghost", hidden: true }, "Quitar foto");

  const loadAvatar = async (has: boolean) => {
    if (avatar.src) URL.revokeObjectURL(avatar.src);
    avatar.hidden = !has;
    removeAvatar.hidden = !has;
    if (has) avatar.src = URL.createObjectURL(await api<Blob>("/me/avatar", { auth: true, binary: true }));
  };

  const load = async () => {
    if (user.offline) {
      info.replaceChildren(h("dt", {}, "Correo"), h("dd", {}, user.email));
      message.textContent = "Sin conexión: los cambios de cuenta estarán disponibles al volver.";
      return;
    }
    const p = await api<Profile>("/me", { auth: true });
    info.replaceChildren(
      h("dt", {}, "Correo"), h("dd", {}, p.email),
      h("dt", {}, "Espacio de sincronización"), h("dd", {}, `${(p.storageUsedBytes / 1048576).toFixed(1)} MB de ${(p.storageQuotaBytes / 1048576).toFixed(0)} MB`),
      h("dt", {}, "Consentimientos"), h("dd", {}, p.consents.join(", ").replace("ACCOUNT", "cuenta").replace("PROJECT_SYNC", "sincronizar proyectos").replace("SECURITY_EMAIL", "avisos de seguridad")),
    );
    await loadAvatar(p.hasAvatar);
  };

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const blob = await compressAvatar(file);
      const form = new FormData();
      form.append("file", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg");
      await api("/me/avatar", { method: "PUT", auth: true, form });
      message.textContent = `Foto actualizada (${Math.round(blob.size / 1024)} KB).`;
      await loadAvatar(true);
    } catch (e) {
      message.textContent = e instanceof Error ? e.message : "No se pudo subir la foto";
    }
    fileInput.value = "";
  });
  removeAvatar.addEventListener("click", async () => {
    await api("/me/avatar", { method: "DELETE", auth: true });
    await loadAvatar(false);
    message.textContent = "Foto quitada.";
  });

  const password = h("input", { id: "delete-password", type: "password", autocomplete: "current-password" });
  const deleteError = h("p", { class: "error", role: "alert" });
  const deleteButton = h("button", { type: "button", class: "danger", "data-testid": "delete-account" }, "Borrar mi cuenta para siempre");
  deleteButton.addEventListener("click", async () => {
    deleteError.textContent = "";
    if (!password.value) {
      deleteError.textContent = "Escribe tu contraseña para confirmar.";
      return;
    }
    if (!window.confirm("Se borrarán tu cuenta y todo lo sincronizado. ¿Continuar?")) return;
    deleteButton.disabled = true;
    try {
      const id = user.id;
      await deleteAccount(password.value);
      await ProjectStore.deleteAll(id).catch(() => undefined);
      location.hash = "#/ingresar";
    } catch (e) {
      deleteError.textContent = e instanceof ApiError ? e.message : "No se pudo borrar la cuenta";
    } finally {
      deleteButton.disabled = false;
    }
  });

  void load().catch((e) => { message.textContent = e instanceof Error ? e.message : "No se pudo cargar tu cuenta"; });

  return h("main", { class: "narrow", id: "main" },
    h("h1", {}, "Mi cuenta"),
    h("section", { class: "card" },
      avatar,
      info,
      h("label", { for: "avatar" }, "Foto de perfil (opcional)"),
      fileInput,
      h("p", { class: "hint" }, "Se recorta y comprime en tu equipo antes de subirla. Máximo 256 KB."),
      removeAvatar,
      message,
    ),
    h("section", { class: "card" },
      h("h2", {}, "Borrar cuenta"),
      h("p", {}, "Borra tu cuenta, tu foto, tus sesiones y tus proyectos sincronizados del servidor, y los proyectos de este equipo. No se puede deshacer."),
      h("label", { for: "delete-password" }, "Tu contraseña"),
      password,
      deleteError,
      deleteButton,
    ),
  );
}
