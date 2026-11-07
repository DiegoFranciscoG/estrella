/**
 * Sólido's 3D view (three.js, MIT). Every solid is a unit shape scaled to its size, with its
 * edges drawn on top the way architectural massing models are shown. Renders on demand only.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import type { Kind, Model, Point2, Solid } from "./model";

export type ViewName = "iso" | "top" | "front" | "side";
export interface Moved { id: string; x: number; y: number; z: number; rotation: number }

export interface SolidScene {
  sync(model: Model, selected: string | null): void;
  /** Point on the ground (y = 0) under the pointer. */
  ground(clientX: number, clientY: number): Point2 | null;
  pick(clientX: number, clientY: number): string | null;
  /** True while the pointer is over a handle of the move or turn gizmo. */
  overGizmo(): boolean;
  setGizmo(mode: "translate" | "rotate", step: number): void;
  setDraft(points: Point2[], cursor: Point2 | null): void;
  view(name: ViewName): void;
  setTheme(dark: boolean): void;
  exportAs(format: "stl" | "obj" | "glb"): Promise<Blob>;
  snapshot(): Promise<Blob>;
  dispose(): void;
}

const UNIT: Partial<Record<Kind, THREE.BufferGeometry>> = {};
/** Side of the ground grid, metres. */
const GROUND = 200;

/** One 5 m tile of the ground: thin lines every metre, a stronger line every 5 m. */
function drawGrid(canvas: HTMLCanvasElement, dark: boolean): void {
  const size = 500;
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, size, size);
  const ink = dark ? "255,255,255" : "0,0,0";
  ctx.strokeStyle = `rgba(${ink},0.12)`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 1; i < 5; i++) {
    const p = (i * size) / 5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();
  ctx.strokeStyle = `rgba(${ink},0.28)`;
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, size, size);
}

/** Unit shapes: x and z from -0.5 to 0.5, y from 0 to 1 (standing on the ground). */
function unitGeometry(kind: Exclude<Kind, "prism">): THREE.BufferGeometry {
  const cached = UNIT[kind];
  if (cached) return cached;
  let g: THREE.BufferGeometry;
  switch (kind) {
    case "box":
      g = new THREE.BoxGeometry(1, 1, 1);
      break;
    case "cylinder":
      g = new THREE.CylinderGeometry(0.5, 0.5, 1, 48);
      break;
    case "cone":
      g = new THREE.ConeGeometry(0.5, 1, 48);
      break;
    case "sphere":
      g = new THREE.SphereGeometry(0.5, 40, 24);
      break;
    case "roof": {
      // Gable roof: a triangle across the width, run along the depth.
      const shape = new THREE.Shape([new THREE.Vector2(-0.5, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(0, 0.5)]);
      g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -0.5);
      break;
    }
  }
  g.translate(0, 0.5, 0);
  g.computeBoundingSphere();
  UNIT[kind] = g;
  return g;
}

/** A footprint (x, z) extruded upwards by 1. */
function prismGeometry(outline: Point2[]): THREE.BufferGeometry {
  // Shape coordinates are (x, -z): after turning the extrusion upright, -z comes back as z.
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.computeBoundingSphere();
  return g;
}

interface Entry { mesh: THREE.Mesh; edges: THREE.LineSegments; key: string; own: boolean }

export function createScene(host: HTMLElement, options: { lite: boolean; dark: boolean; onMove(moved: Moved): void; onMoveStart(): void }): SolidScene {
  const renderer = new THREE.WebGLRenderer({ antialias: !options.lite, preserveDrawingBuffer: true });
  renderer.setPixelRatio(options.lite ? 1 : Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label", "Vista 3D: arrastra para girar la vista, rueda para acercar, clic derecho o flechas para desplazar");
  canvas.tabIndex = 0;
  host.replaceChildren(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 20000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(4, 10, 6);
  scene.add(sun);

  // The ground grid is a textured surface, not GL lines: software renderers (used when a laptop
  // has no graphics acceleration) drop lines that pass behind the camera, so a line grid vanished
  // around the model. Triangles are clipped correctly everywhere.
  const gridCanvas = document.createElement("canvas");
  const gridTexture = new THREE.CanvasTexture(gridCanvas);
  gridTexture.wrapS = gridTexture.wrapT = THREE.RepeatWrapping;
  gridTexture.repeat.set(GROUND / 5, GROUND / 5);
  gridTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  gridTexture.colorSpace = THREE.SRGBColorSpace;
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(GROUND, GROUND), new THREE.MeshBasicMaterial({ map: gridTexture, transparent: true, depthWrite: false }));
  grid.rotation.x = -Math.PI / 2;
  scene.add(grid);
  const axes = new THREE.Group();
  const strip = (along: "x" | "z", color: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(along === "x" ? GROUND / 2 : 0.04, along === "x" ? 0.04 : GROUND / 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(along === "x" ? GROUND / 4 : 0, 0.002, along === "x" ? 0 : GROUND / 4);
    return m;
  };
  axes.add(strip("x", 0xd03030), strip("z", 0x3050d0));
  scene.add(axes);

  const solids = new THREE.Group();
  scene.add(solids);
  const draft = new THREE.Group();
  scene.add(draft);
  const entries = new Map<string, Entry>();

  const orbit = new OrbitControls(camera, canvas);
  orbit.enableDamping = false;
  orbit.listenToKeyEvents(canvas);
  const render = () => renderer.render(scene, camera);
  orbit.addEventListener("change", render);

  const gizmo = new TransformControls(camera, canvas);
  gizmo.setSize(0.9);
  scene.add(gizmo.getHelper());
  gizmo.addEventListener("change", render);
  gizmo.addEventListener("dragging-changed", (event) => {
    const dragging = (event as unknown as { value: boolean }).value;
    orbit.enabled = !dragging;
    const target = gizmo.object;
    if (dragging) return options.onMoveStart();
    if (!target) return;
    const id = target.userData.id as string;
    options.onMove({ id, x: target.position.x, y: target.position.y, z: target.position.z, rotation: THREE.MathUtils.radToDeg(target.rotation.y) });
  });

  let dark = options.dark;
  const edgeColor = () => (dark ? 0xe8e8e8 : 0x1a1a1a);
  const SELECTED = 0x1f6feb;
  let selectedId: string | null = null;

  const setTheme = (value: boolean) => {
    dark = value;
    scene.background = new THREE.Color(dark ? 0x141414 : 0xf0f0f0);
    drawGrid(gridCanvas, dark);
    gridTexture.needsUpdate = true;
    for (const [id, e] of entries) (e.edges.material as THREE.LineBasicMaterial).color.setHex(id === selectedId ? SELECTED : edgeColor());
    render();
  };

  const resize = () => {
    const w = Math.max(host.clientWidth, 1);
    const h = Math.max(host.clientHeight, 1);
    renderer.setSize(w, h, false);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  const keyOf = (s: Solid) => (s.kind === "prism" ? `prism:${JSON.stringify(s.outline)}` : s.kind);

  const build = (s: Solid): Entry => {
    const own = s.kind === "prism";
    const geometry = own ? prismGeometry(s.outline ?? []) : unitGeometry(s.kind as Exclude<Kind, "prism">);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const mesh = new THREE.Mesh(geometry, material);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: edgeColor() }));
    mesh.add(edges);
    mesh.userData.id = s.id;
    solids.add(mesh);
    return { mesh, edges, key: keyOf(s), own };
  };

  const drop = (id: string, e: Entry) => {
    if (gizmo.object === e.mesh) gizmo.detach();
    solids.remove(e.mesh);
    if (e.own) e.mesh.geometry.dispose();
    (e.mesh.material as THREE.Material).dispose();
    e.edges.geometry.dispose();
    (e.edges.material as THREE.Material).dispose();
    entries.delete(id);
  };

  const visibleBox = (): THREE.Box3 => {
    const box = new THREE.Box3();
    for (const e of entries.values()) if (e.mesh.visible) box.expandByObject(e.mesh);
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 2, 5));
    return box;
  };

  const view = (name: ViewName) => {
    const sphere = visibleBox().getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 1);
    const distance = (r / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
    const direction = { iso: new THREE.Vector3(1, 0.9, 1.3), top: new THREE.Vector3(0, 1, 0.0001), front: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0) }[name];
    camera.position.copy(sphere.center).add(direction.normalize().multiplyScalar(distance));
    camera.near = Math.max(distance / 2000, 0.01);
    camera.far = distance * 200;
    camera.updateProjectionMatrix();
    orbit.target.copy(sphere.center);
    orbit.update();
    render();
  };

  const raycaster = new THREE.Raycaster();
  const ray = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), camera);
    return raycaster;
  };
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  setTheme(options.dark);
  resize();
  view("iso");

  return {
    sync(model, selected) {
      const ids = new Set(model.solids.map((s) => s.id));
      for (const [id, e] of entries) if (!ids.has(id)) drop(id, e);
      for (const s of model.solids) {
        let e = entries.get(s.id);
        if (e && e.key !== keyOf(s)) {
          drop(s.id, e);
          e = undefined;
        }
        if (!e) {
          e = build(s);
          entries.set(s.id, e);
        }
        e.mesh.position.set(s.x, s.y, s.z);
        e.mesh.rotation.set(0, THREE.MathUtils.degToRad(s.rotation), 0);
        e.mesh.scale.set(s.width, s.height, s.depth);
        e.mesh.visible = !s.hidden;
        (e.mesh.material as THREE.MeshStandardMaterial).color.set(s.color);
        (e.edges.material as THREE.LineBasicMaterial).color.setHex(s.id === selected ? SELECTED : edgeColor());
      }
      selectedId = selected;
      const target = selected ? entries.get(selected) : undefined;
      if (target && target.mesh.visible) {
        if (gizmo.object !== target.mesh) gizmo.attach(target.mesh);
      } else {
        gizmo.detach();
      }
      render();
    },
    ground(clientX, clientY) {
      const hit = ray(clientX, clientY).ray.intersectPlane(groundPlane, new THREE.Vector3());
      return hit && Math.abs(hit.x) < 1e5 && Math.abs(hit.z) < 1e5 ? [hit.x, hit.z] : null;
    },
    pick(clientX, clientY) {
      const visible = solids.children.filter((m) => m.visible);
      const hit = ray(clientX, clientY).intersectObjects(visible, false)[0];
      return hit ? (hit.object.userData.id as string) : null;
    },
    overGizmo() {
      return gizmo.object !== undefined && gizmo.axis !== null;
    },
    setGizmo(mode, step) {
      gizmo.setMode(mode);
      gizmo.setTranslationSnap(step);
      gizmo.setRotationSnap(THREE.MathUtils.degToRad(15));
      gizmo.showX = mode === "translate";
      gizmo.showZ = mode === "translate";
      gizmo.showY = true;
      render();
    },
    setDraft(points, cursor) {
      for (const child of [...draft.children]) {
        draft.remove(child);
        (child as THREE.Line).geometry.dispose();
        ((child as THREE.Line).material as THREE.Material).dispose();
      }
      const all = cursor ? [...points, cursor] : points;
      if (all.length) {
        const vectors = all.map(([x, z]) => new THREE.Vector3(x, 0.002, z));
        const color = dark ? 0xffffff : 0x000000;
        if (vectors.length > 1) draft.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(vectors), new THREE.LineBasicMaterial({ color, depthTest: false })));
        draft.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints(vectors.slice(0, points.length)), new THREE.PointsMaterial({ color, size: 7, sizeAttenuation: false, depthTest: false })));
      }
      render();
    },
    view,
    setTheme,
    async exportAs(format) {
      // Faces only (no edge lines), visible solids only, at their real size.
      const group = new THREE.Group();
      for (const e of entries.values()) {
        if (!e.mesh.visible) continue;
        const copy = new THREE.Mesh(e.mesh.geometry, e.mesh.material);
        copy.position.copy(e.mesh.position);
        copy.rotation.copy(e.mesh.rotation);
        copy.scale.copy(e.mesh.scale);
        copy.name = String(e.mesh.userData.id);
        group.add(copy);
      }
      if (format === "stl") {
        // 3D printing: Z up and millimetres, what slicers expect.
        group.rotation.x = Math.PI / 2;
        group.scale.setScalar(1000);
        group.updateMatrixWorld(true);
        return new Blob([new STLExporter().parse(group, { binary: true }) as DataView<ArrayBuffer>], { type: "model/stl" });
      }
      group.updateMatrixWorld(true);
      if (format === "obj") return new Blob([new OBJExporter().parse(group)], { type: "model/obj" });
      const glb = (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;
      return new Blob([glb], { type: "model/gltf-binary" });
    },
    snapshot() {
      gizmo.getHelper().visible = false;
      render();
      const done = () => {
        gizmo.getHelper().visible = true;
        render();
      };
      return new Promise((resolve, reject) => canvas.toBlob((b) => {
        done();
        if (b) resolve(b);
        else reject(new Error("png"));
      }, "image/png"));
    },
    dispose() {
      observer.disconnect();
      gizmo.detach();
      gizmo.dispose();
      orbit.dispose();
      for (const [id, e] of entries) drop(id, e);
      renderer.dispose();
      renderer.forceContextLoss();
      host.replaceChildren();
    },
  };
}
