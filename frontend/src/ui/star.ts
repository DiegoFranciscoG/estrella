import { svg } from "./dom";

/** The only brand element: a five-pointed star, drawn for this project. */
export const STAR_PATH = "M50 4 L61.8 37.6 L97.6 38.2 L69.1 59.9 L79.4 94.1 L50 73.8 L20.6 94.1 L30.9 59.9 L2.4 38.2 L38.2 37.6 Z";

export function starIcon(size = 24, filled = true, label?: string): SVGElement {
  const el = svg("svg", {
    viewBox: "0 0 100 100",
    width: String(size),
    height: String(size),
    class: "star",
    ...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true", focusable: "false" }),
  }, svg("path", {
    d: STAR_PATH,
    fill: filled ? "currentColor" : "none",
    stroke: "currentColor",
    "stroke-width": filled ? "0" : "6",
    "stroke-linejoin": "round",
  }));
  return el;
}

/** Loading indicator: the star outline drawing itself. Static when motion is reduced. */
export function starSpinner(label = "Cargando"): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "spinner";
  wrap.setAttribute("role", "status");
  wrap.appendChild(starIcon(28, false));
  const text = document.createElement("span");
  text.className = "visually-hidden";
  text.textContent = label;
  wrap.appendChild(text);
  return wrap;
}
