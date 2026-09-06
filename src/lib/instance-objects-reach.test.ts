import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIELD_SPECS } from "./state-specs";

// js-controller applies the manifest's `instanceObjects` on every start, but with
// `preserve: { common: ["name"] }` — so a renamed channel/state reaches FRESH installs only.
// The runtime `extendObject` call is the single path an updated name can take to an existing
// tree, and the fleet consistency gate (`audit_instanceobjects_reach`) checks it by looking for
// a LITERAL id at the call site. A template-built id (`${channel}.${field}`) writes the same
// tree but is invisible to that check — and to every behavioural test, because the string it
// produces is identical. This guard is the local half of the gate: it reads the source text.
//
// Since v0.16.0 it also compares the SHAPE (audit finding F9): the manifest and `FIELD_SPECS` are
// two hand-maintained descriptions of the same 17 objects, and nothing used to stop a role, a
// unit, a default or a description from drifting between them. A fresh install would then get one
// tree and an updated install another, with every gate green.

const adapterDir = join(__dirname, "..", "..");

interface ManifestObject {
  _id?: string;
  type?: string;
  common?: Record<string, unknown>;
}

function manifestObjects(): ManifestObject[] {
  const iopack = JSON.parse(readFileSync(join(adapterDir, "io-package.json"), "utf8")) as {
    instanceObjects?: ManifestObject[];
  };
  return iopack.instanceObjects ?? [];
}

const source = readFileSync(join(__dirname, "state-publisher.ts"), "utf8");
const englishKeys = Object.keys(
  JSON.parse(readFileSync(join(adapterDir, "admin", "i18n", "en.json"), "utf8")) as Record<string, string>,
);

/** What `ensureObjects` actually writes, read off its source: id → builder call. */
function refreshedObjects(): Map<string, { builder: string; key: string; descKey?: string }> {
  const calls = new Map<string, { builder: string; key: string; descKey?: string }>();
  const re = /extendObjectAsync\(\s*"([^"]+)"\s*,\s*(channelObj|stateObj)\(\s*"([^"]+)"\s*(?:,\s*"([^"]+)"\s*)?\)/g;
  for (const m of source.matchAll(re)) {
    calls.set(m[1], { builder: m[2], key: m[3], descKey: m[4] });
  }
  return calls;
}

describe("instanceObjects reach existing installations", () => {
  const objects = manifestObjects();
  const ids = objects.map(o => o._id).filter((id): id is string => typeof id === "string");
  const refreshed = refreshedObjects();

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

  it("refreshes exactly the objects the manifest declares — no more, no fewer", () => {
    expect([...refreshed.keys()].sort()).toEqual([...ids].sort());
  });

  describe("manifest shape == the shape the runtime writes", () => {
    for (const obj of objects) {
      const id = obj._id as string;

      it(`${id}: type, role, unit and default match FIELD_SPECS`, () => {
        const call = refreshed.get(id);
        expect(call, `${id} is not refreshed at runtime`).toBeDefined();
        const common = obj.common ?? {};
        if (obj.type === "channel") {
          expect(call?.builder).toBe("channelObj");
          return;
        }
        expect(call?.builder).toBe("stateObj");
        const spec = FIELD_SPECS[call!.key];
        expect(spec, `no FIELD_SPECS entry for "${call!.key}"`).toBeDefined();
        expect({
          type: common.type,
          role: common.role,
          read: common.read,
          write: common.write,
          def: common.def,
          unit: common.unit,
        }).toEqual({
          type: spec.type,
          role: spec.role,
          read: spec.read,
          write: spec.write,
          def: spec.def,
          unit: spec.unit,
        });
      });

      it(`${id}: carries an explanation exactly where the runtime writes one`, () => {
        const call = refreshed.get(id);
        const hasDesc = obj.common?.desc !== undefined;
        expect(
          hasDesc,
          `manifest desc ${hasDesc ? "present" : "missing"}, runtime writes ${call?.descKey ?? "none"}`,
        ).toBe(call?.descKey !== undefined);
        if (call?.descKey) {
          // An i18n key adapter-core cannot resolve silently becomes `{ en: "<key>" }`.
          expect(englishKeys, `admin/i18n/en.json has no key "${call.descKey}"`).toContain(call.descKey);
          expect(Object.keys(obj.common?.desc as Record<string, string>).length).toBe(11);
        }
      });
    }
  });
});
