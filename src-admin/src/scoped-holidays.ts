// The card's date-holidays construction, in ONE place for the pickers, the exclude list and the
// preview. An empty state/region is the same as none (measured 2026-10-02 over all 628 scopes), so a
// scope is always constructed the same way — the runtime does it alike (holiday-engine
// createHolidaysInstance), against its own copy of date-holidays.
import Holidays from "date-holidays";

/** The scope the card's lists and preview are built for. */
export interface ScopeSelection {
  /** The country code. */
  country: string;
  /** The state code, "" for none. */
  state: string;
  /** The region code, "" for none. */
  region: string;
  /**
   * Enabled holiday types. An empty list means NO holidays at all — exactly what the runtime does
   * (`buildDayMap` keeps only types in this list). The card must not offer or preview holidays the
   * adapter would never report.
   */
  types: string[];
}

/** Builds the date-holidays instance of a scope (injectable, so the lists are testable without the data). */
export type MakeScopedHolidays = (country: string, state: string, region: string) => Holidays;

/**
 * The date-holidays instance of a scope.
 *
 * @param country the country code
 * @param state the state code, "" for none
 * @param region the region code, "" for none
 * @returns the instance
 */
export const makeScopedHolidays: MakeScopedHolidays = (country, state, region) => new Holidays(country, state, region);
