// K7 — an excluded holiday takes its substitute days with it; a substitute is matched only when unambiguous or by name.
import { describe, expect, it } from "vitest";
import { buildDayMap, toHolidayId } from "../lib/holiday-shared";

const BOXING = { date: "2026-12-26 00:00:00", name: "Boxing Day", type: "public", rule: "12-26" };
const BOXING_SUB = {
  date: "2026-12-28 00:00:00",
  name: "Boxing Day (substitute day)",
  type: "public",
  rule: "substitutes 12-26 if saturday then next monday",
  substitute: true,
};
const EMANCIPATION = { date: "2027-06-19 00:00:00", name: "Emancipation Day", type: "public", rule: "06-19" };
const JUNETEENTH = {
  date: "2027-06-19 00:00:00",
  name: "Juneteenth",
  type: "public",
  rule: "06-19 if sunday then next monday",
};
const JUNETEENTH_SUB = {
  date: "2027-06-18 00:00:00",
  name: "Juneteenth (substitute day)",
  type: "public",
  rule: "substitutes 06-19 if saturday then previous friday",
  substitute: true,
};
const OTHER_SUB = {
  date: "2027-06-21 00:00:00",
  name: "Holiday (substitute day)",
  type: "public",
  rule: "substitutes 06-19 if sunday then next monday",
  substitute: true,
};

function dates(raws: object[], exclude: { name: string; rule: string }): string[] {
  const days = buildDayMap(raws as Parameters<typeof buildDayMap>[0], {
    types: ["public"],
    excludes: [toHolidayId(exclude.name, exclude.rule)],
  });
  return [...days.keys()].sort();
}

describe("K7 an exclude takes its substitute days along", () => {
  it("K7: excluding a holiday removes its substitute day too", () => {
    expect(dates([BOXING, BOXING_SUB], BOXING)).toEqual([]);
  });

  it("K7: two holidays on one date — the substitute goes with the one whose name it carries", () => {
    const raws = [EMANCIPATION, JUNETEENTH, JUNETEENTH_SUB];
    expect(dates(raws, JUNETEENTH)).toEqual(["2027-06-19"]);
    expect(dates(raws, EMANCIPATION)).toEqual(["2027-06-18", "2027-06-19"]);
  });

  it("K7: two holidays on one date and no name match — the substitute stays", () => {
    const raws = [EMANCIPATION, JUNETEENTH, OTHER_SUB];
    expect(dates(raws, EMANCIPATION)).toEqual(["2027-06-19", "2027-06-21"]);
    expect(dates(raws, JUNETEENTH)).toEqual(["2027-06-19", "2027-06-21"]);
  });
});
