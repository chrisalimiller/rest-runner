import { describe, expect, it } from "vitest";
import { maskSecrets, SECRET_MASK as M, secretValues } from "./secrets";

describe("maskSecrets", () => {
  it("masks every occurrence", () => {
    expect(maskSecrets("a tok b tok", ["tok"])).toBe(`a ${M} b ${M}`);
  });

  it("ignores empty secrets and an empty list", () => {
    expect(maskSecrets("abc", [""])).toBe("abc");
    expect(maskSecrets("abc", [])).toBe("abc");
  });

  it("merges overlapping values into one mask", () => {
    expect(maskSecrets("xabcdefx", ["abcd", "cdef"])).toBe(`x${M}x`);
    expect(maskSecrets("Bearer abcdef", ["abc", "abcdef"])).toBe(`Bearer ${M}`);
  });

  it("finds values inside JSON, including escaped ones", () => {
    const pw = 'p"w\\1';
    const body = JSON.stringify({ password: pw, n: 1 });
    expect(maskSecrets(body, [pw])).toBe(`{"password":"${M}","n":1}`);
  });

  it("finds URL-encoded, HTML-escaped and CSV-quoted values", () => {
    expect(maskSecrets("?k=a%20b%26c", ["a b&c"])).toBe(`?k=${M}`);
    expect(maskSecrets("<td>a&amp;b</td>", ["a&b"])).toBe(`<td>${M}</td>`);
    expect(maskSecrets('"say ""hi"""', ['say "hi"'])).toBe(`"${M}"`);
  });
});

describe("secretValues", () => {
  it("lists non-empty secret values once", () => {
    const row = (value: string, secret?: boolean) => ({ id: value, key: "k", value, enabled: true, secret });
    expect(secretValues([{ id: "e", name: "E", vars: [row("a", true), row("b"), row("", true), row("a", true)] }])).toEqual(["a"]);
  });
});
