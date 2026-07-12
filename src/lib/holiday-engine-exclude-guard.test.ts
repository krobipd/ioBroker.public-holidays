import { beforeEach, describe, expect, it, vi } from "vitest";

// Count every `new Holidays(...)` construction so we can prove the exclude guard skips the
// country-wide aggregation (base + one instance per state and region — dozens of them) when
// there are no excludes to validate. Without the guard the first test would see ~25 instances.
const { ctor } = vi.hoisted(() => ({ ctor: { count: 0 } }));
vi.mock("date-holidays", async importActual => {
  const actual = await importActual<{ default: new (...a: unknown[]) => object }>();
  const Real = actual.default;
  return {
    default: class extends Real {
      constructor(...args: unknown[]) {
        super(...args);
        ctor.count++;
      }
    },
  };
});

import { computeHolidays } from "./holiday-engine";
import type { AdapterConfig } from "./types";

function cfg(over: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    country: "DE",
    state: "",
    region: "",
    holidayTypes: ["public"],
    excludeHolidays: [],
    includeBridgeDays: false,
    ...over,
  };
}

describe("exclude guard — country-wide aggregation only runs when there are excludes", () => {
  beforeEach(() => {
    ctor.count = 0;
  });

  it("no excludes → skips the aggregation (single Holidays instance)", () => {
    const result = computeHolidays(cfg({ excludeHolidays: [] }), ["en"], { referenceDate: new Date("2026-01-01") });
    expect(result.unmatchedExcludes).toEqual([]);
    // Only createHolidaysInstance() — no per-state/region enumeration.
    expect(ctor.count).toBe(1);
  });

  it("with excludes → runs the aggregation (many Holidays instances) and still warns correctly", () => {
    const result = computeHolidays(cfg({ excludeHolidays: ["totally_fake_id"] }), ["en"], {
      referenceDate: new Date("2026-01-01"),
    });
    expect(result.unmatchedExcludes).toEqual(["totally_fake_id"]);
    // base + country + every state + every region.
    expect(ctor.count).toBeGreaterThan(1);
  });

  it("runs the aggregation once regardless of exclude count (no per-exclude blowup)", () => {
    ctor.count = 0;
    computeHolidays(cfg({ excludeHolidays: ["fake_a"] }), ["en"], { referenceDate: new Date("2026-01-01") });
    const withOneExclude = ctor.count;
    ctor.count = 0;
    computeHolidays(cfg({ excludeHolidays: ["fake_a", "fake_b", "fake_c"] }), ["en"], {
      referenceDate: new Date("2026-01-01"),
    });
    const withThreeExcludes = ctor.count;
    // collectCountryWideIds must be hoisted out of the filter → identical instance count,
    // not one full aggregation per exclude id.
    expect(withThreeExcludes).toBe(withOneExclude);
  });
});
