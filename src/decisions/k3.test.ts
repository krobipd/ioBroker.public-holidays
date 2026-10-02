// K3 — the admin card and the adapter compute with the same functions; the preview shows exactly what is published.
// The adapter half: what the runtime publishes is the day list of the shared builder the card previews with.
import { describe, expect, it } from "vitest";
import { computeHolidays } from "../lib/holiday-engine";
import { bridgeDayName, buildScopeDays, shiftKey, toDateKey } from "../lib/holiday-shared";

const HOLIDAYS = [
  { date: "2026-05-14 00:00:00", name: "Ascension Day", type: "public", rule: "easter 39" },
  { date: "2026-05-25 00:00:00", name: "Whit Monday", type: "public", rule: "easter 50" },
];
const SOURCE = { getHolidays: (y: number) => HOLIDAYS.filter(h => h.date.startsWith(`${y}-`)) };
const OPTIONS = { types: ["public"], excludes: [], bridgeDays: true, country: "DE" };

describe("K3 runtime and card build the same day list", () => {
  for (const language of ["de", "en", "fr"]) {
    it(`K3: every published day equals the shared builder's day (system language ${language})`, () => {
      const referenceDate = new Date(2026, 4, 14, 12);
      const result = computeHolidays(
        SOURCE as unknown as Parameters<typeof computeHolidays>[0],
        {
          country: "DE",
          state: "",
          region: "",
          holidayTypes: ["public"],
          excludeHolidays: [],
          includeBridgeDays: true,
        },
        { referenceDate, systemLanguage: language },
      );
      const { days } = buildScopeDays(SOURCE, 2026, { ...OPTIONS, bridgeName: bridgeDayName(language) });
      const today = toDateKey(referenceDate);
      const day = (offset: number): { name: string; isHoliday: boolean } => {
        const d = days.get(shiftKey(today, offset));
        return d ? { name: d.name, isHoliday: true } : { name: "", isHoliday: false };
      };
      expect(result.yesterday).toEqual(day(-1));
      expect(result.today).toEqual(day(0));
      expect(result.tomorrow).toEqual(day(1));
      expect(result.tomorrow.name).toBe(bridgeDayName(language));
      expect(result.dayAfterTomorrow).toEqual(day(2));
    });
  }
});
