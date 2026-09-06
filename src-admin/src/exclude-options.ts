// Pure exclude-list logic for the admin component, deliberately free of React/MUI so a vitest
// test under src/ can import and exercise it directly.
//
// The holiday id and the type list come from src/lib/holiday-shared.ts — the SAME module the
// runtime uses. Until v0.15.1 both were copied here because an import from `src/` "would risk the
// MF build"; measured 2026-09-06 that is not so (tsc + `npm run build:admin` both pass), so the
// copies and their parity guards are gone. The explicit `.js` extension is required because the
// ROOT tsconfig (node16 ESM resolution) type-checks this file too; Vite and the src-admin tsconfig
// resolve it to the .ts file all the same.
import Holidays from "date-holidays";
import { HOLIDAY_TYPES, enabledTypeKeys, toHolidayId } from "../../src/lib/holiday-shared.js";

export { HOLIDAY_TYPES, enabledTypeKeys, toHolidayId };

export interface ExcludeOption {
  id: string;
  label: string;
}

export interface ScopeSelection {
  country: string;
  state: string;
  region: string;
  /**
   * Enabled holiday types. An empty list means NO holidays at all — exactly what the runtime
   * does (`getFilteredHolidays` keeps only types in this list, so an empty one drops
   * everything). The card must not offer holidays the adapter would never report.
   */
  types: string[];
}

type MakeHolidays = (country: string, state?: string, region?: string) => Holidays;

const defaultMakeHolidays: MakeHolidays = (country, state, region) => {
  if (state && region) {
    return new Holidays(country, state, region);
  }
  if (state) {
    return new Holidays(country, state);
  }
  return new Holidays(country);
};

// Exclude options for a scope: holidays of exactly country/state/region, localized to `lang`,
// restricted to the enabled types, deduped by id (earlier year wins), sorted by MM-DD so a
// next-year-only holiday slots into the calendar instead of landing at the end. `makeHolidays`
// is injectable so the logic is testable without the date-holidays constructor — the DEFAULT
// maker is exercised too (exclude-options.test.ts), because it is the one the admin actually runs
// and a swapped argument would otherwise ship green (audit finding F10).
export function buildExcludeOptions(
  scope: ScopeSelection,
  lang: string,
  referenceYear: number,
  makeHolidays: MakeHolidays = defaultMakeHolidays,
): ExcludeOption[] {
  // No country, or no enabled type: the runtime reports nothing, so there is nothing to exclude.
  if (!scope.country || scope.types.length === 0) {
    return [];
  }

  let hd: Holidays;
  try {
    // The scoped construction (country / +state / +region) lives in the maker itself —
    // empty strings are folded to "absent" here instead of re-branching per call site.
    hd = makeHolidays(scope.country, scope.state || undefined, scope.region || undefined);
  } catch {
    return [];
  }
  hd.setLanguages([lang]);

  // Cover the same window the runtime evaluates (this year + next) so a holiday that only
  // exists in the coming year can still be picked; dedupe by id, first (earlier year) wins.
  const seen = new Map<string, { name: string; date: string }>();
  for (const year of [referenceYear, referenceYear + 1]) {
    for (const h of hd.getHolidays(year) || []) {
      if (!scope.types.includes(h.type)) {
        continue;
      }
      const id = toHolidayId(h.name, h.rule);
      if (!seen.has(id)) {
        seen.set(id, { name: h.name, date: (h.date || "").substring(0, 10) });
      }
    }
  }

  return Array.from(seen.entries())
    .sort((a, b) => a[1].date.substring(5).localeCompare(b[1].date.substring(5)))
    .map(([id, v]) => {
      const [, month, day] = v.date.split("-");
      const dateLabel = month && day ? `${day}.${month}.` : "";
      return { id, label: dateLabel ? `${v.name} (${dateLabel})` : v.name };
    });
}

// Stored ids not offered by the current scope (a leftover from a wider region or an older
// version) — surfaced as removable chips so they are neither hidden nor silently dropped.
export function computeOrphanIds(value: string[], options: ExcludeOption[]): string[] {
  return value.filter(id => !options.some(o => o.id === id));
}
