// T-02 and notices: every package shipped to students must have an allowed license, and its
// license text is collected into a notices file published with the build.
// Usage (from frontend/): node scripts/third-party-notices.mjs . dist/THIRD-PARTY-NOTICES.txt
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "MPL-2.0", "0BSD", "Unlicense", "CC0-1.0",
  "BlueOak-1.0.0", "Zlib", "Python-2.0", "OFL-1.1", "CC-BY-4.0",
]);

// Packages that omit the license field in package.json, checked by hand against their license file
// and repository. Each entry must say where it was verified.
const VERIFIED = {
  "khroma@2.1.0": "MIT", // license file in the package + github.com/fabiospampinato/khroma, 2026-11-06
};

const [frontend = "frontend", output = "frontend/dist/THIRD-PARTY-NOTICES.txt"] = process.argv.slice(2);
const lock = JSON.parse(readFileSync(join(frontend, "package-lock.json"), "utf8"));

function licenseOf(meta) {
  const raw = meta.license ?? meta.licenses;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.map((l) => l.type ?? l).join(" OR ");
  if (raw && typeof raw === "object") return raw.type;
  return "UNKNOWN";
}

/** An SPDX expression is acceptable if every AND part has at least one allowed OR option. */
function allowed(expression) {
  return expression.replace(/[()]/g, "").split(/\s+AND\s+/).every((part) => part.split(/\s+OR\s+/).some((l) => ALLOWED.has(l.trim())));
}

const problems = [];
const sections = [];
for (const [path, meta] of Object.entries(lock.packages)) {
  if (!path || meta.dev || meta.optional && !existsSync(join(frontend, path))) continue;
  const dir = join(frontend, path);
  if (!existsSync(join(dir, "package.json"))) continue;
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const license = VERIFIED[`${pkg.name}@${pkg.version}`] ?? licenseOf(pkg);
  if (!allowed(license)) problems.push(`${pkg.name}@${pkg.version}: ${license}`);
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(f));
  const text = file ? readFileSync(join(dir, file), "utf8").trim() : `License: ${license} (no license file in the package)`;
  sections.push(`== ${pkg.name} ${pkg.version} (${license})\n${pkg.homepage ?? pkg.repository?.url ?? ""}\n\n${text}\n`);
}

if (problems.length) {
  console.error("Licenses not allowed in what students download:\n" + problems.join("\n"));
  process.exit(1);
}
sections.sort();
writeFileSync(output, `ESTRELLA - third-party notices\nGenerated at build time from the packages shipped in this build.\nminiPaint (bundled unmodified) is listed in apps/lienzo/vendor/.\n\n${sections.join("\n")}`);
console.log(`T-02 ok: ${sections.length} shipped packages, all with allowed licenses. Notices: ${output}`);
