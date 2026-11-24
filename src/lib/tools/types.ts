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
  /**
   * A field (JSON path) of another call's response. For a pick-a-row call, the path is read from the picked row.
   * With `list`, the path is read from an item of one of that call's lists instead (see ListRef).
   */
  call?: { callId: string; path: string; list?: ListRef };
  fixed?: string;
}

/** A condition on the items of a list: the item's field (JSON path inside the item) equals, or does not equal, a value. */
export interface Where {
  field: string;
  op: "eq" | "ne";
  value: PlaceholderMapping;
}

/**
 * Which item of a list a value comes from (or how the list is reduced to one value).
 * - none: no item is chosen; the list is only shown
 * - ask: the row the user picks in the table
 * - index: 0 is the first item, -1 the last, n the item at that position
 * - where: the first item that matches
 */
export type ItemRule = { kind: "none" } | { kind: "ask" } | { kind: "index"; index: number } | { kind: "where"; field: string; op: "eq" | "ne"; value: PlaceholderMapping };

/** How a value reads a list: a different item rule than the list's own, or all items joined, or how many there are. */
export type ListItemChoice = ItemRule | { kind: "all"; join: string; where?: Where } | { kind: "count"; where?: Where } | EachChoice;

/**
 * Runs the call once for every item of the list, each time with that item's value. Only a value of a call's own
 * `{{placeholder}}` may use it, and a call has at most one such value. The answers go in `CallResult.each`.
 */
export interface EachChoice {
  kind: "each";
}

export interface ListRef {
  listId: string;
  /** Overrides the list's own rule for this one value. */
  item?: ListItemChoice;
}

/** A named list inside one call's response, for example the services or devices of a customer. */
export interface ToolList {
  /** Unique within the call. */
  id: string;
  name: string;
  /** JSON path of the list, read from the whole response (or, with parentListId, from the parent's chosen item). Empty or "$" means the response itself. */
  path: string;
  /** A list inside an item of another list of the same call: its path is read from that list's chosen item. */
  parentListId?: string;
  /** JSON path inside an item of the text that names it (waiting messages, history, remembered picks). Empty uses the whole item. */
  labelPath: string;
  /** Which item this list hands on by default. */
  choose: ItemRule;
  /** With "ask", a list of one item is picked without asking. Default true. */
  autoPickSingle?: boolean;
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
  /** Ask which row to use when the response is a list. A call has either pickRow or lists, never both. */
  pickRow?: PickRowSetting;
  /** Named lists inside the response. Fields that name no list read the whole response, as before. */
  lists?: ToolList[];
}

export const BLOCK_TYPES = ["input", "fields", "table", "number", "status", "json", "note", "action"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const FIELD_FORMATS = ["text", "number", "date", "money", "yes-no"] as const;
export type FieldFormat = (typeof FIELD_FORMATS)[number];

export interface BlockField {
  path: string;
  label: string;
  format: FieldFormat;
  /** Reads the path from an item of a list of the block's call. Without it the path is read as before. */
  list?: ListRef;
  /**
   * For a column of a table on a list: the call that runs once per item of that list. The cell shows that item's
   * answer, read at `path` of its response, or the item's error status.
   */
  callId?: string;
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
  /** For a table block, which list of the call it shows. Without it: the pick-a-row list, else the response if it is a list, else its first list. */
  listId?: string;
  /** For a table block: each row opens to show the item's other fields and the lists inside it. Off when missing. */
  expandable?: boolean;
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
  /** For a call with lists: the item picked in each list, by list id. `key` is the item's label, to recognise the same row in a later lookup. */
  picks?: Record<string, ListPick>;
  /** For a call that runs once per item of a list: one answer per item, in the list's order (at most MAX_EACH_ITEMS). The call's own state, status and response are not used. */
  each?: EachResult[];
  /** The number of items the list had, which can be more than `each` holds. */
  eachTotal?: number;
}

/** The answer for one item of a call that runs once per item. Same fields as a call's own answer. */
export interface EachResult {
  /** The item's position in its list. */
  index: number;
  /** The item's label (the list's label path), to name it in history and copied text. */
  key?: string;
  /** "pending": not finished yet (waiting for a free slot, or sent). */
  state: CallState | "pending";
  reason?: SkipReason;
  message?: string;
  status?: number;
  response?: ResponseResult;
  error?: string;
  request?: { method: string; url: string };
  sentAt?: string;
  durationMs?: number;
}

export interface ListPick {
  index: number;
  key?: string;
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
  code: "cycle" | "missing-request" | "unknown-call" | "unknown-input" | "duplicate-input" | "too-many-in-row" | "unknown-block-call" | "unknown-list" | "per-item-twice" | "per-item-write" | "reads-per-item" | "per-item-column" | "per-item-block";
  message: string;
  callId?: string;
  blockId?: string;
}
