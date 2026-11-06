// T-01: names of paid programs may appear only where they describe an equivalence.
// Anywhere else (titles, file names, interface text, code) they fail the build.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const BRANDS = [
  "AutoCAD", "SketchUp", "Revit", "Enscape", "V-Ray", "3ds Max", "Illustrator", "Photoshop", "InDesign",
  "Acrobat", "Lightroom", "Adobe", "Rhinoceros", "Notion", "Autodesk", "Miro", "Premiere",
];
// Descriptive (nominative) use is legitimate only in these places.
const ALLOWED = [
  "frontend/src/data/programas.json",
  "docs/",
  "scripts/check-trademarks.mjs",
];
const SKIP_DIRS = new Set([".git", "node_modules", "target", "dist", "coverage", "playwright-report", "test-results"]);
const TEXT = /\.(java|ts|js|mjs|json|html|css|md|yml|yaml|xml|sql|conf|template|toml|txt|webmanifest|svg)$|Dockerfile$/;

const pattern = new RegExp(`\\b(${BRANDS.map((b) => b.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")).join("|")})\\b`, "i");
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const rel = relative(ROOT, full).split(sep).join("/");
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    if (pattern.test(name)) problems.push(`${rel}: brand in file name`);
    if (!TEXT.test(name) || ALLOWED.some((a) => rel === a || rel.startsWith(a))) continue;
    readFileSync(full, "utf8").split("\n").forEach((line, i) => {
      const m = pattern.exec(line);
      if (m) problems.push(`${rel}:${i + 1}: "${m[1]}"`);
    });
  }
}

walk(ROOT);
if (problems.length) {
  console.error("Trademarks outside the equivalence data:\n" + problems.join("\n"));
  process.exit(1);
}
console.log("T-01 ok: no trademarks outside the equivalence data.");
