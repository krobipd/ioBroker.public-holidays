// K16 — the days follow the server clock; a different time zone shows only in the debug log.
import { describe, expect, it, vi } from "vitest";
import { computeHolidays } from "../lib/holiday-engine";

const events = vi.hoisted(() => [] as string[]);

vi.mock("@iobroker/adapter-core", async () => {
  const { FakeAdapter } = await import("../lib/adapter-fake.js");
  class StubAdapter extends FakeAdapter {
    adapterDir = "/adapter";
    registered: string[] = [];
    stop = vi.fn();
    supportsFeature = (): boolean => false;
    override on(event: string, listener: (...args: never[]) => unknown): this {
      this.registered.push(event);
      return super.on(event, listener);
    }
    override extendForeignObjectAsync(id: string, obj: unknown): Promise<{ id: string }> {
      if (id === `system.adapter.${this.namespace}`) {
        const { common, native } = obj as { common?: object; native?: object };
        events.push(`instance write ${[...Object.keys(common ?? {}), ...Object.keys(native ?? {})].join(",")}`);
      }
      return super.extendForeignObjectAsync(id, obj);
    }
    setState(id: string, state: { val: unknown; ack: boolean }): Promise<void> {
      this.states.set(this.full(id), { val: state.val, ack: state.ack });
      return Promise.resolve();
    }
    getStatesAsync(): Promise<Record<string, { val: unknown; ack: boolean }>> {
      return Promise.resolve({});
    }
  }
  return {
    Adapter: StubAdapter,
    I18n: {
      init: vi.fn(() => {
        events.push("translations");
        return Promise.resolve();
      }),
      getTranslatedObject: (key: string) => ({ en: key }),
    },
  };
});

import type { FakeAdapter } from "../lib/adapter-fake";
import * as mainModule from "../main";

type Stub = FakeAdapter & { registered: string[]; stop: ReturnType<typeof vi.fn> };

/**
 * The guard's precondition: what only shows that it can run, never what the rule says.
 *
 * @param ok whether it holds
 * @param what what is missing otherwise
 */
function need(ok: unknown, what: string): asserts ok {
  if (!ok) {
    throw new Error(`precondition: ${what}`);
  }
}

/**
 * The settings of an instance with one calendar, its name and id the user's own.
 *
 * @param settings location, types, excludes, bridge days
 * @returns the instance settings
 */
function oneCalendar(settings: Record<string, unknown>): Record<string, unknown> {
  return { calendars: [{ uid: "a1", id: "cal-a", name: "cal-a", nameAuto: false, ...settings }] };
}

const SCHEDULE_INSTANCE = { common: { mode: "schedule", schedule: "0 0 * * *" }, native: {} };

async function start(
  config: Record<string, unknown>,
  instance: { common: Record<string, unknown>; native: Record<string, unknown> } = SCHEDULE_INSTANCE,
): Promise<Stub> {
  events.length = 0;
  const stub = new mainModule.PublicHolidaysAdapter() as unknown as Stub;
  stub.config = config;
  stub.objects.set("system.adapter.public-holidays.0", { type: "instance", ...instance });
  need(stub.registered.includes("ready"), "the adapter registers its ready handler");
  await stub.emit("ready");
  return stub;
}

const ZONE = "Pacific/Kiritimati"; // UTC+14: local midnight lies on the previous UTC day

async function inZone<T>(fn: () => Promise<T> | T): Promise<T> {
  const previous = process.env.TZ;
  process.env.TZ = ZONE;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previous;
    }
  }
}

describe("K16 the server clock decides the day", () => {
  it("K16: half an hour after local midnight it is the new local day, not the UTC one", async () => {
    const result = await inZone(() => {
      const source = {
        getHolidays: (y: number) =>
          y === 2026 ? [{ date: "2026-10-03 00:00:00", name: "Holiday", type: "public", rule: "10-03" }] : [],
      };
      return computeHolidays(
        source as unknown as Parameters<typeof computeHolidays>[0],
        {
          country: "DE",
          state: "",
          region: "",
          holidayTypes: ["public"],
          excludeHolidays: [],
          includeBridgeDays: false,
        },
        { referenceDate: new Date(2026, 9, 3, 0, 30), systemLanguage: "en" },
      );
    });
    expect(result.today).toEqual({ name: "Holiday", isHoliday: true });
    expect(result.yesterday.isHoliday).toBe(false);
  });

  it("K16: a server zone outside the country's zones shows in the debug log only", async () => {
    const stub = await inZone(() => start(oneCalendar({ country: "JP" })));
    const zoneLines = stub.lines.filter(l => l.message.includes(ZONE));
    expect(zoneLines.length).toBeGreaterThan(0);
    expect(zoneLines.every(l => l.level === "debug")).toBe(true);
  });
});
