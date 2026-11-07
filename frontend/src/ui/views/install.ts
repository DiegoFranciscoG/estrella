import contact from "../../data/contacto.json";
import { canPromptInstall, detectPlatform, isInstalledApp, onInstallAvailability, promptInstall, type Platform } from "../../core/offline";
import { h } from "../dom";

interface Section {
  platform: Platform;
  title: string;
  steps: (string | HTMLElement)[];
  note?: HTMLElement | string;
}

function windowsInstaller(): HTMLElement {
  const url: string | null = contact.windowsInstaller;
  return h("div", { class: "notice", "data-testid": "windows-installer" },
    h("p", {}, h("strong", {}, "ESTRELLA para Windows (opcional). "),
      "Un archivo de alrededor de 1 MB que se instala solo para tu usuario, sin permisos de administrador. Abre ESTRELLA en su propia ventana y, desde la Guía, instala con un clic los programas libres de escritorio (FreeCAD, Blender, GIMP y otros) desde su fuente oficial."),
    h("p", {}, "No está firmado, porque firmarlo cuesta dinero. Windows mostrará «Windows protegió tu PC»: elige «Más información» y luego «Ejecutar de todas formas». Si prefieres no ver ese aviso, instala ESTRELLA como app web con Edge o Chrome; funciona igual."),
    url
      ? h("a", { class: "button", href: url, rel: "noopener noreferrer", "data-testid": "windows-download" }, "Descargar ESTRELLA para Windows")
      : h("p", { class: "muted" }, "El instalador para Windows se publicará con la primera versión."),
  );
}

function sections(): Section[] {
  return [
    {
      platform: "android", title: "Android",
      steps: ["Abre ESTRELLA en Chrome.", "Toca el menú ⋮.", "Elige «Instalar app» (o «Agregar a la pantalla principal»)."],
    },
    {
      platform: "ios", title: "iPhone y iPad",
      steps: ["Abre ESTRELLA en Safari, Chrome, Edge o Firefox (iOS 16.4 o posterior; antes, solo Safari).", "Toca el botón Compartir.", "Elige «Agregar a inicio» y luego «Agregar»."],
      note: "En iPhone y iPad conviene instalarla: Safari puede borrar los datos de los sitios que no usas por un tiempo, y protege mejor los de las apps de la pantalla de inicio.",
    },
    {
      platform: "windows", title: "Windows",
      steps: ["Abre ESTRELLA en Edge o Chrome.", "Pulsa el ícono de instalar en la barra de direcciones, o el menú … > Aplicaciones > «Instalar este sitio como aplicación»."],
      note: windowsInstaller(),
    },
    {
      platform: "mac", title: "Mac",
      steps: ["En Safari 17 o posterior (macOS Sonoma): menú Archivo > «Añadir al Dock».", "En Chrome o Edge: el ícono de instalar en la barra de direcciones."],
    },
    {
      platform: "linux", title: "Linux",
      steps: ["Abre ESTRELLA en Chrome, Chromium o Edge.", "Pulsa el ícono de instalar en la barra de direcciones."],
      note: "Firefox no instala apps web: ahí ESTRELLA funciona igual, en una pestaña.",
    },
  ];
}

/** Public page: how to install ESTRELLA on each device, with the browser's own button when it offers one. */
export function installView(): HTMLElement {
  const platform = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
  const installed = isInstalledApp();
  const button = h("button", { type: "button", class: "primary", "data-testid": "install-now", hidden: installed || !canPromptInstall() }, "Instalar ESTRELLA");
  const result = h("p", { role: "status" });
  // The browser may offer installation later; once the student left this page, stop listening.
  const stop = onInstallAvailability(() => {
    if (!button.isConnected) stop();
    else button.hidden = installed || !canPromptInstall();
  });
  button.addEventListener("click", async () => {
    const outcome = await promptInstall();
    result.textContent = outcome === "accepted" ? "Listo: ESTRELLA quedó instalada. Ábrela desde el menú de apps de tu equipo." : "No se instaló. Puedes hacerlo cuando quieras.";
    button.hidden = true;
  });

  const ordered = sections().sort((a, b) => Number(b.platform === platform) - Number(a.platform === platform));
  return h("main", { class: "narrow prose", id: "main" },
    h("h1", {}, "Instala ESTRELLA"),
    installed
      ? h("p", { class: "notice", "data-testid": "installed" }, "Ya estás usando ESTRELLA instalada en este equipo.")
      : h("p", { class: "lead" }, "Instalada, ESTRELLA se abre como cualquier app, en su propia ventana, sin tiendas ni descargas pesadas, y se actualiza sola."),
    button,
    result,
    ...ordered.map((s) => h("details", { class: "card install-option", open: s.platform === platform, "data-platform": s.platform },
      h("summary", {}, h("strong", {}, s.title), s.platform === platform ? h("span", { class: "badge" }, "Tu equipo") : null),
      h("ol", {}, ...s.steps.map((step) => h("li", {}, step))),
      typeof s.note === "string" ? h("p", { class: "hint" }, s.note) : s.note ?? null,
    )),
    h("h2", {}, "Sin conexión"),
    h("p", {}, "Con ESTRELLA instalada o ya abierta antes, el panel abre sin internet. Cada programa queda disponible sin conexión después de abrirlo una vez con internet. Tus proyectos se guardan en este equipo; con la nube activada, también cifrados en tu cuenta."),
    h("h2", {}, "Desinstalar"),
    h("p", {}, "Se desinstala como cualquier app. Tus proyectos se quedan en el navegador, salvo que borres también sus datos. Si vas a borrarlos, antes activa la nube o descarga tus datos en Mi cuenta."),
  );
}
