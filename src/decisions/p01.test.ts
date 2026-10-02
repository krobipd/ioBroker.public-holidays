// P-01 — every release checks date-holidays and ships its newest version, so an existing installation gets it too.
// What reaches an existing installation is the declared minimum, so it has to be the version the release ships.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Pkg {
  version: string;
  dependencies: Record<string, string>;
}

function readPackage(...parts: string[]): Pkg {
  return JSON.parse(readFileSync(join(process.cwd(), ...parts, "package.json"), "utf8")) as Pkg;
}

describe("P-01 date-holidays reaches existing installations", () => {
  it("P-01: the declared minimum of date-holidays is the version the release ships", () => {
    const shipped = readPackage("node_modules", "date-holidays").version;
    expect(shipped).toMatch(/^\d+\.\d+\.\d+$/);
    expect(readPackage().dependencies["date-holidays"]).toBe(`^${shipped}`);
  });
});
