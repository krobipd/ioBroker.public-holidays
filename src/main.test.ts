/**
 * Orchestration tests for main.ts — onReady flow (mode migration, country
 * detection chain, compute → publish → stop) and the validateConfig matrix.
 * Fleet harness pattern: `@iobroker/adapter-core` is mocked with a stub Adapter
 * class; everything else (holiday-engine with the real date-holidays data,
 * i18n, state-publisher) runs for REAL against the stub object store.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => {
  interface ObjEntry {
    type?: string;
    common?: Record<string, unknown>;
    native?: Record<string, unknown>;
  }

  class StubAdapter {
    namespace = "public-holidays.0";
    adapterDir = "/stub-adapter-dir";
    config: Record<string, unknown> = {};
    objects = new Map<string, ObjEntry>();
    states = new Map<string, { val: unknown; ack: boolean }>();
    logs: { level: string; msg: string }[] = [];
    stop = vi.fn();
    /** How often the instance's OWN object was written — every write costs a restart. */
    instanceObjectWrites = 0;
    /** Simulates a broker hiccup on the next instance-object read. */
    failNextForeignObjectRead = false;

    log = {
      debug: (m: string): void => void this.logs.push({ level: "debug", msg: m }),
      info: (m: string): void => void this.logs.push({ level: "info", msg: m }),
      warn: (m: string): void => void this.logs.push({ level: "warn", msg: m }),
      error: (m: string): void => void this.logs.push({ level: "error", msg: m }),
    };

    constructor(_options?: unknown) {}

    on(_event: string, _cb: (...args: unknown[]) => unknown): this {
      return this;
    }

    private fullId(id: string): string {
      return id.startsWith("system.") || id.startsWith(`${this.namespace}.`) ? id : `${this.namespace}.${id}`;
    }

    getForeignObjectAsync(id: string): Promise<ObjEntry | null> {
      if (this.failNextForeignObjectRead) {
        this.failNextForeignObjectRead = false;
        return Promise.reject(new Error("objects db unreachable"));
      }
      return Promise.resolve(this.objects.get(id) ?? null);
    }

    extendForeignObjectAsync(id: string, obj: Partial<ObjEntry>): Promise<void> {
      if (id === `system.adapter.${this.namespace}`) {
        this.instanceObjectWrites++;
      }
      const existing = this.objects.get(id) ?? {};
      this.objects.set(id, {
        ...existing,
        ...obj,
        common: { ...(existing.common ?? {}), ...(obj.common ?? {}) },
        native: { ...(existing.native ?? {}), ...(obj.native ?? {}) },
      });
      return Promise.resolve();
    }

    getObjectAsync(id: string): Promise<ObjEntry | null> {
      return Promise.resolve(this.objects.get(this.fullId(id)) ?? null);
    }

    delObjectAsync(id: string): Promise<void> {
      this.objects.delete(this.fullId(id));
      return Promise.resolve();
    }

    extendObjectAsync(id: string, obj: Partial<ObjEntry>, _options?: unknown): Promise<void> {
      const full = this.fullId(id);
      const existing = this.objects.get(full) ?? {};
      this.objects.set(full, {
        ...existing,
        ...obj,
        common: { ...(existing.common ?? {}), ...(obj.common ?? {}) },
        native: { ...(existing.native ?? {}), ...(obj.native ?? {}) },
      });
      return Promise.resolve();
    }

    setStateChangedAsync(id: string, val: unknown, ack: boolean): Promise<void> {
      this.states.set(this.fullId(id), { val, ack });
      return Promise.resolve();
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

import { PublicHolidaysAdapter } from "./main";
import type { AdapterConfig } from "./lib/types";

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
  stop: ReturnType<typeof vi.fn>;
  instanceObjectWrites: number;
  failNextForeignObjectRead: boolean;
  extendObjectAsync: (id: string, obj: Partial<ObjEntry>, options?: unknown) => Promise<void>;
}

/** Typed access to the private members the orchestration tests drive. */
interface Internal {
  onReady: () => Promise<void>;
  validateConfig: (fallbackCountry?: string) => AdapterConfig | null;
}

function setup(config: Record<string, unknown> = {}): {
  adapter: PublicHolidaysAdapter;
  internal: Internal;
  stub: StubSurface;
} {
  const adapter = new PublicHolidaysAdapter();
  const stub = adapter as unknown as StubSurface;
  const internal = adapter as unknown as Internal;
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
    // German system language → German holiday names (resolveLanguages chain).
    stub.objects.set("system.config", { common: { language: "de" } });

    await internal.onReady();

    expect(stub.states.get("public-holidays.0.today.isHoliday")).toEqual({ val: true, ack: true });
    expect(stub.states.get("public-holidays.0.today.name")?.val).toBe("Neujahr");
    expect(stub.states.get("public-holidays.0.next.date")?.val).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof stub.states.get("public-holidays.0.next.daysUntil")?.val).toBe("number");
    expect(stub.states.size).toBe(12);
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
    expect(logsOf(good.stub, "warn").some(m => m.includes("no longer match"))).toBe(false);

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

    expect(stub.states.get("public-holidays.0.today.isHoliday")).toEqual({ val: false, ack: true });
    expect(stub.states.get("public-holidays.0.today.name")).toEqual({ val: "", ack: true });
    expect(stub.states.get("public-holidays.0.next.isHoliday")?.val).toBe(true);
  });

  it("creates all 17 objects (5 channels + 12 states)", async () => {
    const { internal, stub } = setup({ country: "DE" });
    await internal.onReady();
    const own = [...stub.objects.keys()].filter(id => id.startsWith("public-holidays.0."));
    expect(own).toHaveLength(17);
  });

  it("logs the Today/next-holiday summary at info on a holiday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T12:00:00"));
    const { internal, stub } = setup({ country: "DE" });
    await internal.onReady();
    expect(logsOf(stub, "info").some(m => m.startsWith("Today: ") && m.includes("next holiday: "))).toBe(true);
  });

  it("logs the next-holiday summary at info on a normal day too, so it shows on every run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-10T12:00:00"));
    const { internal, stub } = setup({ country: "DE" });
    await internal.onReady();
    expect(logsOf(stub, "info").some(m => m.startsWith("Today: no holiday") && m.includes("next holiday: "))).toBe(
      true,
    );
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
    expect(stub.states.get("public-holidays.0.today.isHoliday")).toBeUndefined();
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("switches a leftover stopInstance flag off and stands down", async () => {
    // With the flag set the host kills the process a second after asking it to stop —
    // in the middle of a holiday run, and this adapter has no message handler to answer with.
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.adapter.public-holidays.0", {
      type: "instance",
      common: { mode: "schedule", supportedMessages: { stopInstance: true } },
      native: {},
    });

    await internal.onReady();

    const inst = stub.objects.get("system.adapter.public-holidays.0")!;
    expect(inst.common!.supportedMessages).toEqual({ stopInstance: false });
    expect(logsOf(stub, "info").some(m => m.includes("restarts once"))).toBe(true);
    expect(stub.states.get("public-holidays.0.today.isHoliday")).toBeUndefined();
    expect(stub.stop).toHaveBeenCalledTimes(1);
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
    expect(inst.common!.supportedMessages).toEqual({ stopInstance: false });
    expect(stub.instanceObjectWrites).toBe(1);
  });

  it("does not touch a healthy instance object and computes normally", async () => {
    const { internal, stub } = setup({ country: "DE" });

    await internal.onReady();

    expect(logsOf(stub, "info").some(m => m.includes("Migrating"))).toBe(false);
    expect(logsOf(stub, "info").some(m => m.includes("restarts once"))).toBe(false);
    expect(stub.instanceObjectWrites).toBe(0);
    expect(stub.states.get("public-holidays.0.today.isHoliday")).toBeDefined();
  });

  it("computes normally when the instance object cannot be read", async () => {
    // A broker hiccup must not cost the daily run — the next run retries the repair.
    const { internal, stub } = setup({ country: "DE" });
    stub.failNextForeignObjectRead = true;

    await internal.onReady();

    expect(stub.states.get("public-holidays.0.today.isHoliday")).toBeDefined();
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

    expect(logsOf(stub, "info").some(m => m.includes("Using system country: AT"))).toBe(true);
    // Oct 26 (Nationalfeiertag) is public in AT but not DE — asserting today=holiday
    // proves the resolved AT data actually flowed through compute, not just detection.
    expect(stub.states.get("public-holidays.0.today.isHoliday")?.val).toBe(true);
    expect(stub.states.get("public-holidays.0.today.name")?.val).not.toBe("");
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("explicit config country wins over the system country", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.objects.set("system.config", { common: { country: "Austria", language: "de" } });

    await internal.onReady();

    expect(logsOf(stub, "info").some(m => m.includes("Using system country"))).toBe(false);
  });

  it("warns and stops when no country is configured and none can be detected", async () => {
    const { internal, stub } = setup({});

    await internal.onReady();

    expect(logsOf(stub, "warn").some(m => m.includes("No country configured"))).toBe(true);
    expect(stub.states.size).toBe(0);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });

  it("warns and stops when the system country name cannot be resolved", async () => {
    const { internal, stub } = setup({});
    stub.objects.set("system.config", { common: { country: "Atlantis", language: "de" } });

    await internal.onReady();

    expect(logsOf(stub, "warn").some(m => m.includes("No country configured"))).toBe(true);
    expect(stub.states.size).toBe(0);
  });

  it("warns when the configured country yields zero raw holidays (A3)", async () => {
    const { internal, stub } = setup({ country: "XX" });

    await internal.onReady();

    expect(logsOf(stub, "warn").some(m => m.includes("'XX' is not recognized"))).toBe(true);
    // Still publishes (empty) states and stops cleanly.
    expect(stub.states.size).toBe(12);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });
});

describe("onReady — error handling", () => {
  it("catches errors, logs onReady failed and STILL stops", async () => {
    const { internal, stub } = setup({ country: "DE" });
    stub.extendObjectAsync = () => {
      return Promise.reject(new Error("broker write refused"));
    };

    await internal.onReady();

    expect(logsOf(stub, "error").some(m => m.includes("onReady failed: broker write refused"))).toBe(true);
    expect(stub.stop).toHaveBeenCalledTimes(1);
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

  it("warns when a configured exclude no longer matches any holiday", async () => {
    const { internal, stub } = setup({ country: "DE", excludeHolidays: ["bogus_stale_exclude"] });

    await internal.onReady();

    expect(logsOf(stub, "warn").some(m => m.includes("no longer match any holiday"))).toBe(true);
    expect(stub.stop).toHaveBeenCalledTimes(1);
  });
});

describe("validateConfig", () => {
  it("returns null without a country (no fallback)", () => {
    const { internal } = setup({});
    expect(internal.validateConfig()).toBeNull();
  });

  it("uses the fallback country when config has none", () => {
    const { internal } = setup({});
    expect(internal.validateConfig("AT")?.country).toBe("AT");
  });

  it("trims the configured country and prefers it over the fallback", () => {
    const { internal } = setup({ country: "  DE  " });
    expect(internal.validateConfig("AT")?.country).toBe("DE");
  });

  it("defaults to public holidays only (typePublic unset)", () => {
    const { internal } = setup({ country: "DE" });
    expect(internal.validateConfig()?.holidayTypes).toEqual(["public"]);
  });

  it("typePublic=false removes public; explicit true flags add their types", () => {
    const { internal } = setup({
      country: "DE",
      typePublic: false,
      typeBank: true,
      typeSchool: true,
      typeOptional: true,
      typeObservance: true,
    });
    expect(internal.validateConfig()?.holidayTypes).toEqual(["bank", "school", "optional", "observance"]);
  });

  it("non-boolean type flags are NOT treated as enabled (strict === true)", () => {
    const { internal } = setup({ country: "DE", typeBank: "true", typeSchool: 1 });
    expect(internal.validateConfig()?.holidayTypes).toEqual(["public"]);
  });

  it("takes excludeHolidays only (legacy per-type exclude keys are ignored) and drops non-strings", () => {
    const { internal } = setup({
      country: "DE",
      // Legacy keys from the pre-0.9.0 per-type exclude UI — no admin field writes these
      // anymore; validateConfig must NOT merge them back in.
      excludePublic: ["legacy_ignored"],
      excludeBank: ["legacy_ignored_too"],
      excludeHolidays: ["a", 42, "b", null],
    });
    expect(internal.validateConfig()?.excludeHolidays).toEqual(["a", "b"]);
  });

  it("state/region default to empty strings and get trimmed", () => {
    const { internal } = setup({ country: "DE", state: " BY ", region: 7 });
    const cfg = internal.validateConfig()!;
    expect(cfg.state).toBe("BY");
    expect(cfg.region).toBe("");
  });

  it("includeBridgeDays only on strict boolean true", () => {
    const { internal: a } = setup({ country: "DE", includeBridgeDays: true });
    const { internal: b } = setup({ country: "DE", includeBridgeDays: "true" });
    expect(a.validateConfig()?.includeBridgeDays).toBe(true);
    expect(b.validateConfig()?.includeBridgeDays).toBe(false);
  });
});
