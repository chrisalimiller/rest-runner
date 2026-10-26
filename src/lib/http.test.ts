import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { sendRequest } from "./http";
import type { PreparedRequest } from "./types";

const req: PreparedRequest = { method: "GET", url: "https://api.acme.com/a", headers: [["Accept", "*/*"]] };

function reply(status: number, headers: [string, string][] = [], body = "") {
  return { status, statusText: "", headers, body, sizeBytes: body.length, durationMs: 1 };
}

beforeEach(() => {
  invoke.mockReset();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("sendRequest in the desktop app", () => {
  it("sends through http_send and returns the response", async () => {
    invoke.mockResolvedValueOnce(reply(200, [], "ok"));
    const out = await sendRequest(req);
    expect(out.ok && out.response.body).toBe("ok");
    const [command, args] = invoke.mock.calls[0];
    expect(command).toBe("http_send");
    expect(args.request).toMatchObject({ method: "GET", url: req.url, headers: req.headers, body: null });
  });

  it("follows redirects one hop at a time", async () => {
    invoke
      .mockResolvedValueOnce(reply(302, [["location", "https://other.test/b"]]))
      .mockResolvedValueOnce(reply(200, [], "done"));
    const out = await sendRequest(req);
    expect(out.ok && out.response.body).toBe("done");
    expect(invoke.mock.calls[1][1].request.url).toBe("https://other.test/b");
    expect(out.request.url).toBe(req.url); // the outcome still records what the user sent
  });

  it("stops after 10 redirects", async () => {
    invoke.mockResolvedValue(reply(302, [["location", "/again"]]));
    const out = await sendRequest(req);
    expect(!out.ok && out.error).toBe("Stopped after 10 redirects");
    expect(invoke).toHaveBeenCalledTimes(11);
  });

  it("reports an error string from Rust", async () => {
    invoke.mockRejectedValueOnce("error sending request: connection refused");
    const out = await sendRequest(req);
    expect(!out.ok && out.error).toBe("error sending request: connection refused");
  });

  it("asks Rust to cancel when the signal aborts", async () => {
    const controller = new AbortController();
    let finish!: (value: unknown) => void;
    invoke.mockImplementation((command: string) =>
      command === "http_send" ? new Promise((resolve) => (finish = resolve)) : Promise.resolve(),
    );
    const pending = sendRequest(req, controller.signal);
    controller.abort();
    expect(invoke).toHaveBeenCalledWith("http_cancel", { id: invoke.mock.calls[0][1].request.id });
    finish(undefined);
    await pending;
  });

  it("does not call Rust when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await sendRequest(req, controller.signal);
    expect(!out.ok && out.error).toBe("Request cancelled");
    expect(invoke).not.toHaveBeenCalled();
  });
});
