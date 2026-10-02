// P-04 — every run writes one summary with the next holiday to the log, at level info.
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

async function runOn(day: Date, config: Record<string, unknown>): Promise<Stub> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(day);
  try {
    return await start(config);
  } finally {
    vi.useRealTimers();
  }
}

function summaries(stub: Stub): { level: string; msg: string }[] {
  return stub.logs.filter(l => l.msg.includes("next holiday"));
}

describe("P-04 one summary per run", () => {
  it("P-04: a run writes exactly one summary line, at info, naming the next holiday", async () => {
    const stub = await runOn(new Date(2026, 9, 20, 0, 0, 30), { country: "AT" });
    expect(summaries(stub)).toHaveLength(1);
    expect(summaries(stub)[0].level).toBe("info");
    expect(summaries(stub)[0].msg).toMatch(/next holiday: .+ on .+ \(in \d+ days?\)$/);
  });

  it("P-04: a run that finds no holiday ahead writes its one summary at info too", async () => {
    const stub = await runOn(new Date(2026, 9, 20, 0, 0, 30), { country: "AT", typePublic: false });
    expect(summaries(stub)).toHaveLength(1);
    expect(summaries(stub)[0].level).toBe("info");
    expect(summaries(stub)[0].msg).toMatch(/next holiday: no upcoming holiday$/);
  });
});
