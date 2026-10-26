import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { resetCertificateCache, saveCertificates, type CertificateEntry } from "./certificates";
import { sendRequest } from "./http";
import type { PreparedRequest } from "./types";

const req: PreparedRequest = { method: "GET", url: "https://api.acme.com/a", headers: [["Accept", "*/*"]] };

function reply(status: number, headers: [string, string][] = [], body = "") {
  return { status, statusText: "", headers, body, sizeBytes: body.length, durationMs: 1 };
}

const details = { subject: "CN=x", issuer: "CN=ca", notBefore: 0, notAfter: 4_000_000_000, sha256: "ab".repeat(32) };
const acme: CertificateEntry = {
  id: "acme",
  name: "Acme staging",
  enabled: true,
  patterns: ["api.acme.com"],
  client: { format: "pem", separateKey: true, hasPassphrase: false, keyUnencrypted: true, details },
};

beforeEach(() => {
  resetCertificateCache();
  saveCertificates([]);
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

  describe("with imported certificates", () => {
    beforeEach(() => saveCertificates([acme]));

    it("sends the matching certificate and records it with the result", async () => {
      invoke.mockResolvedValueOnce(reply(200));
      const out = await sendRequest(req);
      expect(invoke.mock.calls[0][1].request.tls).toEqual({ certId: "acme", caIds: [], caOnly: false });
      expect(out.certificate).toEqual({ id: "acme", name: "Acme staging", sha256: details.sha256 });
    });

    it("sends no certificate to other hosts", async () => {
      invoke.mockResolvedValueOnce(reply(200));
      const out = await sendRequest({ ...req, url: "https://other.test/" });
      expect(invoke.mock.calls[0][1].request.tls).toEqual({ caIds: [], caOnly: false });
      expect(out.certificate).toBeUndefined();
    });

    it("leaves the client certificate out when the request says so", async () => {
      invoke.mockResolvedValueOnce(reply(200));
      const out = await sendRequest({ ...req, noCertificate: true });
      expect(invoke.mock.calls[0][1].request.tls.certId).toBeUndefined();
      expect(out.certificate).toBeUndefined();
    });

    it("matches again on every redirect hop, so the certificate is not shown to the next host", async () => {
      invoke
        .mockResolvedValueOnce(reply(302, [["location", "https://elsewhere.test/x"]]))
        .mockResolvedValueOnce(reply(200));
      await sendRequest(req);
      expect(invoke.mock.calls[0][1].request.tls.certId).toBe("acme");
      expect(invoke.mock.calls[1][1].request.tls.certId).toBeUndefined();
    });

    it("explains a missing client certificate in plain words", async () => {
      saveCertificates([]);
      invoke.mockRejectedValueOnce("error sending request: received fatal alert: CertificateRequired");
      const out = await sendRequest(req);
      expect(!out.ok && out.error).toMatch(/none matched api\.acme\.com/);
    });
  });
});
