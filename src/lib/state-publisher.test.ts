import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import { cleanupDeprecatedStates, ensureObjects, publishStates } from "./state-publisher";
import type { ComputedHolidays } from "./types";

function makeMockAdapter(): {
  extendObject: Mock;
  getObjectAsync: Mock;
  setStateChangedAsync: Mock;
  states: Record<string, { val: unknown; ack: boolean }>;
  objects: Record<string, unknown>;
} {
  const states: Record<string, { val: unknown; ack: boolean }> = {};
  const objects: Record<string, unknown> = {};
  return {
    extendObject: vi.fn((id: string, obj: unknown) => {
      objects[id] = structuredClone(obj);
      return Promise.resolve();
    }),
    // A copy, like the real store (package check read-stub-copy).
    getObjectAsync: vi.fn((id: string) => Promise.resolve(objects[id] ? structuredClone(objects[id]) : null)),
    setStateChangedAsync: vi.fn((id: string, val: unknown, ack: boolean) => {
      states[id] = { val, ack };
      return Promise.resolve();
    }),
    states,
    objects,
  };
}

function makeComputed(): ComputedHolidays {
  return {
    yesterday: { name: "", isHoliday: false },
    today: { name: "Neujahr", isHoliday: true },
    tomorrow: { name: "", isHoliday: false },
    dayAfterTomorrow: { name: "", isHoliday: false },
    next: {
      name: "Karfreitag",
      isHoliday: true,
      date: "2026-04-03",
      daysUntil: 92,
    },
    unmatchedExcludes: [],
  };
}

describe("ensureObjects", () => {
  let adapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(() => {
    adapter = makeMockAdapter();
  });

  it("creates all 5 channels", async () => {
    await ensureObjects(adapter as any);
    const channelIds = Object.keys(adapter.objects).filter(id => !id.includes("."));
    expect(channelIds).toContain("today");
    expect(channelIds).toContain("yesterday");
    expect(channelIds).toContain("tomorrow");
    expect(channelIds).toContain("dayAfterTomorrow");
    expect(channelIds).toContain("next");
    expect(channelIds.length).toBe(5);
  });

  it("creates today states (name, isHoliday)", async () => {
    await ensureObjects(adapter as any);
    expect(adapter.objects["today.name"]).toBeDefined();
    expect(adapter.objects["today.isHoliday"]).toBeDefined();
    expect(adapter.objects["today.id"]).toBeUndefined();
    expect(adapter.objects["today.region"]).toBeUndefined();
    expect(adapter.objects["today.type"]).toBeUndefined();
  });

  it("creates next states including date and daysUntil", async () => {
    await ensureObjects(adapter as any);
    expect(adapter.objects["next.name"]).toBeDefined();
    expect(adapter.objects["next.date"]).toBeDefined();
    expect(adapter.objects["next.daysUntil"]).toBeDefined();
  });

  it("total object count is 5 channels + 12 states = 17", async () => {
    await ensureObjects(adapter as any);
    expect(adapter.extendObject).toHaveBeenCalledTimes(17);
  });

  it("refreshes name and explanation only — the object shape lives in the manifest alone", async () => {
    // js-controller applies the manifest on every start and preserves just `common.name`; a
    // second copy of type/role/unit/def here would be one more place for the shape to drift.
    await ensureObjects(adapter as any);
    for (const [id, obj] of Object.entries(adapter.objects)) {
      const common = (obj as { common: Record<string, unknown> }).common;
      expect(Object.keys(common).sort(), `${id} writes more than name/desc`).toEqual(
        Object.keys(common).includes("desc") ? ["desc", "name"] : ["name"],
      );
    }
  });

  it("a channel is named from its own i18n key", async () => {
    // The mock translates a key to { en: key, de: key_de } — so this reads WHICH key was used.
    await ensureObjects(adapter as any);
    const ch = adapter.objects.dayAfterTomorrow as any;
    expect(ch.common.name).toEqual({ en: "dayAfterTomorrow", de: "dayAfterTomorrow_de" });
  });

  it("a state is named from its field's i18n key and explained from its own desc key", async () => {
    await ensureObjects(adapter as any);
    const st = adapter.objects["next.daysUntil"] as any;
    expect(st.common.name).toEqual({ en: "daysUntil", de: "daysUntil_de" });
    expect(st.common.desc).toEqual({ en: "descNextDaysUntil", de: "descNextDaysUntil_de" });
  });

  it("writes nothing on a second run when every object is already current", async () => {
    // js-controller writes an extendObject without comparing: an unconditional refresh wrote 17
    // unchanged objects (and sent 17 object-change events) on every daily run.
    await ensureObjects(adapter as any);
    adapter.extendObject.mockClear();
    await ensureObjects(adapter as any);
    expect(adapter.extendObject).not.toHaveBeenCalled();
  });

  it("rewrites exactly the object whose name or explanation differs", async () => {
    await ensureObjects(adapter as any);
    (adapter.objects["today.name"] as any).common.name = "Holiday name"; // a pre-translation string
    (adapter.objects.next as any).common.desc = { en: "old text" };
    adapter.extendObject.mockClear();
    await ensureObjects(adapter as any);
    expect(adapter.extendObject.mock.calls.map(c => c[0] as string).sort()).toEqual(["next", "today.name"]);
  });

  it("the same texts in another key order count as current", async () => {
    await ensureObjects(adapter as any);
    const st = adapter.objects["next.date"] as any;
    st.common.name = { de: st.common.name.de, en: st.common.name.en };
    adapter.extendObject.mockClear();
    await ensureObjects(adapter as any);
    expect(adapter.extendObject).not.toHaveBeenCalled();
  });

  it("refreshes when the object cannot be read — the refresh is the safe side", async () => {
    await ensureObjects(adapter as any);
    adapter.getObjectAsync.mockImplementation(() => Promise.reject(new Error("objects db unreachable")));
    adapter.extendObject.mockClear();
    await ensureObjects(adapter as any);
    expect(adapter.extendObject).toHaveBeenCalledTimes(17);
  });

  it("never preserves a name — the adapter owns these names, so a rename must reach existing installs", async () => {
    // `preserve: { common: ["name"] }` tells js-controller to keep whatever name is already
    // there. These names are the adapter's own (translated from admin/i18n), so preserving them
    // would mean a renamed channel/state only ever reaches FRESH installs.
    await ensureObjects(adapter as any);
    const withPreserve = adapter.extendObject.mock.calls.filter(
      call => (call[2] as { preserve?: unknown } | undefined)?.preserve !== undefined,
    );
    expect(withPreserve).toEqual([]);
  });

  it("refreshes every manifest object by its literal id", async () => {
    // The 17 ids also live in io-package.json:instanceObjects, which js-controller applies with
    // preserve on common.name — the runtime call is the only path a rename can take to an
    // existing install. Literal ids (not template-built) so the consistency gate can see them.
    await ensureObjects(adapter as any);
    const called = adapter.extendObject.mock.calls.map(call => call[0] as string);
    expect(called.sort()).toEqual(
      [
        "today",
        "today.name",
        "today.isHoliday",
        "yesterday",
        "yesterday.name",
        "yesterday.isHoliday",
        "tomorrow",
        "tomorrow.name",
        "tomorrow.isHoliday",
        "dayAfterTomorrow",
        "dayAfterTomorrow.name",
        "dayAfterTomorrow.isHoliday",
        "next",
        "next.name",
        "next.isHoliday",
        "next.date",
        "next.daysUntil",
      ].sort(),
    );
  });
});

describe("cleanupDeprecatedStates", () => {
  it("deletes deprecated region and type states when present", async () => {
    const existingObjects: Record<string, unknown> = {
      "next.region": { type: "state" },
      "next.type": { type: "state" },
      "today.region": { type: "state" },
    };
    const deleted: string[] = [];
    const adapter = {
      getObjectAsync: vi.fn((id: string) =>
        Promise.resolve(existingObjects[id] ? structuredClone(existingObjects[id]) : null),
      ),
      delObjectAsync: vi.fn((id: string) => {
        deleted.push(id);
        return Promise.resolve();
      }),
      log: { debug: vi.fn() },
    };
    await cleanupDeprecatedStates(adapter as any);
    expect(deleted).toContain("next.region");
    expect(deleted).toContain("next.type");
    expect(deleted).toContain("today.region");
    expect(deleted.length).toBe(3);
  });

  it("removes the pre-0.11.0 *.boolean states on upgrade (renamed to *.isHoliday)", async () => {
    // Upgrade path: a v0.10.0 install carries the old today.boolean … next.boolean.
    // They must be deleted so only the renamed *.isHoliday states remain.
    const oldBooleanStates = [
      "today.boolean",
      "yesterday.boolean",
      "tomorrow.boolean",
      "dayAfterTomorrow.boolean",
      "next.boolean",
    ];
    const existingObjects: Record<string, unknown> = Object.fromEntries(
      oldBooleanStates.map(id => [id, { type: "state" }]),
    );
    const deleted: string[] = [];
    const adapter = {
      getObjectAsync: vi.fn((id: string) =>
        Promise.resolve(existingObjects[id] ? structuredClone(existingObjects[id]) : null),
      ),
      delObjectAsync: vi.fn((id: string) => {
        deleted.push(id);
        return Promise.resolve();
      }),
      log: { debug: vi.fn() },
    };
    await cleanupDeprecatedStates(adapter as any);
    for (const id of oldBooleanStates) {
      expect(deleted, `${id} must be removed on upgrade`).toContain(id);
    }
  });

  it("removes the tree of the previous owner's 0.0.x releases, children before their channel", async () => {
    // npm 0.0.1/0.0.2 (Jey-Cee) created info, info.lastSettings and aftertomorrow.* — an upgrade
    // from there left them standing, `aftertomorrow.boolean` possibly frozen at true.
    const legacy = ["info", "info.lastSettings", "aftertomorrow", "aftertomorrow.name", "aftertomorrow.boolean"];
    const existingObjects: Record<string, unknown> = Object.fromEntries(legacy.map(id => [id, { type: "state" }]));
    const deleted: string[] = [];
    const adapter = {
      getObjectAsync: vi.fn((id: string) =>
        Promise.resolve(existingObjects[id] ? structuredClone(existingObjects[id]) : null),
      ),
      delObjectAsync: vi.fn((id: string) => {
        deleted.push(id);
        return Promise.resolve();
      }),
      log: { debug: vi.fn() },
    };
    await cleanupDeprecatedStates(adapter as any);
    expect([...deleted].sort()).toEqual([...legacy].sort());
    expect(deleted.indexOf("aftertomorrow.boolean")).toBeLessThan(deleted.indexOf("aftertomorrow"));
    expect(deleted.indexOf("info.lastSettings")).toBeLessThan(deleted.indexOf("info"));
  });

  it("does nothing when no deprecated states exist", async () => {
    const adapter = {
      getObjectAsync: vi.fn(() => Promise.resolve(null)),
      delObjectAsync: vi.fn(),
      log: { debug: vi.fn() },
    };
    await cleanupDeprecatedStates(adapter as any);
    expect(adapter.delObjectAsync).not.toHaveBeenCalled();
  });

  it("logs a failed delete and carries on with the remaining deprecated states", async () => {
    // A leftover object is cosmetic, losing today's holiday over it is not (audit F8, v0.15.1):
    // one refused delete must neither throw out of the cleanup nor stop the loop.
    const present = ["today.region", "today.type", "next.boolean"];
    const deleted: string[] = [];
    const adapter = {
      getObjectAsync: vi.fn((id: string) => Promise.resolve(present.includes(id) ? { type: "state" } : null)),
      delObjectAsync: vi.fn((id: string) => {
        if (id === "today.region") {
          return Promise.reject(new Error("objects db busy"));
        }
        deleted.push(id);
        return Promise.resolve();
      }),
      log: { debug: vi.fn() },
    };

    await expect(cleanupDeprecatedStates(adapter as any)).resolves.toBeUndefined();

    expect(deleted).toEqual(["today.type", "next.boolean"]);
    expect(adapter.log.debug).toHaveBeenCalledWith(
      expect.stringContaining("Could not remove the deprecated state today.region: objects db busy"),
    );
  });
});

describe("publishStates", () => {
  let adapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(() => {
    adapter = makeMockAdapter();
  });

  it("publishes today holiday name", async () => {
    await publishStates(adapter as any, makeComputed());
    expect(adapter.states["today.name"]).toEqual({ val: "Neujahr", ack: true });
  });

  it("publishes today isHoliday", async () => {
    await publishStates(adapter as any, makeComputed());
    expect(adapter.states["today.isHoliday"]).toEqual({ val: true, ack: true });
  });

  it("publishes empty yesterday", async () => {
    await publishStates(adapter as any, makeComputed());
    expect(adapter.states["yesterday.name"]).toEqual({ val: "", ack: true });
    expect(adapter.states["yesterday.isHoliday"]).toEqual({ val: false, ack: true });
  });

  it("publishes next holiday date", async () => {
    await publishStates(adapter as any, makeComputed());
    expect(adapter.states["next.date"]).toEqual({ val: "2026-04-03", ack: true });
  });

  it("publishes next holiday daysUntil", async () => {
    await publishStates(adapter as any, makeComputed());
    expect(adapter.states["next.daysUntil"]).toEqual({ val: 92, ack: true });
  });

  it("publishes next holiday name", async () => {
    await publishStates(adapter as any, makeComputed());
    expect(adapter.states["next.name"]).toEqual({ val: "Karfreitag", ack: true });
  });

  it("all states have ack=true", async () => {
    await publishStates(adapter as any, makeComputed());
    for (const [, s] of Object.entries(adapter.states)) {
      expect(s.ack).toBe(true);
    }
  });

  it("total state count is 12", async () => {
    await publishStates(adapter as any, makeComputed());
    expect(adapter.setStateChangedAsync).toHaveBeenCalledTimes(12);
  });
});

// The manifest (install + every start) and the runtime refresh describe the same 17 objects.
describe("io-package consistency", () => {
  const ioPkg = JSON.parse(readFileSync(join(__dirname, "../../io-package.json"), "utf8"));
  const byId: Record<string, any> = Object.fromEntries(ioPkg.instanceObjects.map((o: any) => [o._id, o]));

  it("every runtime-refreshed object is a manifest object of the same type", async () => {
    const adapter = makeMockAdapter();
    await ensureObjects(adapter as any);
    for (const [id, obj] of Object.entries(adapter.objects)) {
      const io = byId[id];
      expect(io, `${id} refreshed at runtime but missing in io-package.json instanceObjects`).toBeDefined();
      expect(io.type, `${id} object type`).toBe((obj as any).type);
    }
  });

  it("every io-package instanceObject is created at runtime", async () => {
    const adapter = makeMockAdapter();
    await ensureObjects(adapter as any);
    for (const o of ioPkg.instanceObjects) {
      expect(adapter.objects[o._id], `${o._id} in io-package.json but not created by ensureObjects`).toBeDefined();
    }
  });
});

// Nothing structural ties the published fields to the manifest: `DAY_FIELDS`/`NEXT_FIELDS` and the
// value maps are hand lists. A manifest state that is created and refreshed but never written
// would only show up as a stale default in the tree — so the two sets are held equal here.
describe("published states == manifest states", () => {
  it("writes exactly the twelve state ids the manifest declares", async () => {
    const ioPkg = JSON.parse(readFileSync(join(__dirname, "../../io-package.json"), "utf8"));
    const manifestStates = (ioPkg.instanceObjects as { _id: string; type: string }[])
      .filter(o => o.type === "state")
      .map(o => o._id)
      .sort();
    const adapter = makeMockAdapter();

    await publishStates(adapter as any, makeComputed());

    expect(Object.keys(adapter.states).sort()).toEqual(manifestStates);
    expect(manifestStates).toHaveLength(12);
  });
});
