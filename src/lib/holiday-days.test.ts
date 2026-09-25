import { readFileSync } from "node:fs";
import { join } from "node:path";
import Holidays from "date-holidays";
import { describe, expect, it } from "vitest";
import {
  addBridgeDays,
  buildDayMap,
  excludeKey,
  expandHolidayDays,
  formatDayMonth,
  isFullDay,
  pickHolidayLanguages,
  type SourceHoliday,
  substituteBases,
  toHolidayId,
  weekendDays,
} from "./holiday-shared";

/** Every holiday of a scope over the years given, all types, as date-holidays hands them over. */
function raws(years: number[], country: string, state?: string): SourceHoliday[] {
  const hd = state ? new Holidays(country, state) : new Holidays(country);
  hd.setLanguages(["en"]);
  return years.flatMap(y => hd.getHolidays(y) as SourceHoliday[]);
}

function find(list: SourceHoliday[], pred: (h: SourceHoliday) => boolean): SourceHoliday {
  const h = list.find(pred);
  if (!h) {
    throw new Error("holiday not in the data");
  }
  return h;
}

describe("expandHolidayDays — every day a holiday covers (real date-holidays data)", () => {
  it("RU New Year holidays `01-02 P5D` cover 2 to 6 January", () => {
    const h = find(raws([2026], "RU"), x => x.rule === "01-02 P5D");
    expect(expandHolidayDays(h)).toEqual(["2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"]);
  });

  it("KR Chuseok `P3D` covers three days", () => {
    const h = find(raws([2026], "KR"), x => x.name === "Korean Thanksgiving");
    expect(expandHolidayDays(h)).toEqual(["2026-09-24", "2026-09-25", "2026-09-26"]);
  });

  it("TR Eid al-Fitr starts on the eve (-0600) — the eve is not a day, three days are", () => {
    const h = find(raws([2026], "TR"), x => /Eid al-Fitr/.test(x.name));
    expect(h.date).toBe("2026-03-20 00:00:00 -0600");
    expect(expandHolidayDays(h)).toEqual(["2026-03-20", "2026-03-21", "2026-03-22"]);
  });

  it("IL Passover intermediate days `16 Nisan P5D` cover five days, not the eve", () => {
    const h = find(raws([2026], "IL"), x => x.rule === "16 Nisan P5D");
    expect(expandHolidayDays(h)).toEqual(["2026-04-03", "2026-04-04", "2026-04-05", "2026-04-06", "2026-04-07"]);
  });

  it("a one-day holiday and a part-day holiday stay one day", () => {
    const de = raws([2026], "DE");
    expect(expandHolidayDays(find(de, x => x.rule === "10-03"))).toEqual(["2026-10-03"]);
    expect(expandHolidayDays(find(de, x => x.date.startsWith("2026-12-24")))).toEqual(["2026-12-24"]);
  });

  it("without start/end (defensive) the first day is all there is", () => {
    expect(expandHolidayDays({ date: "2026-01-02 00:00:00" })).toEqual(["2026-01-02"]);
  });

  it("a multi-day holiday across the year boundary continues into January", () => {
    const start = new Date("2026-12-30T00:00:00");
    const end = new Date("2027-01-02T00:00:00");
    expect(expandHolidayDays({ date: "2026-12-30 00:00:00", start, end })).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
  });
});

describe("isFullDay — only a whole day off starts a bridge day", () => {
  it("midnight and eve starts are whole days, 14:00 is not", () => {
    expect(isFullDay({ date: "2026-10-03 00:00:00" })).toBe(true);
    expect(isFullDay({ date: "2026-03-20 00:00:00 -0600" })).toBe(true);
    expect(isFullDay({ date: "2026-12-24 14:00:00" })).toBe(false);
  });
});

describe("weekendDays — the country's own weekend", () => {
  it("Saturday + Sunday by default, Friday + Saturday where the country rests then", () => {
    expect(weekendDays("DE")).toEqual([6, 0]);
    expect(weekendDays("sa")).toEqual([5, 6]);
    expect(weekendDays("BD")).toEqual([5, 6]);
    expect(weekendDays("IR")).toEqual([5]);
    expect(weekendDays("IN")).toEqual([0]);
  });

  // The table is held against its two sources for EVERY country date-holidays knows: the weekend the
  // holiday data itself declares (only BD differs from Saturday + Sunday there), otherwise Unicode
  // CLDR as Node's Intl reports it. A new country, or a CLDR change, fails here instead of quietly
  // putting bridge days on a weekend.
  it("matches date-holidays' own data, otherwise CLDR, for every country", () => {
    const data = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "node_modules", "date-holidays", "data", "holidays.json"), "utf8"),
    ) as { holidays: Record<string, { weekend?: string[] }> };
    const day: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const mismatches: string[] = [];
    for (const code of Object.keys(new Holidays().getCountries())) {
      const own = data.holidays[code]?.weekend?.map(d => day[d.toLowerCase()]);
      const locale = new Intl.Locale(`und-${code}`) as Intl.Locale & {
        getWeekInfo?: () => { weekend: number[] };
        weekInfo?: { weekend: number[] };
      };
      const cldr = (locale.getWeekInfo?.() ?? locale.weekInfo)?.weekend.map(d => d % 7);
      const expected = own ?? cldr ?? [6, 0];
      const actual = weekendDays(code);
      if ([...actual].sort().join() !== [...expected].sort().join()) {
        mismatches.push(`${code}: table ${actual.join(",")} vs source ${expected.join(",")}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("excludeKey — the date part of an id", () => {
  it("strips the substitute prefix and cuts before the first condition", () => {
    expect(excludeKey("12-26")).toBe("12-26");
    expect(excludeKey("substitutes_12-26_if_saturday_then_next_monday_if_sunday_then_next_tuesday")).toBe("12-26");
    expect(excludeKey("04-25_and_if_saturday_then_next_monday")).toBe("04-25");
    expect(excludeKey("12-26_not_on_sunday")).toBe("12-26");
    expect(excludeKey("substitutes_korean_4-0-8_if_saturdaysunday_then_next_monday")).toBe("korean_4-0-8");
  });
});

describe("substituteBases — which holiday a substitute day stands in for", () => {
  it("GB Boxing Day's substitute belongs to Boxing Day", () => {
    const bases = substituteBases(raws([2026], "GB"));
    expect(bases.get("substitutes_12-26_if_saturday_then_next_monday_if_sunday_then_next_tuesday")).toBe("12-26");
  });

  it("US-TX: excluding Emancipation Day (06-19) leaves Juneteenth's substitute day standing", () => {
    // Both fall on 19 June; date-holidays gives Juneteenth and its substitute ONE id, so the
    // substitute needs no attribution — what matters is that it never lands on Emancipation Day.
    const list = raws([2021, 2022, 2023, 2027], "US", "TX");
    const sub = find(list, x => x.substitute === true && x.name.startsWith("Juneteenth"));
    const subId = toHolidayId(sub.name, sub.rule);
    expect(substituteBases(list).get(subId)).not.toBe("06-19");
    const days = buildDayMap(list, { types: ["public", "observance"], excludes: ["06-19"] });
    expect([...days.values()].some(d => d.id === subId && d.substitute === true)).toBe(true);
  });

  it("HK: the moved day of a year where the holiday itself is not emitted still finds its holiday", () => {
    // 2027-12-26 is a Sunday: date-holidays emits only the substitute rule that year.
    const bases = substituteBases(raws([2026, 2027], "HK"));
    expect(bases.get("substitutes_12-26_if_sunday_then_next_monday")).toBe("12-26_not_on_sunday");
  });
});

describe("buildDayMap — the day list runtime and card share", () => {
  const gb = raws([2026], "GB");

  it("excluding a holiday excludes its substitute day (GB Boxing Day 2026-12-28)", () => {
    const all = buildDayMap(gb, { types: ["public"], excludes: [] });
    expect(all.get("2026-12-28")?.name).toBe("Boxing Day (substitute day)");
    const without = buildDayMap(gb, { types: ["public"], excludes: ["12-26"] });
    expect(without.has("2026-12-26")).toBe(false);
    expect(without.has("2026-12-28")).toBe(false);
  });

  it("an excluded substitute id removes the substitute only — never widened to its holiday", () => {
    const id = "substitutes_12-26_if_saturday_then_next_monday_if_sunday_then_next_tuesday";
    const days = buildDayMap(gb, { types: ["public"], excludes: [id] });
    expect(days.has("2026-12-26")).toBe(true);
    expect(days.has("2026-12-28")).toBe(false);
  });

  it("every day of a multi-day holiday is listed, sharing one occurrence", () => {
    const days = buildDayMap(raws([2026], "RU"), { types: ["public"], excludes: [] });
    const occurrences = ["2026-01-02", "2026-01-06"].map(k => days.get(k)?.occurrence);
    expect(occurrences[0]).toBeDefined();
    expect(occurrences[0]).toBe(occurrences[1]);
    expect(days.get("2026-01-07")?.name).toBe("Christmas Day");
  });

  it("an excluded multi-day holiday disappears on every day", () => {
    const id = "01-02_p5d";
    const days = buildDayMap(raws([2026], "RU"), { types: ["public"], excludes: [id] });
    expect(["2026-01-02", "2026-01-03", "2026-01-06"].some(k => days.has(k))).toBe(false);
  });
});

describe("addBridgeDays — triggers and the country's weekend", () => {
  it("observances do not start a bridge day (DE Weiberfastnacht, Thursday 2026-02-12)", () => {
    const de = raws([2025, 2026, 2027], "DE");
    const days = buildDayMap(de, { types: ["public", "observance"], excludes: [] });
    expect(days.get("2026-02-12")?.type).toBe("observance");
    addBridgeDays(days, [2026], weekendDays("DE"), "Bridge day");
    expect(days.has("2026-02-13")).toBe(false);
  });

  it("a part-day bank holiday does not start one (synthetic Tuesday 14:00)", () => {
    const partDay: SourceHoliday = { date: "2026-06-02 14:00:00", name: "Afternoon off", type: "bank", rule: "x-part" };
    const days = buildDayMap([partDay], { types: ["bank"], excludes: [] });
    addBridgeDays(days, [2026], weekendDays("DE"), "Bridge day");
    expect(days.has("2026-06-01")).toBe(false);
  });

  it("a follow-up day of a multi-day holiday is a holiday, never a bridge day (KR Chuseok 2026-09-25)", () => {
    const days = buildDayMap(raws([2025, 2026, 2027], "KR"), { types: ["public"], excludes: [] });
    addBridgeDays(days, [2026], weekendDays("KR"), "Bridge day");
    expect(days.get("2026-09-25")?.type).toBe("public");
  });

  it("a follow-up day of a multi-day holiday starts a bridge day like any whole day off", () => {
    // Tuesday 12 to Thursday 14 May 2026 (synthetic P3D): only the THIRD day is a Thursday.
    const multi: SourceHoliday = {
      date: "2026-05-12 00:00:00",
      start: new Date("2026-05-12T00:00:00"),
      end: new Date("2026-05-15T00:00:00"),
      name: "Three days",
      type: "public",
      rule: "05-12 P3D",
    };
    const days = buildDayMap([multi], { types: ["public"], excludes: [] });
    addBridgeDays(days, [2026], weekendDays("DE"), "Bridge day");
    expect(days.get("2026-05-15")?.type).toBe("bridge");
  });

  it("with a Friday + Saturday weekend the Friday is never a bridge day (SA 2026)", () => {
    const days = buildDayMap(raws([2025, 2026, 2027], "SA"), { types: ["public"], excludes: [] });
    addBridgeDays(days, [2026], weekendDays("SA"), "Bridge day");
    const fridays = [...days.values()].filter(
      d => d.type === "bridge" && new Date(`${d.date}T00:00:00`).getDay() === 5,
    );
    expect(fridays).toEqual([]);
  });
});

describe("pickHolidayLanguages — the language the runtime publishes in", () => {
  it("the system language when the data carries it, English behind it", () => {
    expect(pickHolidayLanguages("de", ["de", "en"])).toEqual(["de", "en"]);
    expect(pickHolidayLanguages("en", ["de", "en"])).toEqual(["en"]);
  });

  it("zh-cn is zh", () => {
    expect(pickHolidayLanguages("zh-cn", ["zh", "en"])).toEqual(["zh", "en"]);
  });

  it("English when the country's data lacks the language, or the language is not one of ioBroker's", () => {
    expect(pickHolidayLanguages("ru", ["es", "ca", "en"])).toEqual(["en"]);
    expect(pickHolidayLanguages("ja", ["ja", "en"])).toEqual(["en"]);
  });
});

describe("formatDayMonth — the card's chips in the system date format", () => {
  it("follows the order and separator of the format", () => {
    expect(formatDayMonth("2026-05-14", "DD.MM.YYYY")).toBe("14.05.");
    expect(formatDayMonth("2026-05-14", "MM/DD/YYYY")).toBe("05/14");
    expect(formatDayMonth("2026-05-14", "YYYY-MM-DD")).toBe("05-14");
    expect(formatDayMonth("2026-05-14", "")).toBe("14.05.");
  });
});
