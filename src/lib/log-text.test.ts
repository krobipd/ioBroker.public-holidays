import { describe, expect, it } from "vitest";
import { errLine, oneLine } from "./log-text";

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

describe("errLine", () => {
  it("is the fleet error text on one line (no log forging)", () => {
    expect(errLine(new Error("line1\nline2"))).toBe("line1 line2");
  });

  it("keeps the reason the fleet helper adds", () => {
    expect(errLine(new TypeError("fetch failed", { cause: new Error("ENOTFOUND\nx") }))).toBe(
      "fetch failed (ENOTFOUND x)",
    );
  });
});
