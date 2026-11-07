// Builds one Netlify site from dist/ after `npm run build`:
//   node scripts/netlify-site.mjs panel    <output folder>   the panel, without the programs
//   node scripts/netlify-site.mjs programs <output folder>   only /apps/
// Headers come from nginx.conf.template (see netlify-headers.ts). Needs PANEL_ORIGIN and APPS_ORIGIN.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { headersFile, netlifyRules, parseNginx } from "./netlify-headers.ts";

const PORTS = { panel: 8080, programs: 8081 };
const [site, output] = process.argv.slice(2);
if (!Object.hasOwn(PORTS, site ?? "") || !output) {
  console.error("Usage: node scripts/netlify-site.mjs <panel|programs> <output folder>");
  process.exit(2);
}

function origin(name) {
  const value = process.env[name];
  if (!value || !/^https?:\/\/[^/\s]+$/.test(value)) {
    console.error(`${name} must be an origin such as https://example.netlify.app (no path, no trailing slash)`);
    process.exit(2);
  }
  return value;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const env = { PANEL_ORIGIN: origin("PANEL_ORIGIN"), APPS_ORIGIN: origin("APPS_ORIGIN") };
const servers = parseNginx(readFileSync(join(root, "nginx.conf.template"), "utf8"),
  { "/etc/nginx/snippets/security-headers.conf": readFileSync(join(root, "security-headers.conf"), "utf8") }, env);
const server = servers.find((s) => s.port === PORTS[site]);

const files = walk(dist).map((file) => "/" + relative(dist, file).split(sep).join("/"));
const { published, rules } = netlifyRules(server, files);

const out = resolve(output);
rmSync(out, { recursive: true, force: true });
for (const path of published) {
  const target = join(out, ...path.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(dist, ...path.split("/")), target);
}
writeFileSync(join(out, "_headers"), headersFile(rules));
console.log(`${site}: ${published.length} files and ${rules.length} header rules in ${out}`);
