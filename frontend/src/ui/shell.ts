import contact from "../data/contacto.json";
import { advice, formatMb, isLite, LiteSetting, liteReasons, readDevice } from "../core/resources";
import { currentUser, logout } from "../core/session";
import { safeStorage } from "../core/storage";
import { h } from "./dom";
import { starIcon } from "./star";
import { cycleTheme, themeLabel, themeSetting } from "./theme";

const LITE_KEY = "estrella:lite";

export function liteSetting(): LiteSetting {
  const v = safeStorage.get(LITE_KEY);
  return v === "on" || v === "off" ? v : "auto";
}

export function liteActive(): boolean {
  return isLite(readDevice(), liteSetting());
}

export function header(): HTMLElement {
  const user = currentUser();
  const themeButton = h("button", { class: "ghost", type: "button", "data-testid": "theme" }, themeLabel(themeSetting()));
  themeButton.addEventListener("click", () => {
    themeButton.textContent = themeLabel(cycleTheme());
  });
  return h("header", { class: "topbar" },
    h("a", { class: "brand", href: "#/" }, starIcon(22, true), h("span", {}, "ESTRELLA")),
    h("nav", { class: "topnav", "aria-label": "Principal" },
      h("a", { class: "ghost", href: "#/guia" }, "Guía"),
      themeButton,
      user ? h("a", { class: "ghost", href: "#/cuenta" }, "Mi cuenta") : null,
      user ? h("button", { class: "ghost", type: "button", onclick: () => { void logout().then(() => (location.hash = "#/ingresar")); } }, "Salir") : null,
    ),
  );
}

export function footer(): HTMLElement {
  return h("footer", { class: "footbar" },
    h("details", { class: "meter", "data-testid": "meter" },
      h("summary", {}, "Consumo de tu equipo"),
      meterBody(),
    ),
    h("nav", { class: "footnav", "aria-label": "Información" },
      h("a", { href: "#/licencias" }, "Licencias"),
      h("a", { href: "#/privacidad" }, "Privacidad"),
      h("a", { href: contact.repository, rel: "noopener noreferrer", target: "_blank" }, "Código fuente"),
      contact.donations.enabled && contact.donations.url
        ? h("a", { href: contact.donations.url, rel: "noopener noreferrer", target: "_blank" }, contact.donations.label ?? "Apoyar")
        : null,
    ),
  );
}

function meterBody(): HTMLElement {
  const box = h("div", { class: "meter-body" });
  let timer: number | null = null;
  const render = async () => {
    const device = readDevice();
    const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
    let storageUsedMb: number | null = null;
    let storageQuotaMb: number | null = null;
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage !== undefined) storageUsedMb = est.usage / 1048576;
      if (est?.quota !== undefined) storageQuotaMb = est.quota / 1048576;
    } catch {
      // Not available in this browser.
    }
    const heapMb = perf.memory ? perf.memory.usedJSHeapSize / 1048576 : null;
    const lite = isLite(device, liteSetting());
    const tips = advice(device, { heapMb, storageUsedMb, storageQuotaMb, projectsMb: storageUsedMb ?? 0 });
    const liteSelect = h("select", { id: "lite", "data-testid": "lite-select" },
      h("option", { value: "auto" }, "Automático"),
      h("option", { value: "on" }, "Activado"),
      h("option", { value: "off" }, "Desactivado"),
    );
    liteSelect.value = liteSetting();
    liteSelect.addEventListener("change", () => {
      safeStorage.set(LITE_KEY, liteSelect.value);
      document.documentElement.classList.toggle("lite", liteActive());
      void render();
    });
    const reasons = liteReasons(device);
    box.replaceChildren(
      h("dl", {},
        h("dt", {}, "Memoria de esta pestaña"), h("dd", {}, formatMb(heapMb)),
        h("dt", {}, "Memoria del equipo"), h("dd", {}, device.memoryGb === null ? "no disponible" : `${device.memoryGb} GB o más`),
        h("dt", {}, "Núcleos del procesador"), h("dd", {}, device.cores === null ? "no disponible" : String(device.cores)),
        h("dt", {}, "Espacio usado en este navegador"), h("dd", {}, `${formatMb(storageUsedMb)} de ${formatMb(storageQuotaMb)}`),
      ),
      h("p", { class: "muted" }, "Los navegadores no permiten leer el uso del procesador ni la temperatura. Mostramos solo lo que se puede medir de verdad."),
      h("label", { for: "lite" }, "Modo ligero"),
      liteSelect,
      h("p", { class: "muted" }, lite
        ? `Modo ligero activo${reasons.length ? `: ${reasons.join(", ")}` : ""}. Sin animaciones ni la estrella 3D.`
        : "Modo ligero apagado."),
      tips.length ? h("ul", { class: "tips" }, ...tips.map((t) => h("li", {}, t))) : h("p", {}, "Todo en orden."),
    );
  };
  const details = () => box.parentElement as HTMLDetailsElement | null;
  queueMicrotask(() => {
    details()?.addEventListener("toggle", () => {
      if (details()?.open) {
        void render();
        timer = window.setInterval(() => {
          if (!box.isConnected && timer !== null) {
            window.clearInterval(timer);
            timer = null;
          } else if (!document.hidden) void render();
        }, 5000);
      } else if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    });
  });
  return box;
}

export function page(main: HTMLElement): HTMLElement {
  return h("div", { class: "app" }, header(), main, footer());
}
