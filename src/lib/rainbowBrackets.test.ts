import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RAINBOW_CHARS,
  RAINBOW_COLORS,
  bracketClass,
  bracketSegments,
  findBrackets,
  getRainbowBrackets,
  guessLanguage,
  resetRainbowBracketsCache,
  setRainbowBrackets,
  subscribeRainbowBrackets,
  type BracketLanguage,
} from "./rainbowBrackets";

const depths = (text: string, lang?: BracketLanguage) => findBrackets(text, lang).map((t) => `${text[t.index]}${t.error ? "!" : t.depth}`);

describe("findBrackets", () => {
  it("numbers nesting depth and gives a pair the same depth", () => {
    expect(depths('{"a":[1,{"b":2}]}')).toEqual(["{0", "[1", "{2", "}2", "]1", "}0"]);
  });

  it("handles parentheses, and siblings return to the same depth", () => {
    expect(depths("f(a[0], (b))")).toEqual(["(0", "[1", "]1", "(1", ")1", ")0"]);
  });

  it("ignores brackets inside JSON strings, including escaped quotes", () => {
    expect(depths('{"a":"x[(}\\"]"}')).toEqual(["{0", "}0"]);
  });

  it("ignores brackets in comments", () => {
    expect(depths('{ // [\n "a": 1 /* ( */ }')).toEqual(["{0", "}0"]);
    expect(depths("{ /* never closed [")).toEqual(["{!"]);
  });

  it("does not treat the braces of a {{placeholder}} as brackets", () => {
    expect(depths('{"id": {{id}}, "n": "{{n}}", "o": {"k": {{ k }}}}')).toEqual(["{0", "{1", "}1", "}0"]);
  });

  it("still pairs braces next to a placeholder", () => {
    expect(depths("{{a}}{")).toEqual(["{!"]);
  });

  it("marks unmatched and wrongly paired brackets as errors", () => {
    expect(depths("[1, 2")).toEqual(["[!"]);
    expect(depths("1]")).toEqual(["]!"]);
    expect(depths("{]")).toEqual(["{!", "]!"]);
    expect(depths("{[}")).toEqual(["{!", "[!", "}!"]);
  });

  it("ends an unfinished JSON string at the line break", () => {
    expect(depths('{"a": "oops\n[1]}')).toEqual(["{0", "[1", "]1", "}0"]);
  });

  it("follows the language: js template strings and quotes", () => {
    expect(depths("f('(', `[\n]`, \"{\")", "js")).toEqual(["(0", ")0"]);
  });

  it("follows the language: python and shell comments and triple quotes", () => {
    expect(depths("x = (1) # ) [", "python")).toEqual(["(0", ")0"]);
    expect(depths('s = """(\n["""\nf()', "python")).toEqual(["(0", ")0"]);
    expect(depths("echo ${a} # ( \necho $(b)", "shell")).toEqual(["{0", "}0", "(0", ")0"]);
    expect(depths("echo a#(b)", "shell")).toEqual(["(0", ")0"]);
  });

  it("shell single quotes have no escapes", () => {
    expect(depths("echo 'a\\' (x)", "shell")).toEqual(["(0", ")0"]);
  });

  it("plain counts every bracket, even inside quotes", () => {
    expect(depths("curl -d '{\"a\":[1]}'", "plain")).toEqual(["{0", "[1", "]1", "}0"]);
  });

  it("skips colouring above the size cap", () => {
    expect(findBrackets("[".repeat(MAX_RAINBOW_CHARS + 1))).toEqual([]);
    expect(findBrackets("[]".repeat(10)).length).toBe(20);
  });

  it("is fast on a large body", () => {
    const text = JSON.stringify(Array.from({ length: 4000 }, (_, i) => ({ id: i, tags: ["a", "b"], nested: { x: [1, 2, 3] } })));
    const t = performance.now();
    findBrackets(text.slice(0, MAX_RAINBOW_CHARS), "json");
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe("bracketClass and segments", () => {
  it("cycles the palette and flags errors", () => {
    const tokens = findBrackets("((((( )))))", "plain");
    expect(bracketClass(tokens[0])).toBe("rb-0");
    expect(bracketClass(tokens[RAINBOW_COLORS])).toBe("rb-0");
    expect(bracketClass(tokens[1])).toBe("rb-1");
    expect(bracketClass(findBrackets("]")[0])).toBe("rb-err");
  });

  it("splits text into runs and coloured brackets that rebuild the original", () => {
    const text = 'x [1, {"a": (2)}] y';
    const segs = bracketSegments(text, "json");
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.filter((s) => s.className).map((s) => s.text)).toEqual(["[", "{", "(", ")", "}", "]"]);
    expect(bracketSegments("no brackets")).toEqual([{ text: "no brackets" }]);
  });

  it("guesses JSON rules only for text that starts like JSON", () => {
    expect(guessLanguage('  {"a":1}')).toBe("json");
    expect(guessLanguage("a[0]=1")).toBe("plain");
  });
});

describe("the setting", () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    globalThis.localStorage = {
      get length() {
        return m.size;
      },
      clear: () => m.clear(),
      getItem: (k) => (m.has(k) ? m.get(k)! : null),
      key: (i) => [...m.keys()][i] ?? null,
      removeItem: (k) => void m.delete(k),
      setItem: (k, v) => void m.set(k, String(v)),
    };
    resetRainbowBracketsCache();
  });

  it("is on by default, saves the choice and tells subscribers", () => {
    expect(getRainbowBrackets()).toBe(true);
    const fn = vi.fn();
    const stop = subscribeRainbowBrackets(fn);
    setRainbowBrackets(false);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getRainbowBrackets()).toBe(false);
    resetRainbowBracketsCache();
    expect(getRainbowBrackets()).toBe(false);
    stop();
    setRainbowBrackets(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("falls back to on when the stored value is the wrong shape", () => {
    localStorage.setItem("rest-runner.rainbow-brackets", '"yes"');
    expect(getRainbowBrackets()).toBe(true);
  });
});
