// Pure exclude-list logic for the admin card, deliberately free of React/MUI so its tests exercise
// it without rendering.
//
// The holiday id and the substitute rule come from src/lib/holiday-shared.ts — the SAME module the
// runtime uses. Until v0.15.1 both were copied here because an import from `src/` "would risk the
// MF build"; measured 2026-09-06 that is not so (tsc + `npm run build:admin` both pass), so the
// copies and their parity guards are gone.
import type Holidays from "date-holidays";
import {
  formatDayMonth,
  pickHolidayLanguages,
  type SourceHoliday,
  substituteBases,
  toHolidayId,
} from "../../src/lib/holiday-shared.js";
import { type MakeScopedHolidays, makeScopedHolidays, type ScopeSelection } from "./scoped-holidays";

/** One entry of the exclude list. */
export interface ExcludeOption {
  /** The holiday id that is stored. */
  id: string;
  /** "Name (date)". */
  label: string;
}

/**
 * Exclude options for a scope: holidays of exactly country/state/region, named in the language the
 * runtime publishes (the system language, holiday-shared pickHolidayLanguages), restricted to the
 * enabled types, deduped by id (earlier year wins), sorted by MM-DD so a next-year-only holiday
 * slots into the calendar instead of landing at the end. A substitute day is not offered on its
 * own: excluding its holiday takes it along (holiday-shared substituteBases). The window is this
 * year and the next — what a user can still pick; the runtime's wider window (year before included)
 * only matters for its own day list.
 *
 * @param scope the scope and the enabled types
 * @param options the system language, the year shown, the date format and the scope constructor
 * @param options.systemLanguage the ioBroker system language
 * @param options.referenceYear the year shown
 * @param options.dateFormat the system date format (the chips' day/month order)
 * @param options.makeHolidays builds the scope's date-holidays instance
 * @returns the options, in calendar order
 */
export function buildExcludeOptions(
  scope: ScopeSelection,
  options: { systemLanguage: string; referenceYear: number; dateFormat: string; makeHolidays?: MakeScopedHolidays },
): ExcludeOption[] {
  // No country, or no enabled type: the runtime reports nothing, so there is nothing to exclude.
  if (!scope.country || scope.types.length === 0) {
    return [];
  }

  let hd: Holidays;
  try {
    hd = (options.makeHolidays ?? makeScopedHolidays)(scope.country, scope.state, scope.region);
  } catch {
    return [];
  }
  hd.setLanguages(pickHolidayLanguages(options.systemLanguage, hd.getLanguages()));

  const year = options.referenceYear;
  const raws = [year, year + 1].flatMap(y => (hd.getHolidays(y) ?? []) as SourceHoliday[]);
  const substitutes = substituteBases(raws);
  const seen = new Map<string, Pick<SourceHoliday, "name" | "date">>();
  for (const h of raws) {
    if (!scope.types.includes(h.type)) {
      continue;
    }
    const id = toHolidayId(h.name, h.rule);
    if (substitutes.has(id) || seen.has(id)) {
      continue;
    }
    seen.set(id, { name: h.name, date: h.date.substring(0, 10) });
  }

  return Array.from(seen.entries())
    .sort((a, b) => a[1].date.substring(5).localeCompare(b[1].date.substring(5)))
    .map(([id, v]) => ({ id, label: `${v.name} (${formatDayMonth(v.date, options.dateFormat)})` }));
}

/**
 * Stored ids not offered by the current scope (a leftover from a wider region or an older
 * version) — surfaced as removable chips so they are neither hidden nor silently dropped. Pass the
 * options of ALL types: an exclude of a type that is merely switched off is not an orphan (it acts
 * again the moment the type is back), and treating it as one invited the user to delete it.
 *
 * @param value the stored exclude ids
 * @param options the options of ALL types
 * @returns the ids no option carries
 */
export function computeOrphanIds(value: string[], options: ExcludeOption[]): string[] {
  return value.filter(id => !options.some(o => o.id === id));
}

/**
 * Stored ids that belong to the scope but to a type that is switched off — kept, shown apart.
 *
 * @param value the stored exclude ids
 * @param enabled the options of the enabled types
 * @param all the options of all types
 * @returns the ids of switched-off types
 */
export function computeInactiveIds(value: string[], enabled: ExcludeOption[], all: ExcludeOption[]): string[] {
  return value.filter(id => !enabled.some(o => o.id === id) && all.some(o => o.id === id));
}
