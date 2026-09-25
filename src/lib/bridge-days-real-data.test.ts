import { describe, it, expect } from "vitest";
import Holidays from "date-holidays";
import { detectBridgeKeys, shiftKey, weekendDays } from "./holiday-shared";

// The bridge-day algorithm used to exist twice (runtime + admin preview) and was policed by a
// parity test. Since v0.16.0 both call the SAME function, so comparing them would be a tautology
// (feedback_tautologie_tests_vermeiden). What still has value is running it against REAL holiday
// data and checking the rule itself holds — synthetic maps cannot produce the shapes a year of
// actual holidays does (double Thursdays, holidays on the year boundary, moved days). Since 0.18.0
// the cases include countries whose weekend is not Saturday + Sunday: until then Friday was a
// bridge day in Israel and Saudi Arabia — a day that is off anyway.
const CASES: Array<[string, string]> = [
  ["DE", "BY"],
  ["DE", "NW"],
  ["AT", ""],
  ["US", ""],
  ["FR", ""],
  ["PL", ""],
  ["ES", ""],
  ["IL", ""],
  ["SA", ""],
  ["BD", ""],
  ["IR", ""],
  ["IN", ""],
];
const YEARS = [2025, 2026, 2027, 2028];

function publicHolidayKeys(country: string, state: string, year: number): Set<string> {
  const hd = state ? new Holidays(country, state) : new Holidays(country);
  const keys = new Set<string>();
  for (const y of [year - 1, year, year + 1]) {
    for (const h of hd.getHolidays(y)) {
      if (h.type === "public") {
        keys.add(h.date.substring(0, 10));
      }
    }
  }
  return keys;
}

function weekday(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00`).getDay();
}

describe("bridge days against real holiday data", () => {
  for (const [country, state] of CASES) {
    const weekend = weekendDays(country);
    const isOff = (keys: Set<string>, key: string): boolean => weekend.includes(weekday(key)) || keys.has(key);
    for (const year of YEARS) {
      const label = `${country}${state ? `/${state}` : ""} ${year}`;

      it(`${label}: every bridge day is a working day squeezed between two days off, one of them a holiday`, () => {
        const keys = publicHolidayKeys(country, state, year);
        for (const bridge of detectBridgeKeys(keys, keys, year, weekend)) {
          expect(keys.has(bridge), `${bridge} is itself a holiday`).toBe(false);
          expect(weekend, `${bridge} falls on the weekend`).not.toContain(weekday(bridge));
          const before = shiftKey(bridge, -1);
          const after = shiftKey(bridge, 1);
          expect(isOff(keys, before) && isOff(keys, after), `${bridge} is not squeezed`).toBe(true);
          const seededInYear = [before, after].some(k => keys.has(k) && k.startsWith(String(year)));
          expect(seededInYear, `${bridge} has no holiday of ${year} next to it`).toBe(true);
        }
      });

      it(`${label}: no squeezed working day next to a holiday is missed`, () => {
        const keys = publicHolidayKeys(country, state, year);
        const bridges = new Set(detectBridgeKeys(keys, keys, year, weekend));
        for (const key of keys) {
          if (!key.startsWith(String(year))) {
            continue;
          }
          for (const candidate of [shiftKey(key, -1), shiftKey(key, 1)]) {
            if (
              !isOff(keys, candidate) &&
              isOff(keys, shiftKey(candidate, -1)) &&
              isOff(keys, shiftKey(candidate, 1))
            ) {
              expect(bridges.has(candidate), `${candidate} should bridge the holiday ${key}`).toBe(true);
            }
          }
        }
      });
    }
  }

  it("a Saturday + Sunday country keeps the classic cases", () => {
    const weekend = weekendDays("DE");
    // Thursday → Friday, Tuesday → Monday, Wednesday framed by Tuesday and Thursday.
    expect(detectBridgeKeys(new Set(["2026-05-14"]), ["2026-05-14"], 2026, weekend)).toEqual(["2026-05-15"]);
    expect(detectBridgeKeys(new Set(["2026-06-02"]), ["2026-06-02"], 2026, weekend)).toEqual(["2026-06-01"]);
    const tueThu = new Set(["2026-06-02", "2026-06-04"]);
    expect(new Set(detectBridgeKeys(tueThu, tueThu, 2026, weekend))).toEqual(
      new Set(["2026-06-01", "2026-06-03", "2026-06-05"]),
    );
  });

  it("a weekday framed by two holidays is a bridge day — PL 2 May 2028, ES 7 December 2027", () => {
    const pl = publicHolidayKeys("PL", "", 2028);
    expect(detectBridgeKeys(pl, pl, 2028, weekendDays("PL"))).toContain("2028-05-02");
    const es = publicHolidayKeys("ES", "", 2027);
    expect(detectBridgeKeys(es, es, 2027, weekendDays("ES"))).toContain("2027-12-07");
  });

  it("a Friday + Saturday weekend: Thursday after a Wednesday holiday, never a Friday", () => {
    const weekend = weekendDays("SA");
    // 2026-09-23 (Saudi National Day) is a Wednesday.
    expect(detectBridgeKeys(new Set(["2026-09-23"]), ["2026-09-23"], 2026, weekend)).toEqual(["2026-09-24"]);
    // A Thursday holiday: the Friday is the weekend already, nothing to bridge.
    expect(detectBridgeKeys(new Set(["2026-09-24"]), ["2026-09-24"], 2026, weekend)).toEqual([]);
  });

  it("a Wednesday holiday on its own bridges nothing", () => {
    // 2026-01-07 is a Wednesday; reaching the weekend from there would cost two days off.
    expect(detectBridgeKeys(new Set(["2026-01-07"]), ["2026-01-07"], 2026, weekendDays("DE"))).toEqual([]);
  });

  it("only the trigger keys start a bridge day", () => {
    // Thursday 2026-05-14 is known as a holiday, but is not a trigger (an observance, say).
    expect(detectBridgeKeys(new Set(["2026-05-14"]), [], 2026, weekendDays("DE"))).toEqual([]);
  });
});
