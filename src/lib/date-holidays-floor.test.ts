import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The declared dependency RANGE is the only thing that reaches an installation. `package-lock.json`
// governs this repo and CI; ioBroker installs the adapter with `npm install` into the shared
// /opt/iobroker tree, where an old copy that still satisfies the range is simply kept. A floor left
// behind therefore freezes the holiday DATA on every existing installation, release after release,
// while every gate here stays green — measured 2026-09-04: a server running 3.30.2 against a repo
// six data releases ahead, reporting a day as a public holiday that newer data classifies as an
// observance.
//
// scripts/check-date-holidays.mjs raises the floor to the installed version on every release; this
// guard is the force that makes the drift visible in between. Fix when it fails:
//   node scripts/check-date-holidays.mjs

function readJson(rel: string): { version?: string; dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(__dirname, rel), "utf8")) as {
    version?: string;
    dependencies?: Record<string, string>;
  };
}

describe("date-holidays floor (what an installation actually gets)", () => {
  it("package.json declares the installed version as its floor", () => {
    const installed = readJson("../../node_modules/date-holidays/package.json").version;
    const declared = readJson("../../package.json").dependencies?.["date-holidays"];
    expect(declared).toBe(`^${installed}`);
  });
});
