import { starIcon } from "./star";

/**
 * The single 3D piece: an extruded star made of stacked CSS layers, turning slowly.
 * Loaded on demand and skipped in lite mode or with reduced motion; costs no WebGL and no extra download.
 */
export function mountStar3d(container: HTMLElement, layers = 14): () => void {
  const stage = document.createElement("div");
  stage.className = "star3d";
  stage.setAttribute("aria-hidden", "true");
  const body = document.createElement("div");
  body.className = "star3d-body";
  for (let i = 0; i < layers; i++) {
    const layer = document.createElement("div");
    layer.className = "star3d-layer";
    const depth = i - layers / 2;
    layer.style.transform = `translateZ(${depth * 1.6}px)`;
    // Front and back faces light, sides darker: depth reads in pure grayscale.
    layer.style.color = i === 0 || i === layers - 1 ? "var(--star-face)" : "var(--star-side)";
    layer.appendChild(starIcon(160));
    body.appendChild(layer);
  }
  stage.appendChild(body);
  container.appendChild(stage);

  const pause = () => body.classList.toggle("paused", document.hidden);
  document.addEventListener("visibilitychange", pause);
  return () => {
    document.removeEventListener("visibilitychange", pause);
    stage.remove();
  };
}
