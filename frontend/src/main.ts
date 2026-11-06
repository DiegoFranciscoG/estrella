import "./styles.css";
import { isSignedIn, onUserChange, restore } from "./core/session";
import { h } from "./ui/dom";
import { liteActive, page } from "./ui/shell";
import { starSpinner } from "./ui/star";
import { applyTheme } from "./ui/theme";
import { accountView } from "./ui/views/account";
import { forgotView, loginView, registerView, resetView, verifyView } from "./ui/views/auth";
import { licensesView, privacyView } from "./ui/views/legal";
import { panelView } from "./ui/views/panel";
import { programView } from "./ui/views/program";

const root = document.getElementById("root")!;
const PUBLIC = new Set(["ingresar", "registro", "verificar", "olvide", "restablecer", "licencias", "privacidad"]);

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
    case "cuenta": main = accountView(); break;
    case "p": main = param && /^[0-9a-f-]{36}$/i.test(param) ? programView(param) : notFound(); break;
    case "": main = panelView(); break;
    default: main = notFound();
  }
  root.replaceChildren(page(main));
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
  applyTheme();
  document.documentElement.classList.toggle("lite", liteActive());
  root.replaceChildren(h("div", { class: "boot" }, starSpinner("Cargando ESTRELLA")));
  await restore();
  window.addEventListener("hashchange", render);
  onUserChange((u) => { if (!u && !PUBLIC.has(parseHash().route)) location.replace("#/ingresar"); });
  render();
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }
}

void start();
