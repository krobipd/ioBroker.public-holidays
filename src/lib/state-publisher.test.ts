import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import { KnownObjects } from "./known-objects";
import { cleanupDeprecatedStates, ensureObjects, publishStates } from "./state-publisher";
import type { ComputedHolidays } from "./types";

const NS = "public-holidays.0.";

const ioPkg = JSON.parse(readFileSync(join(__dirname, "../../io-package.json"), "utf8")) as {
  instanceObjects: { _id: string; type: string }[];
};
const manifestIds = ioPkg.instanceObjects.map(o => o._id).sort();
const manifestStates = ioPkg.instanceObjects
  .filter(o => o.type === "state")
  .map(o => o._id)
  .sort();

/**
 * An adapter whose objects behave like the database: `extendObject` merges a copy, the tree is read
 * back as copies (package check read-stub-copy), `delObjectAsync` removes. `failDelete` refuses one id.
 *
 * @param existing objects present before the run, by relative id
 * @param failDelete an id whose delete the database refuses
 */
function makeMockAdapter(
  existing: Record<string, unknown> = {},
  failDelete?: string,
): {
  namespace: string;
  extendObject: Mock;
  setForeignObject: Mock;
  delObjectAsync: Mock;
  getObjectListAsync: Mock;
  setStateChangedAsync: Mock;
  log: { debug: Mock };
  states: Record<string, { val: unknown; ack: boolean }>;
  objects: Record<string, unknown>;
  deleted: string[];
  known: () => Promise<KnownObjects>;
} {
  const states: Record<string, { val: unknown; ack: boolean }> = {};
  const objects: Record<string, unknown> = structuredClone(existing);
  const deleted: string[] = [];
  const adapter = {
    namespace: NS.slice(0, -1),
    extendObject: vi.fn((id: string, obj: { common?: Record<string, unknown> }) => {
      const prev = (objects[id] ?? {}) as { common?: Record<string, unknown> };
      objects[id] = { ...prev, ...structuredClone(obj), common: { ...prev.common, ...structuredClone(obj.common) } };
      return Promise.resolve();
    }),
    setForeignObject: vi.fn(() => Promise.resolve()),
    delObjectAsync: vi.fn((id: string) => {
      if (id === failDelete) {
        return Promise.reject(new Error("objects db busy"));
      }
      deleted.push(id);
      delete objects[id];
      return Promise.resolve();
    }),
    getObjectListAsync: vi.fn(() =>
      Promise.resolve({
        rows: Object.entries(objects).map(([id, value]) => ({ id: NS + id, value: structuredClone(value) })),
      }),
    ),
    setStateChangedAsync: vi.fn((id: string, val: unknown, ack: boolean) => {
      states[id] = { val, ack };
      return Promise.resolve();
    }),
    log: { debug: vi.fn() },
    states,
    objects,
    deleted,
    known: async (): Promise<KnownObjects> => {
      const known = new KnownObjects(adapter);
      await known.load();
      return known;
    },
  };
  return adapter;
}

function makeComputed(): ComputedHolidays {
  return {
    yesterday: { name: "", isHoliday: false },
    today: { name: "Neujahr", isHoliday: true },
    tomorrow: { name: "", isHoliday: false },
    dayAfterTomorrow: { name: "", isHoliday: false },
    next: { name: "Karfreitag", isHoliday: true, date: "2026-04-03", daysUntil: 92 },
    unmatchedExcludes: [],
  };
}

describe("ensureObjects", () => {
  let adapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(() => {
    adapter = makeMockAdapter();
  });

  it("refreshes exactly the manifest objects, each with the manifest's object type", async () => {
    // The manifest (install + every start) and the runtime refresh describe the same objects.
    await ensureObjects(adapter as any, await adapter.known());
    expect(Object.keys(adapter.objects).sort()).toEqual(manifestIds);
    for (const o of ioPkg.instanceObjects) {
      expect((adapter.objects[o._id] as { type: string }).type, `${o._id} object type`).toBe(o.type);
    }
  });

  it("refreshes name and explanation only — the object shape lives in the manifest alone", async () => {
    // js-controller applies the manifest on every start and preserves just `common.name`; a
    // second copy of type/role/unit/def here would be one more place for the shape to drift.
    await ensureObjects(adapter as any, await adapter.known());
    for (const [id, obj] of Object.entries(adapter.objects)) {
      const common = (obj as { common: Record<string, unknown> }).common;
      expect(Object.keys(common).sort(), `${id} writes more than name/desc`).toEqual(
        Object.keys(common).includes("desc") ? ["desc", "name"] : ["name"],
      );
    }
  });

  it("names a channel from its own i18n key and a state from its field's key, explained from its desc key", async () => {
    // The mock translates a key to { en: key, de: key_de } — so this reads WHICH key was used.
    await ensureObjects(adapter as any, await adapter.known());
    expect((adapter.objects.dayAfterTomorrow as any).common.name).toEqual({
      en: "dayAfterTomorrow",
      de: "dayAfterTomorrow_de",
    });
    const st = adapter.objects["next.daysUntil"] as any;
    expect(st.common.name).toEqual({ en: "daysUntil", de: "daysUntil_de" });
    expect(st.common.desc).toEqual({ en: "descNextDaysUntil", de: "descNextDaysUntil_de" });
  });

  it("writes nothing on a second run when every object is already current", async () => {
    // js-controller writes an extendObject without comparing: an unconditional refresh wrote 17
    // unchanged objects (and sent 17 object-change events) on every daily run.
    await ensureObjects(adapter as any, await adapter.known());
    adapter.extendObject.mockClear();
    await ensureObjects(adapter as any, await adapter.known());
    expect(adapter.extendObject).not.toHaveBeenCalled();
  });

  it("rewrites exactly the object whose name or explanation differs", async () => {
    await ensureObjects(adapter as any, await adapter.known());
    (adapter.objects["today.name"] as any).common.name = "Holiday name"; // a pre-translation string
    (adapter.objects.next as any).common.desc = { en: "old text" };
    adapter.extendObject.mockClear();
    await ensureObjects(adapter as any, await adapter.known());
    expect(adapter.extendObject.mock.calls.map(c => c[0] as string).sort()).toEqual(["next", "today.name"]);
  });

  it("the same texts in another key order count as current", async () => {
    await ensureObjects(adapter as any, await adapter.known());
    const st = adapter.objects["next.date"] as any;
    st.common.name = { de: st.common.name.de, en: st.common.name.en };
    adapter.extendObject.mockClear();
    await ensureObjects(adapter as any, await adapter.known());
    expect(adapter.extendObject).not.toHaveBeenCalled();
  });

  it("never preserves a name — the adapter owns these names, so a rename must reach existing installs", async () => {
    // `preserve: { common: ["name"] }` tells js-controller to keep whatever name is already
    // there. These names are the adapter's own (translated from admin/i18n), so preserving them
    // would mean a renamed channel/state only ever reaches FRESH installs.
    await ensureObjects(adapter as any, await adapter.known());
    const withPreserve = adapter.extendObject.mock.calls.filter(
      call => (call[2] as { preserve?: unknown } | undefined)?.preserve !== undefined,
    );
    expect(withPreserve).toEqual([]);
  });
});

describe("cleanupDeprecatedStates", () => {
  const present = (ids: string[]): Record<string, unknown> =>
    Object.fromEntries(ids.map(id => [id, { type: "state" }]));

  it("deletes the deprecated objects that exist — and only those", async () => {
    const adapter = makeMockAdapter(present(["next.region", "next.type", "today.region", "today.name"]));
    await cleanupDeprecatedStates(adapter as any, await adapter.known());
    expect([...adapter.deleted].sort()).toEqual(["next.region", "next.type", "today.region"]);
  });

  it("removes the pre-0.11.0 *.boolean states on upgrade (renamed to *.isHoliday)", async () => {
    const old = ["today.boolean", "yesterday.boolean", "tomorrow.boolean", "dayAfterTomorrow.boolean", "next.boolean"];
    const adapter = makeMockAdapter(present(old));
    await cleanupDeprecatedStates(adapter as any, await adapter.known());
    expect([...adapter.deleted].sort()).toEqual([...old].sort());
  });

  it("removes the tree of the previous owner's 0.0.x releases, children before their channel", async () => {
    // npm 0.0.1/0.0.2 (Jey-Cee) created info, info.lastSettings and aftertomorrow.* — an upgrade
    // from there left them standing, `aftertomorrow.boolean` possibly frozen at true.
    const legacy = ["info", "info.lastSettings", "aftertomorrow", "aftertomorrow.name", "aftertomorrow.boolean"];
    const adapter = makeMockAdapter(present(legacy));
    await cleanupDeprecatedStates(adapter as any, await adapter.known());
    expect([...adapter.deleted].sort()).toEqual([...legacy].sort());
    expect(adapter.deleted.indexOf("aftertomorrow.boolean")).toBeLessThan(adapter.deleted.indexOf("aftertomorrow"));
    expect(adapter.deleted.indexOf("info.lastSettings")).toBeLessThan(adapter.deleted.indexOf("info"));
  });

  it("logs a failed delete and carries on with the remaining deprecated states", async () => {
    // A leftover object is cosmetic, losing today's holiday over it is not (audit F8, v0.15.1):
    // one refused delete must neither throw out of the cleanup nor stop the loop.
    const adapter = makeMockAdapter(present(["today.region", "today.type", "next.boolean"]), "today.region");
    await expect(cleanupDeprecatedStates(adapter as any, await adapter.known())).resolves.toBeUndefined();
    expect(adapter.deleted).toEqual(["today.type", "next.boolean"]);
    expect(adapter.log.debug).toHaveBeenCalledWith(
      expect.stringContaining("Could not remove the deprecated state today.region: objects db busy"),
    );
  });
});

describe("publishStates", () => {
  it("writes every manifest state, acknowledged, with the computed value", async () => {
    // Nothing structural ties the published fields to the manifest — the two sets are held equal here.
    const adapter = makeMockAdapter();
    await publishStates(adapter as any, makeComputed());
    expect(Object.keys(adapter.states).sort()).toEqual(manifestStates);
    expect(adapter.states).toEqual({
      "today.name": { val: "Neujahr", ack: true },
      "today.isHoliday": { val: true, ack: true },
      "yesterday.name": { val: "", ack: true },
      "yesterday.isHoliday": { val: false, ack: true },
      "tomorrow.name": { val: "", ack: true },
      "tomorrow.isHoliday": { val: false, ack: true },
      "dayAfterTomorrow.name": { val: "", ack: true },
      "dayAfterTomorrow.isHoliday": { val: false, ack: true },
      "next.name": { val: "Karfreitag", ack: true },
      "next.isHoliday": { val: true, ack: true },
      "next.date": { val: "2026-04-03", ack: true },
      "next.daysUntil": { val: 92, ack: true },
    });
  });
});
