// P-01 — every release checks date-holidays and ships its newest version, so an existing installation gets it too.
// The card half: the card bundles exactly the version the adapter declares as its minimum.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The dependencies of a package.json.
 *
 * @param parts the path segments of the folder, from the card folder
 * @returns its dependencies
 */
function dependencies(...parts: string[]): Record<string, string> {
  return (
    JSON.parse(readFileSync(join(process.cwd(), ...parts, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    }
  ).dependencies;
}

describe("P-01 the card ships the adapter's date-holidays", () => {
  it("P-01: the card pins exactly the version the adapter declares as its minimum", () => {
    const floor = dependencies("..")["date-holidays"];
    expect(floor).toMatch(/^\^\d+\.\d+\.\d+$/);
    expect(dependencies()["date-holidays"]).toBe(floor.slice(1));
  });
});
