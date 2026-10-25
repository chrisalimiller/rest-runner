import { applyTemplate, type Vars } from "../template";
import { compareValue, describeAssertion, evaluateAssertion, OP_LABELS, opNeedsValue, OPS_FOR_SOURCE, SOURCE_LABELS, showValue } from "../testing/assertions";
import type { AssertionOp, Check } from "../testing/types";
import type { ResponseResult } from "../types";
import type { ConditionSource, FlowCondition } from "./types";

export const CONDITION_SOURCE_LABELS: Record<ConditionSource, string> = {
  "last-result": "Last step result",
  variable: "Variable",
  ...SOURCE_LABELS,
};

export const OPS_FOR_CONDITION: Record<ConditionSource, AssertionOp[]> = {
  "last-result": ["eq", "neq"],
  variable: ["eq", "neq", "contains", "notContains", "exists", "notExists", "lt", "lte", "gt", "gte", "matches"],
  ...OPS_FOR_SOURCE,
};

export function describeCondition(c: FlowCondition): string {
  if (c.source === "variable") {
    const subject = `Variable ${c.property}`;
    return opNeedsValue(c.op) ? `${subject} ${OP_LABELS[c.op]} ${c.expected}` : `${subject} ${OP_LABELS[c.op]}`;
  }
  if (c.source === "last-result") return `Last step result ${OP_LABELS[c.op]} ${c.expected}`;
  return `Last response: ${describeAssertion({ id: "", enabled: true, ...c, source: c.source })}`;
}

export interface ConditionInput {
  /** Flow variables, with the environment underneath, for {{placeholders}} and variable checks. */
  vars: Vars;
  /** How the last Run step ended, or null when no Run step has run yet. */
  lastResult: "passed" | "failed" | null;
  /** The last response a Run step got, or null when none came back. */
  lastResponse: ResponseResult | null;
}

/** Checks an If node's condition. The check's `passed` is the branch: true or false. */
export function evaluateCondition(c: FlowCondition, input: ConditionInput): Check {
  const filled: FlowCondition = { ...c, property: applyTemplate(c.property, input.vars), expected: applyTemplate(c.expected, input.vars) };
  const name = describeCondition(filled);

  if (filled.source === "variable" || filled.source === "last-result") {
    const actual =
      filled.source === "variable"
        ? Object.prototype.hasOwnProperty.call(input.vars, filled.property.trim())
          ? input.vars[filled.property.trim()]
          : undefined
        : (input.lastResult ?? undefined);
    if (filled.source === "last-result" && actual === undefined) {
      return { name, passed: false, message: "No Run step has run yet, so this counts as false.", source: "assertion" };
    }
    const result = compareValue(filled.op, actual, filled.expected.trim());
    if (typeof result === "string") return { name, passed: false, message: `${result}, so this counts as false.`, source: "assertion" };
    return { name, passed: result, message: `Got ${showValue(actual)}`, source: "assertion" };
  }

  if (!input.lastResponse) {
    return { name, passed: false, message: "No response from an earlier step to check, so this counts as false.", source: "assertion" };
  }
  const check = evaluateAssertion({ id: "", enabled: true, ...c, source: filled.source }, input.lastResponse, input.vars);
  return { ...check, name };
}
