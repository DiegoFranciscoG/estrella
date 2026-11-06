import "./asset-path";
import { Excalidraw, getSceneVersion, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { connect, Theme } from "../shared/bridge";
import "./pizarra.css";

type Api = Parameters<NonNullable<Parameters<typeof Excalidraw>[0]["excalidrawAPI"]>>[0];
type InitialData = Parameters<typeof Excalidraw>[0]["initialData"];

let api: Api | null = null;
let lastVersion = -1;
let lastFiles = 0;
let render: ((scene: InitialData, theme: Theme) => void) | null = null;
/** The document can arrive before React mounts; keep it until the component asks for it. */
let pending: { data: InitialData; theme: Theme } | null = null;
let theme: Theme = "light";

const bridge = connect({
  load(data) {
    let scene: InitialData = null;
    if (data) {
      try {
        const parsed = JSON.parse(data);
        scene = { elements: parsed.elements ?? [], appState: { ...(parsed.appState ?? {}), collaborators: new Map() }, files: parsed.files ?? {} };
      } catch {
        scene = null;
      }
    }
    pending = { data: scene, theme };
    render?.(scene, theme);
  },
  serialize() {
    if (!api) return "";
    return serializeAsJSON(api.getSceneElements(), api.getAppState(), api.getFiles(), "local");
  },
  onTheme(next) {
    theme = next;
    api?.updateScene({ appState: { theme: next } });
  },
});

function App() {
  const [scene, setScene] = useState<{ data: InitialData; theme: Theme } | null>(() => pending);
  render = (data, t) => setScene({ data, theme: t });
  if (!scene) return null;
  return (
    <Excalidraw
      initialData={scene.data}
      theme={scene.theme}
      langCode="es-ES"
      excalidrawAPI={(a) => (api = a)}
      UIOptions={{ canvasActions: { loadScene: true, saveToActiveFile: false, export: { saveFileToDisk: true } } }}
      onChange={(elements, _appState, files) => {
        // Panning and selection also call onChange; only real edits count as changes.
        const version = getSceneVersion(elements);
        const fileCount = Object.keys(files).length;
        if (lastVersion === -1) {
          lastVersion = version;
          lastFiles = fileCount;
          return;
        }
        if (version !== lastVersion || fileCount !== lastFiles) {
          lastVersion = version;
          lastFiles = fileCount;
          bridge.changed();
        }
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
