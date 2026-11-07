import { describe, expect, it } from "vitest";
import template from "../../nginx.conf.template?raw";
import securityHeaders from "../../security-headers.conf?raw";
import { headersFile, netlifyRules, parseNginx, ruleMatches, selectLocation, type Rule, type Server } from "../../scripts/netlify-headers";

const ENV = { PANEL_ORIGIN: "https://estrella-panel.netlify.app", APPS_ORIGIN: "https://estrella-programas.netlify.app" };
const servers = parseNginx(template, { "/etc/nginx/snippets/security-headers.conf": securityHeaders }, ENV);
const panel = servers.find((s) => s.port === 8080)!;
const programs = servers.find((s) => s.port === 8081)!;

/** The shape of a real build: the panel at the root, the programs under /apps/. */
const BUILD = [
  "/index.html", "/sw.js", "/manifest.webmanifest", "/estrella.svg", "/THIRD-PARTY-NOTICES.txt",
  "/icons/icon-192.png", "/icons/maskable-512.png", "/assets/index-AbC123.js", "/assets/index-AbC123.css",
  "/apps/sw.js", "/apps/plano/index.html", "/apps/apuntes/index.html", "/apps/folio/index.html",
  "/apps/visor/index.html", "/apps/visor/web-ifc.wasm", "/apps/pizarra/index.html", "/apps/pizarra/fonts/Xiaolai/a.woff2",
  "/apps/assets/main-Xy9.js", "/apps/assets/dwg.worker-DfqzCOa1.js", "/apps/assets/pdf.worker.min-CIqJB0yW.mjs",
  "/apps/assets/subset-worker.chunk-B8OytGiL.js", "/apps/assets/libredwg-Q1.wasm",
];

const csp = (server: Server, path: string) =>
  selectLocation(server, path)?.headers.find(([name]) => name === "Content-Security-Policy")?.[1] ?? "";

/** What Netlify would send for a path: every matching rule, values of a repeated header joined. */
function served(rules: Rule[], path: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const rule of rules.filter((r) => ruleMatches(r.path, path))) {
    for (const [name, value] of rule.headers) out.set(name, [...(out.get(name) ?? []), value]);
  }
  return out;
}

describe("Netlify headers come from nginx.conf.template", () => {
  it("reads both sites with their origins filled in", () => {
    expect(servers.map((s) => s.port)).toEqual([8080, 8081]);
    expect(csp(panel, "/index.html")).toContain(`frame-src ${ENV.APPS_ORIGIN};`);
    expect(csp(programs, "/apps/visor/index.html")).toContain(`frame-ancestors ${ENV.PANEL_ORIGIN}`);
    expect(() => parseNginx(template, {}, ENV)).toThrow(/include/);
    expect(() => parseNginx(template, { "/etc/nginx/snippets/security-headers.conf": "" }, { PANEL_ORIGIN: "x" })).toThrow(/APPS_ORIGIN/);
  });

  it("picks locations as nginx does: exact, then regex, then the longest prefix", () => {
    expect(csp(programs, "/apps/assets/dwg.worker-DfqzCOa1.js")).toContain("'unsafe-eval'");
    expect(csp(programs, "/apps/assets/main-Xy9.js")).not.toContain("'unsafe-eval'");
    expect(csp(programs, "/apps/assets/main-Xy9.js")).toContain("'wasm-unsafe-eval'");
    expect(selectLocation(programs, "/apps/assets/pdf.worker.min-CIqJB0yW.mjs")?.headers).toContainEqual(["Content-Type", "application/javascript"]);
    expect(csp(programs, "/apps/visor/index.html")).toContain("'wasm-unsafe-eval'");
    expect(csp(programs, "/apps/plano/index.html")).not.toContain("wasm");
    expect(selectLocation(programs, "/index.html")?.servesFiles).toBe(false);
    expect(selectLocation(panel, "/apps/plano/index.html")?.servesFiles).toBe(false);
    expect(selectLocation(panel, "/manifest.webmanifest")?.headers).toContainEqual(["Content-Type", "application/manifest+json"]);
  });

  for (const [name, server] of [["panel", panel], ["programs", programs]] as const) {
    it(`gives each ${name} file exactly nginx's headers, each from a single rule`, () => {
      const { published, rules } = netlifyRules(server, BUILD);
      expect(published.length).toBeGreaterThan(0);
      for (const path of published) {
        const got = served(rules, path);
        for (const [header, values] of got) expect(values, `${header} for ${path}`).toHaveLength(1);
        const expected = new Map(selectLocation(server, path)!.headers.map(([n, v]) => [n, [v]]));
        expect(got, path).toEqual(expected);
      }
    });
  }

  it("publishes the programs only on their site and the panel only on its own", () => {
    const panelFiles = netlifyRules(panel, BUILD).published;
    const programFiles = netlifyRules(programs, BUILD).published;
    expect(panelFiles).toContain("/index.html");
    expect(panelFiles.some((p) => p.startsWith("/apps/"))).toBe(false);
    expect(programFiles.every((p) => p.startsWith("/apps/"))).toBe(true);
    expect(programFiles).toContain("/apps/assets/dwg.worker-DfqzCOa1.js");
  });

  it("writes Netlify's _headers format and answers a folder with its index.html headers", () => {
    const { rules } = netlifyRules(panel, BUILD);
    expect(rules[0].path).toBe("/*");
    expect(served(rules, "/").get("Cache-Control")).toEqual(["no-cache"]);
    expect(headersFile([{ path: "/a", headers: [["X-A", "1"], ["X-B", "2"]] }])).toBe("/a\n  X-A: 1\n  X-B: 2\n");
  });
});
