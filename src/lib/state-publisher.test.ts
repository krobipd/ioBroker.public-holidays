import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import { KnownObjects } from "./known-objects";
import {
  CALENDAR_OBJECTS,
  cleanupDeprecatedStates,
  ensureCalendarObjects,
  publishCalendarStates,
  type StoredStates,
} from "./state-publisher";
import type { ComputedHolidays } from "./types";

const NS = "public-holidays.0.";

/** The calendar folder the tests write. */
const FOLDER = { id: "de-by-public", name: "Germany · Bavaria", uid: "c1" };

/** Every id a calendar's tree holds, the folder first. */
const treeIds = [FOLDER.id, ...CALENDAR_OBJECTS.map(o => `${FOLDER.id}.${o.rel}`)].sort();

/** Every state id below the folder. */
const stateIds = CALENDAR_OBJECTS.filter(o => o.type === "state")
  .map(o => `${FOLDER.id}.${o.rel}`)
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
  config: { deleteRecordedStates: boolean; deleteRecordedHistory: boolean };
  sendToAsync: Mock;
  setTimeout: () => undefined;
  clearTimeout: () => undefined;
  extendObject: Mock;
  setForeignObject: Mock;
  delObjectAsync: Mock;
  getObjectListAsync: Mock;
  getStatesAsync: Mock;
  setState: Mock;
  log: { debug: Mock; info: Mock };
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
    config: { deleteRecordedStates: true, deleteRecordedHistory: false },
    // no recording instance runs here, so nobody answers the removal's question
    sendToAsync: vi.fn((): Promise<unknown> => Promise.reject(new Error("no recording instance"))),
    // no report timer — what the removal keeps is not this suite's question (as in the master's own tests)
    setTimeout: () => undefined,
    clearTimeout: () => undefined,
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
    // One bulk read of the namespace, as copies (package check read-stub-copy).
    getStatesAsync: vi.fn(() =>
      Promise.resolve(Object.fromEntries(Object.entries(states).map(([id, s]) => [NS + id, structuredClone(s)]))),
    ),
    setState: vi.fn((id: string, state: { val: unknown; ack: boolean }) => {
      states[id] = { ...state };
      return Promise.resolve();
    }),
    log: { debug: vi.fn(), info: vi.fn() },
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

describe("ensureCalendarObjects", () => {
  let adapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(() => {
    adapter = makeMockAdapter();
  });

  it("creates the folder and its 17 objects, each with its object type", async () => {
    await ensureCalendarObjects(await adapter.known(), FOLDER);
    expect(Object.keys(adapter.objects).sort()).toEqual(treeIds);
    expect(adapter.objects[FOLDER.id]).toEqual({
      type: "folder",
      common: { name: FOLDER.name },
      native: { uid: "c1" },
    });
    for (const o of CALENDAR_OBJECTS) {
      expect((adapter.objects[`${FOLDER.id}.${o.rel}`] as { type: string }).type, `${o.rel} object type`).toBe(o.type);
    }
  });

  it("gives every state its full shape — the runtime is the only source of a calendar's objects", async () => {
    await ensureCalendarObjects(await adapter.known(), FOLDER);
    const daysUntil = adapter.objects[`${FOLDER.id}.next.daysUntil`] as { common: Record<string, unknown> };
    expect(daysUntil.common).toMatchObject({
      type: "number",
      role: "value.interval",
      read: true,
      write: false,
      unit: "d",
      def: 0,
    });
    for (const id of stateIds) {
      expect((adapter.objects[id] as { common: { write: unknown } }).common.write, id).toBe(false);
    }
  });

  it("names a channel from its own i18n key and a state from its field's key, explained from its desc key", async () => {
    // The mock translates a key to { en: key, de: key_de } — so this reads WHICH key was used.
    await ensureCalendarObjects(await adapter.known(), FOLDER);
    expect((adapter.objects[`${FOLDER.id}.dayAfterTomorrow`] as any).common.name).toEqual({
      en: "dayAfterTomorrow",
      de: "dayAfterTomorrow_de",
    });
    const st = adapter.objects[`${FOLDER.id}.next.daysUntil`] as any;
    expect(st.common.name).toEqual({ en: "daysUntil", de: "daysUntil_de" });
    expect(st.common.desc).toEqual({ en: "descNextDaysUntil", de: "descNextDaysUntil_de" });
  });

  it("writes nothing on a second run when every object is already current", async () => {
    // js-controller writes an extendObject without comparing: an unconditional refresh wrote 17
    // unchanged objects (and sent 17 object-change events) on every daily run.
    await ensureCalendarObjects(await adapter.known(), FOLDER);
    adapter.extendObject.mockClear();
    await ensureCalendarObjects(await adapter.known(), FOLDER);
    expect(adapter.extendObject).not.toHaveBeenCalled();
  });

  it("rewrites exactly the object whose name or explanation differs — and the folder for a new name", async () => {
    await ensureCalendarObjects(await adapter.known(), FOLDER);
    (adapter.objects[`${FOLDER.id}.today.name`] as any).common.name = "Holiday name"; // a pre-translation string
    (adapter.objects[`${FOLDER.id}.next`] as any).common.desc = { en: "old text" };
    adapter.extendObject.mockClear();
    await ensureCalendarObjects(await adapter.known(), { ...FOLDER, name: "Bavaria" });
    expect(adapter.extendObject.mock.calls.map(c => c[0] as string).sort()).toEqual(
      [FOLDER.id, `${FOLDER.id}.next`, `${FOLDER.id}.today.name`].sort(),
    );
    expect((adapter.objects[FOLDER.id] as any).common.name).toBe("Bavaria");
  });

  it("keeps the user's recording settings on an object it brings up to date", async () => {
    await ensureCalendarObjects(await adapter.known(), FOLDER);
    const id = `${FOLDER.id}.today.isHoliday`;
    (adapter.objects[id] as any).common.custom = { "history.0": { enabled: true } };
    (adapter.objects[id] as any).common.name = "old";
    await ensureCalendarObjects(await adapter.known(), FOLDER);
    expect((adapter.objects[id] as any).common.custom).toEqual({ "history.0": { enabled: true } });
  });

  it("never preserves a name — the adapter owns these names, so a rename must reach existing installs", async () => {
    // `preserve: { common: ["name"] }` tells js-controller to keep whatever name is already
    // there. These names are the adapter's own (translated from admin/i18n), so preserving them
    // would mean a renamed channel/state only ever reaches FRESH installs.
    await ensureCalendarObjects(await adapter.known(), FOLDER);
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

  it("never touches a calendar folder that carries one of the old names", async () => {
    const adapter = makeMockAdapter({ info: { type: "folder", native: { uid: "c2" } } });
    await cleanupDeprecatedStates(adapter as any, await adapter.known());
    expect(adapter.deleted).toEqual([]);
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

describe("publishCalendarStates", () => {
  /**
   * The run's bulk read, as main takes it once per run.
   *
   * @param adapter the mock adapter
   * @returns the stored states
   */
  async function bulk(adapter: ReturnType<typeof makeMockAdapter>): Promise<StoredStates> {
    return (await adapter.getStatesAsync("public-holidays.0.*")) as StoredStates;
  }

  it("writes every state of the calendar below its folder, acknowledged, with the computed value", async () => {
    const adapter = makeMockAdapter();
    await publishCalendarStates(adapter as any, await bulk(adapter), FOLDER.id, makeComputed());
    expect(Object.keys(adapter.states).sort()).toEqual(stateIds);
    const f = FOLDER.id;
    expect(adapter.states).toEqual({
      [`${f}.today.name`]: { val: "Neujahr", ack: true },
      [`${f}.today.isHoliday`]: { val: true, ack: true },
      [`${f}.yesterday.name`]: { val: "", ack: true },
      [`${f}.yesterday.isHoliday`]: { val: false, ack: true },
      [`${f}.tomorrow.name`]: { val: "", ack: true },
      [`${f}.tomorrow.isHoliday`]: { val: false, ack: true },
      [`${f}.dayAfterTomorrow.name`]: { val: "", ack: true },
      [`${f}.dayAfterTomorrow.isHoliday`]: { val: false, ack: true },
      [`${f}.next.name`]: { val: "Karfreitag", ack: true },
      [`${f}.next.isHoliday`]: { val: true, ack: true },
      [`${f}.next.date`]: { val: "2026-04-03", ack: true },
      [`${f}.next.daysUntil`]: { val: 92, ack: true },
    });
  });

  it("compares against the run's one bulk read and writes only the values that changed", async () => {
    // All twelve are read-only: compared in memory against one bulk read, never per state against the
    // database (fleet rule, checked by the inventory's resource probe).
    const adapter = makeMockAdapter();
    await publishCalendarStates(adapter as any, await bulk(adapter), FOLDER.id, makeComputed());
    adapter.setState.mockClear();
    const changed = makeComputed();
    changed.next.daysUntil = 91;
    await publishCalendarStates(adapter as any, await bulk(adapter), FOLDER.id, changed);
    expect(adapter.setState.mock.calls.map(c => c[0] as string)).toEqual([`${FOLDER.id}.next.daysUntil`]);
  });

  it("rewrites a value that is the same but unacknowledged or carries a quality code", async () => {
    const adapter = makeMockAdapter();
    await publishCalendarStates(adapter as any, await bulk(adapter), FOLDER.id, makeComputed());
    adapter.states[`${FOLDER.id}.today.name`] = { val: "Neujahr", ack: false };
    (adapter.states[`${FOLDER.id}.next.date`] as Record<string, unknown>).q = 0x01;
    adapter.setState.mockClear();
    await publishCalendarStates(adapter as any, await bulk(adapter), FOLDER.id, makeComputed());
    expect(adapter.setState.mock.calls.map(c => c[0] as string).sort()).toEqual(
      [`${FOLDER.id}.next.date`, `${FOLDER.id}.today.name`].sort(),
    );
  });

  it("another calendar's states are its own — the same values under another folder are written", async () => {
    const adapter = makeMockAdapter();
    await publishCalendarStates(adapter as any, await bulk(adapter), FOLDER.id, makeComputed());
    adapter.setState.mockClear();
    await publishCalendarStates(adapter as any, await bulk(adapter), "at-bank", makeComputed());
    expect(adapter.setState).toHaveBeenCalledTimes(12);
  });
});
