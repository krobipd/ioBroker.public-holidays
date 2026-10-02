// K16 — the days follow the server clock; a different time zone shows only in the debug log.
import { describe, expect, it, vi } from "vitest";
import { computeHolidays } from "../lib/holiday-engine";

const events = vi.hoisted(() => [] as string[]);

vi.mock("@iobroker/adapter-core", () => {
  interface Obj {
    type?: string;
    common?: Record<string, unknown>;
    native?: Record<string, unknown>;
  }
  class StubAdapter {
    namespace = "public-holidays.0";
    adapterDir = "/adapter";
    config: Record<string, unknown> = {};
    objects = new Map<string, Obj>();
    states = new Map<string, { val: unknown; ack: boolean }>();
    logs: { level: string; msg: string }[] = [];
    handlers = new Map<string, (...args: unknown[]) => unknown>();
    stop = vi.fn();
    supportsFeature = (): boolean => false;
    log = {
      level: "info",
      debug: (m: string): void => void this.logs.push({ level: "debug", msg: m }),
      info: (m: string): void => void this.logs.push({ level: "info", msg: m }),
      warn: (m: string): void => void this.logs.push({ level: "warn", msg: m }),
      error: (m: string): void => void this.logs.push({ level: "error", msg: m }),
    };
    on(event: string, cb: (...args: unknown[]) => unknown): this {
      this.handlers.set(event, cb);
      return this;
    }
    private full(id: string): string {
      return id.startsWith("system.") || id.startsWith(`${this.namespace}.`) ? id : `${this.namespace}.${id}`;
    }
    private merge(id: string, patch: Obj): void {
      const p = JSON.parse(JSON.stringify(patch)) as Obj;
      const e = this.objects.get(id) ?? {};
      this.objects.set(id, {
        ...e,
        ...p,
        common: { ...(e.common ?? {}), ...(p.common ?? {}) },
        native: { ...(e.native ?? {}), ...(p.native ?? {}) },
      });
    }
    getForeignObjectAsync(id: string): Promise<Obj | null> {
      const o = this.objects.get(id);
      return Promise.resolve(o ? structuredClone(o) : null);
    }
    extendForeignObjectAsync(id: string, patch: Obj): Promise<void> {
      const keys = [...Object.keys(patch.common ?? {}), ...Object.keys(patch.native ?? {})];
      events.push(`instance write ${keys.join(",")}`);
      this.merge(id, patch);
      return Promise.resolve();
    }
    getObjectListAsync(p: { startkey: string; endkey: string }): Promise<{ rows: { id: string; value: unknown }[] }> {
      const rows = [...this.objects.entries()]
        .filter(([id]) => id >= p.startkey && id <= p.endkey)
        .map(([id, value]) => ({ id, value: structuredClone(value) }));
      return Promise.resolve({ rows });
    }
    setForeignObject(id: string, obj: Obj): Promise<void> {
      this.objects.set(id, structuredClone(obj));
      return Promise.resolve();
    }
    delObjectAsync(id: string): Promise<void> {
      this.objects.delete(this.full(id));
      return Promise.resolve();
    }
    extendObject(id: string, patch: Obj): Promise<void> {
      this.merge(this.full(id), patch);
      return Promise.resolve();
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

import { PublicHolidaysAdapter } from "../main";

interface Stub {
  config: Record<string, unknown>;
  objects: Map<string, { type?: string; common?: Record<string, unknown>; native?: Record<string, unknown> }>;
  states: Map<string, { val: unknown; ack: boolean }>;
  logs: { level: string; msg: string }[];
  handlers: Map<string, (...args: unknown[]) => unknown>;
  stop: ReturnType<typeof vi.fn>;
}

const SCHEDULE_INSTANCE = { common: { mode: "schedule", schedule: "0 0 * * *" }, native: {} };

async function start(
  config: Record<string, unknown>,
  instance: { common: Record<string, unknown>; native: Record<string, unknown> } = SCHEDULE_INSTANCE,
): Promise<Stub> {
  events.length = 0;
  const stub = new PublicHolidaysAdapter() as unknown as Stub;
  stub.config = config;
  stub.objects.set("system.adapter.public-holidays.0", { type: "instance", ...instance });
  const ready = stub.handlers.get("ready");
  expect(ready).toBeTypeOf("function");
  await (ready as () => Promise<void>)();
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
    const stub = await inZone(() => start({ country: "JP" }));
    const zoneLines = stub.logs.filter(l => l.msg.includes(ZONE));
    expect(zoneLines.length).toBeGreaterThan(0);
    expect(zoneLines.every(l => l.level === "debug")).toBe(true);
  });
});
