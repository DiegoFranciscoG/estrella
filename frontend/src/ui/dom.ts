/** Minimal DOM builder. Text always goes through textContent, never innerHTML, so user data cannot inject markup. */

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = String(value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

export function svg(tag: string, attrs: Record<string, string>, ...children: SVGElement[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  children.forEach((c) => el.appendChild(c));
  return el;
}

/** Announces a message to screen readers and shows it in the status area. */
export function announce(message: string): void {
  const region = document.getElementById("live");
  if (region) region.textContent = message;
}

export function relativeTime(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return "hace un instante";
  if (s < 60) return `hace ${s} segundos`;
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? "hace 1 minuto" : `hace ${m} minutos`;
  const hours = Math.round(m / 60);
  if (hours < 24) return hours === 1 ? "hace 1 hora" : `hace ${hours} horas`;
  return new Date(ms).toLocaleDateString("es-EC", { day: "numeric", month: "short", year: "numeric" });
}
