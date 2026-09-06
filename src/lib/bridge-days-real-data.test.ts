import { describe, it, expect } from "vitest";
import Holidays from "date-holidays";
import { detectBridgeKeys, shiftKey } from "./holiday-shared";

// The bridge-day algorithm used to exist twice (runtime + admin preview) and was policed by a
// parity test. Since v0.16.0 both call the SAME function, so comparing them would be a tautology
// (feedback_tautologie_tests_vermeiden). What still has value is running it against REAL holiday
// data and checking the rules themselves hold — synthetic maps cannot produce the shapes a year of
// actual holidays does (double Thursdays, holidays on the year boundary, moved days).
const CASES: Array<[string, string]> = [
  ["DE", "BY"],
  ["DE", "NW"],
  ["AT", ""],
  ["US", ""],
  ["FR", ""],
];
const YEARS = [2025, 2026, 2027, 2028];

function publicHolidayKeys(country: string, state: string, year: number): Set<string> {
  const hd = state ? new Holidays(country, state) : new Holidays(country);
  const keys = new Set<string>();
  for (const h of hd.getHolidays(year)) {
    if (h.type === "public") {
      keys.add(h.date.substring(0, 10));
    }
  }
  return keys;
}

function weekday(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00`).getDay();
}

describe("bridge days against real holiday data", () => {
  for (const [country, state] of CASES) {
    for (const year of YEARS) {
      const label = `${country}${state ? `/${state}` : ""} ${year}`;

      it(`${label}: every bridge day is justified by the rule that produced it`, () => {
        const keys = publicHolidayKeys(country, state, year);
        for (const bridge of detectBridgeKeys(keys, year)) {
          expect(keys.has(bridge), `${bridge} is itself a holiday`).toBe(false);
          const dow = weekday(bridge);
          expect([1, 3, 5], `${bridge} falls on weekday ${dow}`).toContain(dow);
          if (dow === 5) {
            // Friday bridge → the Thursday before must be a holiday.
            expect(keys.has(shiftKey(bridge, -1))).toBe(true);
          } else if (dow === 1) {
            // Monday bridge → the Tuesday after must be a holiday.
            expect(keys.has(shiftKey(bridge, 1))).toBe(true);
          } else {
            // Wednesday bridge → framed by a Tuesday AND a Thursday holiday.
            expect(keys.has(shiftKey(bridge, -1))).toBe(true);
            expect(keys.has(shiftKey(bridge, 1))).toBe(true);
          }
        }
      });

      it(`${label}: no Thursday holiday with a free Friday is missed`, () => {
        const keys = publicHolidayKeys(country, state, year);
        const bridges = new Set(detectBridgeKeys(keys, year));
        for (const key of keys) {
          if (!key.startsWith(String(year)) || weekday(key) !== 4) {
            continue;
          }
          const friday = shiftKey(key, 1);
          if (!keys.has(friday)) {
            expect(bridges.has(friday), `${friday} should bridge the Thursday ${key}`).toBe(true);
          }
        }
      });
    }
  }

  it("a Wednesday holiday on its own bridges nothing", () => {
    // 2026-01-07 is a Wednesday; reaching the weekend from there would cost two days off.
    expect(detectBridgeKeys(new Set(["2026-01-07"]), 2026)).toEqual([]);
  });
});
