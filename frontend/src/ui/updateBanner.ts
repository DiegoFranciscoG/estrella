import type { UpdateOffer } from "../core/offline";
import { announce, h } from "./dom";
import { saveOpenProgram } from "./views/program";

/**
 * Offers a new version without forcing it: the student finishes what they are doing and chooses
 * when. Updating first saves the open program, then reloads into the same place.
 */
export function showUpdateBanner(offer: UpdateOffer): void {
  if (document.querySelector('[data-testid="update-banner"]')) return;
  const later = h("button", { type: "button", class: "ghost small" }, "Más tarde");
  const now = h("button", { type: "button", class: "primary small", "data-testid": "update-now" }, "Actualizar ahora");
  const banner = h("div", { class: "update-banner", role: "status", "data-testid": "update-banner" },
    h("span", {}, "Hay una versión nueva de ESTRELLA. Tu trabajo se guarda antes de actualizar."),
    h("div", { class: "row" }, now, later),
  );
  later.addEventListener("click", () => banner.remove());
  now.addEventListener("click", async () => {
    now.disabled = true;
    later.disabled = true;
    now.textContent = "Guardando…";
    await saveOpenProgram();
    offer.activate();
  });
  document.body.append(banner);
  announce("Hay una versión nueva de ESTRELLA");
}
