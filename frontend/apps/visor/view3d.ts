/**
 * 3D viewer (three.js, MIT). Loaded only when a 3D file is opened. It renders on demand, when the
 * camera moves or the window changes, instead of 60 times per second: on a modest laptop an idle
 * model costs no CPU or battery.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";

export interface ModelInfo {
  triangles: number;
  size: { x: number; y: number; z: number };
}

export interface Viewer3D {
  info: ModelInfo;
  fit(): void;
  setWireframe(on: boolean): void;
  setTheme(dark: boolean): void;
  exportAs(format: "stl" | "obj" | "glb"): Promise<Blob>;
  snapshot(): Promise<Blob>;
  dispose(): void;
}

const GRAY = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide });

function meshFromGeometry(geometry: THREE.BufferGeometry): THREE.Mesh {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const material = geometry.getAttribute("color")
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide })
    : GRAY;
  return new THREE.Mesh(geometry, material);
}

/** Print and CAD formats are Z-up; three.js is Y-up. Without this, models open lying on their back. */
function zUp(object: THREE.Object3D): THREE.Object3D {
  const holder = new THREE.Group();
  object.rotation.x = -Math.PI / 2;
  holder.add(object);
  return holder;
}

/** Parses a mesh file already in memory. Nothing is fetched: external references are not followed. */
export async function parseMesh(subtype: string, bytes: Uint8Array): Promise<THREE.Object3D> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  switch (subtype) {
    case "stl":
      return zUp(meshFromGeometry(new STLLoader().parse(buffer)));
    case "ply":
      return zUp(meshFromGeometry(new PLYLoader().parse(buffer)));
    case "obj": {
      const group = new OBJLoader().parse(new TextDecoder().decode(bytes));
      group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = GRAY; });
      return group;
    }
    case "3mf":
      return zUp(new ThreeMFLoader().parse(buffer));
    case "glb":
    case "gltf": {
      const loader = new GLTFLoader();
      // An empty base path and a manager that refuses every URL: a glTF can name external files,
      // and they must not turn into requests to this site or anywhere else.
      loader.manager.setURLModifier(() => "data:,");
      const gltf = await loader.parseAsync(buffer, "");
      return gltf.scene;
    }
    default:
      throw new Error(`unknown mesh ${subtype}`);
  }
}

function countTriangles(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!(o as THREE.Mesh).isMesh || !g) return;
    n += g.index ? g.index.count / 3 : (g.getAttribute("position")?.count ?? 0) / 3;
  });
  return Math.round(n);
}

export function createViewer(host: HTMLElement, model: THREE.Object3D, options: { lite: boolean; dark: boolean }): Viewer3D {
  const renderer = new THREE.WebGLRenderer({ antialias: !options.lite, preserveDrawingBuffer: true });
  renderer.setPixelRatio(options.lite ? 1 : Math.min(window.devicePixelRatio, 2));
  host.replaceChildren(renderer.domElement);
  renderer.domElement.setAttribute("aria-label", "Vista 3D: arrastra para girar, rueda para acercar, clic derecho para mover");
  renderer.domElement.tabIndex = 0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e7);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);

  scene.add(model);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;

  const render = () => renderer.render(scene, camera);
  controls.addEventListener("change", render);

  const box = new THREE.Box3().setFromObject(model);
  const sizeVec = box.getSize(new THREE.Vector3());

  const fit = () => {
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1e-6);
    const distance = r / Math.sin((camera.fov * Math.PI) / 360);
    camera.near = distance / 1000;
    camera.far = distance * 1000;
    camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.8, 1.2).normalize().multiplyScalar(distance));
    camera.updateProjectionMatrix();
    controls.target.copy(sphere.center);
    controls.update();
    render();
  };

  const resize = () => {
    const w = Math.max(host.clientWidth, 1);
    const h = Math.max(host.clientHeight, 1);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  const setTheme = (dark: boolean) => {
    scene.background = new THREE.Color(dark ? 0x101010 : 0xeaeaea);
    render();
  };
  setTheme(options.dark);
  resize();
  fit();

  return {
    info: { triangles: countTriangles(model), size: { x: sizeVec.x, y: sizeVec.y, z: sizeVec.z } },
    fit,
    setWireframe(on) {
      model.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const mat of Array.isArray(m) ? m : m ? [m] : []) (mat as THREE.MeshStandardMaterial).wireframe = on;
      });
      render();
    },
    setTheme,
    async exportAs(format) {
      if (format === "stl") return new Blob([new STLExporter().parse(model, { binary: true }) as DataView<ArrayBuffer>], { type: "model/stl" });
      if (format === "obj") return new Blob([new OBJExporter().parse(model)], { type: "model/obj" });
      const glb = (await new GLTFExporter().parseAsync(model, { binary: true })) as ArrayBuffer;
      return new Blob([glb], { type: "model/gltf-binary" });
    },
    snapshot() {
      render();
      return new Promise((resolve, reject) => renderer.domElement.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
    },
    dispose() {
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      host.replaceChildren();
    },
  };
}

/** Builds a three.js group from flat triangle data (used by the IFC reader). */
export function groupFromParts(parts: { positions: Float32Array; normals: Float32Array; indices: Uint32Array; color: [number, number, number, number] }[]): THREE.Group {
  const group = new THREE.Group();
  const materials = new Map<string, THREE.Material>();
  for (const p of parts) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(p.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(p.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(p.indices, 1));
    const key = p.color.map((c) => c.toFixed(3)).join(",");
    let material = materials.get(key);
    if (!material) {
      const [r, g, b, a] = p.color;
      material = new THREE.MeshStandardMaterial({ color: new THREE.Color(r, g, b), transparent: a < 1, opacity: a, roughness: 0.8, side: THREE.DoubleSide });
      materials.set(key, material);
    }
    group.add(new THREE.Mesh(geometry, material));
  }
  return group;
}
