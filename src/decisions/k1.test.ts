// K1 — one run a day (schedule mode), no long-running process.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

interface Manifest {
  common: { mode?: string; schedule?: string };
}

describe("K1 one run a day", () => {
  it("K1: the manifest declares schedule mode with a once-a-day schedule", () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "io-package.json"), "utf8")) as Manifest;
    expect(manifest.common.mode).toBe("schedule");
    expect(manifest.common.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  it("K1: a run computes, publishes and then stops the process", async () => {
    const stub = await start(oneCalendar({ country: "AT" }));
    expect(stub.states.size).toBeGreaterThan(0);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("K1: a daemon instance is moved to the daily schedule", async () => {
    const stub = await start(oneCalendar({ country: "AT" }), { common: { mode: "daemon" }, native: {} });
    expect(stub.objects.get("system.adapter.public-holidays.0")?.common).toMatchObject({
      mode: "schedule",
      schedule: "0 0 * * *",
    });
  });
});
