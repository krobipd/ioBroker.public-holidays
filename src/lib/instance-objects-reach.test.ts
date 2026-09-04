import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// js-controller applies the manifest's `instanceObjects` on every start, but with
// `preserve: { common: ["name"] }` — so a renamed channel/state reaches FRESH installs only.
// The runtime `extendObject` call is the single path an updated name can take to an existing
// tree, and the fleet consistency gate (`audit_instanceobjects_reach`) checks it by looking for
// a LITERAL id at the call site. A template-built id (`${channel}.${field}`) writes the same
// tree but is invisible to that check — and to every behavioural test, because the string it
// produces is identical. This guard is the local half of the gate: it reads the source text.

const adapterDir = join(__dirname, "..", "..");

function instanceObjectIds(): string[] {
  const iopack = JSON.parse(readFileSync(join(adapterDir, "io-package.json"), "utf8")) as {
    instanceObjects?: { _id?: string }[];
  };
  return (iopack.instanceObjects ?? []).map(o => o._id).filter((id): id is string => typeof id === "string");
}

describe("instanceObjects reach existing installations", () => {
  const source = readFileSync(join(__dirname, "state-publisher.ts"), "utf8");
  const ids = instanceObjectIds();

  it("the manifest carries all 17 objects", () => {
    expect(ids).toHaveLength(17);
  });

  it.each(ids)("'%s' is refreshed by a literal extendObject call", id => {
    const literal = new RegExp(String.raw`extendObject(?:Async)?\(\s*["'\`]${id.replace(".", "\\.")}["'\`]`);
    expect(literal.test(source)).toBe(true);
  });

  it("no name is preserved — preserving would freeze the old text on existing installs", () => {
    // Comments talk ABOUT preserve; only the code must not use it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("preserve");
  });
});
