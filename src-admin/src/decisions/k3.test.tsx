// K3 — the admin card and the adapter compute with the same functions; the preview shows exactly what is published.
// The card half: the preview is the day list the runtime builds — every day of a multi-day holiday, bridge days of
// the country's weekend, an excluded holiday gone together with its substitute day.
import { describe, expect, it } from "vitest";
import { buildPreviewHolidays } from "../scope-options";

const HOLIDAYS = [
  {
    date: "2026-01-01 00:00:00",
    start: new Date(2026, 0, 1),
    end: new Date(2026, 0, 3),
    name: "New Year",
    type: "public",
    rule: "01-01 P2D",
  },
  { date: "2026-05-14 00:00:00", name: "Ascension Day", type: "public", rule: "easter 39" },
  { date: "2026-12-26 00:00:00", name: "Boxing Day", type: "public", rule: "12-26" },
  {
    date: "2026-12-28 00:00:00",
    name: "Boxing Day (substitute day)",
    type: "public",
    rule: "substitutes 12-26 if saturday then next monday",
    substitute: true,
  },
  { date: "2026-08-15 00:00:00", name: "Assumption Day", type: "observance", rule: "08-15" },
];

const makeHolidays = (() => ({
  getHolidays: (y: number) => HOLIDAYS.filter(h => h.date.startsWith(`${y}-`)),
  getLanguages: () => ["en"],
  setLanguages: () => undefined,
})) as unknown as NonNullable<Parameters<typeof buildPreviewHolidays>[1]["makeHolidays"]>;

describe("K3 the card previews what the runtime publishes", () => {
  it("K3: the preview carries exactly the runtime's day list", () => {
    const preview = buildPreviewHolidays(
      {
        country: "DE",
        state: "",
        region: "",
        types: ["public"],
        excludeHolidays: ["12-26"],
        includeBridgeDays: true,
      },
      { systemLanguage: "en", referenceYear: 2026, makeHolidays },
    );
    expect(preview).toEqual([
      { date: "2026-01-01", name: "New Year", type: "public" },
      { date: "2026-01-02", name: "New Year", type: "public" },
      { date: "2026-05-14", name: "Ascension Day", type: "public" },
      { date: "2026-05-15", name: "", type: "bridge" },
    ]);
  });
});
