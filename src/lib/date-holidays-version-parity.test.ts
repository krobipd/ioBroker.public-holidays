import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The admin card (src-admin) bundles its OWN date-holidays at build time, while the runtime
// (src/) uses the root-installed one. After the guided-config rewrite the card computes the
// country/state/region cascade AND the live preview from its bundled copy — so if the two
// versions drift, the card can offer a country/state/region the runtime does not compute.
// The root dep is a caret range force-bumped to npm-latest on every release by
// scripts/check-date-holidays.mjs, while src-admin is exact-pinned and ignored by dependabot —
// they only stay aligned if something forces it. This guard is that force: it fails when the
// src-admin pin no longer equals the version the runtime actually resolves.

function readJson(rel: string): { version?: string; dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(__dirname, rel), "utf8"));
}

describe("date-holidays version parity (runtime vs admin bundle)", () => {
  it("src-admin pins exactly the date-holidays version the runtime resolves", () => {
    const runtimeInstalled = readJson("../../node_modules/date-holidays/package.json").version;
    const adminPinned = readJson("../../src-admin/package.json").dependencies?.["date-holidays"];
    expect(adminPinned).toBe(runtimeInstalled);
  });
});
