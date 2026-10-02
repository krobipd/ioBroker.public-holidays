// K6 — a bridge day is a single working day between two days off, at least one of them a holiday; the weekend
// follows the country.
import { describe, expect, it } from "vitest";
import { buildScopeDays } from "../lib/holiday-shared";

/**
 * The bridge days of a scope whose public holidays fall on these 2026 dates.
 *
 * @param country the country (its weekend)
 * @param dates the holiday dates
 * @returns the bridge-day dates, sorted
 */
function bridges(country: string, dates: string[]): string[] {
  const holidays = dates.map(d => ({ date: `${d} 00:00:00`, name: `Holiday ${d}`, type: "public", rule: d.slice(5) }));
  const source = { getHolidays: (y: number) => holidays.filter(h => h.date.startsWith(`${y}-`)) };
  const { days } = buildScopeDays(source, 2026, {
    types: ["public"],
    excludes: [],
    bridgeDays: true,
    country,
    bridgeName: "Bridge day",
  });
  return [...days.values()]
    .filter(d => d.type === "bridge")
    .map(d => d.date)
    .sort();
}

describe("K6 bridge days", () => {
  it("K6: Thursday holiday, Saturday + Sunday weekend: the Friday is a bridge day", () => {
    expect(bridges("DE", ["2026-05-14"])).toEqual(["2026-05-15"]);
  });

  it("K6: Wednesday holiday, Saturday + Sunday weekend: no single working day, no bridge day", () => {
    expect(bridges("DE", ["2026-05-13"])).toEqual([]);
  });

  it("K6: a working day between two holidays is a bridge day, as are the days to the weekend", () => {
    expect(bridges("DE", ["2026-05-12", "2026-05-14"])).toEqual(["2026-05-11", "2026-05-13", "2026-05-15"]);
  });

  it("K6: Wednesday holiday, Friday + Saturday weekend: the Thursday is a bridge day", () => {
    expect(bridges("IL", ["2026-05-13"])).toEqual(["2026-05-14"]);
  });

  it("K6: Thursday holiday, Friday + Saturday weekend: no bridge day", () => {
    expect(bridges("IL", ["2026-05-14"])).toEqual([]);
  });
});
