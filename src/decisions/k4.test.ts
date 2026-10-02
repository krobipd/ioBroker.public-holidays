// K4 — a holiday counts on every calendar day it covers, even when it starts in the afternoon; a multi-day holiday
// counts on each of its days; a start on the evening before does not make that day a holiday.
import { describe, expect, it } from "vitest";
import { computeHolidays } from "../lib/holiday-engine";

interface Raw {
  date: string;
  start: Date;
  end: Date;
  name: string;
  type: string;
  rule: string;
}

function isHolidayOn(holiday: Raw, day: Date): boolean {
  const source = { getHolidays: (y: number) => (holiday.date.startsWith(`${y}-`) ? [holiday] : []) };
  return computeHolidays(
    source as unknown as Parameters<typeof computeHolidays>[0],
    { country: "DE", state: "", region: "", holidayTypes: ["public"], excludeHolidays: [], includeBridgeDays: false },
    { referenceDate: day, systemLanguage: "en" },
  ).today.isHoliday;
}

describe("K4 a holiday counts on every day it covers", () => {
  it("K4: a holiday starting in the afternoon counts on that day", () => {
    const eve: Raw = {
      date: "2026-12-24 14:00:00",
      start: new Date(2026, 11, 24, 14),
      end: new Date(2026, 11, 25),
      name: "Christmas Eve",
      type: "public",
      rule: "12-24 14:00",
    };
    expect(isHolidayOn(eve, new Date(2026, 11, 24, 12))).toBe(true);
    expect(isHolidayOn(eve, new Date(2026, 11, 25, 12))).toBe(false);
  });

  it("K4: a holiday of three days counts on each of the three days, not on the fourth", () => {
    const newYear: Raw = {
      date: "2026-01-01 00:00:00",
      start: new Date(2026, 0, 1),
      end: new Date(2026, 0, 4),
      name: "New Year Holiday",
      type: "public",
      rule: "01-01 P3D",
    };
    for (const d of [1, 2, 3]) {
      expect(isHolidayOn(newYear, new Date(2026, 0, d, 12)), `day ${d}`).toBe(true);
    }
    expect(isHolidayOn(newYear, new Date(2026, 0, 4, 12))).toBe(false);
  });

  it("K4: a holiday that begins on the evening before does not make that day a holiday", () => {
    const atDusk: Raw = {
      date: "2026-09-12 00:00:00 -0600",
      start: new Date(2026, 8, 11, 18),
      end: new Date(2026, 8, 13),
      name: "New Year",
      type: "public",
      rule: "1 Tishrei",
    };
    expect(isHolidayOn(atDusk, new Date(2026, 8, 11, 12))).toBe(false);
    expect(isHolidayOn(atDusk, new Date(2026, 8, 12, 12))).toBe(true);
    expect(isHolidayOn(atDusk, new Date(2026, 8, 13, 12))).toBe(false);
  });
});
