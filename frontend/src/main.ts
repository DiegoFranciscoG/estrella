import "./styles.css";
import { finishConnection } from "./core/assistant";
import { captureInstallPrompt, registerPanelWorker } from "./core/offline";
import { currentUser, isSignedIn, onUserChange, restore } from "./core/session";
import { h } from "./ui/dom";
import { header, liteActive, page } from "./ui/shell";
import { starSpinner } from "./ui/star";
import { applyTheme } from "./ui/theme";
import { showUpdateBanner } from "./ui/updateBanner";
import { accountView } from "./ui/views/account";
import { guideView } from "./ui/views/guide";
import { forgotView, loginView, registerView, resetView, verifyView } from "./ui/views/auth";
import { installView } from "./ui/views/install";
import { licensesView, privacyView } from "./ui/views/legal";
import { panelView } from "./ui/views/panel";
import { programView } from "./ui/views/program";

const root = document.getElementById("root")!;
const PUBLIC = new Set(["ingresar", "registro", "verificar", "olvide", "restablecer", "licencias", "privacidad", "guia", "instalar"]);

function parseHash(): { route: string; param: string | null; query: URLSearchParams } {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, queryString = ""] = raw.split("?");
  const [route = "", param = null] = path.split("/");
  return { route, param, query: new URLSearchParams(queryString) };
}

function render(): void {
  const { route, param, query } = parseHash();
  if (!PUBLIC.has(route) && !isSignedIn()) {
    location.replace("#/ingresar");
    return;
  }
  if ((route === "ingresar" || route === "registro") && isSignedIn()) {
    location.replace("#/");
    return;
  }
  let main: HTMLElement;
  switch (route) {
    case "ingresar": main = loginView(); break;
    case "registro": main = registerView(); break;
    case "verificar": main = verifyView(query.get("token")); break;
    case "olvide": main = forgotView(); break;
    case "restablecer": main = resetView(query.get("token")); break;
    case "licencias": main = licensesView(); break;
    case "privacidad": main = privacyView(); break;
    case "guia": main = guideView(query); break;
    case "instalar": main = installView(); break;
    case "cuenta": main = accountView(); break;
    case "p": main = param && /^[0-9a-f-]{36}$/i.test(param) ? programView(param) : notFound(); break;
    case "": main = panelView(); break;
    default: main = notFound();
  }
  // Programs get the whole screen height: no footer, the frame fills what is left under the bar.
  root.replaceChildren(route === "p" ? h("div", { class: "app app-program" }, header(), main) : page(main));
  // Tokens from email links must not stay in the address bar or the history.
  if (query.has("token")) history.replaceState(null, "", `#/${route}`);
  // On route changes focus moves to the new page's title, as a screen reader user expects. On the
  // first load it stays at the top, so Tab reaches "Saltar al contenido" first.
  const heading = main.querySelector("h1");
  if (heading && !firstRender) {
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  }
  firstRender = false;
}

let firstRender = true;

function notFound(): HTMLElement {
  return h("main", { class: "narrow", id: "main" }, h("h1", {}, "No encontramos esa página"), h("a", { href: "#/" }, "Ir al panel"));
}

async function start(): Promise<void> {
  // The browser may offer installation right away; keep the offer for the "Instalar" page.
  captureInstallPrompt();
  applyTheme();
  document.documentElement.classList.toggle("lite", liteActive());
  root.replaceChildren(h("div", { class: "boot" }, starSpinner("Cargando ESTRELLA")));
  await restore();
  // OpenRouter sends the student back to this site's root with ?code=…&state=…: the code is
  // handed to the server and removed from the address bar before anything renders.
  await finishConnection(isSignedIn() && !currentUser()?.offline);
  window.addEventListener("hashchange", render);
  onUserChange((u) => { if (!u && !PUBLIC.has(parseHash().route)) location.replace("#/ingresar"); });
  render();
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    registerPanelWorker(showUpdateBanner).catch(() => undefined);
  }
}

void start();
