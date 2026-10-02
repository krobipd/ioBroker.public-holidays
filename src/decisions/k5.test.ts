// K5 — `next` shows the next holiday day; while a multi-day holiday runs, that is its next day too, nothing is skipped.
import { describe, expect, it } from "vitest";
import { computeHolidays } from "../lib/holiday-engine";

const HOLIDAYS = [
  {
    date: "2026-01-01 00:00:00",
    start: new Date(2026, 0, 1),
    end: new Date(2026, 0, 4),
    name: "New Year Holiday",
    type: "public",
    rule: "01-01 P3D",
  },
  {
    date: "2026-01-07 00:00:00",
    start: new Date(2026, 0, 7),
    end: new Date(2026, 0, 8),
    name: "Christmas Day",
    type: "public",
    rule: "01-07",
  },
];

function nextOn(day: number): { name: string; date: string; daysUntil: number } {
  const source = { getHolidays: (y: number) => HOLIDAYS.filter(h => h.date.startsWith(`${y}-`)) };
  const { next } = computeHolidays(
    source as unknown as Parameters<typeof computeHolidays>[0],
    { country: "DE", state: "", region: "", holidayTypes: ["public"], excludeHolidays: [], includeBridgeDays: false },
    { referenceDate: new Date(2026, 0, day, 12), systemLanguage: "en" },
  );
  return { name: next.name, date: next.date, daysUntil: next.daysUntil };
}

describe("K5 next is the next holiday day", () => {
  it("K5: on day 1 of a three-day holiday, next is its day 2", () => {
    expect(nextOn(1)).toEqual({ name: "New Year Holiday", date: "2026-01-02", daysUntil: 1 });
  });

  it("K5: on day 2, next is its day 3", () => {
    expect(nextOn(2)).toEqual({ name: "New Year Holiday", date: "2026-01-03", daysUntil: 1 });
  });

  it("K5: on its last day, next is the following holiday", () => {
    expect(nextOn(3)).toEqual({ name: "Christmas Day", date: "2026-01-07", daysUntil: 4 });
  });
});
