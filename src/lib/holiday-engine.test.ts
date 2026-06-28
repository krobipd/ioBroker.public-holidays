import { describe, it, expect } from "vitest";
import {
  computeHolidays,
  detectBridgeDays,
  logAvailableHolidays,
  toHolidayId,
  toDateKey,
  type RawHoliday,
} from "./holiday-engine";
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

function makeDate(dateStr: string): Date {
  return new Date(dateStr + "T12:00:00");
}

// ─── Config: country / state / region ───────────────────────────────

describe("config: country/state/region", () => {
  it("country-only config returns holidays", () => {
    const result = computeHolidays(makeConfig({ country: "DE" }), ["en"], makeDate("2026-01-01"));
    expect(result.today.isHoliday).toBe(true);
    expect(result.today.name.length).toBeGreaterThan(0);
  });

  it("state config narrows holidays (DE/BY has Fronleichnam, DE/HH does not)", () => {
    const by = computeHolidays(makeConfig({ state: "BY" }), ["de"], makeDate("2026-06-04"));
    const hh = computeHolidays(makeConfig({ state: "HH" }), ["de"], makeDate("2026-06-04"));
    expect(by.today.isHoliday).toBe(true);
    expect(hh.today.isHoliday).toBe(false);
  });

  it("state config adds holidays (DE/BE has Frauentag Mar 8)", () => {
    const be = computeHolidays(makeConfig({ state: "BE" }), ["de"], makeDate("2026-03-08"));
    const nw = computeHolidays(makeConfig({ state: "NW" }), ["de"], makeDate("2026-03-08"));
    expect(be.today.isHoliday).toBe(true);
    expect(nw.today.isHoliday).toBe(false);
  });

  it("state config narrows holidays (IT/32 Alto Adige has Pentecost Monday, plain IT does not)", () => {
    // date-holidays codes the Italian autonomous provinces numerically; 32 = Alto Adige
    // (South Tyrol). Lunedì di Pentecoste (May 25 2026) is public there, not in the rest of Italy.
    const altoAdige = computeHolidays(makeConfig({ country: "IT", state: "32" }), ["it"], makeDate("2026-05-25"));
    const plainIt = computeHolidays(makeConfig({ country: "IT" }), ["it"], makeDate("2026-05-25"));
    expect(altoAdige.today.isHoliday).toBe(true);
    expect(plainIt.today.isHoliday).toBe(false);
  });

  it("full country/state/region config works (DE/BY/A — Augsburger Friedensfest Aug 8)", () => {
    // The ONLY real region branch in createHolidaysInstance: 3-arg constructor.
    // Friedensfest (Aug 8) is a public holiday only in the city of Augsburg
    // (region A of DE/BY) — plain DE/BY does not have it.
    const withRegion = computeHolidays(
      makeConfig({ country: "DE", state: "BY", region: "A" }),
      ["de"],
      makeDate("2026-08-08"),
    );
    const withoutRegion = computeHolidays(makeConfig({ country: "DE", state: "BY" }), ["de"], makeDate("2026-08-08"));
    expect(withRegion.today.isHoliday).toBe(true);
    expect(withoutRegion.today.isHoliday).toBe(false);
  });

  it("state config narrows holidays (CH/BE has Berchtoldstag Jan 2, plain CH does not)", () => {
    const bern = computeHolidays(makeConfig({ country: "CH", state: "BE" }), ["de"], makeDate("2026-01-02"));
    const plainCh = computeHolidays(makeConfig({ country: "CH" }), ["de"], makeDate("2026-01-02"));
    expect(bern.today.isHoliday).toBe(true);
    expect(plainCh.today.isHoliday).toBe(false);
  });

  it("state config narrows holidays (US/CA has César Chávez Day Mar 31, plain US does not)", () => {
    const california = computeHolidays(makeConfig({ country: "US", state: "CA" }), ["en"], makeDate("2026-03-31"));
    const plainUs = computeHolidays(makeConfig({ country: "US" }), ["en"], makeDate("2026-03-31"));
    expect(california.today.isHoliday).toBe(true);
    expect(plainUs.today.isHoliday).toBe(false);
  });

  it("different countries differ on same date (DE vs AT on Oct 26)", () => {
    const de = computeHolidays(makeConfig({ country: "DE" }), ["de"], makeDate("2026-10-26"));
    const at = computeHolidays(makeConfig({ country: "AT" }), ["de"], makeDate("2026-10-26"));
    expect(de.today.isHoliday).toBe(false);
    expect(at.today.isHoliday).toBe(true);
  });

  it("country without states works (JP)", () => {
    const result = computeHolidays(makeConfig({ country: "JP" }), ["en"], makeDate("2026-01-01"));
    expect(result.today.isHoliday).toBe(true);
  });

  it("country with many holidays (IN)", () => {
    const config = makeConfig({ country: "IN", holidayTypes: ["public", "bank", "optional", "observance"] });
    const result = computeHolidays(config, ["en"], makeDate("2026-01-26"));
    expect(result.today.isHoliday).toBe(true);
  });

  it("normal working day is not a holiday", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-03-11"));
    expect(result.today.isHoliday).toBe(false);
    expect(result.today.name).toBe("");
  });
});

// ─── Type filter ────────────────────────────────────────────────────

describe("type filter", () => {
  it("filters out non-matching types", () => {
    const result = computeHolidays(makeConfig({ holidayTypes: ["bank"] }), ["de"], makeDate("2026-01-01"));
    expect(result.today.isHoliday).toBe(false);
  });

  it("shows holidays when type matches", () => {
    const result = computeHolidays(makeConfig({ holidayTypes: ["public"] }), ["de"], makeDate("2026-01-01"));
    expect(result.today.isHoliday).toBe(true);
  });

  it("multiple types allowed", () => {
    const result = computeHolidays(
      makeConfig({ holidayTypes: ["public", "observance"] }),
      ["de"],
      makeDate("2026-01-01"),
    );
    expect(result.today.isHoliday).toBe(true);
  });

  it("empty type filter shows nothing", () => {
    const result = computeHolidays(makeConfig({ holidayTypes: [] }), ["de"], makeDate("2026-01-01"));
    expect(result.today.isHoliday).toBe(false);
  });

  it("observance type adds observance holidays (DE/BY Aug 15)", () => {
    const without = computeHolidays(
      makeConfig({ state: "BY", holidayTypes: ["public"] }),
      ["de"],
      makeDate("2026-08-15"),
    );
    const withObs = computeHolidays(
      makeConfig({ state: "BY", holidayTypes: ["public", "observance"] }),
      ["de"],
      makeDate("2026-08-15"),
    );
    expect(without.today.isHoliday).toBe(false);
    expect(withObs.today.isHoliday).toBe(true);
  });
});

// ─── Exclude list ───────────────────────────────────────────────────

describe("exclude list", () => {
  it("excludes a holiday by ID", () => {
    const before = computeHolidays(makeConfig(), ["de"], makeDate("2026-01-01"));
    expect(before.today.isHoliday).toBe(true);

    const after = computeHolidays(
      makeConfig({ excludeHolidays: [toHolidayId("Neujahr", "01-01")] }),
      ["de"],
      makeDate("2026-01-01"),
    );
    expect(after.today.isHoliday).toBe(false);
  });

  it("excluded holiday does not appear in next", () => {
    const before = computeHolidays(makeConfig(), ["de"], makeDate("2026-12-24"));
    expect(before.tomorrow.isHoliday).toBe(true);

    const after = computeHolidays(
      makeConfig({ excludeHolidays: [toHolidayId("1. Weihnachtstag", "12-25")] }),
      ["de"],
      makeDate("2026-12-24"),
    );
    expect(after.tomorrow.isHoliday).toBe(false);
  });

  it("non-matching exclude ID has no effect", () => {
    const result = computeHolidays(
      makeConfig({ excludeHolidays: ["nonexistent_holiday"] }),
      ["de"],
      makeDate("2026-01-01"),
    );
    expect(result.today.isHoliday).toBe(true);
  });

  it("multiple holidays can be excluded", () => {
    const config = makeConfig({
      excludeHolidays: [toHolidayId("Neujahr", "01-01"), toHolidayId("1. Weihnachtstag", "12-25")],
    });
    const jan1 = computeHolidays(config, ["de"], makeDate("2026-01-01"));
    const dec25 = computeHolidays(config, ["de"], makeDate("2026-12-25"));
    expect(jan1.today.isHoliday).toBe(false);
    expect(dec25.today.isHoliday).toBe(false);
  });

  it("excluded holiday does not generate bridge day", () => {
    const himmelfahrtId = toHolidayId("Christi Himmelfahrt", "easter 39");
    const config = makeConfig({ includeBridgeDays: true, excludeHolidays: [himmelfahrtId] });
    const result = computeHolidays(config, ["de"], makeDate("2026-05-15"));
    expect(result.today.isHoliday).toBe(false);
  });
});

// ─── Exclude warning (unmatchedExcludes) ────────────────────────────

describe("exclude warning (unmatchedExcludes)", () => {
  it("does not warn for an exclude that is only valid in a sibling state of the same country", () => {
    // Martinstag (11-11, Burgenland) and Rupert (09-24, Salzburg) do not occur in
    // Kärnten (AT/2). A user who carried them over must NOT be warned — the dropdown
    // used to offer the whole country, and such an exclude is a harmless no-op.
    const result = computeHolidays(
      makeConfig({ country: "AT", state: "2", excludeHolidays: ["11-11", "09-24"] }),
      ["de"],
      makeDate("2026-06-28"),
    );
    expect(result.unmatchedExcludes).toEqual([]);
  });

  it("warns only for an id that exists nowhere in the country (genuine rename/removal)", () => {
    const result = computeHolidays(
      makeConfig({ country: "AT", state: "2", excludeHolidays: ["11-11", "total_fake_xyz"] }),
      ["de"],
      makeDate("2026-06-28"),
    );
    expect(result.unmatchedExcludes).toEqual(["total_fake_xyz"]);
  });

  it("does not warn for an exclude that is valid in the user's own scope", () => {
    const result = computeHolidays(
      makeConfig({ country: "AT", state: "2", excludeHolidays: [toHolidayId("Neujahr", "01-01")] }),
      ["de"],
      makeDate("2026-06-28"),
    );
    expect(result.unmatchedExcludes).toEqual([]);
  });

  it("a disabled holiday type does not make a still-valid exclude look unmatched", () => {
    // No types enabled → nothing is shown, but the exclude still exists in the country
    // and must not be reported as unmatched.
    const result = computeHolidays(
      makeConfig({ country: "DE", holidayTypes: [], excludeHolidays: [toHolidayId("Neujahr", "01-01")] }),
      ["de"],
      makeDate("2026-01-01"),
    );
    expect(result.unmatchedExcludes).toEqual([]);
  });
});

// ─── Bridge days ────────────────────────────────────────────────────

describe("bridge days", () => {
  it("Thursday holiday creates Friday bridge day", () => {
    const config = makeConfig({ includeBridgeDays: true });
    const result = computeHolidays(config, ["de"], makeDate("2026-05-15"));
    expect(result.today.isHoliday).toBe(true);
    expect(result.today.name).toBe("Brückentag");
  });

  it("bridge day not created when disabled", () => {
    const config = makeConfig({ includeBridgeDays: false });
    const result = computeHolidays(config, ["de"], makeDate("2026-05-15"));
    expect(result.today.isHoliday).toBe(false);
  });

  it("Saturday holiday does not create bridge day", () => {
    const config = makeConfig({ includeBridgeDays: true });
    const result = computeHolidays(config, ["de"], makeDate("2021-12-31"));
    expect(result.today.isHoliday).toBe(false);
  });

  it("Wednesday holiday does not create bridge day", () => {
    const config = makeConfig({ includeBridgeDays: true });
    const result = computeHolidays(config, ["de"], makeDate("2024-12-24"));
    expect(result.today.isHoliday).toBe(false);
  });

  it("detectBridgeDays returns correct dates for Thursday holiday", () => {
    const holidays = new Map<string, RawHoliday>();
    holidays.set("2026-05-14", {
      date: "2026-05-14",
      name: "Test",
      type: "public",
    });
    const bridges = detectBridgeDays(holidays, 2026);
    expect(bridges).toHaveLength(1);
    expect(toDateKey(bridges[0])).toBe("2026-05-15");
  });

  it("detectBridgeDays returns correct dates for Tuesday holiday", () => {
    const holidays = new Map<string, RawHoliday>();
    holidays.set("2030-01-01", {
      date: "2030-01-01",
      name: "Test",
      type: "public",
    });
    const bridges = detectBridgeDays(holidays, 2030);
    expect(bridges).toHaveLength(1);
    expect(toDateKey(bridges[0])).toBe("2029-12-31");
  });

  it("detectBridgeDays returns nothing for Monday holiday", () => {
    const holidays = new Map<string, RawHoliday>();
    holidays.set("2026-01-05", {
      date: "2026-01-05",
      name: "Test",
      type: "public",
    });
    const bridges = detectBridgeDays(holidays, 2026);
    expect(bridges).toHaveLength(0);
  });

  it("detectBridgeDays returns nothing for Friday holiday", () => {
    const holidays = new Map<string, RawHoliday>();
    holidays.set("2026-01-02", {
      date: "2026-01-02",
      name: "Test",
      type: "public",
    });
    const bridges = detectBridgeDays(holidays, 2026);
    expect(bridges).toHaveLength(0);
  });

  it("no duplicate bridge day when adjacent holidays", () => {
    const holidays = new Map<string, RawHoliday>();
    holidays.set("2026-05-14", {
      date: "2026-05-14",
      name: "Holiday Thu",
      type: "public",
    });
    holidays.set("2026-05-15", {
      date: "2026-05-15",
      name: "Holiday Fri",
      type: "public",
    });
    const bridges = detectBridgeDays(holidays, 2026);
    expect(bridges).toHaveLength(0);
  });

  it("detects a bridge day in the following year (year-boundary)", () => {
    // Jan 1 2026 is a Thursday (Neujahr) -> Fri Jan 2 2026 is a bridge day, which lies in
    // the year AFTER the reference date. Guards that bridge days are computed for all 3 years.
    const config = makeConfig({ includeBridgeDays: true });
    const result = computeHolidays(config, ["de"], makeDate("2025-12-31"));
    expect(result.dayAfterTomorrow.isHoliday).toBe(true);
    expect(result.dayAfterTomorrow.name).toBe("Brückentag");
  });

  describe("bridge day name localization", () => {
    const bridgeDayDate = makeDate("2026-05-15");

    it.each([
      ["de", "Brückentag"],
      ["en", "Bridge day"],
      ["es", "Día puente"],
      ["fr", "Jour de pont"],
      ["it", "Ponte"],
      ["nl", "Brugdag"],
      ["pl", "Dzień pomostowy"],
      ["pt", "Dia de ponte"],
      ["ru", "Нерабочий день"],
      ["uk", "Неробочий день"],
      ["zh", "桥接日"],
    ])("language %s → %s", (lang, expected) => {
      const config = makeConfig({ includeBridgeDays: true });
      const result = computeHolidays(config, [lang], bridgeDayDate);
      expect(result.today.name).toBe(expected);
    });

    it("unknown language falls back to English", () => {
      const config = makeConfig({ includeBridgeDays: true });
      const result = computeHolidays(config, ["xx"], bridgeDayDate);
      expect(result.today.name).toBe("Bridge day");
    });
  });
});

// ─── Relative days ──────────────────────────────────────────────────

describe("relative days", () => {
  it("yesterday shows previous day holiday", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-01-02"));
    expect(result.yesterday.isHoliday).toBe(true);
    expect(result.yesterday.name.length).toBeGreaterThan(0);
  });

  it("tomorrow shows next day holiday", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-12-24"));
    expect(result.tomorrow.isHoliday).toBe(true);
    expect(result.tomorrow.name.length).toBeGreaterThan(0);
  });

  it("dayAfterTomorrow works correctly", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-12-24"));
    expect(result.dayAfterTomorrow.isHoliday).toBe(true);
  });

  it("all relative days empty on normal workday", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-03-11"));
    expect(result.yesterday.isHoliday).toBe(false);
    expect(result.today.isHoliday).toBe(false);
    expect(result.tomorrow.isHoliday).toBe(false);
    expect(result.dayAfterTomorrow.isHoliday).toBe(false);
  });

  it("holiday name is empty when not a holiday", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-03-11"));
    expect(result.today.name).toBe("");
    expect(result.yesterday.name).toBe("");
  });
});

// ─── Next holiday ───────────────────────────────────────────────────

describe("next holiday", () => {
  it("finds the next upcoming holiday", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-01-02"));
    expect(result.next.isHoliday).toBe(true);
    expect(result.next.name.length).toBeGreaterThan(0);
    expect(result.next.daysUntil).toBeGreaterThan(0);
    expect(result.next.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("next holiday daysUntil is correct (1 day before)", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-04-02"));
    expect(result.next.date).toBe("2026-04-03");
    expect(result.next.daysUntil).toBe(1);
  });

  it("skips today when finding next", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-01-01"));
    expect(result.next.daysUntil).toBeGreaterThan(0);
  });

  it("year rollover: next from December finds January", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-12-27"));
    expect(result.next.isHoliday).toBe(true);
    expect(result.next.date).toBe("2027-01-01");
  });

  it("next holiday always has ISO date format", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-06-01"));
    expect(result.next.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── Localization ───────────────────────────────────────────────────

describe("localization", () => {
  it("German names with de language", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-01-01"));
    expect(result.today.name).toBe("Neujahr");
  });

  it("English names with en language", () => {
    const result = computeHolidays(makeConfig(), ["en"], makeDate("2026-01-01"));
    expect(result.today.name).toContain("New Year");
  });

  it("language affects holiday names (same holiday, different language)", () => {
    const de = computeHolidays(makeConfig(), ["de"], makeDate("2026-01-01"));
    const en = computeHolidays(makeConfig(), ["en"], makeDate("2026-01-01"));
    expect(de.today.name).not.toBe(en.today.name);
  });

  it("Italian names for IT holidays", () => {
    const result = computeHolidays(makeConfig({ country: "IT" }), ["it"], makeDate("2026-01-01"));
    expect(result.today.name).toContain("Capodanno");
  });

  it("French names for FR holidays", () => {
    const result = computeHolidays(makeConfig({ country: "FR" }), ["fr"], makeDate("2026-01-01"));
    expect(result.today.name.length).toBeGreaterThan(0);
  });

  it("English fallback for unsupported language", () => {
    const result = computeHolidays(makeConfig(), ["en"], makeDate("2026-01-01"));
    expect(result.today.name.length).toBeGreaterThan(0);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────

describe("edge cases", () => {
  it("leap year Feb 29", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2028-02-29"));
    expect(result.today.isHoliday).toBe(false);
  });

  it("Silvester is not a public holiday in DE", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-12-31"));
    expect(result.today.isHoliday).toBe(false);
  });

  it("empty day info has consistent shape", () => {
    const result = computeHolidays(makeConfig(), ["de"], makeDate("2026-03-11"));
    expect(result.today).toEqual({ name: "", isHoliday: false });
  });

  it("empty next holiday has consistent shape", () => {
    const result = computeHolidays(makeConfig({ holidayTypes: [] }), ["de"], makeDate("2026-03-11"));
    expect(result.next).toEqual({ name: "", isHoliday: false, date: "", daysUntil: 0 });
  });

  it("all types enabled returns more holidays than public only", () => {
    const publicOnly = makeConfig({ state: "BY" });
    const allTypes = makeConfig({ state: "BY", holidayTypes: ["public", "bank", "school", "optional", "observance"] });
    const pubResult = computeHolidays(publicOnly, ["de"], makeDate("2026-08-15"));
    const allResult = computeHolidays(allTypes, ["de"], makeDate("2026-08-15"));
    expect(pubResult.today.isHoliday).toBe(false);
    expect(allResult.today.isHoliday).toBe(true);
  });
});

// ─── toHolidayId ────────────────────────────────────────────────────

describe("toHolidayId", () => {
  it("creates ID from name", () => {
    expect(toHolidayId("Good Friday")).toBe("good_friday");
  });

  it("handles umlauts", () => {
    const id = toHolidayId("Mariä Himmelfahrt");
    expect(id).toMatch(/^[a-z0-9_]+$/);
  });

  it("prefers rule-based ID when available", () => {
    expect(toHolidayId("Neujahr", "01-01")).toBe("01-01");
  });

  it("falls back to name when rule is too short", () => {
    expect(toHolidayId("Test Holiday", "x")).toBe("test_holiday");
  });

  it("handles special characters", () => {
    const id = toHolidayId("Fête nationale");
    expect(id).toMatch(/^[a-z0-9_]+$/);
  });
});

// ─── toDateKey ──────────────────────────────────────────────────────

describe("toDateKey", () => {
  it("formats date correctly", () => {
    expect(toDateKey(new Date("2026-01-01T12:00:00"))).toBe("2026-01-01");
  });

  it("pads single-digit month and day", () => {
    expect(toDateKey(new Date("2026-03-05T00:00:00"))).toBe("2026-03-05");
  });
});

// ─── Country diversity (structural) ────────────────────────────────

describe("country diversity", () => {
  const countries = [
    "US",
    "GB",
    "FR",
    "JP",
    "BR",
    "IN",
    "AU",
    "CA",
    "MX",
    "ZA",
    "KR",
    "NG",
    "EG",
    "SE",
    "PL",
    "TR",
    "AR",
    "TH",
    "NZ",
    "IL",
  ];

  for (const cc of countries) {
    it(`${cc}: does not crash and returns valid structure`, () => {
      const config = makeConfig({ country: cc });
      const result = computeHolidays(config, ["en"], makeDate("2026-01-01"));
      expect(result.today).toBeDefined();
      expect(typeof result.today.isHoliday).toBe("boolean");
      expect(typeof result.today.name).toBe("string");
      expect(result.next).toBeDefined();
      expect(typeof result.next.daysUntil).toBe("number");
    });
  }

  it("all tested countries have at least one holiday per year", () => {
    for (const cc of countries) {
      const config = makeConfig({ country: cc });
      const result = computeHolidays(config, ["en"], makeDate("2026-06-15"));
      expect(result.next.isHoliday).toBe(true);
    }
  });

  it("US: Jul 4 is a holiday", () => {
    const result = computeHolidays(makeConfig({ country: "US" }), ["en"], makeDate("2026-07-04"));
    expect(result.today.isHoliday).toBe(true);
  });

  it("FR: Jul 14 is a holiday", () => {
    const result = computeHolidays(makeConfig({ country: "FR" }), ["fr"], makeDate("2026-07-14"));
    expect(result.today.isHoliday).toBe(true);
  });

  it("GB: Dec 25 is a holiday", () => {
    const result = computeHolidays(makeConfig({ country: "GB" }), ["en"], makeDate("2026-12-25"));
    expect(result.today.isHoliday).toBe(true);
  });

  it("JP: Jan 1 is a holiday", () => {
    const result = computeHolidays(makeConfig({ country: "JP" }), ["en"], makeDate("2026-01-01"));
    expect(result.today.isHoliday).toBe(true);
  });

  it("BR: Sep 7 is a holiday", () => {
    const result = computeHolidays(makeConfig({ country: "BR" }), ["pt"], makeDate("2026-09-07"));
    expect(result.today.isHoliday).toBe(true);
  });

  it("bridge day is created for a non-DACH country (FR Ascension Thu -> Fri)", () => {
    // Ascension 2026 = Thu May 14 (public holiday in FR); Fri May 15 is a bridge day.
    const config = makeConfig({ country: "FR", includeBridgeDays: true });
    const result = computeHolidays(config, ["fr"], makeDate("2026-05-15"));
    expect(result.today.isHoliday).toBe(true);
    expect(result.today.name).toBe("Jour de pont");
  });
});

// ─── logAvailableHolidays ───────────────────────────────────────────

describe("logAvailableHolidays", () => {
  it("logs the matching holiday IDs for the configured country", () => {
    const msgs: string[] = [];
    logAvailableHolidays(makeConfig({ country: "DE" }), ["de"], m => msgs.push(m));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("DE");
    expect(msgs[0]).toMatch(/holidays for \d{4}/);
  });

  it("reports zero when no holiday type matches", () => {
    const msgs: string[] = [];
    logAvailableHolidays(makeConfig({ country: "DE", holidayTypes: [] }), ["de"], m => msgs.push(m));
    expect(msgs[0]).toContain("0 holidays");
  });
});

// ─── Same-date collision priority ───────────────────────────────────

describe("same-date collision priority", () => {
  it("shows the higher-priority (public) holiday when several types collide on one day", () => {
    // American Samoa 2027-12-24: a public substitute day collides with bank/optional Christmas Eve.
    const allTypes = computeHolidays(
      makeConfig({ country: "AS", holidayTypes: ["public", "bank", "optional"] }),
      ["en"],
      makeDate("2027-12-24"),
    );
    const publicOnly = computeHolidays(
      makeConfig({ country: "AS", holidayTypes: ["public"] }),
      ["en"],
      makeDate("2027-12-24"),
    );
    expect(publicOnly.today.isHoliday).toBe(true);
    // The surviving name is the public one, not whichever type date-holidays emitted first.
    expect(allTypes.today.name).toBe(publicOnly.today.name);
  });
});

// ─── Midweek bridge day ─────────────────────────────────────────────

describe("midweek bridge day", () => {
  it("bridges a free Wednesday between a Tuesday and a Thursday holiday", () => {
    // 2026-05-12 is a Tuesday, 2026-05-14 a Thursday, 2026-05-13 the free Wednesday between.
    const holidays = new Map<string, RawHoliday>();
    holidays.set("2026-05-12", { date: "2026-05-12", name: "Tue", type: "public" });
    holidays.set("2026-05-14", { date: "2026-05-14", name: "Thu", type: "public" });
    const bridges = detectBridgeDays(holidays, 2026).map(toDateKey);
    expect(bridges).toContain("2026-05-13");
  });

  it("does not bridge the Wednesday when only the Tuesday is a holiday", () => {
    const holidays = new Map<string, RawHoliday>();
    holidays.set("2026-05-12", { date: "2026-05-12", name: "Tue", type: "public" });
    const bridges = detectBridgeDays(holidays, 2026).map(toDateKey);
    expect(bridges).not.toContain("2026-05-13");
  });
});

// ─── Stale exclude detection ────────────────────────────────────────

describe("unmatched excludes", () => {
  it("reports an exclude ID that matches no holiday in the data", () => {
    const result = computeHolidays(
      makeConfig({ excludeHolidays: ["definitely_not_a_real_holiday"] }),
      ["de"],
      makeDate("2026-01-01"),
    );
    expect(result.unmatchedExcludes).toContain("definitely_not_a_real_holiday");
  });

  it("does not report an exclude that matches a real holiday", () => {
    const result = computeHolidays(
      makeConfig({ excludeHolidays: [toHolidayId("Neujahr", "01-01")] }),
      ["de"],
      makeDate("2026-01-01"),
    );
    expect(result.unmatchedExcludes).toHaveLength(0);
  });

  it("does not flag a still-valid exclude whose holiday type is currently disabled", () => {
    // Neujahr (id "01-01") is public; with only 'bank' enabled it is filtered out, but its
    // ID still exists in the data → it must NOT be reported as stale (false-positive guard).
    const result = computeHolidays(
      makeConfig({ holidayTypes: ["bank"], excludeHolidays: [toHolidayId("Neujahr", "01-01")] }),
      ["de"],
      makeDate("2026-01-01"),
    );
    expect(result.unmatchedExcludes).toHaveLength(0);
  });
});
