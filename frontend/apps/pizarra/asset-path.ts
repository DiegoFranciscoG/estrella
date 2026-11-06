// Must be the first import of the whiteboard: ES modules run their imports before their own body,
// so setting this inside main.tsx came too late and Excalidraw fell back to a public CDN for fonts.
(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = `${location.origin}/apps/pizarra/`;

export {};
