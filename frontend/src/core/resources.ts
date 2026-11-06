/**
 * What we can honestly know about the device from a web page, and what we advise.
 * Browsers do not expose CPU usage or temperature; we never pretend they do.
 */

export interface DeviceInfo {
  memoryGb: number | null; // navigator.deviceMemory (Chromium only, rounded and capped by the browser)
  cores: number | null;
  saveData: boolean;
  reducedMotion: boolean;
}

export interface Usage {
  heapMb: number | null; // performance.memory (Chromium only)
  storageUsedMb: number | null;
  storageQuotaMb: number | null;
  projectsMb: number;
}

export type LiteSetting = "auto" | "on" | "off";

export function readDevice(nav: Navigator = navigator, win: Window = window): DeviceInfo {
  const n = nav as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return {
    memoryGb: typeof n.deviceMemory === "number" ? n.deviceMemory : null,
    cores: typeof n.hardwareConcurrency === "number" && n.hardwareConcurrency > 0 ? n.hardwareConcurrency : null,
    saveData: n.connection?.saveData === true,
    reducedMotion: typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

/** Lite mode turns off decoration and lowers background work on modest computers. */
export function isLite(device: DeviceInfo, setting: LiteSetting): boolean {
  if (setting === "on") return true;
  if (setting === "off") return false;
  return (device.memoryGb !== null && device.memoryGb <= 4) || (device.cores !== null && device.cores <= 2) || device.saveData;
}

export function liteReasons(device: DeviceInfo): string[] {
  const reasons: string[] = [];
  if (device.memoryGb !== null && device.memoryGb <= 4) reasons.push(`tu equipo informa ${device.memoryGb} GB de memoria`);
  if (device.cores !== null && device.cores <= 2) reasons.push(`tu procesador tiene ${device.cores} núcleos`);
  if (device.saveData) reasons.push("tienes activado el ahorro de datos");
  return reasons;
}

export function advice(device: DeviceInfo, usage: Usage): string[] {
  const tips: string[] = [];
  if (usage.storageUsedMb !== null && usage.storageQuotaMb !== null && usage.storageQuotaMb > 0
      && usage.storageUsedMb / usage.storageQuotaMb > 0.8) {
    tips.push("El espacio del navegador está casi lleno. Exporta y borra proyectos que ya no uses.");
  }
  if (usage.heapMb !== null && device.memoryGb !== null && usage.heapMb > device.memoryGb * 1024 * 0.25) {
    tips.push("Esta pestaña usa mucha memoria. Cierra programas que no estés usando.");
  }
  if (device.memoryGb !== null && device.memoryGb <= 4) {
    tips.push("Con 4 GB o menos, cierra otras pestañas antes de abrir programas grandes.");
  }
  if (usage.projectsMb > 200) {
    tips.push("Tus proyectos ocupan más de 200 MB en este equipo. Exporta los antiguos.");
  }
  return tips;
}

export function formatMb(value: number | null): string {
  if (value === null) return "no disponible";
  if (value < 1) return `${Math.round(value * 1024)} KB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`;
  return `${Math.round(value)} MB`;
}
