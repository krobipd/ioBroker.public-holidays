// P-02 — every datapoint is always there; no setting creates or omits single datapoints.
import { describe, expect, it, vi } from "vitest";

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
      init: vi.fn(() => Promise.resolve()),
      getTranslatedObject: (key: string) => ({ en: key }),
    },
  };
});

import * as mainModule from "../main";
import { CALENDAR_OBJECTS } from "../lib/state-publisher";

interface Stub {
  config: Record<string, unknown>;
  objects: Map<string, { type?: string; common?: Record<string, unknown>; native?: Record<string, unknown> }>;
  states: Map<string, { val: unknown; ack: boolean }>;
  handlers: Map<string, (...args: unknown[]) => unknown>;
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

async function start(...calendars: Record<string, unknown>[]): Promise<Stub> {
  const stub = new mainModule.PublicHolidaysAdapter() as unknown as Stub;
  stub.config = { calendars };
  stub.objects.set("system.adapter.public-holidays.0", {
    type: "instance",
    common: { mode: "schedule", schedule: "0 0 * * *" },
    native: {},
  });
  const ready = stub.handlers.get("ready");
  need(typeof ready === "function", "the adapter registers its ready handler");
  await (ready as () => Promise<void>)();
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
