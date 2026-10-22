import { OP_LABELS, OPS_FOR_SOURCE, opNeedsValue, SOURCE_LABELS } from "../../lib/testing/assertions";
import { newAssertion } from "../../lib/testing/suites";
import type { Assertion, AssertionSource } from "../../lib/testing/types";

interface Props {
  assertions: Assertion[];
  onChange: (assertions: Assertion[]) => void;
}

const SOURCES = Object.keys(SOURCE_LABELS) as AssertionSource[];

const PROPERTY_HINT: Partial<Record<AssertionSource, string>> = {
  header: "Header name, e.g. Content-Type",
  json: "Path, e.g. $.data[0].id",
};

const EXPECTED_HINT: Partial<Record<AssertionSource, string>> = {
  status: "200 or 2xx",
  time: "500",
  size: "1024",
};

/** A table of no-code checks, each one row: source, property, operator, expected value. */
export function AssertionEditor({ assertions, onChange }: Props) {
  const update = (id: string, patch: Partial<Assertion>) =>
    onChange(
      assertions.map((a) => {
        if (a.id !== id) return a;
        const next = { ...a, ...patch };
        if (patch.source && !OPS_FOR_SOURCE[patch.source].includes(next.op)) next.op = OPS_FOR_SOURCE[patch.source][0];
        return next;
      }),
    );

  return (
    <div className="assertions">
      <p className="muted small">
        Each enabled row must pass for the case to pass. Expected values can use {"{{variables}}"}. JSON values compare loosely, so 42 matches
        "42".
      </p>
      <table className="kv assertion-table">
        <thead>
          <tr>
            <th className="kv-check" />
            <th>Check</th>
            <th>Property</th>
            <th>Condition</th>
            <th>Expected</th>
            <th className="kv-del" />
          </tr>
        </thead>
        <tbody>
          {assertions.map((a) => (
            <tr key={a.id} className={a.enabled ? "" : "disabled"}>
              <td className="kv-check">
                <input type="checkbox" checked={a.enabled} onChange={(e) => update(a.id, { enabled: e.target.checked })} aria-label="Enabled" />
              </td>
              <td>
                <select value={a.source} onChange={(e) => update(a.id, { source: e.target.value as AssertionSource })} aria-label="Check">
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {PROPERTY_HINT[a.source] ? (
                  <input value={a.property} onChange={(e) => update(a.id, { property: e.target.value })} placeholder={PROPERTY_HINT[a.source]} spellCheck={false} aria-label="Property" />
                ) : (
                  <span className="muted small">—</span>
                )}
              </td>
              <td>
                <select value={a.op} onChange={(e) => update(a.id, { op: e.target.value as Assertion["op"] })} aria-label="Condition">
                  {OPS_FOR_SOURCE[a.source].map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {opNeedsValue(a.op) ? (
                  <input
                    value={a.expected}
                    onChange={(e) => update(a.id, { expected: e.target.value })}
                    placeholder={a.op === "isType" ? "string, number, boolean, array, object, null" : (EXPECTED_HINT[a.source] ?? "Value")}
                    spellCheck={false}
                    aria-label="Expected"
                  />
                ) : (
                  <span className="muted small">—</span>
                )}
              </td>
              <td className="kv-del">
                <button className="icon-btn" onClick={() => onChange(assertions.filter((x) => x.id !== a.id))} aria-label="Remove assertion" title="Remove">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="assertion-add">
        <button className="link-btn" onClick={() => onChange([...assertions, newAssertion()])}>
          + Status
        </button>
        <button className="link-btn" onClick={() => onChange([...assertions, newAssertion({ source: "time", op: "lt", expected: "1000" })])}>
          + Response time
        </button>
        <button className="link-btn" onClick={() => onChange([...assertions, newAssertion({ source: "json", property: "$.", op: "exists", expected: "" })])}>
          + JSON path
        </button>
        <button className="link-btn" onClick={() => onChange([...assertions, newAssertion({ source: "header", property: "Content-Type", op: "contains", expected: "json" })])}>
          + Header
        </button>
        <button className="link-btn" onClick={() => onChange([...assertions, newAssertion({ source: "body", op: "contains", expected: "" })])}>
          + Body text
        </button>
      </div>
    </div>
  );
}
