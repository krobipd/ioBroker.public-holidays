import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// js-controller applies the manifest's `instanceObjects` on every start, but with
// `preserve: { common: ["name"] }` — so a renamed channel/state reaches FRESH installs only.
// The runtime `extendObject` call is the single path an updated name can take to an existing
// tree, and the package check `instance-objects-refresh` looks for a LITERAL id at the call
// site. A template-built id (`${channel}.${field}`) writes the same tree but is invisible to that
// check — and to every behavioural test, because the string it produces is identical. This guard
// is the local half of the check: it reads the source text.
//
// Shape is NOT compared here: the runtime refresh carries name and explanation only, everything
// else lives in the manifest alone and reaches existing trees through the platform (v0.17.0; the
// v0.16.0 hand copy rested on the opposite premise). What IS held together is the explanation:
// the manifest must carry a `desc` exactly where the runtime writes one, from a key that exists.

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

/**
 * What `ensureObjects` actually writes, read off its source: id → builder call. Each object goes
 * through `refresh(adapter, "<id>", <builder>, o => adapter.extendObject("<id>", o))` — the id is
 * read from BOTH places and must agree, so a copy-paste slip (checked one object, wrote another)
 * cannot hide.
 */
function refreshedObjects(): Map<string, { builder: string; key: string; descKey?: string; writes: string }> {
  const calls = new Map<string, { builder: string; key: string; descKey?: string; writes: string }>();
  const re =
    /refresh\(\s*adapter,\s*"([^"]+)"\s*,\s*(channelObj|stateObj)\(\s*"([^"]+)"\s*(?:,\s*"([^"]+)"\s*)?\)\s*,\s*o\s*=>\s*adapter\.extendObject\(\s*"([^"]+)"/g;
  for (const m of source.matchAll(re)) {
    calls.set(m[1], { builder: m[2], key: m[3], descKey: m[4], writes: m[5] });
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

  describe("explanations: manifest and runtime agree", () => {
    for (const obj of objects) {
      const id = obj._id as string;

      it(`${id}: is refreshed by the builder of its object type, under its own id`, () => {
        const call = refreshed.get(id);
        expect(call, `${id} is not refreshed at runtime`).toBeDefined();
        expect(call?.builder).toBe(obj.type === "channel" ? "channelObj" : "stateObj");
        expect(call?.writes).toBe(id);
      });

      it(`${id}: its name comes from a key that exists`, () => {
        // An i18n key adapter-core cannot resolve silently becomes `{ en: "<key>" }` — and with no
        // \`preserve\` that placeholder would overwrite the translated name on every installation.
        const call = refreshed.get(id);
        expect(englishKeys, `admin/i18n/en.json has no key "${call?.key}"`).toContain(call?.key);
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
