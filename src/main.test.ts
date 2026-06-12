/**
 * Orchestration tests for main.ts — onReady flow (mode migration, country
 * detection chain, compute → publish → stop) and the validateConfig matrix.
 * Fleet harness pattern: @iobroker/adapter-core is mocked with a stub Adapter
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

    async getForeignObjectAsync(id: string): Promise<ObjEntry | null> {
      return this.objects.get(id) ?? null;
    }

    async extendForeignObjectAsync(id: string, obj: Partial<ObjEntry>): Promise<void> {
      const existing = this.objects.get(id) ?? {};
      this.objects.set(id, {
        ...existing,
        ...obj,
        common: { ...(existing.common ?? {}), ...(obj.common ?? {}) },
        native: { ...(existing.native ?? {}), ...(obj.native ?? {}) },
      });
    }

    async getObjectAsync(id: string): Promise<ObjEntry | null> {
      return this.objects.get(this.fullId(id)) ?? null;
    }

    async delObjectAsync(id: string): Promise<void> {
      this.objects.delete(this.fullId(id));
    }

    async extendObjectAsync(id: string, obj: Partial<ObjEntry>, _options?: unknown): Promise<void> {
      const full = this.fullId(id);
      const existing = this.objects.get(full) ?? {};
      this.objects.set(full, {
        ...existing,
        ...obj,
        common: { ...(existing.common ?? {}), ...(obj.common ?? {}) },
        native: { ...(existing.native ?? {}), ...(obj.native ?? {}) },
      });
    }

    async setStateChangedAsync(id: string, val: unknown, ack: boolean): Promise<void> {
      this.states.set(this.fullId(id), { val, ack });
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

    expect(stub.states.get("public-holidays.0.today.boolean")).toEqual({ val: true, ack: true });
    expect(stub.states.get("public-holidays.0.today.name")?.val).toBe("Neujahr");
    expect(stub.states.get("public-holidays.0.next.date")?.val).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof stub.states.get("public-holidays.0.next.daysUntil")?.val).toBe("number");
    expect(stub.states.size).toBe(12);
    expect(stub.stop).toHaveBeenCalledTimes(1);
    expect(logsOf(stub, "error")).toEqual([]);
  });

  it("publishes false/empty day states on a normal workday", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-03-10T12:00:00"));
    const { internal, stub } = setup({ country: "DE" });

    await internal.onReady();

    expect(stub.states.get("public-holidays.0.today.boolean")).toEqual({ val: false, ack: true });
    expect(stub.states.get("public-holidays.0.today.name")).toEqual({ val: "", ack: true });
    expect(stub.states.get("public-holidays.0.next.boolean")?.val).toBe(true);
  });

  it("creates all 17 objects (5 channels + 12 states)", async () => {
    const { internal, stub } = setup({ country: "DE" });
    await internal.onReady();
    const own = [...stub.objects.keys()].filter(id => id.startsWith("public-holidays.0."));
    expect(own).toHaveLength(17);
  });

  it("logs the Today/next summary line", async () => {
    const { internal, stub } = setup({ country: "DE" });
    await internal.onReady();
    expect(logsOf(stub, "info").some(m => m.startsWith("Today: ") && m.includes("next: "))).toBe(true);
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

describe("onReady — daemon → schedule migration", () => {
  it("migrates a daemon-mode instance to schedule mode", async () => {
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
  });

  it("does not touch an instance already in schedule mode", async () => {
    const { internal, stub } = setup({ country: "DE" });
    await internal.onReady();
    expect(logsOf(stub, "info").some(m => m.includes("Migrating"))).toBe(false);
  });
});

describe("onReady — country detection chain", () => {
  it("uses the system country (ISO name resolved to code) when nothing is configured", async () => {
    const { internal, stub } = setup({});
    stub.objects.set("system.config", { common: { country: "Austria", language: "de" } });

    await internal.onReady();

    expect(logsOf(stub, "info").some(m => m.includes("Using system country: AT"))).toBe(true);
    // Oct 26 (Nationalfeiertag) only exists for AT — verify AT data was really used.
    expect(stub.states.get("public-holidays.0.next.date")?.val).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
    stub.extendObjectAsync = async () => {
      throw new Error("broker write refused");
    };

    await internal.onReady();

    expect(logsOf(stub, "error").some(m => m.includes("onReady failed: broker write refused"))).toBe(true);
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

  it("merges all 6 exclude sources and drops non-string entries", () => {
    const { internal } = setup({
      country: "DE",
      excludePublic: ["a", 42],
      excludeBank: ["b"],
      excludeSchool: "not-an-array",
      excludeOptional: ["c", null],
      excludeObservance: [],
      excludeHolidays: ["d"],
    });
    expect(internal.validateConfig()?.excludeHolidays).toEqual(["a", "b", "c", "d"]);
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
