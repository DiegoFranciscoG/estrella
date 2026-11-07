import { describe, expect, it } from "vitest";
import {
  add, defaultStyle, duplicate, fitTo, localBox, move, newDrawing, parseDrawing, placed, remove, reorder, restyle, simplify,
} from "../../apps/trazo/model";
import { fromSvg, parseTransform, toSvg } from "../../apps/trazo/svg-io";

const rect = () => ({ kind: "rect" as const, x: 10, y: 20, w: 100, h: 50, r: 0 });

describe("Trazo drawing", () => {
  it("adds, moves, restyles, duplicates and removes shapes with stable names", () => {
    const d = newDrawing(800, 600);
    const a = add(d, rect(), defaultStyle());
    const b = add(d, { kind: "ellipse", cx: 50, cy: 50, rx: 20, ry: 10 }, defaultStyle());
    expect(a.name).toBe("Rectángulo 1");
    expect(b.name).toBe("Elipse 1");
    move(d, [a.id], 5, -5);
    restyle(d, [a.id], { fill: null, strokeWidth: 4 });
    expect(d.shapes[0]).toMatchObject({ tx: 5, ty: -5, fill: null, strokeWidth: 4 });
    const [copy] = duplicate(d, [a.id]);
    expect(d.shapes.at(-1)).toMatchObject({ id: copy, name: "Rectángulo 2", tx: 21, ty: 11 });
    remove(d, [b.id]);
    expect(d.shapes.map((s) => s.name)).toEqual(["Rectángulo 1", "Rectángulo 2"]);
  });

  it("changes the stacking order", () => {
    const d = newDrawing();
    const [a, b, c] = [1, 2, 3].map(() => add(d, rect(), defaultStyle()).id);
    reorder(d, [a], "front");
    expect(d.shapes.map((s) => s.id)).toEqual([b, c, a]);
    reorder(d, [a], "down");
    expect(d.shapes.map((s) => s.id)).toEqual([b, a, c]);
    reorder(d, [c], "back");
    expect(d.shapes.map((s) => s.id)).toEqual([c, b, a]);
  });

  it("resizes through the placement, keeping the geometry", () => {
    const d = newDrawing();
    const s = add(d, rect(), defaultStyle());
    const local = localBox(s)!;
    fitTo(s, local, { x: 10, y: 20, w: 200, h: 25 });
    expect(placed(s, local)).toEqual({ x: 10, y: 20, w: 200, h: 25 });
    expect(s).toMatchObject({ w: 100, h: 50, sx: 2, sy: 0.5 });
  });

  it("simplifies a freehand stroke without losing its corners", () => {
    const line: [number, number][] = Array.from({ length: 50 }, (_, i) => [i, i < 25 ? 0 : i - 25]);
    const out = simplify(line, 0.5);
    expect(out.length).toBeLessThan(6);
    expect(out[0]).toEqual([0, 0]);
    expect(out.at(-1)).toEqual([49, 24]);
  });

  it("refuses a saved drawing that is malformed instead of drawing it half", () => {
    const d = newDrawing();
    add(d, rect(), defaultStyle());
    expect(parseDrawing(JSON.stringify(d)).shapes).toHaveLength(1);
    const bad = JSON.parse(JSON.stringify(d));
    bad.shapes[0].fill = "url(javascript:alert(1))";
    expect(() => parseDrawing(JSON.stringify(bad))).toThrow();
    const path = newDrawing();
    add(path, { kind: "path", d: "M0 0 L10 10" }, defaultStyle());
    const evil = JSON.parse(JSON.stringify(path));
    evil.shapes[0].d = "M0 0 <script>";
    expect(() => parseDrawing(JSON.stringify(evil))).toThrow();
  });
});

describe("Trazo SVG", () => {
  it("exports the visible shapes with their placement and escapes text", () => {
    const d = newDrawing(200, 100);
    const s = add(d, rect(), defaultStyle());
    move(d, [s.id], 10, 0);
    add(d, { kind: "text", x: 5, y: 40, text: "<script>alert(1)</script> & co", size: 20, bold: true }, { ...defaultStyle(), stroke: null });
    const hidden = add(d, { kind: "line", x1: 0, y1: 0, x2: 9, y2: 9 }, defaultStyle());
    hidden.hidden = true;
    const svg = toSvg(d);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">');
    expect(svg).toContain('<g transform="translate(10 0)"><rect x="10" y="20" width="100" height="50"');
    expect(svg).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</text>");
    expect(svg).not.toContain("<line");
    expect(new DOMParser().parseFromString(svg, "image/svg+xml").getElementsByTagName("parsererror")).toHaveLength(0);
  });

  it("imports plain shapes and leaves out anything that could run or load", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 150 100">
      <script>alert(1)</script>
      <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">hola</div></foreignObject>
      <image href="https://example.com/x.png" width="10" height="10"/>
      <g transform="translate(10 5)" fill="red">
        <rect x="0" y="0" width="20" height="10" onclick="alert(1)"/>
        <circle cx="5" cy="5" r="2" style="fill:#00f;stroke:black;stroke-width:3"/>
      </g>
      <path d="M0 0 L10 10 Z"/>
      <path d="M0 0 javascript:alert(1)"/>
      <polygon points="0,0 10,0 10,10"/>
      <text x="1" y="9" font-size="8" font-weight="bold">Hola &amp; adiós</text>
      <rect x="0" y="0" width="5" height="5" transform="rotate(30)"/>
      <rect x="0" y="0" width="5" height="5" fill="url(#grad)"/>
    </svg>`;
    const out = fromSvg(source);
    expect(out.width).toBe(300);
    expect(out.height).toBe(200);
    const kinds = out.shapes.map((s) => s.geometry.kind);
    expect(kinds).toEqual(["rect", "ellipse", "path", "poly", "text", "rect"]);
    expect(out.skipped).toBe(5);
    expect(out.approximated).toBe(1);
    // The viewBox doubles everything; the group adds its translation.
    expect(out.shapes[0].placement).toEqual({ sx: 2, sy: 2, tx: 20, ty: 10 });
    expect(out.shapes[0].style.fill).toBe("#ff0000");
    expect(out.shapes[1].style).toMatchObject({ fill: "#0000ff", stroke: "#000000", strokeWidth: 3 });
    expect(out.shapes[4].geometry).toMatchObject({ text: "Hola & adiós", size: 8, bold: true });
    expect(JSON.stringify(out)).not.toMatch(/alert|script|onclick|https:/);
  });

  it("refuses files that are not SVG and transforms it cannot place", () => {
    expect(() => fromSvg("<html><body>no</body></html>")).toThrow(/no es un SVG/);
    expect(() => fromSvg("<svg")).toThrow();
    expect(parseTransform("translate(5) scale(2)")).toEqual({ tx: 5, ty: 0, sx: 2, sy: 2 });
    expect(parseTransform("matrix(2 0 0 3 4 5)")).toEqual({ sx: 2, sy: 3, tx: 4, ty: 5 });
    expect(parseTransform("rotate(45)")).toBeNull();
    expect(parseTransform("skewX(10)")).toBeNull();
    expect(parseTransform("translate(1) bogus")).toBeNull();
  });
});
