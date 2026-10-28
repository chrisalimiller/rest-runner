import { parser } from "@lezer/javascript";

/**
 * Finds Postman `pm.*` calls in a script and says what to write in REST Runner's `rr.*` instead.
 * Pure and synchronous, so the import, the editor and the script runner can all use it.
 */

export interface PostmanCall {
  /** Range of the matched expression. */
  from: number;
  to: number;
  /** For example "pm.environment.get". */
  api: string;
  /** Replacement text for from..to. Missing when there is no rr equivalent. */
  fix?: { insert: string };
  /** One or two sentences for the hover text. */
  message: string;
}

type Tree = ReturnType<typeof parser.parse>;
type Node = Tree["topNode"];

type Seg =
  | { t: "p"; name: string; to: number }
  | { t: "c"; args: string[]; to: number }
  | { t: "i"; text: string; to: number };

interface Chain {
  root: string;
  rootTo: number;
  from: number;
  segs: Seg[];
}

const MAX_PASSES = 10;

/** Legacy Postman globals that are only flagged when the script does not declare them. */
const LEGACY_ROOTS = new Set([
  "tests",
  "responseBody",
  "responseCode",
  "responseTime",
  "responseHeaders",
  "environment",
  "globals",
  "data",
  "iteration",
  "tv4",
  "_",
  "CryptoJS",
  "xml2Json",
  "require",
]);

const VAR_SCOPES = new Set(["variables", "environment", "collectionVariables", "globals"]);
const FILLER = new Set(["to", "be", "been", "is", "that", "which", "and", "has", "have", "with", "at", "of", "same"]);

const TIP_NO_REQUEST_CHANGE = 'Scripts can\'t change the request. Set a variable with rr.vars.set("name", value) and use {{name}} in the header, query or body.';
const TIP_LIBRARY = "Postman's built-in libraries are not available. Plain JavaScript (Date, JSON, Math, atob/btoa) works.";

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
  return out;
}

function argsOf(argList: Node, code: string): string[] {
  return children(argList)
    .filter((c) => !["(", ")", ",", "LineComment", "BlockComment"].includes(c.name))
    .map((c) => code.slice(c.from, c.to));
}

function flatten(node: Node, code: string): Chain | null {
  if (node.name === "VariableName") return { root: code.slice(node.from, node.to), rootTo: node.to, from: node.from, segs: [] };
  if (node.name !== "MemberExpression" && node.name !== "CallExpression") return null;
  const kids = children(node);
  const head = flatten(kids[0], code);
  if (!head) return null;
  if (node.name === "CallExpression") {
    const list = kids.find((k) => k.name === "ArgList");
    if (!list) return null;
    head.segs.push({ t: "c", args: argsOf(list, code), to: node.to });
    return head;
  }
  const prop = kids.find((k) => k.name === "PropertyName");
  if (prop) {
    head.segs.push({ t: "p", name: code.slice(prop.from, prop.to), to: node.to });
    return head;
  }
  const open = kids.findIndex((k) => k.name === "[");
  const inner = open >= 0 ? kids[open + 1] : undefined;
  if (!inner) return null;
  head.segs.push({ t: "i", text: code.slice(inner.from, inner.to), to: node.to });
  return head;
}

function isChainObject(node: Node): boolean {
  const p = node.parent;
  return !!p && (p.name === "MemberExpression" || p.name === "CallExpression") && p.firstChild?.from === node.from && p.firstChild.to === node.to;
}

/** Names the script declares itself (variables, functions, parameters). */
function declaredNames(tree: Tree, code: string): Set<string> {
  const names = new Set<string>();
  tree.iterate({
    enter(n) {
      if (n.name === "VariableDefinition") names.add(code.slice(n.from, n.to));
    },
  });
  return names;
}

interface Match {
  /** How many segments of the chain this matched. */
  len: number;
  fix?: string;
  message: string;
  /** Replace this range instead of the matched prefix (used by the `tests[...] =` form). */
  range?: [number, number];
}

const prop = (c: Chain, i: number) => {
  const s = c.segs[i];
  return s && s.t === "p" ? s.name : undefined;
};
const call = (c: Chain, i: number) => {
  const s = c.segs[i];
  return s && s.t === "c" ? s : undefined;
};
const use = (code: string, extra?: string) => `Use ${code}.${extra ? " " + extra : ""}`;
const SET_NOTE = "REST Runner keeps this as a script variable for the session. It does not change the saved environment.";

/** pm.expect(a)...chai chain to rr.expect(a)...matcher */
function matchExpect(c: Chain, start: number): Match {
  const open = call(c, start);
  const generic: Match = { len: c.segs.length, message: "This chai assertion has no direct REST Runner equivalent. Rewrite it with rr.expect(value).toBe / toEqual / toContain / …." };
  if (!open || open.args.length !== 1) return generic;
  let negate = false;
  let deep = false;
  let i = start + 1;
  let matcher: string | undefined;
  let args: string[] = [];
  for (; i < c.segs.length; i++) {
    const s = c.segs[i];
    if (s.t === "p") {
      if (FILLER.has(s.name)) continue;
      if (s.name === "not") negate = !negate;
      else if (s.name === "deep") deep = true;
      else {
        matcher = s.name;
        const next = call(c, i + 1);
        if (next) {
          args = next.args;
          i++;
        }
        i++;
        break;
      }
    } else return generic;
  }
  if (!matcher || i < c.segs.length) return generic;
  const value = open.args[0];
  const a = args[0];
  let m: string | undefined;
  let subject = `rr.expect(${value})`;
  const one = args.length === 1;
  switch (matcher) {
    case "equal": case "equals": case "eq":
      if (one) m = deep ? `toEqual(${a})` : `toBe(${a})`;
      break;
    case "eql": case "eqls":
      if (one) m = `toEqual(${a})`;
      break;
    case "true": case "false": case "undefined":
      if (!args.length) m = `toBe(${matcher})`;
      break;
    case "null":
      if (!args.length) m = "toBeNull()";
      break;
    case "ok":
      if (!args.length) m = "toBeTruthy()";
      break;
    case "exist":
      if (!args.length) m = "toBeDefined()";
      break;
    case "include": case "includes": case "contain": case "contains":
      if (one) m = `toContain(${a})`;
      break;
    case "above": case "gt": case "greaterThan":
      if (one) m = `toBeGreaterThan(${a})`;
      break;
    case "least": case "gte":
      if (one) m = `toBeGreaterThanOrEqual(${a})`;
      break;
    case "below": case "lt": case "lessThan":
      if (one) m = `toBeLessThan(${a})`;
      break;
    case "most": case "lte":
      if (one) m = `toBeLessThanOrEqual(${a})`;
      break;
    case "property":
      if (one) m = `toHaveProperty(${a})`;
      break;
    case "lengthOf": case "length":
      if (one) m = `toHaveLength(${a})`;
      break;
    case "match":
      if (one) m = `toMatch(${a})`;
      break;
    case "a": case "an": {
      const t = one ? /^(["'])(\w+)\1$/.exec(a)?.[2] : undefined;
      if (t === "array") {
        subject = `rr.expect(Array.isArray(${value}))`;
        m = "toBe(true)";
      } else if (t && ["string", "number", "boolean", "object", "undefined"].includes(t)) {
        subject = `rr.expect(typeof ${/^[\w.$]+$/.test(value) ? value : `(${value})`})`;
        m = `toBe("${t}")`;
      }
      break;
    }
  }
  if (!m) return generic;
  return { len: c.segs.length, fix: `${subject}${negate ? ".not" : ""}.${m}`, message: use(`${subject}${negate ? ".not" : ""}.${m}`) };
}

/** pm.response.to.... assertions */
function matchResponseTo(c: Chain): Match | null {
  let i = 2; // after "response", "to"
  while (prop(c, i) && FILLER.has(prop(c, i)!)) i++;
  const name = prop(c, i);
  const args = call(c, i + 1);
  if (name === "status" && args?.args.length === 1) {
    const f = `rr.expect(rr.response.status).toBe(${args.args[0]})`;
    return { len: i + 2, fix: f, message: use(f) };
  }
  if (name === "header" && args?.args.length === 1) {
    const f = `rr.expect(rr.response.header(${args.args[0]})).toBeDefined()`;
    return { len: i + 2, fix: f, message: use(f) };
  }
  if ((name === "ok" || name === "success") && !args) {
    const f = "rr.expect(rr.response.status >= 200 && rr.response.status < 300).toBe(true)";
    return { len: i + 1, fix: f, message: use(f) };
  }
  if (name === "jsonBody" && args && !args.args.length) {
    return { len: i + 2, fix: "rr.response.json()", message: use("rr.response.json()", "It throws when the body is not JSON.") };
  }
  if (name === "json" && !args) {
    return { len: i + 1, fix: "rr.response.json()", message: use("rr.response.json()", "It throws when the body is not JSON.") };
  }
  if (name === "jsonSchema") return { len: i + 1, message: "JSON schema checks are not available. Check the fields you care about with rr.expect." };
  return null;
}

function matchPm(c: Chain): Match {
  const p1 = prop(c, 0);
  const generic = (n = 1): Match => ({ len: n, message: `Postman's pm.${p1 ?? ""} has no REST Runner equivalent.` });
  if (!p1) return generic(0);

  if (VAR_SCOPES.has(p1)) {
    const method = prop(c, 1);
    const k = call(c, 2);
    const extra = p1 === "variables" ? undefined : SET_NOTE;
    if (!method || !k) return generic(1);
    const [a, b] = k.args;
    if (method === "get" && k.args.length === 1) return { len: 3, fix: `rr.vars.get(${a})`, message: use(`rr.vars.get(${a})`, "It looks in script variables, then the CSV row, then the environment.") };
    if (method === "set" && k.args.length === 2) return { len: 3, fix: `rr.vars.set(${a}, ${b})`, message: use(`rr.vars.set(${a}, ${b})`, extra) };
    if (method === "unset" && k.args.length === 1) return { len: 3, fix: `rr.vars.unset(${a})`, message: use(`rr.vars.unset(${a})`, extra) };
    if (method === "has" && k.args.length === 1) return { len: 3, fix: `rr.vars.has(${a})`, message: use(`rr.vars.has(${a})`) };
    if (method === "toObject" && !k.args.length) return { len: 3, fix: "rr.vars.all()", message: use("rr.vars.all()") };
    if (method === "replaceIn") return { len: 3, message: "Use {{name}} in the request instead, or rr.vars.get." };
    if (method === "clear") return { len: 3, message: "There is no equivalent. Use rr.vars.unset(name) for each variable." };
    return generic(3);
  }

  if (p1 === "iterationData") {
    const method = prop(c, 1);
    const k = call(c, 2);
    if (method === "get" && k?.args.length === 1) return { len: 3, fix: `rr.data[${k.args[0]}]`, message: use(`rr.data[${k.args[0]}]`) };
    if (method === "toObject" && k && !k.args.length) return { len: 3, fix: "rr.data", message: use("rr.data") };
    return generic(2);
  }

  if (p1 === "test") {
    return call(c, 1) ? { len: 1, fix: "rr.test", message: use("rr.test") } : generic(1);
  }

  if (p1 === "expect") return matchExpect(c, 1);

  if (p1 === "response") {
    const p2 = prop(c, 1);
    const k2 = call(c, 2);
    if (p2 === "to") return matchResponseTo(c) ?? generic(2);
    const plain: Record<string, [string, string?]> = {
      code: ["rr.response.status"],
      status: ["rr.response.statusText"],
      responseTime: ["rr.response.time"],
    };
    if (p2 && plain[p2] && !k2) return { len: 2, fix: plain[p2][0], message: use(plain[p2][0]) };
    if ((p2 === "json" || p2 === "text") && k2) return { len: 3, fix: `rr.response.${p2}()`, message: use(`rr.response.${p2}()`, p2 === "json" ? "It throws when the body is not JSON." : undefined) };
    if (p2 === "size" && k2) return { len: prop(c, 3) === "body" ? 4 : 3, fix: "rr.response.size", message: use("rr.response.size", "It is the body size in bytes.") };
    if (p2 === "headers") {
      const m = prop(c, 2);
      const k = call(c, 3);
      if (m === "get" && k?.args.length === 1) return { len: 4, fix: `rr.response.header(${k.args[0]})`, message: use(`rr.response.header(${k.args[0]})`) };
      if (m === "has" && k?.args.length === 1) {
        const f = `(rr.response.header(${k.args[0]}) !== undefined)`;
        return { len: 4, fix: f, message: use(f) };
      }
    }
    return generic(2);
  }

  if (p1 === "request") {
    const p2 = prop(c, 1);
    if (p2 === "url") {
      const t = prop(c, 2) === "toString" && call(c, 3);
      if (t) return { len: 4, fix: "rr.request.url", message: use("rr.request.url") };
      if (!prop(c, 2)) return { len: 2, fix: "rr.request.url", message: use("rr.request.url") };
      return { len: 2, message: TIP_NO_REQUEST_CHANGE };
    }
    if (p2 === "method" && !call(c, 2)) return { len: 2, fix: "rr.request.method", message: use("rr.request.method") };
    if (p2 === "headers") {
      const m = prop(c, 2);
      const k = call(c, 3);
      if (m === "get" && k?.args.length === 1) return { len: 4, fix: `rr.request.header(${k.args[0]})`, message: use(`rr.request.header(${k.args[0]})`) };
      if (m === "add" || m === "upsert" || m === "remove") return { len: 3, message: TIP_NO_REQUEST_CHANGE };
    }
    if (p2 === "body") {
      if (prop(c, 2) === "raw" && !call(c, 3)) return { len: 3, fix: "rr.request.body", message: use("rr.request.body") };
      return { len: 2, message: TIP_NO_REQUEST_CHANGE };
    }
    return generic(2);
  }

  if (p1 === "info") {
    const p2 = prop(c, 1);
    if (p2 === "iteration") return { len: 2, fix: "rr.iteration", message: use("rr.iteration") };
    if (p2 === "requestName") return { len: 2, fix: "rr.caseName", message: use("rr.caseName") };
    return generic(2);
  }

  if (p1 === "sendRequest") {
    return { len: 1, message: "Scripts can't send requests. Make it a separate request and chain the two in a Flow, or use a test suite and pass values with rr.vars.set." };
  }
  if (p1 === "execution") return { len: 2, message: "Use a Flow to choose which request runs next." };
  if (p1 === "cookies") return { len: 1, message: 'Read the cookie with rr.response.header("set-cookie").' };
  if (p1 === "visualizer") return { len: 2, message: "There is no visualizer. console.log the data instead." };
  if (p1 === "require") return { len: 1, message: TIP_LIBRARY };
  return generic(1);
}

function matchPostman(c: Chain): Match {
  const m = prop(c, 0);
  const k = call(c, 1);
  const [a, b] = k?.args ?? [];
  if ((m === "getEnvironmentVariable" || m === "getGlobalVariable") && k?.args.length === 1) return { len: 2, fix: `rr.vars.get(${a})`, message: use(`rr.vars.get(${a})`) };
  if ((m === "setEnvironmentVariable" || m === "setGlobalVariable") && k?.args.length === 2) return { len: 2, fix: `rr.vars.set(${a}, ${b})`, message: use(`rr.vars.set(${a}, ${b})`, SET_NOTE) };
  if (m === "getResponseHeader" && k?.args.length === 1) return { len: 2, fix: `rr.response.header(${a})`, message: use(`rr.response.header(${a})`) };
  if (m === "setNextRequest") return { len: 2, message: "Use a Flow to choose which request runs next." };
  return { len: m ? 1 : 0, message: `Postman's postman.${m ?? ""} has no REST Runner equivalent.` };
}

function matchLegacy(c: Chain, node: Node, code: string): Match | null {
  const s0 = c.segs[0];
  switch (c.root) {
    case "tests": {
      if (s0?.t !== "i") return { len: 0, message: "Postman's legacy tests object has no REST Runner equivalent. Use rr.test(name, () => { … })." };
      const parent = node.parent;
      const rhs = parent?.name === "AssignmentExpression" && parent.firstChild?.from === node.from && parent.firstChild.to === node.to ? parent.lastChild : null;
      const isPlainAssign = parent && children(parent).some((k) => k.name === "Equals");
      if (!parent || !rhs || !isPlainAssign) return { len: 1, message: "Postman's legacy tests object has no REST Runner equivalent. Use rr.test(name, () => { … })." };
      const f = `rr.test(${s0.text}, () => rr.expect(${code.slice(rhs.from, rhs.to)}).toBeTruthy())`;
      return { len: 1, fix: f, message: use(f), range: [parent.from, parent.to] };
    }
    case "responseBody": return { len: 0, fix: "rr.response.text()", message: use("rr.response.text()") };
    case "responseCode":
      return prop(c, 0) === "code" ? { len: 1, fix: "rr.response.status", message: use("rr.response.status") } : { len: 0, message: "Postman's responseCode has no REST Runner equivalent. Use rr.response.status." };
    case "responseTime": return { len: 0, fix: "rr.response.time", message: use("rr.response.time") };
    case "responseHeaders":
      return s0?.t === "i" ? { len: 1, fix: `rr.response.header(${s0.text})`, message: use(`rr.response.header(${s0.text})`) } : { len: 0, message: "Use rr.response.header(name)." };
    case "environment": case "globals":
      return s0?.t === "i" ? { len: 1, fix: `rr.vars.get(${s0.text})`, message: use(`rr.vars.get(${s0.text})`) } : { len: 0, message: "Use rr.vars.get(name)." };
    case "data":
      if (s0?.t === "i") return { len: 1, fix: `rr.data[${s0.text}]`, message: use(`rr.data[${s0.text}]`) };
      if (s0?.t === "p") return { len: 1, fix: `rr.data.${s0.name}`, message: use(`rr.data.${s0.name}`) };
      return { len: 0, fix: "rr.data", message: use("rr.data") };
    case "iteration": return { len: 0, fix: "rr.iteration", message: use("rr.iteration") };
    default: return { len: s0 ? 1 : 0, message: TIP_LIBRARY };
  }
}

function describe(c: Chain, len: number): string {
  const parts = [c.root];
  for (const s of c.segs.slice(0, len)) if (s.t === "p") parts.push(s.name);
  return parts.join(".");
}

function walk(tree: Tree, code: string): PostmanCall[] {
  const declared = declaredNames(tree, code);
  const out: PostmanCall[] = [];
  tree.iterate({
    enter(ref) {
      if (ref.name !== "MemberExpression" && ref.name !== "CallExpression" && ref.name !== "VariableName") return;
      const node = ref.node;
      if (isChainObject(node)) return;
      const chain = flatten(node, code);
      if (!chain || declared.has(chain.root)) return;
      let m: Match;
      if (chain.root === "pm") m = matchPm(chain);
      else if (chain.root === "postman") m = matchPostman(chain);
      else if (LEGACY_ROOTS.has(chain.root)) {
        const legacy = matchLegacy(chain, node, code);
        if (!legacy) return;
        m = legacy;
      } else return;
      // The matched prefix covers the root plus `len` segments.
      const len = Math.min(m.len, chain.segs.length);
      const end = len > 0 ? chain.segs[len - 1].to : chain.rootTo;
      const [from, to] = m.range ?? [chain.from, end];
      out.push({
        from,
        to,
        api: describe(chain, len),
        fix: m.fix === undefined ? undefined : { insert: m.fix },
        message: m.message,
      });
    },
  });
  return out.sort((x, y) => x.from - y.from || y.to - x.to);
}

function hasParseError(tree: Tree): boolean {
  let bad = false;
  tree.iterate({
    enter(n) {
      if (n.type.isError) bad = true;
      return !bad;
    },
  });
  return bad;
}

export function findPostmanCalls(code: string): PostmanCall[] {
  return walk(parser.parse(code), code);
}

/** Replaces every call that has an rr equivalent. Repeats because replacements can nest. */
export function convertPostmanScript(code: string): { code: string; converted: number; remaining: PostmanCall[] } {
  let current = code;
  let converted = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const chosen: PostmanCall[] = [];
    let lastEnd = -1;
    for (const c of findPostmanCalls(current)) {
      if (!c.fix || c.from < lastEnd) continue;
      chosen.push(c);
      lastEnd = c.to;
    }
    if (!chosen.length) break;
    let next = "";
    let at = 0;
    for (const c of chosen) {
      next += current.slice(at, c.from) + c.fix!.insert;
      at = c.to;
    }
    current = next + current.slice(at);
    converted += chosen.length;
  }
  return { code: current, converted, remaining: findPostmanCalls(current) };
}

const resultCache = new Map<string, boolean>();

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** True when the script still uses Postman calls. Cheap enough to call on every run. */
export function usesPostman(code: string): boolean {
  const cached = resultCache.get(code);
  if (cached !== undefined) return cached;
  const tree = parser.parse(code);
  let result = walk(tree, code).length > 0;
  // A script with a syntax error may hide pm calls from the parser, so be strict about those.
  if (!result && hasParseError(tree)) result = /\b(pm|postman)\s*\./.test(stripComments(code));
  if (resultCache.size > 500) resultCache.clear();
  resultCache.set(code, result);
  return result;
}

/** At most `limit` distinct api names, for error messages. */
export function postmanApiNames(code: string, limit = 3): string[] {
  const names = new Set<string>();
  for (const c of findPostmanCalls(code)) {
    names.add(c.api);
    if (names.size >= limit) break;
  }
  return [...names];
}
