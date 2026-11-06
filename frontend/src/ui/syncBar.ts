import { ApiError } from "../core/api";
import { unlockSync } from "../core/session";
import { onSyncStatus, SyncStatus, syncNow } from "../core/syncManager";
import { h, relativeTime } from "./dom";

export function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toLocaleString("es-EC", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;
}

/** One line that always says where the student's work is: here only, in the cloud, or on its way. */
export function syncBar(): HTMLElement {
  const text = h("span", { "data-testid": "sync-text" });
  const actions = h("span", { class: "sync-actions" });
  const bar = h("div", { class: "sync-bar", "data-testid": "sync-bar" },
    h("strong", {}, "Nube: "), h("span", { role: "status", "aria-live": "polite" }, text), actions);

  const retry = (label: string) => h("button", { type: "button", class: "ghost small", onclick: () => void syncNow() }, label);

  const unlockForm = () => {
    const password = h("input", { id: "unlock-password", type: "password", autocomplete: "current-password", "aria-label": "Tu contraseña" });
    const error = h("span", { class: "error", role: "alert" });
    const form = h("form", { class: "unlock" }, password,
      h("button", { type: "submit", class: "small" }, "Desbloquear"), error);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.textContent = "";
      try {
        await unlockSync(password.value);
      } catch (err) {
        error.textContent = err instanceof ApiError ? err.message : "No se pudo desbloquear.";
      }
    });
    return form;
  };

  const render = (s: SyncStatus): void => {
    if (!bar.isConnected && bar.dataset.mounted) {
      unsubscribe();
      return;
    }
    bar.dataset.state = s.state;
    switch (s.state) {
      case "off":
        text.textContent = s.message || "desactivada. Tus proyectos quedan solo en este equipo.";
        actions.replaceChildren(h("a", { href: "#/cuenta" }, "Activar en Mi cuenta"));
        break;
      case "locked":
        text.textContent = "bloqueada en este equipo. Escribe tu contraseña para sincronizar (no sale de tu equipo).";
        actions.replaceChildren(unlockForm());
        break;
      case "syncing":
        text.textContent = "sincronizando…";
        actions.replaceChildren();
        break;
      case "offline":
      case "error":
        text.textContent = s.message;
        actions.replaceChildren(retry("Reintentar"));
        break;
      case "idle": {
        const r = s.report;
        const parts = [s.lastSync ? `sincronizada ${relativeTime(s.lastSync)}` : "lista"];
        if (r && r.storageQuotaBytes) parts.push(`${megabytes(r.storageUsedBytes)} de ${megabytes(r.storageQuotaBytes)}`);
        if (r?.conflicts.length) parts.push(`otro equipo cambió lo mismo: guardamos tu versión como «${r.conflicts.join("», «")}»`);
        if (r?.undecryptable) parts.push(`${r.undecryptable} proyecto(s) de la nube no se pueden abrir con la llave de este equipo`);
        if (s.message) parts.push(s.message);
        text.textContent = parts.join(" · ") + ".";
        actions.replaceChildren(retry("Sincronizar ahora"));
        break;
      }
    }
  };
  const unsubscribe = onSyncStatus(render);
  bar.dataset.mounted = "1";
  return bar;
}
