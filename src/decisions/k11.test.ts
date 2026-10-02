// K11 — start order: translations, cleanup of old settings, instance repair; every repair means a restart.
import { describe, expect, it, vi } from "vitest";

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

describe("K11 start order", () => {
  it("K11: translations load before the cleanup of an old setting, which restarts without a run", async () => {
    const stub = await start(
      { country: "AT" },
      { common: { mode: "schedule", schedule: "0 0 * * *" }, native: { excludePublic: "x" } },
    );
    expect(events).toEqual(["translations", "instance write excludePublic"]);
    expect(stub.stop).toHaveBeenCalledTimes(1);
    expect(stub.states.size).toBe(0);
  });

  it("K11: the instance repair comes after the cleanup and restarts without a run", async () => {
    const stub = await start({ country: "AT" }, { common: { mode: "daemon" }, native: {} });
    expect(events).toEqual(["translations", "instance write mode,schedule"]);
    expect(stub.stop).toHaveBeenCalledTimes(1);
    expect(stub.states.size).toBe(0);
  });

  it("K11: an instance that needs no repair runs and publishes", async () => {
    const stub = await start({ country: "AT" });
    expect(events).toEqual(["translations"]);
    expect(stub.states.size).toBeGreaterThan(0);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });
});
