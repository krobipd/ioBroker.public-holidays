// Pure exclude-list logic for the admin component, deliberately free of React/MUI so a vitest
// test under src/ can import and exercise it directly. src-admin is an isolated
// Module-Federation/Vite bundle — this file must NOT import from src/ (that would risk the MF
// build), which is why the type set and toHolidayId are duplicated here and guarded by
// parity tests (holiday-id-parity.test.ts, exclude-type-flags-parity.test.ts).
import Holidays from "date-holidays";

// MUST stay byte-for-byte in sync with toHolidayId() in src/lib/holiday-engine.ts — the ids
// written by the admin are matched verbatim against the runtime's computed ids. Every
// date-holidays entry carries a rule, so the id is rule-based and language-independent; the
// name branch is only a fallback.
export function toHolidayId(name: string, rule?: string): string {
  if (rule) {
    const clean = rule
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .toLowerCase();
    if (clean.length > 3) {
      return clean;
    }
  }
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

// Holiday type ↔ native config flag ↔ admin default. MUST match HOLIDAY_TYPES in
// src/lib/types.ts (guarded by exclude-type-flags-parity.test.ts). defaultOn mirrors the admin
// default so the option list offers exactly the types the runtime would compute.
export interface AdminTypeFlag {
  type: string;
  flag: string;
  defaultOn: boolean;
}

export const TYPE_FLAGS: AdminTypeFlag[] = [
  { type: "public", flag: "typePublic", defaultOn: true },
  { type: "bank", flag: "typeBank", defaultOn: false },
  { type: "school", flag: "typeSchool", defaultOn: false },
  { type: "optional", flag: "typeOptional", defaultOn: false },
  { type: "observance", flag: "typeObservance", defaultOn: false },
];

// Enabled types given the raw native flags — mirrors validateConfig() in main.ts exactly: a
// defaultOn type counts as enabled unless explicitly false; every other type only when
// explicitly true. (Before, the admin used a plain truthy check, so an unset typePublic hid
// public holidays the runtime still computed — audit finding L1.)
export function enabledTypes(getFlag: (flag: string) => unknown): string[] {
  return TYPE_FLAGS.filter(t => (t.defaultOn ? getFlag(t.flag) !== false : getFlag(t.flag) === true)).map(t => t.type);
}

export interface ExcludeOption {
  id: string;
  label: string;
}

export interface ScopeSelection {
  country: string;
  state: string;
  region: string;
  /** Enabled holiday types; an empty list means "no type filter" (offer all). */
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
// is injectable so the logic is testable without the date-holidays constructor.
export function buildExcludeOptions(
  scope: ScopeSelection,
  lang: string,
  referenceYear: number,
  makeHolidays: MakeHolidays = defaultMakeHolidays,
): ExcludeOption[] {
  if (!scope.country) {
    return [];
  }

  let hd: Holidays;
  try {
    hd =
      scope.state && scope.region
        ? makeHolidays(scope.country, scope.state, scope.region)
        : scope.state
          ? makeHolidays(scope.country, scope.state)
          : makeHolidays(scope.country);
  } catch {
    return [];
  }
  hd.setLanguages([lang]);

  // Cover the same window the runtime evaluates (this year + next) so a holiday that only
  // exists in the coming year can still be picked; dedupe by id, first (earlier year) wins.
  const seen = new Map<string, { name: string; date: string }>();
  for (const year of [referenceYear, referenceYear + 1]) {
    for (const h of hd.getHolidays(year) || []) {
      if (scope.types.length && !scope.types.includes(h.type)) {
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
