import { describe, expect, it } from "vitest";
import Holidays from "date-holidays";
import {
  beats,
  bridgeDayName,
  BRIDGE_DAY_NAMES,
  enabledTypeKeys,
  HOLIDAY_TYPES,
  shiftKey,
  toHolidayId,
  typeRank,
} from "./holiday-shared";
import { computeHolidays } from "./holiday-engine";
import type { AdapterConfig } from "./types";

function makeConfig(overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    country: "DE",
    state: "",
    region: "",
    holidayTypes: ["public"],
    excludeHolidays: [],
    includeBridgeDays: false,
    ...overrides,
  };
}

// ─── the collision rule (audit finding F6) ──────────────────────────────────

describe("beats — which holiday survives a shared date", () => {
  it("prefers the higher-priority type", () => {
    expect(beats({ type: "public", id: "zzz" }, { type: "bank", id: "aaa" })).toBe(true);
    expect(beats({ type: "bank", id: "aaa" }, { type: "public", id: "zzz" })).toBe(false);
  });

  it("prefers a real holiday over a substitute of the same type", () => {
    expect(beats({ type: "public", id: "zzz" }, { type: "public", substitute: true, id: "aaa" })).toBe(true);
    expect(beats({ type: "public", substitute: true, id: "aaa" }, { type: "public", id: "zzz" })).toBe(false);
  });

  it("falls back to the smaller id — the only tiebreak left for two substitutes", () => {
    expect(
      beats({ type: "public", substitute: true, id: "aaa" }, { type: "public", substitute: true, id: "bbb" }),
    ).toBe(true);
    expect(
      beats({ type: "public", substitute: true, id: "bbb" }, { type: "public", substitute: true, id: "aaa" }),
    ).toBe(false);
  });

  it("is a total order — never reports both directions as winners", () => {
    const candidates = [
      { type: "public", id: "a" },
      { type: "public", substitute: true, id: "a" },
      { type: "bank", id: "a" },
      { type: "public", id: "b" },
      { type: "observance", substitute: true, id: "z" },
    ];
    for (const a of candidates) {
      for (const b of candidates) {
        if (a === b) {
          continue;
        }
        expect(beats(a, b) && beats(b, a), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(false);
      }
    }
  });

  it("never displaces an identical entry (a stable map keeps the first)", () => {
    const h = { type: "public", id: "same" };
    expect(beats(h, { ...h })).toBe(false);
  });
});

// The rule only matters because real data collides. These two cases USED to be decided by the
// order date-holidays happened to emit them in, and both landed on the substitute.
describe("real collisions resolve to the day that genuinely belongs there", () => {
  it("AL 2027-11-29: Liberation Day beats the moved Independence Day", () => {
    const computed = computeHolidays(makeConfig({ country: "AL" }), ["en"], {
      referenceDate: new Date("2027-11-28T12:00:00"),
    });
    expect(computed.tomorrow.name).toBe("Liberation Day");
  });

  it("TW 2027-04-05: Tomb Sweeping Day beats the moved Children's Day", () => {
    const computed = computeHolidays(makeConfig({ country: "TW" }), ["en"], {
      referenceDate: new Date("2027-04-05T12:00:00"),
    });
    expect(computed.today.name).toBe("Tomb Sweeping Day");
  });

  it("the winner does not depend on the order date-holidays emits", () => {
    // Feed the same two holidays in both orders through the rule and demand one answer.
    const hd = new Holidays("NO");
    hd.setLanguages(["en"]);
    const clash = hd
      .getHolidays(2027)
      .filter(h => h.date.substring(0, 10) === "2027-05-17" && h.type === "public")
      .map(h => ({ type: h.type, substitute: h.substitute, id: toHolidayId(h.name, h.rule), name: h.name }));
    expect(clash.length).toBe(2);

    const winnerOf = (list: typeof clash): string => list.reduce((best, c) => (beats(c, best) ? c : best)).name;
    expect(winnerOf(clash)).toBe(winnerOf([...clash].reverse()));
  });
});

// ─── the rest of the shared surface ─────────────────────────────────────────

describe("typeRank", () => {
  it("ranks the five known types in manifest order", () => {
    expect(HOLIDAY_TYPES.map(t => typeRank(t.key))).toEqual([0, 1, 2, 3, 4]);
  });

  it("ranks an unknown type (bridge days) last", () => {
    expect(typeRank("bridge")).toBe(HOLIDAY_TYPES.length);
  });
});

describe("enabledTypeKeys", () => {
  it("treats an unset flag as the admin default", () => {
    expect(enabledTypeKeys(() => undefined)).toEqual(["public"]);
  });

  it("honours an explicit false on a default-on type", () => {
    expect(enabledTypeKeys(flag => (flag === "typePublic" ? false : undefined))).toEqual([]);
  });

  it("needs an explicit true for a default-off type", () => {
    expect(enabledTypeKeys(flag => (flag === "typeBank" ? true : undefined))).toEqual(["public", "bank"]);
  });
});

describe("bridgeDayName", () => {
  it("covers every language the adapter supports", () => {
    expect(Object.keys(BRIDGE_DAY_NAMES).sort()).toEqual(
      ["de", "en", "es", "fr", "it", "nl", "pl", "pt", "ru", "uk", "zh"].sort(),
    );
  });

  it("reduces a language tag to its base language", () => {
    expect(bridgeDayName("zh-cn")).toBe(BRIDGE_DAY_NAMES.zh);
    expect(bridgeDayName("de-DE")).toBe(BRIDGE_DAY_NAMES.de);
  });

  it("falls back to English for an unknown language", () => {
    expect(bridgeDayName("xx")).toBe(BRIDGE_DAY_NAMES.en);
  });
});

describe("shiftKey", () => {
  it("crosses a month boundary", () => {
    expect(shiftKey("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("crosses a year boundary backwards", () => {
    expect(shiftKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("survives the spring DST switch (Europe/Berlin, 2026-03-29)", () => {
    expect(shiftKey("2026-03-28", 1)).toBe("2026-03-29");
    expect(shiftKey("2026-03-29", 1)).toBe("2026-03-30");
  });
});
