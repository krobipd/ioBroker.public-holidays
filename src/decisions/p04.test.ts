// P-04 — every run writes one summary with the next holiday to the log, at level info.
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
 * One calendar of the list, its name and id the user's own.
 *
 * @param id the folder id
 * @param uid the calendar's uid
 * @param settings location, types, excludes, bridge days
 * @returns the calendar record
 */
function calendar(id: string, uid: string, settings: Record<string, unknown>): Record<string, unknown> {
  return { uid, id, name: id, nameAuto: false, ...settings };
}

async function runOn(day: Date, ...calendars: Record<string, unknown>[]): Promise<Stub> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(day);
  try {
    return await start({ calendars });
  } finally {
    vi.useRealTimers();
  }
}

function summaries(stub: Stub): { level: string; message: string }[] {
  return stub.lines.filter(l => l.message.includes("next holiday"));
}

const DAY = new Date(2026, 9, 20, 0, 0, 30);

describe("P-04 one summary per run", () => {
  it("P-04: a run writes exactly one summary line, at info, naming the next holiday", async () => {
    const stub = await runOn(DAY, calendar("cal-a", "a1", { country: "AT" }));
    expect(summaries(stub)).toHaveLength(1);
    expect(summaries(stub)[0].level).toBe("info");
    expect(summaries(stub)[0].message).toMatch(/next holiday: .+ on .+ \(in \d+ days?\)$/);
  });

  it("P-04: a run over several calendars writes one summary, at info, naming each one's next holiday", async () => {
    const stub = await runOn(
      DAY,
      calendar("cal-a", "a1", { country: "AT" }),
      calendar("cal-b", "b1", { country: "DE" }),
    );
    expect(summaries(stub)).toHaveLength(1);
    expect(summaries(stub)[0].level).toBe("info");
    expect(summaries(stub)[0].message.match(/next holiday: .+? on .+? \(in \d+ days?\)/g)).toHaveLength(2);
  });

  it("P-04: a run that finds no holiday ahead writes its one summary at info too", async () => {
    const stub = await runOn(DAY, calendar("cal-a", "a1", { country: "AT", typePublic: false }));
    expect(summaries(stub)).toHaveLength(1);
    expect(summaries(stub)[0].level).toBe("info");
    expect(summaries(stub)[0].message).toMatch(/next holiday: no upcoming holiday$/);
  });
});
