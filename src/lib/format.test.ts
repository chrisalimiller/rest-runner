import { describe, expect, it } from "vitest";
import { splitBytes } from "./format";

describe("splitBytes", () => {
  it("splits bytes, kilobytes and megabytes into number and unit", () => {
    expect(splitBytes(391)).toEqual({ value: "391", unit: "B" });
    expect(splitBytes(1536)).toEqual({ value: "1.5", unit: "KB" });
    expect(splitBytes(3 * 1024 * 1024)).toEqual({ value: "3.00", unit: "MB" });
  });
});
