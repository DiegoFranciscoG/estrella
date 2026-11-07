/**
 * BIM's 3D view (three.js, MIT). One mesh per placed geometry, tagged with its IFC element, so
 * elements can be hidden, picked and highlighted. It renders on demand, never in a loop: an idle
 * model costs no CPU or battery on a modest laptop.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { BimPart } from "./ifc-model";
import type { Measure } from "./model";

export interface Hit { id: number; point: [number, number, number] }

export interface BimView {
  /** Height range of the whole model, for the section slider. */
  readonly heights: { min: number; max: number };
  setVisible(isVisible: (id: number) => boolean): void;
  select(id: number | null): void;
  setSection(y: number | null): void;
  setMeasures(measures: Measure[], pending: [number, number, number] | null): void;
  frame(mode: "fit" | "top", id?: number): void;
  pick(clientX: number, clientY: number): Hit | null;
  setTheme(dark: boolean): void;
  snapshot(): Promise<Blob>;
  dispose(): void;
}

/** Plane constant that clips nothing (the model is moved near the origin). */
const OFF = 1e9;

export function createView(host: HTMLElement, parts: BimPart[], options: { lite: boolean; dark: boolean }): BimView {
  const renderer = new THREE.WebGLRenderer({ antialias: !options.lite, preserveDrawingBuffer: true });
  renderer.setPixelRatio(options.lite ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.localClippingEnabled = true;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label", "Modelo 3D: arrastra para girar, rueda para acercar, clic derecho o flechas para mover, clic para seleccionar");
  canvas.tabIndex = 0;
  host.replaceChildren(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e6);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);

  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), OFF);
  const clipping = [plane];
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const highlight = new THREE.MeshStandardMaterial({ color: 0xff8a00, emissive: 0x4a2000, roughness: 0.6, side: THREE.DoubleSide, clippingPlanes: clipping });

  const model = new THREE.Group();
  const byId = new Map<number, THREE.Mesh[]>();
  for (const p of parts) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(p.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(p.normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(p.indices, 1));
    geometry.computeBoundingSphere();
    const key = p.color.map((c) => c.toFixed(3)).join(",");
    let material = materials.get(key);
    if (!material) {
      const [r, g, b, a] = p.color;
      material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(r, g, b), transparent: a < 1, opacity: a, depthWrite: a >= 1,
        roughness: 0.8, side: THREE.DoubleSide, clippingPlanes: clipping,
      });
      materials.set(key, material);
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData = { id: p.id, material };
    model.add(mesh);
    const list = byId.get(p.id);
    if (list) list.push(mesh);
    else byId.set(p.id, [mesh]);
  }
  scene.add(model);
  const whole = new THREE.Box3().setFromObject(model);

  const marks = new THREE.Group();
  marks.renderOrder = 10;
  scene.add(marks);
  const markColor = () => (options.dark ? 0xffffff : 0x000000);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.listenToKeyEvents(canvas);
  const render = () => renderer.render(scene, camera);
  controls.addEventListener("change", render);

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

  let selected: number | null = null;
  let section: number | null = null;

  /** Box of what is on screen: visible meshes, below the cut. */
  const visibleBox = (only?: number): THREE.Box3 => {
    const box = new THREE.Box3();
    const meshes = only !== undefined ? byId.get(only) ?? [] : model.children;
    for (const m of meshes) if (m.visible) box.expandByObject(m);
    if (box.isEmpty()) box.copy(whole);
    if (section !== null && only === undefined) box.max.y = Math.max(Math.min(box.max.y, section), box.min.y);
    return box;
  };

  const frame = (mode: "fit" | "top", id?: number) => {
    const box = visibleBox(id);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 0.05);
    const distance = r / Math.sin((camera.fov * Math.PI) / 360);
    camera.near = distance / 1000;
    camera.far = distance * 1000;
    const direction = mode === "top" ? new THREE.Vector3(0, 1, 0.0001) : new THREE.Vector3(1, 0.8, 1.2);
    camera.position.copy(sphere.center).add(direction.normalize().multiplyScalar(distance));
    camera.updateProjectionMatrix();
    controls.target.copy(sphere.center);
    controls.update();
    render();
  };

  const setTheme = (dark: boolean) => {
    options.dark = dark;
    scene.background = new THREE.Color(dark ? 0x101010 : 0xeaeaea);
    for (const child of marks.children) {
      const m = (child as THREE.Line).material as THREE.LineBasicMaterial;
      m.color.setHex(markColor());
    }
    render();
  };

  const raycaster = new THREE.Raycaster();
  setTheme(options.dark);
  resize();
  frame("fit");

  return {
    heights: { min: whole.min.y, max: whole.max.y },
    setVisible(isVisible) {
      for (const [id, meshes] of byId) {
        const on = isVisible(id);
        for (const m of meshes) m.visible = on;
      }
      render();
    },
    select(id) {
      if (selected !== null) for (const m of byId.get(selected) ?? []) m.material = m.userData.material;
      selected = id !== null && byId.has(id) ? id : null;
      if (selected !== null) for (const m of byId.get(selected)!) m.material = highlight;
      render();
    },
    setSection(y) {
      section = y;
      plane.constant = y ?? OFF;
      render();
    },
    setMeasures(measures, pending) {
      for (const child of [...marks.children]) {
        marks.remove(child);
        (child as THREE.Line).geometry.dispose();
        ((child as THREE.Line).material as THREE.Material).dispose();
      }
      const style = () => new THREE.LineBasicMaterial({ color: markColor(), depthTest: false, transparent: true });
      const dot = () => new THREE.PointsMaterial({ color: markColor(), size: 7, sizeAttenuation: false, depthTest: false, transparent: true });
      for (const m of measures) {
        const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(m, 3));
        marks.add(new THREE.Line(geometry, style()), new THREE.Points(geometry.clone(), dot()));
      }
      if (pending) marks.add(new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pending, 3)), dot()));
      for (const child of marks.children) child.renderOrder = 10;
      render();
    },
    frame,
    pick(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const visible = model.children.filter((m) => m.visible);
      // Rays ignore clipping planes: skip what the horizontal cut removed.
      const hit = raycaster.intersectObjects(visible, false).find((h) => section === null || h.point.y <= section + 1e-4);
      if (!hit) return null;
      return { id: hit.object.userData.id as number, point: [hit.point.x, hit.point.y, hit.point.z] };
    },
    setTheme,
    snapshot() {
      render();
      return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
    },
    dispose() {
      observer.disconnect();
      controls.dispose();
      model.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      for (const m of materials.values()) m.dispose();
      highlight.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      host.replaceChildren();
    },
  };
}
