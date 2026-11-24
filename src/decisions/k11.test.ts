// K11 — start order: translations, cleanup of old settings, instance repair; every repair means a restart.
import { describe, expect, it, vi } from "vitest";

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

describe("K11 start order", () => {
  it("K11: translations load before the cleanup of an old setting, which restarts without a run", async () => {
    const stub = await start(oneCalendar({ country: "AT" }), {
      common: { mode: "schedule", schedule: "0 0 * * *" },
      native: { excludePublic: "x" },
    });
    expect(events).toEqual(["translations", "instance write excludePublic"]);
    expect(stub.stop).toHaveBeenCalledTimes(1);
    expect(stub.states.size).toBe(0);
  });

  it("K11: the instance repair comes after the cleanup and restarts without a run", async () => {
    const stub = await start(oneCalendar({ country: "AT" }), { common: { mode: "daemon" }, native: {} });
    expect(events).toEqual(["translations", "instance write mode,schedule"]);
    expect(stub.stop).toHaveBeenCalledTimes(1);
    expect(stub.states.size).toBe(0);
  });

  it("K11: an instance that needs no repair runs and publishes", async () => {
    const stub = await start(oneCalendar({ country: "AT" }));
    expect(events).toEqual(["translations"]);
    expect(stub.states.size).toBeGreaterThan(0);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });
});
