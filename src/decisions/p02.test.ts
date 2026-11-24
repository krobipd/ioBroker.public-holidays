// P-02 — every datapoint is always there; no setting creates or omits single datapoints.
import { describe, expect, it, vi } from "vitest";

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
      init: vi.fn(() => Promise.resolve()),
      getTranslatedObject: (key: string) => ({ en: key }),
    },
  };
});

import type { FakeAdapter } from "../lib/adapter-fake";
import * as mainModule from "../main";
import { CALENDAR_OBJECTS } from "../lib/state-publisher";

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

async function start(...calendars: Record<string, unknown>[]): Promise<Stub> {
  const stub = new mainModule.PublicHolidaysAdapter() as unknown as Stub;
  stub.config = { calendars };
  stub.objects.set("system.adapter.public-holidays.0", {
    type: "instance",
    common: { mode: "schedule", schedule: "0 0 * * *" },
    native: {},
  });
  need(stub.registered.includes("ready"), "the adapter registers its ready handler");
  await stub.emit("ready");
  return stub;
}

/**
 * The ids below a folder, relative to it, sorted.
 *
 * @param ids the full ids
 * @param folder the folder's full id
 * @returns the relative ids
 */
function below(ids: Iterable<string>, folder: string): string[] {
  return [...ids]
    .filter(id => id.startsWith(`${folder}.`))
    .map(id => id.slice(folder.length + 1))
    .sort();
}

/**
 * Per calendar folder, in order of creation: every object below it and every state that got a value.
 *
 * @param stub the adapter after its run
 * @returns one entry per folder
 */
function calendarTrees(stub: Stub): { objects: string[]; values: string[] }[] {
  return [...stub.objects.entries()]
    .filter(([, o]) => o.type === "folder")
    .map(([folder]) => ({ objects: below(stub.objects.keys(), folder), values: below(stub.states.keys(), folder) }));
}

const SHAPE = {
  objects: CALENDAR_OBJECTS.map(o => o.rel).sort(),
  values: CALENDAR_OBJECTS.filter(o => o.type === "state")
    .map(o => o.rel)
    .sort(),
};

describe("P-02 every datapoint is always there", () => {
  it("P-02: every datapoint of a calendar is there and carries a value, whether the run found holidays or none", async () => {
    const found = await start(calendar("cal-a", "a1", { country: "AT" }));
    const none = await start(calendar("cal-a", "a1", { country: "" }));
    expect([calendarTrees(found), calendarTrees(none)]).toEqual([[SHAPE], [SHAPE]]);
  });

  it("P-02: no setting creates or omits single datapoints — calendars with different settings carry the same ones", async () => {
    const stub = await start(
      calendar("cal-a", "a1", { country: "AT" }),
      calendar("cal-b", "b1", {
        country: "DE",
        state: "BY",
        region: "A",
        typeBank: true,
        typeSchool: true,
        typeOptional: true,
        typeObservance: true,
        includeBridgeDays: true,
      }),
      calendar("cal-c", "c1", { country: "JP", typePublic: false }),
      calendar("cal-d", "d1", { country: "" }),
    );
    expect(calendarTrees(stub)).toEqual([SHAPE, SHAPE, SHAPE, SHAPE]);
  });
});
