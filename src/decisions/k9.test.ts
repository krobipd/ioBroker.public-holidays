// K9 — no holiday type selected means no holidays, never silently all.
import { describe, expect, it } from "vitest";
import { parseConfig } from "../lib/config";
import { computeHolidays } from "../lib/holiday-engine";

const SOURCE = {
  getHolidays: (y: number) =>
    y === 2026
      ? [
          { date: "2026-05-01 00:00:00", name: "Labour Day", type: "public", rule: "05-01" },
          { date: "2026-05-02 00:00:00", name: "Bank Day", type: "bank", rule: "05-02" },
          { date: "2026-05-03 00:00:00", name: "Observed Day", type: "observance", rule: "05-03" },
        ]
      : [],
};

const NO_TYPE = {
  country: "DE",
  typePublic: false,
  typeBank: false,
  typeSchool: false,
  typeOptional: false,
  typeObservance: false,
};

describe("K9 no type selected, no holidays", () => {
  it("K9: with every type switched off, the setting holds no type at all", () => {
    expect(parseConfig(NO_TYPE)?.holidayTypes).toEqual([]);
  });

  it("K9: with no type, no day is a holiday and nothing is ahead", () => {
    const config = parseConfig(NO_TYPE);
    expect(config).not.toBeNull();
    const result = computeHolidays(SOURCE as unknown as Parameters<typeof computeHolidays>[0], config!, {
      referenceDate: new Date(2026, 4, 1, 12),
      systemLanguage: "en",
    });
    expect([result.yesterday, result.today, result.tomorrow, result.dayAfterTomorrow].map(d => d.isHoliday)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect(result.next.isHoliday).toBe(false);
  });
});
