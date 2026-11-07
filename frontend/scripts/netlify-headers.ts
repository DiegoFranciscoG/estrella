/**
 * Response headers of the two Netlify sites, taken from nginx.conf.template: the headers are written
 * in one place, and the local stack and the free hosting serve the same ones. Pure functions; the
 * command line (netlify-site.mjs) reads and writes the files.
 *
 * Netlify applies every _headers rule that matches a path and joins the values of a header that two
 * rules set. Two Content-Security-Policy values joined that way are two policies, both enforced, so
 * the relaxed policy of one worker would be undone by the general one. Hence the rules built here
 * never let two rules give the same header to the same path.
 */

export interface Location {
  modifier: "" | "=" | "~" | "~*";
  pattern: string;
  headers: [string, string][];
  /** False when the location answers by itself (return) or proxies: nothing is published under it. */
  servesFiles: boolean;
}

export interface Server {
  port: number;
  locations: Location[];
}

export interface Rule {
  path: string;
  headers: [string, string][];
}

interface Directive {
  name: string;
  args: string[];
  block?: Directive[];
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /\s+|#[^\n]*|"([^"]*)"|([{};])|([^\s{};"#]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) tokens.push(`"${m[1]}`);
    else if (m[2] !== undefined) tokens.push(m[2]);
    else if (m[3] !== undefined) tokens.push(m[3]);
  }
  return tokens;
}

function parseDirectives(tokens: string[], at: { i: number }): Directive[] {
  const out: Directive[] = [];
  while (at.i < tokens.length) {
    const name = tokens[at.i++];
    if (name === "}") return out;
    const args: string[] = [];
    while (at.i < tokens.length && tokens[at.i] !== ";" && tokens[at.i] !== "{") {
      const t = tokens[at.i++];
      args.push(t.startsWith('"') ? t.slice(1) : t);
    }
    if (tokens[at.i] === "{") {
      at.i++;
      out.push({ name, args, block: parseDirectives(tokens, at) });
    } else {
      at.i++;
      out.push({ name, args });
    }
  }
  return out;
}

/** The container fills ${NAME} from its environment before nginx starts; this does the same. */
function fillEnvironment(template: string, env: Record<string, string>): string {
  return template.replace(/\$\{([A-Z_]+)\}/g, (_, name: string) => {
    const value = env[name];
    if (value === undefined) throw new Error(`Missing ${name}`);
    return value;
  });
}

/**
 * The servers of the template, with each location's headers resolved: ${NAME} from {@code env},
 * $variables from `set`, and `include` from {@code snippets} (keyed by the path the template uses).
 */
export function parseNginx(template: string, snippets: Record<string, string>, env: Record<string, string>): Server[] {
  const top = parseDirectives(tokenize(fillEnvironment(template, env)), { i: 0 });
  return top.filter((d) => d.name === "server").map((server) => {
    const body = server.block ?? [];
    const vars = new Map<string, string>();
    for (const d of body) if (d.name === "set") vars.set(d.args[0], d.args[1]);
    const resolve = (value: string) => (value.startsWith("$") ? (vars.get(value) ?? value) : value);
    const listen = body.find((d) => d.name === "listen");
    const locations = body.filter((d) => d.name === "location").map((loc): Location => {
      const [first, second] = loc.args;
      const modifier = (second === undefined ? "" : first) as Location["modifier"];
      const pattern = second ?? first;
      const directives = (loc.block ?? []).flatMap((d) => {
        if (d.name !== "include") return [d];
        const snippet = snippets[d.args[0]];
        if (snippet === undefined) throw new Error(`Unknown include ${d.args[0]}`);
        return parseDirectives(tokenize(snippet), { i: 0 });
      });
      const headers: [string, string][] = [];
      for (const d of directives) {
        if (d.name === "add_header") headers.push([d.args[0], resolve(d.args[1])]);
        if (d.name === "default_type") headers.push(["Content-Type", d.args[0]]);
      }
      const servesFiles = !directives.some((d) => d.name === "return" || d.name === "proxy_pass");
      return { modifier, pattern, headers, servesFiles };
    });
    return { port: Number(listen?.args[0]), locations };
  });
}

/** nginx's choice: an exact match, else the first matching regex, else the longest matching prefix. */
export function selectLocation(server: Server, path: string): Location | undefined {
  const exact = server.locations.find((l) => l.modifier === "=" && l.pattern === path);
  if (exact) return exact;
  const regex = server.locations.find(
    (l) => (l.modifier === "~" || l.modifier === "~*") && new RegExp(l.pattern, l.modifier === "~*" ? "i" : "").test(path),
  );
  if (regex) return regex;
  let prefix: Location | undefined;
  for (const l of server.locations) {
    if (l.modifier === "" && path.startsWith(l.pattern) && (!prefix || l.pattern.length > prefix.pattern.length)) prefix = l;
  }
  return prefix;
}

const key = (headers: [string, string][]) => JSON.stringify(headers);

/**
 * What one site publishes and its _headers rules. Headers every file shares go in one rule for
 * "/*". The rest go in a "dir/*" rule when every file below dir has the same ones, and otherwise in
 * one rule per file. A folder's index.html also answers the folder's own path.
 */
export function netlifyRules(server: Server, files: string[]): { published: string[]; rules: Rule[] } {
  const own = new Map<string, [string, string][]>();
  for (const file of files) {
    const location = selectLocation(server, file);
    if (location?.servesFiles) own.set(file, location.headers);
  }
  const published = [...own.keys()].sort();
  if (published.length === 0) return { published, rules: [] };

  const shared = own.get(published[0])!.filter(([name, value]) =>
    published.every((f) => own.get(f)!.some(([n, v]) => n === name && v === value)));
  const rest = (file: string) => own.get(file)!.filter(([name]) => !shared.some(([n]) => n === name));
  const rules: Rule[] = [{ path: "/*", headers: shared }];

  const emit = (dir: string, below: string[]) => {
    if (dir !== "/" && new Set(below.map((f) => key(rest(f)))).size === 1) {
      if (rest(below[0]).length > 0) rules.push({ path: `${dir}*`, headers: rest(below[0]) });
      return;
    }
    const subdirs = new Map<string, string[]>();
    for (const file of below) {
      const tail = file.slice(dir.length);
      const slash = tail.indexOf("/");
      if (slash === -1) {
        const headers = rest(file);
        if (headers.length === 0) continue;
        rules.push({ path: file, headers });
        if (tail === "index.html") rules.push({ path: dir, headers });
      } else {
        const sub = dir + tail.slice(0, slash + 1);
        subdirs.set(sub, [...(subdirs.get(sub) ?? []), file]);
      }
    }
    for (const [sub, subFiles] of [...subdirs.entries()].sort()) emit(sub, subFiles);
  };
  emit("/", published);
  return { published, rules };
}

/** How Netlify finds a rule's path: equal, or under a trailing splat. */
export function ruleMatches(rule: string, path: string): boolean {
  return rule.endsWith("*") ? path.startsWith(rule.slice(0, -1)) : rule === path;
}

/** Netlify's _headers format: the path, then one indented "Name: value" line per header. */
export function headersFile(rules: Rule[]): string {
  return rules.map((r) => [r.path, ...r.headers.map(([n, v]) => `  ${n}: ${v}`)].join("\n")).join("\n\n") + "\n";
}
