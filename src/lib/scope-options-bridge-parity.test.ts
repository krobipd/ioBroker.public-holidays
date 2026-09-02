import { describe, it, expect } from "vitest";
import Holidays from "date-holidays";
import { detectBridgeDays, toDateKey, type RawHoliday } from "./holiday-engine";
import { detectPreviewBridgeDays } from "../../src-admin/src/scope-options";

// The admin preview mirrors the runtime bridge-day algorithm (holiday-engine.detectBridgeDays) but
// on a Set<date-key> instead of a Map<key, holiday> — src-admin can't import from src/ without
// risking the MF build, so the logic is duplicated. This behavioural guard feeds BOTH copies the
// same real holidays and asserts identical bridge output, so any drift makes CI fail instead of
// shipping a preview count that disagrees with the runtime. DE is included on purpose: Ascension
// is always a Thursday, guaranteeing a non-trivial (non-empty) comparison.
const CASES: Array<[string, string]> = [
  ["DE", "BY"],
  ["DE", "NW"],
  ["AT", ""],
  ["US", ""],
  ["FR", ""],
];

describe("bridge-day parity (runtime engine vs admin preview)", () => {
  for (const [country, state] of CASES) {
    for (const year of [2025, 2026, 2027, 2028]) {
      it(`${country}${state ? `/${state}` : ""} ${year}: preview bridges == runtime bridges`, () => {
        const hd = state ? new Holidays(country, state) : new Holidays(country);
        const map = new Map<string, RawHoliday>();
        for (const h of hd.getHolidays(year)) {
          if (h.type !== "public") {
            continue;
          }
          const key = h.date.substring(0, 10);
          map.set(key, { date: key, name: h.name, type: h.type, rule: h.rule });
        }
        const keys = new Set(map.keys());
        const runtime = detectBridgeDays(map, year).map(toDateKey).sort();
        const preview = detectPreviewBridgeDays(keys, year).sort();
        expect(preview).toEqual(runtime);
      });
    }
  }
});
