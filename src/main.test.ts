/**
 * Orchestration tests for main.ts — onReady flow (mode migration, country
 * detection chain, compute → publish → stop). The config matrix lives in config.test.ts.
 * Fleet harness pattern: `@iobroker/adapter-core` is mocked with a stub Adapter
 * class; everything else (holiday-engine with the real date-holidays data,
 * i18n, state-publisher) runs for REAL against the stub object store.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => {
  class StubAdapter {
    namespace = "public-holidays.0";
    adapterDir = "/stub-adapter-dir";
    config: Record<string, unknown> = {};
    objects = new Map<string, ObjEntry>();
    states = new Map<string, { val: unknown; ack: boolean }>();
    logs: { level: string; msg: string }[] = [];
    stop = vi.fn();
    /** The adapter's name — the scope of its notifications (failStart). */
    name = "public-holidays";
    /** How the process would end — recorded, not ended: the real one never returns (failStart). */
    terminate = vi.fn((_reason?: string, _exitCode?: number): void => undefined);
    /** The notifications the adapter registered in the admin. */
    notifications: { scope: string; category: string | null; message: string }[] = [];
    registerNotification(scope: string, category: string | null, message: string): Promise<void> {
      this.notifications.push({ scope, category, message });
      return Promise.resolve();
    }
    /** Like a real install without the plugin system — overridden where a test hands an error to Sentry. */
    supportsFeature = vi.fn((_feature: string) => false);
    /** How often the instance's OWN object was written — every write costs a restart. */
    instanceObjectWrites = 0;
    /** Writes of the adapter's own objects (the 17 refreshes). */
    objectWrites = 0;
    /** State writes that reached the store. */
    stateWrites = 0;
    /** Simulates a broker hiccup on the next instance-object read. */
    failNextForeignObjectRead = false;

    log = {
      /** The instance's verbosity — the real Logger carries it and onReady reads it. */
      level: "info",
      debug: (m: string): void => void this.logs.push({ level: "debug", msg: m }),
      info: (m: string): void => void this.logs.push({ level: "info", msg: m }),
      warn: (m: string): void => void this.logs.push({ level: "warn", msg: m }),
      error: (m: string): void => void this.logs.push({ level: "error", msg: m }),
    };

    /** The handlers the adapter registered — the tests fire them as js-controller would. */
    handlers = new Map<string, (...args: unknown[]) => unknown>();

    constructor(_options?: unknown) {}

    on(event: string, cb: (...args: unknown[]) => unknown): this {
      this.handlers.set(event, cb);
      return this;
    }

    private fullId(id: string): string {
      return id.startsWith("system.") || id.startsWith(`${this.namespace}.`) ? id : `${this.namespace}.${id}`;
    }

    // Reads hand out a COPY, like the real store: a caller that mutates what it read must not
    // change the stored object behind the store's back (package check read-stub-copy).
    getForeignObjectAsync(id: string): Promise<ObjEntry | null> {
      if (this.failNextForeignObjectRead) {
        this.failNextForeignObjectRead = false;
        return Promise.reject(new Error("objects db unreachable"));
      }
      const obj = this.objects.get(id);
      return Promise.resolve(obj ? structuredClone(obj) : null);
    }

    /**
     * A merge as the objects DB performs it: the patch travels as JSON, so `null` arrives and is
     * stored (the "cleared" state of a key) while `undefined` vanishes — a repair that wrote
     * `undefined` would leave the key standing and repair again on every start.
     *
     * @param id the full object id
     * @param obj the patch
     */
    private merge(id: string, obj: Partial<ObjEntry>): void {
      const patch = JSON.parse(JSON.stringify(obj)) as Partial<ObjEntry>;
      const existing = this.objects.get(id) ?? {};
      this.objects.set(id, {
        ...existing,
        ...patch,
        common: { ...(existing.common ?? {}), ...(patch.common ?? {}) },
        native: { ...(existing.native ?? {}), ...(patch.native ?? {}) },
      });
    }

    extendForeignObjectAsync(id: string, obj: Partial<ObjEntry>): Promise<void> {
      if (id === `system.adapter.${this.namespace}`) {
        this.instanceObjectWrites++;
      }
      this.merge(id, obj);
      return Promise.resolve();
    }

    getObjectAsync(id: string): Promise<ObjEntry | null> {
      const obj = this.objects.get(this.fullId(id));
      return Promise.resolve(obj ? structuredClone(obj) : null);
    }

    delObjectAsync(id: string, options?: { recursive?: boolean }): Promise<void> {
      const full = this.fullId(id);
      for (const key of [...this.objects.keys()]) {
        if (key === full || (options?.recursive && key.startsWith(`${full}.`))) {
          this.objects.delete(key);
        }
      }
      return Promise.resolve();
    }

    // The range read the fleet's KnownObjects loads the own tree with — copies, like every read.
    getObjectListAsync(params: {
      startkey: string;
      endkey: string;
    }): Promise<{ rows: Array<{ id: string; value: unknown }> }> {
      const rows = [...this.objects.entries()]
        .filter(([id]) => id >= params.startkey && id <= params.endkey)
        .map(([id, value]) => ({ id, value: structuredClone(value) }));
      return Promise.resolve({ rows });
    }

    setForeignObject(id: string, obj: ObjEntry): Promise<void> {
      this.objects.set(id, structuredClone(obj));
      return Promise.resolve();
    }

    extendObject(id: string, obj: Partial<ObjEntry>): Promise<void> {
      this.objectWrites++;
      this.merge(this.fullId(id), obj);
      return Promise.resolve();
    }

    // The fleet removal asks the recording instances before it deletes (object-removal.ts) — no
    // recording instance runs here, so nobody answers.
    sendToAsync = vi.fn((): Promise<unknown> => Promise.reject(new Error("no recording instance")));
    /**
     * Timers as the adapter offers them — a property, like the real one.
     *
     * @param callback what runs when the timer fires
     * @param ms the delay
     */
    setTimeout = (callback: () => void, ms: number): ReturnType<typeof setTimeout> => setTimeout(callback, ms);
    clearTimeout = (timer: ReturnType<typeof setTimeout> | undefined): void => clearTimeout(timer);
    /** The run's wait for the removal's report line — counted, not waited. */
    delays: number[] = [];
    delay(ms: number): Promise<void> {
      this.delays.push(ms);
      return Promise.resolve();
    }

    // A plain setState always writes, like the database: an unchanged value is the adapter's to skip.
    setState(id: string, state: { val: unknown; ack: boolean }): Promise<void> {
      this.states.set(this.fullId(id), { val: state.val, ack: state.ack });
      this.stateWrites++;
      return Promise.resolve();
    }

    /**
     * The bulk read of a pattern (`<namespace>.*`) — copies, like every read.
     *
     * @param pattern the id pattern, `<namespace>.*`
     */
    getStatesAsync(pattern: string): Promise<Record<string, { val: unknown; ack: boolean }>> {
      const prefix = pattern.replace(/\*$/, "");
      return Promise.resolve(
        Object.fromEntries(
          [...this.states.entries()].filter(([id]) => id.startsWith(prefix)).map(([id, s]) => [id, structuredClone(s)]),
        ),
      );
    }
  }

  return {
    Adapter: StubAdapter,
    I18n: {
      init: vi.fn(async () => {}),
      getTranslatedObject: vi.fn((key: string) => ({ en: key })),
      translate: vi.fn((key: string) => key),
    },
  };
});

import { I18n } from "@iobroker/adapter-core";
import { CALENDAR_OBJECTS } from "./lib/state-publisher";
import { PublicHolidaysAdapter } from "./main";

/** The folder of a calendar and its objects and states — what a complete run of one calendar writes. */
const OBJECT_COUNT = CALENDAR_OBJECTS.length + 1;
const STATE_COUNT = CALENDAR_OBJECTS.filter(o => o.type === "state").length;

/** The folder id the tests' single calendar publishes under. */
const CAL = "public-holidays.0.cal";

interface ObjEntry {
  type?: string;
  common?: Record<string, unknown>;
  native?: Record<string, unknown>;
}

/** Stub surface added by the adapter-core mock (see vi.mock factory above). */
interface StubSurface {
  config: Record<string, unknown>;
  objects: Map<string, ObjEntry>;
  states: Map<string, { val: unknown; ack: boolean }>;
  logs: { level: string; msg: string }[];
  log: { level: string; info: (m: string) => void };
  stop: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  notifications: { scope: string; category: string | null; message: string }[];
  handlers: Map<string, (...args: unknown[]) => unknown>;
  instanceObjectWrites: number;
  objectWrites: number;
  stateWrites: number;
  failNextForeignObjectRead: boolean;
  delays: number[];
  extendObject: (id: string, obj: Partial<ObjEntry>) => Promise<void>;
  setState: (id: string, state: { val: unknown; ack: boolean }) => Promise<void>;
  extendForeignObjectAsync: (id: string, obj: Partial<ObjEntry>) => Promise<void>;
  getForeignObjectAsync: (id: string) => Promise<ObjEntry | null>;
  supportsFeature?: (feature: string) => boolean;
  getPluginInstance?: (name: string) => {
    getSentryObject: () => { captureException: (e: unknown) => void; flush?: (ms: number) => Promise<boolean> };
  } | null;
}

/** The two lifecycle events, fired through the handlers the adapter registered. */
interface Lifecycle {
  onReady: () => Promise<void>;
  onUnload: (callback: () => void) => void;
}

/**
 * The settings of an instance with ONE calendar holding these settings, under the folder `cal`.
 *
 * @param settings location, types, excludes, bridge days
 * @returns the native record
 */
function oneCalendar(settings: Record<string, unknown>): Record<string, unknown> {
  return {
    calendars: [{ uid: "c1", name: "Test", nameAuto: false, id: "cal", ...settings }],
    deleteRecordedStates: true,
    deleteRecordedHistory: false,
  };
}

function setup(
  settings: Record<string, unknown> = {},
  config = oneCalendar(settings),
): {
  adapter: PublicHolidaysAdapter;
  internal: Lifecycle;
  stub: StubSurface;
} {
  const adapter = new PublicHolidaysAdapter();
  const stub = adapter as unknown as StubSurface;
  // A handler the constructor never registered fails here — js-controller would never run it.
  const handler = (event: string): ((...args: unknown[]) => unknown) => {
    const cb = stub.handlers.get(event);
    if (!cb) {
      throw new Error(`no "${event}" handler registered`);
    }
    return cb;
  };
  const internal: Lifecycle = {
    onReady: () => handler("ready")() as Promise<void>,
    onUnload: callback => void handler("unload")(callback),
  };
  stub.config = config;
  // Instance object in schedule mode by default (no migration needed).
  stub.objects.set("system.adapter.public-holidays.0", {
    type: "instance",
    common: { mode: "schedule", schedule: "0 0 * * *" },
    native: {},
  });
  return { adapter, internal, stub };
}

function logsOf(stub: StubSurface, level: string): string[] {
  return stub.logs.filter(l => l.level === level).map(l => l.msg);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("onReady — happy path", () => {
  it("computes and publishes real holiday states, then stops (DE, New Year)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T12:00:00"));
    const { internal, stub } = setup({ country: "DE" });
    // German system language → German holiday names (pickHolidayLanguages).
    stub.objects.set("system.config", { common: { language: "de" } });

    await internal.onReady();

    expect(stub.states.get(`${CAL}.today.isHoliday`)).toEqual({ val: true, ack: true });
    expect(stub.states.get(`${CAL}.today.name`)?.val).toBe("Neujahr");
    expect(stub.states.get(`${CAL}.next.date`)?.val).toBe("2027-03-26");
    expect(stub.states.get(`${CAL}.next.daysUntil`)?.val).toBe(84);
    expect(stub.states.size).toBe(STATE_COUNT);
    expect(stub.stop).toHaveBeenCalledTimes(1);
    expect(logsOf(stub, "error")).toEqual([]);
  });

  it("warns about stale excludes only when there ARE stale ones", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T12:00:00"));

    // Every configured exclude still matches a real holiday → no warning. A
    // warning here would tell the user their configuration is broken when it
    // is not — on every single run, because this adapter runs daily.
    const good = setup({ country: "DE", excludeHolidays: ["01-01"] });
    await good.internal.onReady();
    expect(logsOf(good.stub, "warn").some(m => m.includes("no longer occur"))).toBe(false);

    // A renamed/removed id → the warning is exactly what the user needs.
    const stale = setup({ country: "DE", excludeHolidays: ["gone_forever_xyz"] });
    await stale.internal.onReady();
    expect(logsOf(stale.stub, "warn").some(m => m.includes("gone_forever_xyz"))).toBe(true);
  });

  it("publishes false/empty day states on a normal workday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-10T12:00:00"));
    const { internal, stub } = setup({ country: "DE" });

    await internal.onReady();

    expect(stub.states.get(`${CAL}.today.isHoliday`)).toEqual({ val: false, ack: true });
    expect(stub.states.get(`${CAL}.today.name`)).toEqual({ val: "", ack: true });
    expect(stub.states.get(`${CAL}.next.isHoliday`)?.val).toBe(true);
  });

  it("creates the calendar's folder with every object below it", async () => {
    const { internal, stub } = setup({ country: "DE" });
    await internal.onReady();
    const own = [...stub.objects.keys()].filter(id => id.startsWith("public-holidays.0.")).sort();
    expect(own).toEqual([CAL, ...CALENDAR_OBJECTS.map(o => `${CAL}.${o.rel}`)].sort());
    expect(stub.objects.get(CAL)).toMatchObject({ type: "folder", common: { name: "Test" }, native: { uid: "c1" } });
  });

  // audit finding F12 — the holiday listing computes an extra year and builds a line naming every
  // holiday of it. Doing that once a day for a log level nobody reads is pure waste.
  it("skips the holiday listing while debug output is off", async () => {
    const { internal, stub } = setup({ country: "DE", state: "BY" });
    stub.log.level = "info";
    await internal.onReady();
    expect(logsOf(stub, "debug").filter(m => m.includes("IDs:"))).toEqual([]);
  });

  it("writes the holiday listing once debug output is on", async () => {
    const { internal, stub } = setup({ country: "DE", state: "BY" });
    stub.log.level = "debug";
    await internal.onReady();
    const listing = logsOf(stub, "debug").filter(m => m.includes("IDs:"));
    expect(listing).toHaveLength(1);
    expect(listing[0]).toContain("DE/BY:");
  });

  it("logs the Today/next-holiday summary at info on every run — a holiday and a normal day", async () => {
    vi.useFakeTimers();
    for (const [day, today] of [
      ["2027-01-01T12:00:00", "Today: New Year's Day"],
      ["2027-03-10T12:00:00", "Today: no holiday"],
    ]) {
      vi.setSystemTime(new Date(day));
      const { internal, stub } = setup({ country: "DE" });
      await internal.onReady();
      expect(
        logsOf(stub, "info").some(m => m.startsWith(`cal: ${today}, next holiday: `)),
        day,
      ).toBe(true);
    }
  });

  it("removes deprecated states left over from older versions", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("public-holidays.0.next.duration", { type: "state" });
    stub.objects.set("public-holidays.0.today.id", { type: "state" });

    await internal.onReady();

    expect(stub.objects.has("public-holidays.0.next.duration")).toBe(false);
    expect(stub.objects.has("public-holidays.0.today.id")).toBe(false);
  });
});

describe("onReady — lifecycle", () => {
  it("loads the translations first — before the settings migration may stand the run down", async () => {
    const order: string[] = [];
    vi.mocked(I18n.init).mockImplementationOnce(() => {
      order.push("i18n");
      return Promise.resolve();
    });
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "schedule" },
      native: { excludePublic: ["11-11"] },
    });
    const write = stub.extendForeignObjectAsync.bind(stub);
    stub.extendForeignObjectAsync = (id, obj) => {
      order.push("instance write");
      return write(id, obj);
    };

    await internal.onReady();

    expect(order).toEqual(["i18n", "instance write"]);
  });
});

describe("onReady — instance-object repair", () => {
  it("migrates a daemon-mode instance to schedule mode and stands down", async () => {
    // Writing the instance object makes the host restart us — computing and publishing
    // afterwards runs against a database that is already closing.
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "daemon" },
      native: {},
    });

    await internal.onReady();

    const inst = stub.objects.get("system.adapter.public-holidays.0")!;
    expect(inst.common!.mode).toBe("schedule");
    expect(inst.common!.schedule).toBe("0 0 * * *");
    expect(logsOf(stub, "info").some(m => m.includes("Migrating from daemon to schedule"))).toBe(true);
    expect(stub.states.get(`${CAL}.today.isHoliday`)).toBeUndefined();
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("CLEARS a leftover supportedMessages key instead of writing false into it", async () => {
    // With stopInstance set the host kills the process a second after asking it to stop — in the
    // middle of a holiday run, and this adapter has no message handler to answer with. Writing
    // `{ stopInstance: false }` back would not fix it: supportedMessages is a positive list, so
    // an object with no value other than false shuts the message box for good, silently.
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "schedule", supportedMessages: { stopInstance: true } },
      native: {},
    });

    await internal.onReady();

    const inst = stub.objects.get("system.adapter.public-holidays.0")!;
    expect(inst.common!.supportedMessages ?? null).toBeNull();
    expect(logsOf(stub, "info").some(m => m.includes("restarts once"))).toBe(true);
    expect(stub.states.get(`${CAL}.today.isHoliday`)).toBeUndefined();
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("corrects a half-repaired instance that only carries { stopInstance: false }", async () => {
    // The 0.13.2 correction wrote exactly this. A guard that looks at `stopInstance` would never
    // see its own result again, so such an install would stay message-deaf forever.
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "schedule", supportedMessages: { stopInstance: false } },
      native: {},
    });

    await internal.onReady();

    const inst = stub.objects.get("system.adapter.public-holidays.0")!;
    expect(inst.common!.supportedMessages ?? null).toBeNull();
    expect(stub.instanceObjectWrites).toBe(1);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("leaves a cleared key alone on the next start — no restart loop", async () => {
    // The whole correction hinges on converging: once the key is gone (or null), the next run
    // must write nothing at all, otherwise every start restarts the instance.
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "schedule", supportedMessages: null as unknown as undefined },
      native: {},
    });

    await internal.onReady();

    expect(stub.instanceObjectWrites).toBe(0);
    expect(logsOf(stub, "info").some(m => m.includes("restarts once"))).toBe(false);
    expect(stub.states.get(`${CAL}.today.isHoliday`)).toBeDefined();
  });

  it("drops the obsolete settings keys (excludePublic, the previous owner's holidays) and stands down", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "schedule" },
      native: { country: "DE", excludePublic: ["11-11", "09-24"], holidays: [] },
    });

    await internal.onReady();

    const inst = stub.objects.get("system.adapter.public-holidays.0")!;
    // Stored as null — the cleared state the helper recognises; `undefined` would vanish on the
    // way into the database and the key would be migrated again on every start.
    expect(inst.native).toHaveProperty("excludePublic", null);
    expect(inst.native).toHaveProperty("holidays", null);
    expect(inst.native).toHaveProperty("country", "DE");
    expect(stub.instanceObjectWrites).toBe(1);
    // The write restarts the instance — nothing is computed in the process on its way out.
    expect(stub.states.size).toBe(0);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("does not write for the obsolete keys once they are cleared", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "schedule" },
      native: { excludePublic: null, holidays: null },
    });

    await internal.onReady();

    expect(stub.instanceObjectWrites).toBe(0);
    expect(stub.states.get(`${CAL}.today.isHoliday`)).toBeDefined();
  });

  it("an install with obsolete native AND common settings converges: one write per start, then none", async () => {
    // Each start is a fresh process on the same database — three onReady runs model the restarts.
    const first = setup({ country: "DE" });
    first.stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "daemon", supportedMessages: { stopInstance: true } },
      native: { excludePublic: ["11-11"], holidays: [] },
    });
    const db = first.stub.objects;

    await first.internal.onReady(); // the settings migration writes and stands down
    expect(first.stub.instanceObjectWrites).toBe(1);

    const second = setup({ country: "DE" });
    second.stub.objects = db;
    await second.internal.onReady(); // the instance repair writes and stands down
    expect(second.stub.instanceObjectWrites).toBe(1);
    expect(second.stub.states.size).toBe(0);

    const third = setup({ country: "DE" });
    third.stub.objects = db;
    await third.internal.onReady(); // nothing left to repair — the run computes
    expect(third.stub.instanceObjectWrites).toBe(0);
    expect(third.stub.states.size).toBe(STATE_COUNT);

    const inst = db.get("system.adapter.public-holidays.0")!;
    expect(inst.common).toHaveProperty("supportedMessages", null);
    expect(inst.common).toHaveProperty("mode", "schedule");
    expect(inst.native).toHaveProperty("excludePublic", null);
    expect(inst.native).toHaveProperty("holidays", null);
  });

  it("repairs both in ONE write so the instance restarts once, not twice", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "daemon", supportedMessages: { stopInstance: true } },
      native: {},
    });

    await internal.onReady();

    const inst = stub.objects.get("system.adapter.public-holidays.0")!;
    expect(inst.common!.mode).toBe("schedule");
    expect(inst.common!.supportedMessages ?? null).toBeNull();
    expect(stub.instanceObjectWrites).toBe(1);
  });

  it("does not touch a healthy instance object and computes normally", async () => {
    const { internal, stub } = setup({ country: "DE" });

    await internal.onReady();

    expect(logsOf(stub, "info").some(m => m.includes("Migrating"))).toBe(false);
    expect(logsOf(stub, "info").some(m => m.includes("restarts once"))).toBe(false);
    expect(stub.instanceObjectWrites).toBe(0);
    expect(stub.states.get(`${CAL}.today.isHoliday`)).toBeDefined();
  });

  it("computes normally when the instance object cannot be read", async () => {
    // A broker hiccup must not cost the daily run — the next run retries the repair.
    const { internal, stub } = setup({ country: "DE" });
    stub.failNextForeignObjectRead = true;

    await internal.onReady();

    expect(stub.states.get(`${CAL}.today.isHoliday`)).toBeDefined();
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("computes normally when the repair write is refused — the next run retries it", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "daemon" },
      native: {},
    });
    stub.extendForeignObjectAsync = () => Promise.reject(new Error("objects db read-only"));

    await internal.onReady();

    expect(logsOf(stub, "debug").some(m => m.includes("Could not check the instance object"))).toBe(true);
    expect(logsOf(stub, "error")).toEqual([]);
    expect(stub.states.size).toBe(STATE_COUNT);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });
});

describe("onReady — country detection chain", () => {
  it("uses the system country (ISO name resolved to code) when nothing is configured", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T12:00:00"));
    const { internal, stub } = setup({});
    stub.objects.set("system.config", { common: { country: "Austria", language: "de" } });

    await internal.onReady();

    expect(logsOf(stub, "debug").some(m => m.includes("Using system country: AT"))).toBe(true);
    // Oct 26 (Nationalfeiertag) is public in AT but not DE — asserting today=holiday
    // proves the resolved AT data actually flowed through compute, not just detection.
    expect(stub.states.get(`${CAL}.today.isHoliday`)?.val).toBe(true);
    expect(stub.states.get(`${CAL}.today.name`)?.val).not.toBe("");
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("explicit config country wins over the system country", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.config", { common: { country: "Austria", language: "de" } });

    await internal.onReady();

    expect(logsOf(stub, "debug").some(m => m.includes("Using system country"))).toBe(false);
  });

  it("warns, publishes an empty result and stops when no country is configured and none can be detected", async () => {
    const { internal, stub } = setup({});

    await internal.onReady();

    expect(logsOf(stub, "warn").some(m => m.includes("No country configured"))).toBe(true);
    // A truthful empty result, not silence: the twelve states carry their manifest defaults.
    expect(stub.states.size).toBe(STATE_COUNT);
    expect(stub.states.get(`${CAL}.today.isHoliday`)).toEqual({ val: false, ack: true });
    expect(stub.states.get(`${CAL}.next.date`)).toEqual({ val: "", ack: true });
    expect(stub.states.get(`${CAL}.next.daysUntil`)).toEqual({ val: 0, ack: true });
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("warns and publishes an empty result when the system country name cannot be resolved", async () => {
    const { internal, stub } = setup({});
    stub.objects.set("system.config", { common: { country: "Atlantis", language: "de" } });

    await internal.onReady();

    // The country IS set in the system settings — "No country configured" would send the user
    // looking in the wrong place.
    expect(logsOf(stub, "warn")).toContain(
      "cal: System country 'Atlantis' is not recognized — choose a country in the adapter settings",
    );
    expect(stub.states.size).toBe(STATE_COUNT);
    expect(stub.states.get(`${CAL}.today.name`)).toEqual({ val: "", ack: true });
  });

  it("resolves a name of the admin wizard's own list (Admin <= 8.0.14): Vietnam", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T12:00:00")); // VN National Day
    const { internal, stub } = setup({});
    stub.objects.set("system.config", { common: { country: "Vietnam", language: "en" } });

    await internal.onReady();

    expect(logsOf(stub, "debug")).toContain("cal: Using system country: VN");
    expect(stub.states.get(`${CAL}.today.isHoliday`)?.val).toBe(true);
  });

  it("names the real cause for a system country that covers several countries", async () => {
    const { internal, stub } = setup({});
    stub.objects.set("system.config", { common: { country: "Serbia and Montenegro", language: "en" } });

    await internal.onReady();

    expect(logsOf(stub, "warn")).toContain(
      "cal: System country 'Serbia and Montenegro' covers several countries — choose the country in the adapter settings",
    );
  });

  it("names the real cause for a system country without holiday data", async () => {
    const { internal, stub } = setup({});
    stub.objects.set("system.config", { common: { country: "Qatar", language: "en" } });

    await internal.onReady();

    expect(logsOf(stub, "warn")).toContain(
      "cal: System country 'Qatar' has no holiday data — choose a country in the adapter settings",
    );
  });

  it("overwrites the previous run's holiday with the empty result once the country is gone (audit E2)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T12:00:00"));
    const { internal, stub } = setup({ country: "DE" });

    await internal.onReady();
    expect(stub.states.get(`${CAL}.today.isHoliday`)).toEqual({ val: true, ack: true });

    // The user clears the country; the next run must not leave New Year standing forever.
    stub.config = oneCalendar({});
    stub.stop.mockClear();
    await internal.onReady();

    expect(stub.states.get(`${CAL}.today.isHoliday`)).toEqual({ val: false, ack: true });
    expect(stub.states.get(`${CAL}.today.name`)).toEqual({ val: "", ack: true });
    expect(stub.states.get(`${CAL}.next.date`)).toEqual({ val: "", ack: true });
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("warns and runs with English names and the configured country when system.config cannot be read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T12:00:00"));
    const { internal, stub } = setup({ country: "DE" });
    const read = stub.getForeignObjectAsync.bind(stub);
    stub.getForeignObjectAsync = (id: string) =>
      id === "system.config" ? Promise.reject(new Error("objects db unreachable")) : read(id);

    await internal.onReady();

    expect(logsOf(stub, "warn").some(m => m.includes("Could not read the ioBroker system settings"))).toBe(true);
    expect(stub.states.get(`${CAL}.today.name`)?.val).toBe("New Year's Day");
    expect(stub.states.size).toBe(STATE_COUNT);
    expect(logsOf(stub, "error")).toEqual([]);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("warns when the configured country yields zero raw holidays (A3)", async () => {
    const { internal, stub } = setup({ country: "XX" });

    await internal.onReady();

    expect(logsOf(stub, "warn").some(m => m.includes("'XX' is not recognized"))).toBe(true);
    // Still publishes (empty) states and stops cleanly.
    expect(stub.states.size).toBe(STATE_COUNT);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });
});

describe("onReady — error handling", () => {
  // Fleet start-failure standard (src/lib/start-failure.ts): a start that fails ends the process with
  // one error line and exit code 6 — the controller tries again — and never runs on as an empty shell.
  it("ends a failed start with one error line and exit code 6", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.extendObject = () => {
      return Promise.reject(new Error("broker write refused"));
    };

    await internal.onReady();

    expect(logsOf(stub, "error")).toEqual(["Start failed: broker write refused"]);
    expect(stub.terminate).toHaveBeenCalledTimes(1);
    expect(stub.terminate).toHaveBeenCalledWith("broker write refused", 6);
    expect(stub.notifications).toEqual([]);
    expect(stub.stop).not.toHaveBeenCalled();
  });

  it("a stop during the start is no start failure — one debug line, no error, no end of its own", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.extendObject = () => Promise.reject(new Error("instance closing"));
    stub.supportsFeature = vi.fn(() => true);
    stub.getPluginInstance = vi.fn(() => null);
    internal.onUnload(vi.fn());

    await internal.onReady();

    expect(logsOf(stub, "error")).toEqual([]);
    expect(logsOf(stub, "debug")).toContain("Start ended by the stop: instance closing");
    expect(stub.terminate).not.toHaveBeenCalled();
    expect(stub.getPluginInstance).not.toHaveBeenCalled();
    expect(stub.stop).not.toHaveBeenCalled();
  });

  // The Sentry plugin only hooks uncaught exceptions; a caught one reaches it only when handed
  // over explicitly — before this, no error of this adapter ever arrived there (audit E1).
  it("hands a caught error to the Sentry plugin when it is loaded", async () => {
    const { internal, stub } = setup({ country: "DE" });
    const failure = new Error("broker write refused");
    stub.extendObject = () => Promise.reject(failure);
    const order: string[] = [];
    const captureException = vi.fn(() => void order.push("capture"));
    const flush = vi.fn((_ms: number) => {
      order.push("flush");
      return Promise.resolve(true);
    });
    stub.terminate.mockImplementation(() => void order.push("terminate"));
    stub.supportsFeature = vi.fn((feature: string) => feature === "PLUGINS");
    stub.getPluginInstance = vi.fn((name: string) =>
      name === "sentry" ? { getSentryObject: () => ({ captureException, flush }) } : null,
    );

    await internal.onReady();

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(failure);
    // failStart ends the process right after — the event has to be out before (flush).
    expect(flush).toHaveBeenCalledWith(2000);
    expect(order).toEqual(["capture", "flush", "terminate"]);
  });

  it("a Sentry hand-over that throws neither escapes nor keeps the start from ending", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.extendObject = () => Promise.reject(new Error("broker write refused"));
    stub.supportsFeature = vi.fn(() => true);
    stub.getPluginInstance = vi.fn(() => ({
      getSentryObject: () => ({
        captureException: () => {
          throw new Error("sentry down");
        },
      }),
    }));

    await expect(internal.onReady()).resolves.toBeUndefined();

    expect(logsOf(stub, "debug")).toContain("Could not hand the error to Sentry: sentry down");
    expect(stub.terminate).toHaveBeenCalledWith("broker write refused", 6);
  });

  it("logs and ends as before when no Sentry plugin is loaded", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.extendObject = () => Promise.reject(new Error("broker write refused"));
    stub.supportsFeature = vi.fn(() => true);
    stub.getPluginInstance = vi.fn(() => null);

    await internal.onReady();

    expect(stub.getPluginInstance).toHaveBeenCalledWith("sentry");
    expect(logsOf(stub, "error")).toEqual(["Start failed: broker write refused"]);
    expect(stub.terminate).toHaveBeenCalledWith("broker write refused", 6);
  });
});

describe("onReady — what a run writes and says (0.18.0)", () => {
  it("names the bridge day in the SYSTEM language, whatever the data language (de system, US scope)", () => {
    // US data carries no German — holiday names are English, the adapter's own bridge-day name is not.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T00:00:30"));
    const { internal, stub } = setup({ country: "US", includeBridgeDays: true });
    stub.objects.set("system.config", { common: { language: "de" } });
    return internal.onReady().then(() => {
      expect(stub.states.get(`${CAL}.today.name`)).toEqual({ val: "Brückentag", ack: true });
      expect(stub.states.get(`${CAL}.yesterday.name`)?.val).toBe("Thanksgiving Day");
    });
  });

  it("a second run with nothing changed writes no object and no state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:30"));
    const { internal, stub } = setup({ country: "DE" });
    await internal.onReady();
    expect(stub.objectWrites).toBe(OBJECT_COUNT);
    expect(stub.stateWrites).toBe(STATE_COUNT);

    stub.objectWrites = 0;
    stub.stateWrites = 0;
    await internal.onReady();
    expect(stub.objectWrites).toBe(0);
    expect(stub.stateWrites).toBe(0);
  });

  it("the summary line comes after the states are written, with a singular day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T00:00:30"));
    const { internal, stub } = setup({ country: "DE" });
    const order: string[] = [];
    const setState = stub.setState.bind(stub);
    stub.setState = (id: string, state: { val: unknown; ack: boolean }): Promise<void> => {
      order.push("state");
      return setState(id, state);
    };
    const info = stub.log.info;
    stub.log.info = (m: string): void => {
      order.push(m.startsWith("cal: Today:") ? "summary" : "info");
      info(m);
    };

    await internal.onReady();

    expect(order.lastIndexOf("state")).toBeLessThan(order.indexOf("summary"));
    expect(logsOf(stub, "info").find(m => m.startsWith("cal: Today:"))).toMatch(/\(in 1 day\)$/);
  });

  it("says in debug output when the host clock is not in one of the country's zones", async () => {
    const { internal, stub } = setup({ country: "JP" });
    stub.log.level = "debug";
    await internal.onReady();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(logsOf(stub, "debug").some(m => m.startsWith(`cal: Host time zone ${zone} is not one of JP's`))).toBe(
      zone !== "Asia/Tokyo",
    );
  });

  it("a scope date-holidays cannot load says so (NZ Timaru)", async () => {
    const { internal, stub } = setup({ country: "NZ", state: "CAN", region: "Timaru" });
    await internal.onReady();
    expect(logsOf(stub, "warn")).toContain(
      "cal: date-holidays cannot load 'Timaru' (library defect) — using the broader scope's holidays",
    );
  });
});

describe("onUnload", () => {
  it("reports done immediately — nothing to flush, no timer, no connection", () => {
    const { internal } = setup({ country: "DE" });
    const callback = vi.fn();

    internal.onUnload(callback);

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("onReady — diagnostics warnings", () => {
  it("warns when the configured state is unknown for the country", async () => {
    const { internal, stub } = setup({ country: "DE", state: "XX" });

    await internal.onReady();

    expect(logsOf(stub, "warn").some(m => m.includes("State 'XX' is unknown"))).toBe(true);
    // Still publishes (country-level) states and stops cleanly.
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("warns when the configured region is unknown for the state", async () => {
    const { internal, stub } = setup({ country: "DE", state: "BY", region: "ZZ" });

    await internal.onReady();

    expect(logsOf(stub, "warn").some(m => m.includes("Region 'ZZ' is unknown"))).toBe(true);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("warns when no holiday type is enabled — and still publishes the (empty) result", async () => {
    // One click on the "public holidays" box gets a user here, and the type filter then drops
    // every holiday. Publishing empty states without a word looks like a broken adapter; keeping
    // yesterday's values (by stopping early) would be worse still.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T12:00:00"));
    const { internal, stub } = setup({ country: "DE", typePublic: false });

    await internal.onReady();

    expect(logsOf(stub, "warn").some(m => m.includes("No holiday type is enabled"))).toBe(true);
    expect(stub.states.get(`${CAL}.today.isHoliday`)).toEqual({ val: false, ack: true });
    expect(stub.states.get(`${CAL}.next.name`)).toEqual({ val: "", ack: true });
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("stays quiet about types when at least one is enabled", async () => {
    const { internal, stub } = setup({ country: "DE" });

    await internal.onReady();

    expect(logsOf(stub, "warn").some(m => m.includes("No holiday type is enabled"))).toBe(false);
  });
});

describe("onReady — several calendars (multi-calendar)", () => {
  /** The settings of 0.20.x as they stand after the update: the old keys beside the manifest default. */
  const LEGACY = {
    country: "DE",
    state: "BY",
    region: "",
    typePublic: true,
    typeBank: false,
    typeSchool: true,
    typeOptional: false,
    typeObservance: false,
    excludeHolidays: ["01-06"],
    includeBridgeDays: true,
    calendars: [
      {
        uid: "c1",
        name: "",
        nameAuto: true,
        id: "system-public",
        country: "",
        state: "",
        region: "",
        typePublic: true,
        typeBank: false,
        typeSchool: false,
        typeOptional: false,
        typeObservance: false,
        excludeHolidays: [],
        includeBridgeDays: false,
      },
    ],
    deleteRecordedStates: true,
    deleteRecordedHistory: false,
  };

  it("publishes every calendar into its own folder and names each in the one summary line", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T12:00:00"));
    const config = {
      calendars: [
        {
          uid: "c1",
          name: "Bavaria",
          nameAuto: false,
          id: "de-by-public",
          country: "DE",
          state: "BY",
          typePublic: true,
        },
        { uid: "c2", name: "Banks", nameAuto: false, id: "at-bank", country: "AT", typeBank: true },
      ],
    };
    const { internal, stub } = setup({}, config);
    await internal.onReady();

    expect(stub.states.get("public-holidays.0.de-by-public.today.isHoliday")).toEqual({ val: true, ack: true });
    expect(stub.objects.get("public-holidays.0.at-bank")).toMatchObject({ type: "folder", native: { uid: "c2" } });
    expect(stub.states.size).toBe(2 * STATE_COUNT);
    const summary = logsOf(stub, "info");
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatch(/^de-by-public: Today: New Year's Day, next holiday: .*; at-bank: Today: /);
  });

  it("the first start after the update takes the single calendar of 0.20.x into the list in ONE write and stands down", async () => {
    const { internal, stub } = setup({}, LEGACY);
    stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "schedule" },
      native: structuredClone(LEGACY),
    });

    await internal.onReady();

    expect(stub.instanceObjectWrites).toBe(1);
    const native = stub.objects.get("system.adapter.public-holidays.0")!.native!;
    expect(native.calendars).toEqual([
      {
        uid: "c1",
        name: "",
        nameAuto: true,
        id: "de-by-public-school",
        country: "DE",
        state: "BY",
        region: "",
        typePublic: true,
        typeBank: false,
        typeSchool: true,
        typeOptional: false,
        typeObservance: false,
        excludeHolidays: ["01-06"],
        includeBridgeDays: true,
      },
    ]);
    // every old key cleared in the same write — js-controller never deletes a native key
    for (const key of [
      "country",
      "state",
      "region",
      "typePublic",
      "typeSchool",
      "excludeHolidays",
      "includeBridgeDays",
    ]) {
      expect(native).toHaveProperty(key, null);
    }
    expect(stub.states.size).toBe(0);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("the start after the takeover runs the calendar under its standard folder and writes no settings", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T12:00:00"));
    const first = setup({}, LEGACY);
    first.stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "schedule" },
      native: structuredClone(LEGACY),
    });
    await first.internal.onReady();
    const db = first.stub.objects;

    const migrated = db.get("system.adapter.public-holidays.0")!.native!;
    const second = setup({}, structuredClone(migrated));
    second.stub.objects = db;
    await second.internal.onReady();

    expect(second.stub.instanceObjectWrites).toBe(0);
    expect(second.stub.states.get("public-holidays.0.de-by-public-school.today.isHoliday")).toEqual({
      val: true,
      ack: true,
    });
    // the folder carries the standard name in the system language (English without system.config)
    expect(db.get("public-holidays.0.de-by-public-school")?.common?.name).toBe("Germany · Bayern");
  });

  it("removes the folder of a deleted calendar; a folder without a calendar uid and one that is still to move stay", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("public-holidays.0.gone", { type: "folder", common: { name: "Gone" }, native: { uid: "c9" } });
    stub.objects.set("public-holidays.0.gone.next", { type: "channel", common: { name: "next" } });
    stub.objects.set("public-holidays.0.mine", { type: "folder", common: { name: "Mine" }, native: {} });
    // calendar c1 publishes under "cal" now — its old folder is the move master's work, never deleted here
    stub.objects.set("public-holidays.0.old", { type: "folder", common: { name: "Old" }, native: { uid: "c1" } });

    await internal.onReady();

    expect(stub.objects.has("public-holidays.0.gone")).toBe(false);
    expect(stub.objects.has("public-holidays.0.gone.next")).toBe(false);
    expect(stub.objects.has("public-holidays.0.mine")).toBe(true);
    expect(stub.objects.has("public-holidays.0.old")).toBe(true);
    // the run waits for the removal's report line before it stops
    expect(stub.delays).toHaveLength(1);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("leaves the tree of 0.20.x at the instance root alone — its move is the move master's", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("public-holidays.0.today", { type: "channel", common: { name: "today" } });
    stub.objects.set("public-holidays.0.today.isHoliday", { type: "state", common: { name: "isHoliday" } });

    await internal.onReady();

    expect(stub.objects.has("public-holidays.0.today")).toBe(true);
    expect(stub.objects.has("public-holidays.0.today.isHoliday")).toBe(true);
    expect(stub.delays).toHaveLength(0);
  });

  it("a damaged calendar list changes nothing and ends the start as a settings error", async () => {
    const { internal, stub } = setup({}, { calendars: "broken" });
    stub.objects.set("public-holidays.0.cal", { type: "folder", common: { name: "Test" }, native: { uid: "c1" } });
    stub.supportsFeature = vi.fn(() => true);
    stub.getPluginInstance = vi.fn(() => null);
    const text =
      "The calendar list in the settings is damaged — nothing was changed; open the adapter settings and save them";

    await internal.onReady();

    expect(logsOf(stub, "warn")).toEqual([]);
    expect(logsOf(stub, "error")).toEqual([`Settings: ${text}`]);
    expect(stub.notifications).toEqual([{ scope: "public-holidays", category: "userActionRequired", message: text }]);
    expect(stub.terminate).toHaveBeenCalledTimes(1);
    expect(stub.terminate).toHaveBeenCalledWith(text, 11);
    // the user's settings, not an adapter defect — nothing goes to Sentry
    expect(stub.getPluginInstance).not.toHaveBeenCalled();
    expect(stub.objects.has("public-holidays.0.cal")).toBe(true);
    expect(stub.objectWrites).toBe(0);
    expect(stub.states.size).toBe(0);
    expect(stub.stop).not.toHaveBeenCalled();
  });

  it("skips a calendar without a valid id and the second of an id held twice, and runs the others", async () => {
    const config = {
      calendars: [
        { uid: "c1", name: "A", id: "cal", country: "DE", typePublic: true },
        { uid: "c2", name: "B", id: "Not Valid", country: "DE", typePublic: true },
        { uid: "c3", name: "C", id: "cal", country: "AT", typePublic: true },
      ],
    };
    const { internal, stub } = setup({}, config);

    await internal.onReady();

    expect(logsOf(stub, "warn")).toEqual([
      "Calendar 2 has no valid id ('Not Valid') — skipped; open the adapter settings",
      "Calendar 3 uses the id 'cal' of a calendar above it — skipped; open the adapter settings",
    ]);
    expect(stub.states.size).toBe(STATE_COUNT);
    expect(stub.objects.get(CAL)?.native).toEqual({ uid: "c1" });
  });

  it("an empty list says so and publishes nothing", async () => {
    const { internal, stub } = setup({}, { calendars: [] });

    await internal.onReady();

    expect(logsOf(stub, "warn")).toEqual(["No calendar is set up — add one in the adapter settings"]);
    expect(stub.states.size).toBe(0);
    expect(logsOf(stub, "info")).toEqual([]);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });
});
