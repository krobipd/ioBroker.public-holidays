import { describe, it, expect } from "vitest";
import { ALL_TYPES, compute, makeConfig } from "../../test/helpers";
import { createHolidaysInstance, detectScopeIssue, logAvailableHolidays } from "./holiday-engine";
import { pickHolidayLanguages, toHolidayId } from "./holiday-shared";

function makeDate(dateStr: string): Date {
  return new Date(`${dateStr}T12:00:00`);
}

// ─── Scope: country / state / region ────────────────────────────────

describe("scope: country/state/region", () => {
  it("a country alone yields its holidays", () => {
    expect(compute(makeConfig(), ["de"], { referenceDate: makeDate("2026-01-01") }).today).toEqual({
      name: "Neujahr",
      isHoliday: true,
    });
  });

  it.each([
    // [what, scope with, scope without, date]
    ["DE/BY has Fronleichnam, DE/HH does not", { state: "BY" }, { state: "HH" }, "2026-06-04"],
    ["DE/BE has Frauentag", { state: "BE" }, { state: "NW" }, "2026-03-08"],
    // date-holidays codes the Italian autonomous provinces numerically; 32 = Alto Adige (South Tyrol).
    ["IT/32 Alto Adige has Pentecost Monday", { country: "IT", state: "32" }, { country: "IT" }, "2026-05-25"],
    // The region level: Friedensfest is a public holiday only in the city of Augsburg (region A of DE/BY).
    ["DE/BY/A has the Augsburger Friedensfest", { state: "BY", region: "A" }, { state: "BY" }, "2026-08-08"],
    ["CH/BE has Berchtoldstag", { country: "CH", state: "BE" }, { country: "CH" }, "2026-01-02"],
    ["US/CA has César Chávez Day", { country: "US", state: "CA" }, { country: "US" }, "2026-03-31"],
    ["AT has its national day, DE does not", { country: "AT" }, { country: "DE" }, "2026-10-26"],
  ])("%s", (_what, withIt, withoutIt, date) => {
    expect(compute(makeConfig(withIt), ["en"], { referenceDate: makeDate(date) }).today.isHoliday).toBe(true);
    expect(compute(makeConfig(withoutIt), ["en"], { referenceDate: makeDate(date) }).today.isHoliday).toBe(false);
  });

  it.each([
    ["US", "2026-07-04", "en"],
    ["FR", "2026-07-14", "fr"],
    ["GB", "2026-12-25", "en"],
    ["JP", "2026-01-01", "en"],
    ["BR", "2026-09-07", "pt"],
    ["IN", "2026-01-26", "en"],
  ])("%s: %s is a holiday", (country, date, lang) => {
    expect(
      compute(makeConfig({ country, holidayTypes: ALL_TYPES }), [lang], { referenceDate: makeDate(date) }).today
        .isHoliday,
    ).toBe(true);
  });

  it("every one of twenty countries across the continents has a holiday ahead", () => {
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
    for (const country of countries) {
      expect(
        compute(makeConfig({ country }), ["en"], { referenceDate: makeDate("2026-06-15") }).next.isHoliday,
        country,
      ).toBe(true);
    }
  });
});

// ─── Type filter ────────────────────────────────────────────────────

describe("type filter", () => {
  it("only the enabled types count (New Year is public, not bank)", () => {
    expect(
      compute(makeConfig({ holidayTypes: ["bank"] }), ["de"], { referenceDate: makeDate("2026-01-01") }).today
        .isHoliday,
    ).toBe(false);
  });

  it("no enabled type means no holidays at all — today and next", () => {
    const result = compute(makeConfig({ holidayTypes: [] }), ["de"], { referenceDate: makeDate("2026-01-01") });
    expect(result.today.isHoliday).toBe(false);
    expect(result.next).toEqual({ name: "", isHoliday: false, date: "", daysUntil: 0 });
  });

  it("observance adds observance holidays (DE/BY Mariä Himmelfahrt)", () => {
    const at = { referenceDate: makeDate("2026-08-15") };
    expect(compute(makeConfig({ state: "BY" }), ["de"], at).today.isHoliday).toBe(false);
    expect(compute(makeConfig({ state: "BY", holidayTypes: ["public", "observance"] }), ["de"], at).today).toEqual({
      name: "Mariä Himmelfahrt",
      isHoliday: true,
    });
  });
});

// ─── Excludes ───────────────────────────────────────────────────────

describe("exclude list", () => {
  const newYear = toHolidayId("Neujahr", "01-01");
  const christmas = toHolidayId("1. Weihnachtstag", "12-25");

  it("excludes a holiday by its id — as today and as tomorrow", () => {
    expect(
      compute(makeConfig({ excludeHolidays: [newYear] }), ["de"], { referenceDate: makeDate("2026-01-01") }).today
        .isHoliday,
    ).toBe(false);
    const eve = compute(makeConfig({ excludeHolidays: [christmas] }), ["de"], {
      referenceDate: makeDate("2026-12-24"),
    });
    expect(eve.tomorrow.isHoliday).toBe(false);
  });

  it("several holidays can be excluded, an unknown id changes nothing", () => {
    const config = makeConfig({ excludeHolidays: [newYear, christmas, "nonexistent_holiday"] });
    expect(compute(config, ["de"], { referenceDate: makeDate("2026-01-01") }).today.isHoliday).toBe(false);
    expect(compute(config, ["de"], { referenceDate: makeDate("2026-12-25") }).today.isHoliday).toBe(false);
    expect(compute(config, ["de"], { referenceDate: makeDate("2026-12-26") }).today.isHoliday).toBe(true);
  });

  it("an excluded holiday makes no bridge day", () => {
    const config = makeConfig({
      includeBridgeDays: true,
      excludeHolidays: [toHolidayId("Christi Himmelfahrt", "easter 39")],
    });
    expect(compute(config, ["de"], { referenceDate: makeDate("2026-05-15") }).today.isHoliday).toBe(false);
  });
});

describe("unmatched excludes — warned only when the id exists nowhere in the country", () => {
  const at = { referenceDate: makeDate("2026-06-28") };

  it("an id of a sibling state, of the own scope, or of a disabled type is not unmatched", () => {
    // Martinstag (11-11, Burgenland) and Rupert (09-24, Salzburg) do not occur in Kärnten (AT/2): a
    // user who carried them over must NOT be warned — such an exclude is a harmless no-op.
    expect(
      compute(makeConfig({ country: "AT", state: "2", excludeHolidays: ["11-11", "09-24"] }), ["de"], at)
        .unmatchedExcludes,
    ).toEqual([]);
    expect(
      compute(makeConfig({ country: "AT", state: "2", excludeHolidays: ["01-01"] }), ["de"], at).unmatchedExcludes,
    ).toEqual([]);
    expect(
      compute(makeConfig({ holidayTypes: ["bank"], excludeHolidays: ["01-01"] }), ["de"], at).unmatchedExcludes,
    ).toEqual([]);
    expect(compute(makeConfig({ holidayTypes: [], excludeHolidays: ["01-01"] }), ["de"], at).unmatchedExcludes).toEqual(
      [],
    );
  });

  it("an id that exists nowhere in the country is reported", () => {
    const result = compute(
      makeConfig({ country: "AT", state: "2", excludeHolidays: ["11-11", "total_fake_xyz"] }),
      ["de"],
      at,
    );
    expect(result.unmatchedExcludes).toEqual(["total_fake_xyz"]);
  });
});

// ─── Collisions ─────────────────────────────────────────────────────

describe("same-date collisions and type priority", () => {
  /**
   * date-holidays itself rarely returns two types for one date, so the collision is built here: a
   * fake instance that reports both entries on the same day.
   *
   * @param entries Holiday entries the fake instance returns for every year.
   */
  function fakeInstance(entries: { date: string; name: string; type: string }[]): never {
    return {
      getHolidays: (year: number) =>
        entries
          .filter(e => e.date.startsWith(String(year)))
          .map(e => ({
            date: `${e.date} 00:00:00`,
            start: new Date(`${e.date}T00:00:00`),
            name: e.name,
            type: e.type,
          })),
      setLanguages: () => undefined,
    } as never;
  }

  it("keeps the higher-priority type when two holidays share a date", () => {
    // Letting the observance win turns a day off into a "Gedenktag" in every visualisation.
    const result = compute(makeConfig({ holidayTypes: ["public", "observance"] }), ["de"], {
      referenceDate: makeDate("2026-12-26"),
      instance: fakeInstance([
        { date: "2026-12-26", name: "Gedenktag", type: "observance" },
        { date: "2026-12-26", name: "2. Weihnachtstag", type: "public" },
      ]),
    });
    expect(result.today).toEqual({ name: "2. Weihnachtstag", isHoliday: true });
  });

  it("ranks an unknown type LAST, never first", () => {
    // A date-holidays release can add a type this adapter does not know yet.
    const result = compute(makeConfig({ holidayTypes: ["public", "brand_new_type"] }), ["de"], {
      referenceDate: makeDate("2026-12-25"),
      instance: fakeInstance([
        { date: "2026-12-25", name: "Neuer Typ", type: "brand_new_type" },
        { date: "2026-12-25", name: "1. Weihnachtstag", type: "public" },
      ]),
    });
    expect(result.today.name).toBe("1. Weihnachtstag");
  });

  it("real data: the public holiday survives several types on one day (AS 2027-12-24)", () => {
    const at = { referenceDate: makeDate("2027-12-24") };
    const allTypes = compute(makeConfig({ country: "AS", holidayTypes: ["public", "bank", "optional"] }), ["en"], at);
    const publicOnly = compute(makeConfig({ country: "AS" }), ["en"], at);
    expect(publicOnly.today.isHoliday).toBe(true);
    expect(allTypes.today.name).toBe(publicOnly.today.name);
  });
});

// ─── Bridge days (the rule itself: bridge-days-real-data.test.ts) ────

describe("bridge days in the result", () => {
  it("a Thursday holiday makes the Friday a bridge day — only when switched on", () => {
    const at = { referenceDate: makeDate("2026-05-15") };
    expect(compute(makeConfig({ includeBridgeDays: true }), ["de"], at).today).toEqual({
      name: "Brückentag",
      isHoliday: true,
    });
    expect(compute(makeConfig(), ["de"], at).today.isHoliday).toBe(false);
  });

  it("a bridge day in the following year is found (Fri 2 Jan 2026 seen on 31 Dec 2025)", () => {
    const result = compute(makeConfig({ includeBridgeDays: true }), ["de"], { referenceDate: makeDate("2025-12-31") });
    expect(result.dayAfterTomorrow).toEqual({ name: "Brückentag", isHoliday: true });
  });

  it("the bridge day is named in the SYSTEM language, not the data language (audit S1)", () => {
    // US data has no German, so the holiday names come in English; the bridge day is the adapter's
    // own text. Friday after Thanksgiving 2026: an observance filtered away, so the Friday is bridged.
    const config = makeConfig({ country: "US", includeBridgeDays: true });
    const friday = { referenceDate: makeDate("2026-11-27") };
    expect(compute(config, ["en"], { ...friday, systemLanguage: "de" }).today.name).toBe("Brückentag");
    expect(compute(config, ["en"], { ...friday, systemLanguage: "xx" }).today.name).toBe("Bridge day");
    expect(
      compute(makeConfig({ country: "FR", includeBridgeDays: true }), ["fr"], { referenceDate: makeDate("2026-05-15") })
        .today.name,
    ).toBe("Jour de pont");
  });
});

// ─── Relative days and next ─────────────────────────────────────────

describe("relative days", () => {
  it("yesterday, tomorrow and the day after carry the names of the days around today", () => {
    expect(compute(makeConfig(), ["de"], { referenceDate: makeDate("2026-01-02") }).yesterday).toEqual({
      name: "Neujahr",
      isHoliday: true,
    });
    const eve = compute(makeConfig(), ["de"], { referenceDate: makeDate("2026-12-24") });
    expect(eve.tomorrow).toEqual({ name: "1. Weihnachtstag", isHoliday: true });
    expect(eve.dayAfterTomorrow).toEqual({ name: "2. Weihnachtstag", isHoliday: true });
  });

  it("a workday: every day empty, in the same shape", () => {
    const result = compute(makeConfig(), ["de"], { referenceDate: makeDate("2026-03-11") });
    for (const day of [result.yesterday, result.today, result.tomorrow, result.dayAfterTomorrow]) {
      expect(day).toEqual({ name: "", isHoliday: false });
    }
  });

  it("leap day and New Year's Eve are no public holidays in DE", () => {
    expect(compute(makeConfig(), ["de"], { referenceDate: makeDate("2028-02-29") }).today.isHoliday).toBe(false);
    expect(compute(makeConfig(), ["de"], { referenceDate: makeDate("2026-12-31") }).today.isHoliday).toBe(false);
  });
});

describe("next holiday", () => {
  it("the next holiday ahead with its ISO date and the days until it", () => {
    expect(compute(makeConfig(), ["de"], { referenceDate: makeDate("2026-01-02") }).next).toEqual({
      name: "Karfreitag",
      isHoliday: true,
      date: "2026-04-03",
      daysUntil: 91,
    });
    expect(compute(makeConfig(), ["de"], { referenceDate: makeDate("2026-04-02") }).next).toMatchObject({
      date: "2026-04-03",
      daysUntil: 1,
    });
  });

  it("a holiday today is not next", () => {
    expect(compute(makeConfig(), ["de"], { referenceDate: makeDate("2026-01-01") }).next.date).toBe("2026-04-03");
  });

  it("reaches into the next year from December", () => {
    expect(compute(makeConfig(), ["de"], { referenceDate: makeDate("2026-12-27") }).next).toMatchObject({
      name: "Neujahr",
      date: "2027-01-01",
    });
  });
});

// ─── Localization ───────────────────────────────────────────────────

describe("localization", () => {
  it("the holiday names follow the languages set", () => {
    const at = { referenceDate: makeDate("2026-01-01") };
    expect(compute(makeConfig(), ["de"], at).today.name).toBe("Neujahr");
    expect(compute(makeConfig(), ["en"], at).today.name).toBe("New Year's Day");
    expect(compute(makeConfig({ country: "IT" }), ["it"], at).today.name).toContain("Capodanno");
  });

  it("a system language the country's data lacks falls back to English (DE data, Swedish system)", () => {
    const languages = pickHolidayLanguages("sv", createHolidaysInstance(makeConfig()).getLanguages());
    expect(compute(makeConfig(), languages, { referenceDate: makeDate("2026-01-01") }).today.name).toBe(
      "New Year's Day",
    );
  });
});

// ─── Multi-day holidays (0.18.0) ────────────────────────────────────

describe("multi-day holidays count on every day", () => {
  it("RU 3 January: today is the New Year holiday, and next is its next day, 4 January", () => {
    const result = compute(makeConfig({ country: "RU" }), ["en"], { referenceDate: makeDate("2026-01-03") });
    expect(result.today).toEqual({ name: "New Year Holiday", isHoliday: true });
    expect(result.tomorrow.isHoliday).toBe(true);
    // Nothing of the holiday running today is skipped: its next day is `next`.
    expect(result.next).toMatchObject({ name: "New Year Holiday", date: "2026-01-04", daysUntil: 1 });
  });

  it("the day before a multi-day holiday: next is its first day", () => {
    const result = compute(makeConfig({ country: "KR" }), ["en"], { referenceDate: makeDate("2026-09-23") });
    expect(result.next).toMatchObject({ name: "Korean Thanksgiving", date: "2026-09-24", daysUntil: 1 });
    expect(result.dayAfterTomorrow).toEqual({ name: "Korean Thanksgiving", isHoliday: true });
  });

  it("VN Tết: every day of the holidays, not only the first", () => {
    for (const day of ["2026-02-16", "2026-02-18", "2026-02-20"]) {
      expect(
        compute(makeConfig({ country: "VN" }), ["en"], { referenceDate: makeDate(day) }).today.isHoliday,
        day,
      ).toBe(true);
    }
  });

  it("yesterday on 1 January reaches back into the previous year (TH New Year's Eve)", () => {
    const result = compute(makeConfig({ country: "TH" }), ["en"], { referenceDate: makeDate("2027-01-01") });
    expect(result.yesterday).toEqual({ name: "New Year's Eve", isHoliday: true });
  });
});

// ─── The cron hour and the time zone (0.18.0, audit T3) ─────────────

describe("the run at midnight", () => {
  // The daily run starts at 00:00 local time; a test at noon cannot tell a local date from a UTC one.
  it("30 seconds after midnight on a holiday: today is that holiday", () => {
    const result = compute(makeConfig(), ["en"], { referenceDate: new Date(2026, 9, 3, 0, 0, 30) });
    expect(result.today.isHoliday).toBe(true);
    expect(result.yesterday.isHoliday).toBe(false);
  });

  it("30 seconds before midnight on the eve: the holiday is tomorrow, and next in 1 day", () => {
    const result = compute(makeConfig(), ["en"], { referenceDate: new Date(2026, 9, 2, 23, 59, 30) });
    expect(result.today.isHoliday).toBe(false);
    expect(result.tomorrow.isHoliday).toBe(true);
    expect(result.next).toMatchObject({ date: "2026-10-03", daysUntil: 1 });
  });

  it("daysUntil counts calendar days across a DST switch in a zone that has one (Europe/Vienna)", () => {
    // The CI runs in UTC, where a day is always 24 h — pin a DST zone for this one case. Local
    // midnight to local midnight across 29 March is 5 d 23 h; only rounding makes it the 6 days meant.
    const previous = process.env.TZ;
    process.env.TZ = "Europe/Vienna";
    try {
      const result = compute(makeConfig(), ["de"], { referenceDate: new Date(2026, 2, 28, 0, 0, 30) });
      expect(result.next).toMatchObject({ date: "2026-04-03", daysUntil: 6 });
    } finally {
      if (previous === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previous;
      }
    }
  });
});

// ─── logAvailableHolidays ───────────────────────────────────────────

describe("logAvailableHolidays", () => {
  it("lists the matching holidays of the year with their ids", () => {
    const hd = createHolidaysInstance(makeConfig({ state: "BY" }));
    hd.setLanguages(["en"]);
    const msgs: string[] = [];
    logAvailableHolidays(hd, makeConfig({ state: "BY" }), m => msgs.push(m), makeDate("2026-06-01"));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(
      /^DE\/BY: 12 holidays for 2026 — IDs: 01-01 \(New Year's Day, public\), 01-06 \(Epiphany, public\)/,
    );
  });

  it("reports zero when no holiday type matches", () => {
    const msgs: string[] = [];
    logAvailableHolidays(
      createHolidaysInstance(makeConfig()),
      makeConfig({ holidayTypes: [] }),
      m => msgs.push(m),
      makeDate("2026-06-01"),
    );
    expect(msgs).toEqual(["DE: 0 holidays for 2026 — IDs: "]);
  });
});

// ─── detectScopeIssue ───────────────────────────────────────────────

describe("detectScopeIssue", () => {
  const issue = (over: Parameters<typeof makeConfig>[0]): ReturnType<typeof detectScopeIssue> =>
    detectScopeIssue(createHolidaysInstance(makeConfig(over)), makeConfig(over));

  it("flags an unknown country, state and region — at most one, the broadest", () => {
    expect(issue({ country: "XX" })).toEqual({ kind: "country" });
    expect(issue({ state: "XX" })).toEqual({ kind: "state" });
    expect(issue({ state: "BY", region: "ZZ" })).toEqual({ kind: "region" });
  });

  it("a sound scope, and a hand-written lower-case state, have no issue", () => {
    expect(issue({ state: "BY" })).toBeNull();
    expect(issue({ state: "by" })).toBeNull();
  });

  it("NZ Timaru cannot be loaded by date-holidays — said, not hidden", () => {
    expect(issue({ country: "NZ", state: "CAN", region: "Timaru" })).toEqual({ kind: "unloadable" });
  });

  it("the twelve mixed-case scopes still load only their parent — a fixed library shows here", () => {
    const base = createHolidaysInstance(makeConfig({ country: "CK" }));
    const scopes: Array<[string, string, string]> = [
      ...Object.keys(base.getStates("CK") ?? {}).map(s => ["CK", s, ""] as [string, string, string]),
      ["NZ", "CAN", "Timaru"],
      ["NZ", "WTC", "Buller"],
    ];
    expect(scopes).toHaveLength(12);
    const days = (c: string, st: string, rg: string): string =>
      JSON.stringify(
        createHolidaysInstance(makeConfig({ country: c, state: st, region: rg }))
          .getHolidays(2026)
          .map(h => h.date + h.name),
      );
    for (const [c, st, rg] of scopes) {
      const parent = rg ? days(c, st, "") : days(c, "", "");
      expect(days(c, st, rg), `${c}/${st}/${rg} now loads — drop the "unloadable" warning`).toBe(parent);
    }
  });
});
