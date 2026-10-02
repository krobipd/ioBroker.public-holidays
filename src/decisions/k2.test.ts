// K2 — date-holidays is the only data source, offline.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeHolidays } from "../lib/holiday-engine";

const CONFIG = {
  country: "DE",
  state: "",
  region: "",
  holidayTypes: ["public"],
  excludeHolidays: [],
  includeBridgeDays: false,
};

function compute(
  holidays: { date: string; name: string; type: string; rule: string }[],
): ReturnType<typeof computeHolidays> {
  const source = { getHolidays: (y: number) => holidays.filter(h => h.date.startsWith(`${y}-`)) };
  return computeHolidays(source as unknown as Parameters<typeof computeHolidays>[0], CONFIG, {
    referenceDate: new Date(2026, 4, 1, 12),
    systemLanguage: "en",
  });
}

describe("K2 date-holidays is the only data source", () => {
  it("K2: the adapter depends on nothing but adapter-core and date-holidays at runtime", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@iobroker/adapter-core", "date-holidays"]);
  });

  it("K2: the result is exactly what the date-holidays source holds", () => {
    const result = compute([{ date: "2026-05-01 00:00:00", name: "Labour Day", type: "public", rule: "05-01" }]);
    expect(result.today).toEqual({ name: "Labour Day", isHoliday: true });
    expect(result.next).toEqual({ name: "", isHoliday: false, date: "", daysUntil: 0 });
  });

  it("K2: an empty source gives no holiday at all", () => {
    const result = compute([]);
    expect([result.yesterday, result.today, result.tomorrow, result.dayAfterTomorrow].some(d => d.isHoliday)).toBe(
      false,
    );
    expect(result.next.isHoliday).toBe(false);
  });
});
