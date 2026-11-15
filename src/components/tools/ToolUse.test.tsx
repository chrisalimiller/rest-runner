import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sampleFindRequest, sampleTool } from "../../lib/tools/sample";
import type { SessionState } from "../../lib/tools/session";
import type { BoardActions } from "./ToolBlocks";
import { ToolUse, mayTakeFocus } from "./ToolUse";

const tool = sampleTool();
const actions: Omit<BoardActions, "onRunKey"> = { onInput: () => {}, onRetry: () => {}, onOpenRequest: () => {}, onCopy: () => {}, onPick: () => {}, onRunAction: () => {} };
const base: SessionState = { inputs: {}, results: {}, sending: [], writes: {}, writing: [], running: false, startedAt: null, viewing: null, recordId: null, pending: [], error: null, stopped: false, loaded: true };

function page(state: SessionState): string {
  return renderToStaticMarkup(
    <ToolUse tool={tool} state={state} findRequest={sampleFindRequest()} environment={null} problems={[]} onLookup={() => {}} onStop={() => {}} onCopyAll={() => {}} onSaveHtml={() => {}} actions={actions} />,
  );
}

describe("ToolUse header", () => {
  it("puts the input and Look up in one form, with no separate Input block", () => {
    const html = page(base);
    expect(html).toContain("Subscriber ID");
    expect(html.match(/>Look up</g)).toHaveLength(1);
    expect(html).not.toContain('data-block="input"');
    expect(html).not.toContain("tool-status-line");
  });

  it("marks a saved lookup and says nothing was sent", () => {
    const viewing = { id: "r1", startedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), inputs: { subscriberId: "42" }, environmentName: "Dev" } as unknown as SessionState["viewing"];
    const html = page({ ...base, viewing, startedAt: viewing!.startedAt });
    expect(html).toContain("tool-status saved");
    expect(html).toContain("Saved lookup");
    expect(html).toContain("Nothing was sent");
  });

  it("a fresh lookup is not tinted", () => {
    expect(page({ ...base, startedAt: new Date().toISOString() })).not.toContain("tool-status saved");
  });
});

describe("mayTakeFocus", () => {
  it("allows focus from nothing or a button, not from a text field elsewhere", () => {
    expect(mayTakeFocus(null)).toBe(true);
    expect(mayTakeFocus({ tagName: "BODY" })).toBe(true);
    expect(mayTakeFocus({ tagName: "BUTTON" })).toBe(true);
    expect(mayTakeFocus({ tagName: "INPUT" })).toBe(false);
    expect(mayTakeFocus({ tagName: "DIV", isContentEditable: true })).toBe(false);
    expect(mayTakeFocus({ tagName: "INPUT" }, true)).toBe(true);
  });
});
