import { safeStorage } from "../core/storage";

export type ThemeSetting = "system" | "light" | "dark";
const KEY = "estrella:theme";
const listeners = new Set<(t: "light" | "dark") => void>();

export function themeSetting(): ThemeSetting {
  const v = safeStorage.get(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function effectiveTheme(): "light" | "dark" {
  const s = themeSetting();
  if (s !== "system") return s;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(): void {
  const s = themeSetting();
  if (s === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = s;
  const t = effectiveTheme();
  listeners.forEach((l) => l(t));
}

export function cycleTheme(): ThemeSetting {
  const order: ThemeSetting[] = ["system", "light", "dark"];
  const next = order[(order.indexOf(themeSetting()) + 1) % order.length];
  safeStorage.set(KEY, next);
  applyTheme();
  return next;
}

export function onThemeChange(listener: (t: "light" | "dark") => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function themeLabel(s: ThemeSetting): string {
  return s === "system" ? "Tema: sistema" : s === "light" ? "Tema: claro" : "Tema: oscuro";
}

window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
