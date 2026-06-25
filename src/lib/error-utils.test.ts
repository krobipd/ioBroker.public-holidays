import { describe, expect, it } from "vitest";
import { errText, oneLine } from "./error-utils";

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

  it("collapses newlines in the message (no log forging)", () => {
    expect(errText(new Error("line1\nline2"))).toBe("line1 line2");
  });
});

describe("oneLine", () => {
  it("collapses newlines and tabs to single spaces and trims", () => {
    expect(oneLine("a\nb")).toBe("a b");
    expect(oneLine("a\r\n\tb")).toBe("a b");
    expect(oneLine("  spaced  ")).toBe("spaced");
  });

  it("leaves a clean single-line string unchanged", () => {
    expect(oneLine("Christi Himmelfahrt")).toBe("Christi Himmelfahrt");
  });

  it("returns an empty string for empty input", () => {
    expect(oneLine("")).toBe("");
  });
});
