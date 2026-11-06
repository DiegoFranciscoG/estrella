import { api, ApiError } from "../../core/api";
import { assistantStatus, disconnect, safeAuthUrl, startConnection, takeConnectionResult } from "../../core/assistant";
import { exportEverything } from "../../core/exporter";
import { currentUser, deleteAccount } from "../../core/session";
import { ProjectStore } from "../../core/store";
import { syncNow } from "../../core/syncManager";
import { h } from "../dom";
import { megabytes, syncBar } from "../syncBar";

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
    const names: Record<string, string> = { ACCOUNT: "cuenta", PROJECT_SYNC: "nube de proyectos", SECURITY_EMAIL: "avisos de seguridad", AI_ASSISTANT: "asistente de IA" };
    info.replaceChildren(
      h("dt", {}, "Correo"), h("dd", {}, p.email),
      h("dt", {}, "Espacio en la nube"), h("dd", {}, `${megabytes(p.storageUsedBytes)} de ${megabytes(p.storageQuotaBytes)}`),
      h("dt", {}, "Consentimientos activos"), h("dd", {}, p.consents.map((c) => names[c] ?? c).join(", ")),
    );
    renderCloud(p.consents.includes("PROJECT_SYNC"));
    renderAlerts(p.consents.includes("SECURITY_EMAIL"));
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

  // Cloud: consent to keep encrypted copies on the server (LOPDP art. 8), revocable at any time.
  const cloudMessage = h("p", { role: "status" });
  const cloudButton = h("button", { type: "button", "data-testid": "cloud-toggle" });
  let cloudOn = false;
  const renderCloud = (on: boolean) => {
    cloudOn = on;
    cloudButton.textContent = on ? "Desactivar la nube y borrar la copia del servidor" : "Activar la nube";
    cloudButton.className = on ? "ghost" : "primary";
  };
  renderCloud(false);
  cloudButton.hidden = user.offline;
  cloudButton.addEventListener("click", async () => {
    cloudMessage.textContent = "";
    cloudButton.disabled = true;
    try {
      if (!cloudOn) {
        await api("/me/consents/PROJECT_SYNC", { method: "PUT", auth: true });
        renderCloud(true);
        cloudMessage.textContent = "Nube activada. Tus proyectos se cifran en este equipo y se suben.";
        await syncNow();
      } else {
        if (!window.confirm("Se borrará la copia cifrada de tus proyectos en el servidor. En este equipo se quedan. ¿Continuar?")) return;
        const r = await api<{ deletedProjects: number }>("/me/consents/PROJECT_SYNC", { method: "DELETE", auth: true });
        const store = await ProjectStore.open(user.id);
        try {
          await store.forgetSync();
        } finally {
          store.close();
        }
        renderCloud(false);
        await syncNow();
        cloudMessage.textContent = `Nube desactivada. Se borraron ${r.deletedProjects} proyecto(s) del servidor; siguen en este equipo.`;
      }
    } catch (e) {
      cloudMessage.textContent = e instanceof Error ? e.message : "No se pudo cambiar la nube";
    } finally {
      cloudButton.disabled = false;
    }
  });

  // Security emails: optional consent, revocable here (LOPDP art. 8).
  const alertsButton = h("button", { type: "button", class: "ghost", "data-testid": "alerts-toggle", hidden: user.offline });
  let alertsOn = false;
  const renderAlerts = (on: boolean) => {
    alertsOn = on;
    alertsButton.textContent = on ? "Dejar de avisarme por correo cuando se inicie sesión" : "Avisarme por correo cuando se inicie sesión";
  };
  renderAlerts(false);
  alertsButton.addEventListener("click", async () => {
    alertsButton.disabled = true;
    try {
      await api("/me/consents/SECURITY_EMAIL", { method: alertsOn ? "DELETE" : "PUT", auth: true });
      renderAlerts(!alertsOn);
      message.textContent = alertsOn ? "Te avisaremos por correo de cada inicio de sesión." : "Ya no te avisaremos por correo.";
    } catch (e) {
      message.textContent = e instanceof Error ? e.message : "No se pudo cambiar el aviso";
    } finally {
      alertsButton.disabled = false;
    }
  });

  // Assistant: 18+ only (OpenRouter's terms), with its own consent (LOPDP art. 8), revocable here.
  const aiBox = h("div", { "data-testid": "ai-card-body" });
  const aiMessage = h("p", { role: "status", "data-testid": "ai-message" });
  const flash = takeConnectionResult();
  if (flash) {
    aiMessage.textContent = flash.message;
    aiMessage.className = flash.ok ? "" : "error";
  }
  const renderAssistant = async () => {
    if (user.offline) {
      aiBox.replaceChildren(h("p", { class: "muted" }, "Sin conexión: el asistente se configura cuando vuelvas a tener internet."));
      return;
    }
    const s = await assistantStatus();
    if (s.connected) {
      const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-EC", { dateStyle: "medium", timeStyle: "short" }) : "todavía no");
      const off = h("button", { type: "button", class: "ghost", "data-testid": "ai-disconnect" }, "Desconectar y borrar la llave de ESTRELLA");
      off.addEventListener("click", async () => {
        off.disabled = true;
        try {
          const r = await disconnect();
          aiMessage.className = "";
          aiMessage.replaceChildren("Desconectado: ESTRELLA borró la llave. La llave sigue existiendo en tu cuenta de OpenRouter");
          let link: URL | null = null;
          try {
            link = r.keySettingsUrl ? safeAuthUrl(r.keySettingsUrl) : null;
          } catch {
            link = null;
          }
          aiMessage.append(link
            ? h("span", {}, "; puedes borrarla allí: ", h("a", { href: link.toString(), target: "_blank", rel: "noopener noreferrer", "data-testid": "ai-key-link" }, "abrir la llave en OpenRouter"), ".")
            : ", en su página de llaves.");
          await renderAssistant();
        } catch (e) {
          aiMessage.textContent = e instanceof Error ? e.message : "No se pudo desconectar";
          off.disabled = false;
        }
      });
      aiBox.replaceChildren(
        h("p", { "data-testid": "ai-connected" }, `Conectado desde ${when(s.connectedAt)}. Último uso: ${when(s.lastUsedAt)}.`),
        off,
      );
      return;
    }
    const adult = h("input", { type: "checkbox", id: "ai-adult", "data-testid": "ai-adult" });
    const connect = h("button", { type: "button", class: "primary", disabled: true, "data-testid": "ai-connect" }, "Conectar mi cuenta de OpenRouter");
    adult.addEventListener("change", () => { connect.disabled = !adult.checked; });
    connect.addEventListener("click", async () => {
      connect.disabled = true;
      try {
        location.assign(await startConnection(s, "#/cuenta", location.origin));
      } catch (e) {
        aiMessage.textContent = e instanceof Error ? e.message : "No se pudo iniciar la conexión";
        connect.disabled = !adult.checked;
      }
    });
    aiBox.replaceChildren(
      h("ul", { class: "tips" },
        h("li", {}, "Al conectar, OpenRouter crea una llave para ESTRELLA en tu cuenta. ESTRELLA la guarda cifrada en el servidor y nunca llega a este navegador."),
        h("li", {}, "Cada pregunta, solo con lo que tú revisas antes de enviar, va a OpenRouter (Estados Unidos) y al proveedor del modelo. ESTRELLA no guarda preguntas ni respuestas."),
        h("li", {}, "Solo se usan modelos gratuitos: tu cuenta nunca gasta créditos por ESTRELLA. El plan gratuito permite unas 50 preguntas al día."),
      ),
      h("label", { class: "check" }, adult,
        "Tengo 18 años o más. Acepto que mis preguntas se envíen a OpenRouter (Estados Unidos) y al proveedor del modelo, y cumpliré los términos de OpenRouter."),
      connect,
      h("p", { class: "hint" }, "Si tienes menos de 18 años, usa la Guía (sin IA) dentro de cada programa: OpenRouter no admite menores. ",
        h("a", { href: "https://openrouter.ai/terms", target: "_blank", rel: "noopener noreferrer" }, "Términos de OpenRouter"), " · ",
        h("a", { href: "#/privacidad" }, "Aviso de privacidad")),
    );
  };

  // Portability (LOPDP arts. 13 and 17): everything, decrypted here, in common formats.
  const exportMessage = h("p", { role: "status" });
  const exportButton = h("button", { type: "button", "data-testid": "export-all" }, "Descargar todos mis datos (ZIP)");
  exportButton.addEventListener("click", async () => {
    exportButton.disabled = true;
    exportMessage.textContent = "Preparando…";
    try {
      const result = await exportEverything(user);
      const url = URL.createObjectURL(new Blob([result.zip], { type: "application/zip" }));
      const a = h("a", { href: url, download: result.fileName });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      exportMessage.textContent = `Listo: ${result.fileName} con ${result.projects} proyecto(s)${result.includesServerData ? " y los datos de tu cuenta" : "; sin conexión no se incluyeron los datos del servidor"}.`;
    } catch (e) {
      exportMessage.textContent = e instanceof Error ? e.message : "No se pudo exportar";
    } finally {
      exportButton.disabled = false;
    }
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
  void renderAssistant().catch((e) => { aiMessage.textContent = e instanceof Error ? e.message : "No se pudo cargar el asistente"; });

  return h("main", { class: "narrow", id: "main" },
    h("h1", {}, "Mi cuenta"),
    h("section", { class: "card" },
      avatar,
      info,
      h("label", { for: "avatar" }, "Foto de perfil (opcional)"),
      fileInput,
      h("p", { class: "hint" }, "Se recorta y comprime en tu equipo antes de subirla. Máximo 256 KB."),
      removeAvatar,
      alertsButton,
      message,
    ),
    h("section", { class: "card" },
      h("h2", {}, "Tus proyectos en la nube"),
      h("p", {}, "Con la nube activada, tus proyectos se guardan en el servidor para abrirlos en otros equipos. Se cifran en este equipo antes de salir: el servidor, y quien lo administra, no puede leer ni su contenido ni sus nombres."),
      h("p", { class: "hint" }, "Los servidores están fuera de Ecuador. Se guardan las últimas 5 versiones de cada proyecto. Si olvidas tu contraseña y también tu código de recuperación, nadie podrá recuperar la copia de la nube. Puedes desactivarla cuando quieras: se borra del servidor y queda en tus equipos. ", h("a", { href: "#/privacidad" }, "Aviso de privacidad")),
      syncBar(),
      cloudButton,
      cloudMessage,
    ),
    h("section", { class: "card", "aria-labelledby": "ai-title" },
      h("h2", { id: "ai-title" }, "Asistente de IA (opcional, 18 años o más)"),
      h("p", {}, "Responde dudas dentro de cada programa, desde el botón «Ayuda», con modelos de IA gratuitos y tu propia cuenta de OpenRouter."),
      aiBox,
      aiMessage,
    ),
    h("section", { class: "card" },
      h("h2", {}, "Tus datos"),
      h("p", {}, "Descarga en un ZIP todo lo que ESTRELLA guarda sobre ti: los datos de tu cuenta, tus consentimientos y sesiones, tu foto y todos tus proyectos, ya descifrados en este equipo."),
      exportButton,
      exportMessage,
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
