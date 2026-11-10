import { cloneWithNewIds, countRequests, type Collection, type FolderNode, type RequestNode, type TreeNode } from "./collections";
import { defaultEnvColor, type Environment } from "./environments";
import { importWorkspace, type Workspace } from "./workspace";
import { newId } from "./ids";
import {
  envNameFromFile,
  isBrunoCollection,
  isInsomniaExport,
  looksLikeBrunoEnvironment,
  looksLikeDotEnv,
  markSecretLooking,
  parseBrunoCollection,
  parseBrunoEnvironment,
  parseDotEnv,
  parseInsomnia,
} from "./importFormats";
import { detectPostmanFile, importPostmanCollection, importPostmanEnvironment, isPostmanGlobals } from "./postman";
import type { Flow } from "./flows/types";
import type { TestSuite } from "./testing/types";

/**
 * The unified Import dialog's logic: find what is in each file (`scanText`), work out what each choice
 * would do to the workspace (`applyImport`) and which choices clash with something that already exists.
 * Pure: it works on a copy of the workspace and never writes anything.
 */

export type ImportKind = "collection" | "environment" | "suite" | "flow" | "certificates";

/** Where an item came from: its own file, variables embedded in a collection, or a Postman globals file. */
export type ImportOrigin = "file" | "embedded" | "globals";

export interface ImportItem {
  /** Unique across everything scanned in one dialog session. */
  key: string;
  kind: ImportKind;
  file: string;
  /** "Postman collection", "Insomnia export" and so on. */
  format: string;
  origin: ImportOrigin;
  name: string;
  /** "12 requests", "5 variables". */
  detail: string;
  /** Collections and standalone environments start checked; embedded variables and globals do not. */
  defaultChecked: boolean;
  warnings: string[];
  collection?: Collection;
  environment?: Environment;
  suite?: TestSuite;
  flow?: Flow;
  /** Certificate rules from a workspace file (applied by the caller; they have no names to clash). */
  certificates?: unknown[];
}

export interface ScannedFile {
  file: string;
  /** What the file was detected as, or "" when it was not recognised. */
  format: string;
  items: ImportItem[];
  /** Set when the file could not be read; the other fields are then empty. */
  error?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function envItem(base: Omit<ImportItem, "kind" | "detail" | "name" | "environment">, environment: Environment): ImportItem {
  const n = environment.vars.filter((v) => v.key.trim() !== "").length;
  return { ...base, kind: "environment", name: environment.name, detail: plural(n, "variable"), environment };
}

function collectionItem(base: Omit<ImportItem, "kind" | "detail" | "name" | "collection">, collection: Collection): ImportItem {
  return { ...base, kind: "collection", name: collection.name, detail: plural(countRequests(collection.items), "request"), collection };
}

/** Reads one file's text, whatever it is, and lists what it holds. Never throws: problems come back in `error`. */
export function scanText(file: string, text: string, keyPrefix = file): ScannedFile {
  let n = 0;
  const key = () => `${keyPrefix}#${n++}`;
  const fail = (error: string): ScannedFile => ({ file, format: "", items: [], error });
  try {
    const trimmed = text.replace(/^﻿/, "");
    if (trimmed.trim() === "") return fail("The file is empty.");
    let data: unknown;
    let isJson = true;
    try {
      data = JSON.parse(trimmed);
    } catch {
      isJson = false;
    }
    const base = (format: string, origin: ImportOrigin, defaultChecked: boolean, warnings: string[]) => ({ key: key(), file, format, origin, defaultChecked, warnings });

    if (!isJson) {
      if (looksLikeBrunoEnvironment(trimmed)) {
        const { environment, warnings } = parseBrunoEnvironment(trimmed, envNameFromFile(file.replace(/\.bru$/i, "")));
        return { file, format: "Bruno environment", items: [envItem(base("Bruno environment", "file", true, warnings), environment)] };
      }
      if (looksLikeDotEnv(trimmed)) {
        const { environment, warnings } = parseDotEnv(trimmed, envNameFromFile(file));
        return { file, format: ".env file", items: [envItem(base(".env file", "file", true, warnings), environment)] };
      }
      if (/^\s*(openapi|swagger|type:\s*collection\.insomnia)/m.test(trimmed)) return fail("Insomnia 8+ YAML and OpenAPI files are not supported. In Insomnia, export as Insomnia v4 (JSON).");
      return fail("This is not a file REST Runner can import. It reads Postman, Insomnia (v4 JSON), Bruno, .env and REST Runner files.");
    }

    const obj = data as Record<string, unknown> | null;
    if (obj && typeof obj === "object" && obj.app === "rest-runner") {
      const ws = importWorkspace(trimmed, { collections: [], environments: [], suites: [], flows: [] });
      const items: ImportItem[] = [];
      const b = () => base("REST Runner file", "file", true, []);
      for (const c of ws.collections) items.push(collectionItem(b(), c));
      for (const e of ws.environments) items.push(envItem(b(), e));
      for (const s of ws.suites) items.push({ ...b(), kind: "suite", name: s.name, detail: plural(s.cases.length, "test case"), suite: s });
      for (const f of ws.flows) items.push({ ...b(), kind: "flow", name: f.name, detail: plural(f.nodes.length, "step"), flow: f, warnings: ["Imported flow schedules are off. Review and enable them in Flows."] });
      const certs = Array.isArray(obj.certificates) ? obj.certificates : [];
      if (certs.length > 0) items.push({ ...b(), kind: "certificates", name: "Certificate rules", detail: plural(certs.length, "rule"), certificates: certs });
      if (items.length === 0) return fail("This REST Runner file has nothing to import.");
      return { file, format: "REST Runner file", items };
    }

    const postman = detectPostmanFile(data);
    if (postman === "collection") {
      const r = importPostmanCollection(data);
      const items = [collectionItem(base("Postman collection", "file", true, r.warnings), r.collection)];
      if (r.variables) {
        items.push(envItem(base("Postman collection", "embedded", false, []), { ...r.variables, name: `${r.collection.name} variables` }));
      }
      return { file, format: "Postman collection", items };
    }
    if (postman === "environment") {
      const r = importPostmanEnvironment(data);
      if (isPostmanGlobals(data)) {
        const name = typeof (data as { name?: unknown }).name === "string" && (data as { name: string }).name.trim() !== "" ? r.environment.name : "Postman globals";
        return { file, format: "Postman globals", items: [envItem(base("Postman globals", "globals", false, r.warnings), { ...r.environment, name })] };
      }
      return { file, format: "Postman environment", items: [envItem(base("Postman environment", "file", true, r.warnings), r.environment)] };
    }
    if (isInsomniaExport(data)) {
      const r = parseInsomnia(data);
      const items = [
        ...r.collections.map((c) => collectionItem(base("Insomnia export", "file", true, r.warnings), c)),
        ...r.environments.map((e) => envItem(base("Insomnia export", "file", true, []), e)),
      ];
      // Warnings belong to the export, so show them once, on the first item.
      for (const it of items.slice(1)) it.warnings = it.kind === "collection" ? [] : it.warnings;
      return { file, format: "Insomnia export", items };
    }
    if (isBrunoCollection(data)) {
      const r = parseBrunoCollection(data);
      const items = [
        ...r.collections.map((c) => collectionItem(base("Bruno collection", "file", true, r.warnings), c)),
        ...r.environments.map((e) => envItem(base("Bruno collection", "file", true, []), e)),
      ];
      return { file, format: "Bruno collection", items };
    }
    return fail("This JSON file is not a Postman, Insomnia, Bruno or REST Runner export.");
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

// ---- Choices and applying them ----------------------------------------------

export type Resolution = "merge" | "replace" | "keep-both";

/** What the user decided for one item in the review step. */
export interface ImportChoice {
  item: ImportItem;
  checked: boolean;
  name: string;
  /** Environments only. */
  isProduction: boolean;
  /** Environments only: mark variables named like token, key, secret or password as secret. */
  markSecrets: boolean;
  /** How to settle a name clash. Null until the user picks; unresolved clashes block the import. */
  resolution: Resolution | null;
}

export function defaultChoice(item: ImportItem): ImportChoice {
  return { item, checked: item.defaultChecked, name: item.name, isProduction: false, markSecrets: true, resolution: null };
}

/** The resolutions that make sense for a kind: suites and flows cannot be merged. */
export function resolutionsFor(kind: ImportKind): Resolution[] {
  return kind === "collection" || kind === "environment" ? ["merge", "replace", "keep-both"] : ["replace", "keep-both"];
}

const norm = (s: string) => s.trim().toLowerCase();

/** `name (2)`, `name (3)` ... the first not in `taken` (lower-case names). */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(norm(name))) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name} (${i})`;
    if (!taken.has(norm(candidate))) return candidate;
  }
}

export interface ImportOutcome {
  workspace: Workspace;
  /** For each choice, whether its name clashes with something already there (or imported earlier). */
  clashes: boolean[];
  /** Checked choices that clash and have no resolution yet. */
  unresolved: number;
  /** Human lines for the result summary. */
  lines: string[];
  /** Item and file warnings of what was imported, without repeats. */
  warnings: string[];
  /** Number of items added, merged into, replaced. */
  counts: { added: number; merged: number; replaced: number };
}

function collectionIds(c: Collection): string[] {
  const out = [c.id];
  const walk = (items: TreeNode[]) => {
    for (const i of items) {
      out.push(i.id);
      if (i.kind === "folder") walk(i.items);
      else for (const e of i.examples) out.push(e.id);
    }
  };
  walk(c.items);
  return out;
}

function mergeItems(existing: TreeNode[], incoming: TreeNode[]): TreeNode[] {
  const out = [...existing];
  for (const node of incoming) {
    if (node.kind === "folder") {
      const i = out.findIndex((x) => x.kind === "folder" && norm(x.name) === norm(node.name));
      if (i >= 0) {
        const folder = out[i] as FolderNode;
        out[i] = { ...folder, items: mergeItems(folder.items, node.items) };
      } else out.push(cloneWithNewIds(node));
    } else {
      const same = (x: TreeNode): x is RequestNode =>
        x.kind === "request" && norm(x.request.name) === norm(node.request.name) && x.request.method === node.request.method && x.request.url === node.request.url;
      const i = out.findIndex(same);
      if (i >= 0) {
        const old = out[i] as RequestNode;
        const copy = cloneWithNewIds(node) as RequestNode;
        // The request keeps its place and id, so tabs, flows and suites that point at it still work.
        out[i] = { ...old, request: { ...copy.request, id: old.id }, examples: copy.examples };
      } else out.push(cloneWithNewIds(node));
    }
  }
  return out;
}

function mergeEnvironment(existing: Environment, incoming: Environment): Environment {
  const vars = existing.vars.filter((v) => v.key.trim() !== "" || existing.vars.length === 1);
  for (const v of incoming.vars) {
    if (v.key.trim() === "") continue;
    const i = vars.findIndex((x) => x.key.trim() === v.key.trim());
    if (i >= 0) {
      const old = vars[i];
      // A blank secret in the file (Bruno, Postman) must not wipe the value already here.
      const value = v.secret && v.value === "" ? old.value : v.value;
      vars[i] = { ...old, value, enabled: v.enabled, secret: old.secret || v.secret ? true : undefined };
      if (!vars[i].secret) delete vars[i].secret;
    } else vars.push({ ...v, id: newId() });
  }
  return { ...existing, vars: vars.length > 0 ? vars : existing.vars };
}

function keepBlankSecrets(incoming: Environment, existing: Environment): Environment {
  return {
    ...incoming,
    vars: incoming.vars.map((v) => {
      if (!v.secret || v.value !== "") return v;
      const mine = existing.vars.find((x) => x.key.trim() === v.key.trim() && x.key.trim() !== "");
      return mine?.secret || mine?.value ? { ...v, value: mine.value } : v;
    }),
  };
}

/**
 * Works out the result of an import without touching anything: the checked choices are applied, in
 * order, to a copy of `current`. A clash is a checked item whose (renamed) name matches an existing
 * item of the same kind, ignoring case, or an earlier checked item. A clash with no resolution is
 * left out and counted in `unresolved`; the caller must not commit until that is zero.
 */
export function computeImport(current: Workspace, choices: readonly ImportChoice[]): ImportOutcome {
  let ws: Workspace = { collections: [...current.collections], environments: [...current.environments], suites: [...current.suites], flows: [...current.flows] };
  const clashes: boolean[] = [];
  const lines: string[] = [];
  const warnings: string[] = [];
  const counts = { added: 0, merged: 0, replaced: 0 };
  let unresolved = 0;
  const warn = (w: string) => {
    if (!warnings.includes(w)) warnings.push(w);
  };

  for (const choice of choices) {
    const { item } = choice;
    if (!choice.checked || item.kind === "certificates") {
      clashes.push(false);
      continue;
    }
    const wanted = choice.name.trim() === "" ? item.name : choice.name.trim();
    const list = item.kind === "collection" ? ws.collections : item.kind === "environment" ? ws.environments : item.kind === "suite" ? ws.suites : ws.flows;
    const names = new Set(list.map((x) => norm(x.name)));
    const clashing = list.find((x) => norm(x.name) === norm(wanted));
    clashes.push(!!clashing);
    if (clashing && choice.resolution === null) {
      unresolved += 1;
      continue;
    }
    const mode: Resolution | null = clashing ? choice.resolution : null;
    const finalName = mode === "keep-both" ? uniqueName(wanted, names) : mode ? clashing!.name : wanted;
    const label = `${item.kind} "${finalName}"`;
    for (const w of item.warnings) warn(w);

    if (item.kind === "environment") {
      let env: Environment = { ...structuredClone(item.environment!), name: finalName };
      if (choice.markSecrets) env = markSecretLooking(env);
      const prod = choice.isProduction;
      const idTaken = ws.environments.some((e) => e.id === env.id);
      if (mode === "merge") {
        const merged = mergeEnvironment(clashing as Environment, env);
        const next = { ...merged, isProduction: merged.isProduction || prod };
        ws = { ...ws, environments: ws.environments.map((e) => (e.id === merged.id ? next : e)) };
        counts.merged += 1;
        lines.push(`Merged variables into environment "${next.name}".`);
      } else if (mode === "replace") {
        const old = clashing as Environment;
        const next: Environment = { ...keepBlankSecrets(env, old), id: old.id, name: old.name, color: old.color, isProduction: old.isProduction || prod };
        ws = { ...ws, environments: ws.environments.map((e) => (e.id === old.id ? next : e)) };
        counts.replaced += 1;
        lines.push(`Replaced ${label}.`);
      } else {
        const next: Environment = { ...env, id: mode === "keep-both" || idTaken ? newId() : env.id, color: env.color ?? defaultEnvColor(finalName), isProduction: prod };
        ws = { ...ws, environments: [...ws.environments, next] };
        counts.added += 1;
        lines.push(`Added ${label}${prod ? " (production)" : ""}.`);
      }
    } else if (item.kind === "collection") {
      const col = { ...item.collection!, name: finalName };
      if (mode === "merge") {
        const old = clashing as Collection;
        ws = { ...ws, collections: ws.collections.map((c) => (c.id === old.id ? { ...c, items: mergeItems(c.items, col.items) } : c)) };
        counts.merged += 1;
        lines.push(`Merged requests into collection "${old.name}".`);
      } else if (mode === "replace") {
        const old = clashing as Collection;
        ws = { ...ws, collections: ws.collections.map((c) => (c.id === old.id ? { ...col, id: old.id, name: old.name } : c)) };
        counts.replaced += 1;
        lines.push(`Replaced ${label}.`);
      } else {
        const used = new Set(ws.collections.flatMap(collectionIds));
        const clash = mode === "keep-both" || collectionIds(col).some((id) => used.has(id));
        const next: Collection = clash ? { ...col, id: newId(), items: col.items.map(cloneWithNewIds) } : col;
        ws = { ...ws, collections: [...ws.collections, next] };
        counts.added += 1;
        lines.push(`Added ${label} (${plural(countRequests(next.items), "request")}).`);
      }
    } else if (item.kind === "suite") {
      const suite = { ...item.suite!, name: finalName };
      if (mode === "replace") {
        const old = clashing as TestSuite;
        ws = { ...ws, suites: ws.suites.map((s) => (s.id === old.id ? { ...suite, id: old.id, name: old.name } : s)) };
        counts.replaced += 1;
        lines.push(`Replaced ${label}.`);
      } else {
        const idTaken = ws.suites.some((s) => s.id === suite.id);
        ws = { ...ws, suites: [...ws.suites, { ...suite, id: mode === "keep-both" || idTaken ? newId() : suite.id }] };
        counts.added += 1;
        lines.push(`Added ${label}.`);
      }
    } else {
      const flow = { ...item.flow!, name: finalName };
      if (mode === "replace") {
        const old = clashing as Flow;
        ws = { ...ws, flows: ws.flows.map((f) => (f.id === old.id ? { ...flow, id: old.id, name: old.name } : f)) };
        counts.replaced += 1;
        lines.push(`Replaced ${label}.`);
      } else {
        const idTaken = ws.flows.some((f) => f.id === flow.id);
        ws = { ...ws, flows: [...ws.flows, { ...flow, id: mode === "keep-both" || idTaken ? newId() : flow.id }] };
        counts.added += 1;
        lines.push(`Added ${label}.`);
      }
    }
  }
  return { workspace: ws, clashes, unresolved, lines, warnings, counts };
}

/** Sets the same resolution on every checked, clashing item that has none (the "apply to all clashes" shortcut). */
export function applyToAllClashes(choices: readonly ImportChoice[], clashes: readonly boolean[], resolution: Resolution): ImportChoice[] {
  return choices.map((c, i) => (c.checked && clashes[i] && resolutionsFor(c.item.kind).includes(resolution) ? { ...c, resolution } : c));
}

/** True when the Import button may be pressed: something is checked and no clash is waiting for an answer. */
export function canImport(choices: readonly ImportChoice[], outcome: ImportOutcome): boolean {
  return outcome.unresolved === 0 && choices.some((c) => c.checked);
}
