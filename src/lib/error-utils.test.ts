import { describe, expect, it } from "vitest";
import { errText } from "./error-utils";

describe("errText", () => {
  it("returns the message of an Error", () => {
    expect(errText(new Error("boom"))).toBe("boom");
  });

  it("returns a string as-is", () => {
    expect(errText("plain")).toBe("plain");
  });

  it("stringifies non-Error, non-string values", () => {
    expect(errText(42)).toBe("42");
    expect(errText(null)).toBe("null");
    expect(errText(undefined)).toBe("undefined");
    expect(errText({ a: 1 })).toBe("[object Object]");
  });
});
