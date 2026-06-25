import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import { cleanupDeprecatedStates, ensureObjects, publishStates } from "./state-publisher";
import type { ComputedHolidays } from "./types";

function makeMockAdapter() {
  const states: Record<string, { val: unknown; ack: boolean }> = {};
  const objects: Record<string, unknown> = {};
  return {
    extendObjectAsync: vi.fn(async (id: string, obj: unknown) => {
      objects[id] = obj;
    }),
    setStateChangedAsync: vi.fn(async (id: string, val: unknown, ack: boolean) => {
      states[id] = { val, ack };
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

  it("creates today states (name, boolean)", async () => {
    await ensureObjects(adapter as any);
    expect(adapter.objects["today.name"]).toBeDefined();
    expect(adapter.objects["today.boolean"]).toBeDefined();
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
    expect(adapter.extendObjectAsync).toHaveBeenCalledTimes(17);
  });

  it("state objects have correct common.type", async () => {
    await ensureObjects(adapter as any);
    const nameObj = adapter.objects["today.name"] as any;
    expect(nameObj.common.type).toBe("string");
    const boolObj = adapter.objects["today.boolean"] as any;
    expect(boolObj.common.type).toBe("boolean");
    const durObj = adapter.objects["next.daysUntil"] as any;
    expect(durObj.common.type).toBe("number");
  });

  it("state objects have correct roles", async () => {
    await ensureObjects(adapter as any);
    const dateObj = adapter.objects["next.date"] as any;
    expect(dateObj.common.role).toBe("text");
    const boolObj = adapter.objects["today.boolean"] as any;
    expect(boolObj.common.role).toBe("indicator");
  });

  it("state objects have read=true, write=false", async () => {
    await ensureObjects(adapter as any);
    const nameObj = adapter.objects["today.name"] as any;
    expect(nameObj.common.read).toBe(true);
    expect(nameObj.common.write).toBe(false);
  });

  it("channel objects have translation object name", async () => {
    await ensureObjects(adapter as any);
    const ch = adapter.objects["today"] as any;
    expect(ch.common.name).toHaveProperty("en");
    expect(ch.common.name).toHaveProperty("de");
  });

  it("state objects have 11-language name", async () => {
    await ensureObjects(adapter as any);
    const st = adapter.objects["today.name"] as any;
    expect(st.common.name).toHaveProperty("en");
    expect(st.common.name).toHaveProperty("de");
  });

  it("passes preserve option for channels", async () => {
    await ensureObjects(adapter as any);
    expect(adapter.extendObjectAsync).toHaveBeenCalledWith("today", expect.anything(), {
      preserve: { common: ["name"] },
    });
  });

  it("passes preserve option for states", async () => {
    await ensureObjects(adapter as any);
    expect(adapter.extendObjectAsync).toHaveBeenCalledWith("today.name", expect.anything(), {
      preserve: { common: ["name"] },
    });
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
      getObjectAsync: vi.fn(async (id: string) => existingObjects[id] ?? null),
      delObjectAsync: vi.fn(async (id: string) => {
        deleted.push(id);
      }),
      log: { debug: vi.fn() },
    };
    await cleanupDeprecatedStates(adapter as any);
    expect(deleted).toContain("next.region");
    expect(deleted).toContain("next.type");
    expect(deleted).toContain("today.region");
    expect(deleted.length).toBe(3);
  });

  it("does nothing when no deprecated states exist", async () => {
    const adapter = {
      getObjectAsync: vi.fn(async () => null),
      delObjectAsync: vi.fn(),
      log: { debug: vi.fn() },
    };
    await cleanupDeprecatedStates(adapter as any);
    expect(adapter.delObjectAsync).not.toHaveBeenCalled();
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

  it("publishes today boolean", async () => {
    await publishStates(adapter as any, makeComputed());
    expect(adapter.states["today.boolean"]).toEqual({ val: true, ack: true });
  });

  it("publishes empty yesterday", async () => {
    await publishStates(adapter as any, makeComputed());
    expect(adapter.states["yesterday.name"]).toEqual({ val: "", ack: true });
    expect(adapter.states["yesterday.boolean"]).toEqual({ val: false, ack: true });
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

// Guard against drift between the two state-schema sources:
// io-package.json:instanceObjects (install) ↔ state-publisher FIELD_SPECS (runtime).
describe("io-package consistency", () => {
  const ioPkg = JSON.parse(readFileSync(join(__dirname, "../../io-package.json"), "utf8"));
  const byId: Record<string, any> = Object.fromEntries(ioPkg.instanceObjects.map((o: any) => [o._id, o]));

  it("runtime objects match io-package instanceObjects (type/role/read/write)", async () => {
    const adapter = makeMockAdapter();
    await ensureObjects(adapter as any);
    for (const [id, obj] of Object.entries(adapter.objects)) {
      const io = byId[id];
      expect(io, `${id} created at runtime but missing in io-package.json instanceObjects`).toBeDefined();
      expect(io.type).toBe((obj as any).type);
      if ((obj as any).type === "state") {
        expect(io.common.type, `${id} type`).toBe((obj as any).common.type);
        expect(io.common.role, `${id} role`).toBe((obj as any).common.role);
        expect(io.common.read, `${id} read`).toBe((obj as any).common.read);
        expect(io.common.write, `${id} write`).toBe((obj as any).common.write);
      }
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
