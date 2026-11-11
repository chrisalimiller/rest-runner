import type { ResponseResult } from "../types";

/** A tool is a small lookup page: inputs, saved requests that run in dependency order, and blocks that show the answers. */

export type ToolInputKind = "text" | "dropdown";

export interface ToolInput {
  /** The name a call's placeholder maps to. Unique within a tool. */
  name: string;
  label: string;
  kind: ToolInputKind;
  /** Used when the field is left empty. */
  default?: string;
  /** Choices for a dropdown. */
  options?: string[];
}

/**
 * Where one `{{placeholder}}` of a call gets its value. Sources are tried in this order:
 * the input, another call's field, the fixed value. A placeholder with no mapping at all
 * (or an empty one) falls back to the environment, the same as in Requests.
 * When a call field is mapped and has no value, the call is skipped rather than
 * sending with the environment's value of the same name.
 */
export interface PlaceholderMapping {
  /** Name of a tool input. */
  input?: string;
  /** A field (JSON path) of another call's response. For a pick-a-row call, the path is read from the picked row. */
  call?: { callId: string; path: string };
  fixed?: string;
}

export interface PickRowSetting {
  /** JSON path of the list in the response. Empty or "$" means the response itself is the list. */
  listPath: string;
  /** JSON path inside a row of the text shown when choosing. Empty shows the whole row. */
  labelPath: string;
}

export interface ToolCall {
  id: string;
  /** Own name, so the same saved request can appear twice, filled differently. */
  name: string;
  /** A saved request or example, by id (not a copy). */
  requestId: string;
  /** By placeholder name. */
  mappings: Record<string, PlaceholderMapping>;
  /** Write calls (POST/PUT/PATCH/DELETE) run only from an Action button, never in Look up. */
  write: boolean;
  /** Ask which row to use when the response is a list. */
  pickRow?: PickRowSetting;
}

export const BLOCK_TYPES = ["input", "fields", "table", "number", "status", "json", "note", "action"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const FIELD_FORMATS = ["text", "number", "date", "money", "yes-no"] as const;
export type FieldFormat = (typeof FIELD_FORMATS)[number];

export interface BlockField {
  path: string;
  label: string;
  format: FieldFormat;
}

export const MAX_BLOCKS_PER_ROW = 3;

export interface ToolBlock {
  id: string;
  type: BlockType;
  title: string;
  /** Which call fills the block (for an action button, the write call it runs). */
  callId?: string;
  /** For an input block, the input it shows. */
  inputName?: string;
  fields: BlockField[];
  /** Heading or note text. */
  text?: string;
  /** Row of the page, counted from 0. Up to MAX_BLOCKS_PER_ROW blocks share a row, in array order. */
  row: number;
}

export interface ToolSettings {
  /** Environment used for lookups. Null means none. */
  environmentId: string | null;
  runOnOpen: boolean;
  /** Off means this tool keeps no recent lookups. */
  keepHistory: boolean;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  inputs: ToolInput[];
  calls: ToolCall[];
  blocks: ToolBlock[];
  settings: ToolSettings;
}

/**
 * How a call ended. There is no pass or fail.
 * - done: a response came back (any status, 4xx and 5xx included)
 * - skipped: not sent (a needed value is missing, the request is missing, or a write call in Look up)
 * - network-error: no response; `error` says why
 * - stopped: the user pressed Stop
 */
export type CallState = "done" | "skipped" | "network-error" | "stopped";

export type SkipReason = "missing-request" | "needs-value" | "not-confirmed" | "invalid";

export interface CallResult {
  callId: string;
  name: string;
  state: CallState;
  reason?: SkipReason;
  /** Plain-language note, e.g. "Needs accountId from Subscriber". */
  message?: string;
  /** Present when state is done. */
  status?: number;
  response?: ResponseResult;
  /** Present when state is network-error. */
  error?: string;
  /** What was sent (no headers, so no credentials end up in history). */
  request?: { method: string; url: string };
  sentAt?: string;
  durationMs?: number;
  /** For a pick-a-row call: how many rows the list had, and the row chosen. */
  rowCount?: number;
  picked?: { index: number };
}

export interface LookupRun {
  id: string;
  toolId: string;
  startedAt: string;
  inputs: Record<string, string>;
  /** In the order of the tool's calls. Write calls are not in here. */
  results: CallResult[];
  /** The user pressed Stop. */
  stopped: boolean;
}

/** One saved lookup (recent lookups). */
export interface LookupRecord extends LookupRun {
  toolName: string;
  environmentName?: string;
}

export interface ToolProblem {
  /** "error" means Look up refuses to run. */
  level: "error" | "warning";
  code: "cycle" | "missing-request" | "unknown-call" | "unknown-input" | "duplicate-input" | "too-many-in-row" | "unknown-block-call";
  message: string;
  callId?: string;
  blockId?: string;
}
