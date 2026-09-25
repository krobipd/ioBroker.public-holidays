// Pure cascade logic for the guided admin card, deliberately free of React/MUI so a vitest test
// under src/ can import and exercise it directly. The country/state/region taxonomy is served
// client-side from the card's own bundled date-holidays, replacing the 145 KB static jsonConfig
// the generator used to emit. Its bundled version is held equal to the runtime's by
// scripts/check-date-holidays.mjs (guard: date-holidays-version-parity.test.ts).
//
// The collision rule and the bridge-day algorithm come from src/lib/holiday-shared.ts — the SAME
// module the runtime uses, so the preview cannot drift from what gets published. The explicit
// `.js` extension is required because the ROOT tsconfig (node16 ESM resolution) type-checks this
// file too.
import Holidays from "date-holidays";
import {
  addBridgeDays,
  buildDayMap,
  pickHolidayLanguages,
  type SourceHoliday,
  weekendDays,
} from "../../src/lib/holiday-shared.js";

export interface ScopeOption {
  value: string;
  label: string;
  /**
   * The key is written in mixed case, which date-holidays cannot load (it upper-cases every key and
   * silently falls back to the broader scope) — the card says so instead of pretending.
   */
  unloadable?: boolean;
}

type MakeHolidays = () => Holidays;
const defaultMakeHolidays: MakeHolidays = () => new Holidays();

// date-holidays returns a `{ code: name }` map (or undefined for an unknown scope). Turn it into
// options labelled "Name (CODE)" — the code stays visible because it is what the runtime stores —
// sorted by the localized name. Backslashes appear in a few raw names and are stripped, matching
// the old generator.
function toOptions(
  map: Record<string, string> | undefined,
  lang: string,
  label: (value: string, name: string) => string = (_value, name) => name,
): ScopeOption[] {
  if (!map) {
    return [];
  }
  return Object.entries(map)
    .map(([value, name]) => ({ value, name: label(value, name.replace(/\\/g, "")) }))
    .sort((a, b) => a.name.localeCompare(b.name, lang))
    .map(({ value, name }) => ({
      value,
      label: `${name} (${value})`,
      ...(value === value.toUpperCase() ? {} : { unloadable: true }),
    }));
}

/**
 * The display name of a country in the admin language. date-holidays translates country names for
 * a handful of countries only (German: 12 of 207), so a German list read "日本 (JP)" and
 * "Ελλάδα (GR)", and a search for "Japan" found nothing. `Intl.DisplayNames` knows every ISO region
 * in every browser language; `fallback: "none"` makes it say "unknown" (undefined) instead of echoing
 * the bare code, so the library's own name stays the fallback.
 *
 * @param lang the admin language
 * @returns a code → label function
 */
function regionNamer(lang: string): (code: string, fallback: string) => string {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([lang === "zh-cn" ? "zh-Hans" : lang], { type: "region", fallback: "none" });
  } catch {
    names = null;
  }
  return (code, fallback) => {
    try {
      return names?.of(code) ?? fallback;
    } catch {
      // A code Intl does not accept as a region (none today — a guard, not a case).
      return fallback;
    }
  };
}

export function getCountryOptions(lang: string, makeHd: MakeHolidays = defaultMakeHolidays): ScopeOption[] {
  return toOptions(makeHd().getCountries(lang), lang, regionNamer(lang));
}

export function getStateOptions(
  country: string,
  lang: string,
  makeHd: MakeHolidays = defaultMakeHolidays,
): ScopeOption[] {
  if (!country) {
    return [];
  }
  return toOptions(makeHd().getStates(country, lang), lang);
}

export function getRegionOptions(
  country: string,
  state: string,
  lang: string,
  makeHd: MakeHolidays = defaultMakeHolidays,
): ScopeOption[] {
  if (!country || !state) {
    return [];
  }
  return toOptions(makeHd().getRegions(country, state, lang), lang);
}

// --- live preview of the holidays the runtime would compute for the current scope ---

export interface PreviewScope {
  country: string;
  state: string;
  region: string;
  /**
   * Enabled holiday types. An empty list means NO holidays at all — the same thing the runtime
   * does (`buildDayMap` keeps only types in this list). The preview would otherwise show a full
   * year of holidays for a configuration that publishes nothing.
   */
  types: string[];
  excludeHolidays: string[];
}

export interface PreviewHoliday {
  /** Calendar date YYYY-MM-DD. */
  date: string;
  name: string;
  type: string;
}

type MakeScopedHolidays = (country: string, state?: string, region?: string) => Holidays;
const defaultMakeScoped: MakeScopedHolidays = (country, state, region) => {
  if (state && region) {
    return new Holidays(country, state, region);
  }
  if (state) {
    return new Holidays(country, state);
  }
  return new Holidays(country);
};

// The holidays the runtime would publish for `scope` in `referenceYear`, built by the SAME
// functions the runtime uses (holiday-shared buildDayMap + addBridgeDays) over the SAME three-year
// window, then cut to the year shown ("N holidays for 2026") — a bridge day across the year boundary
// (31 December before a Friday New Year) is decided the same way on both sides. Names come in the
// language the runtime publishes, the system language (holiday-shared pickHolidayLanguages).
// `makeHolidays` is injectable so the logic is testable without the date-holidays constructor; the
// DEFAULT maker is exercised too (scope-options.test.ts), because it is the one the admin actually
// runs (audit finding F10).
export function buildPreviewHolidays(
  scope: PreviewScope,
  includeBridgeDays: boolean,
  systemLanguage: string,
  referenceYear: number,
  makeHolidays: MakeScopedHolidays = defaultMakeScoped,
): PreviewHoliday[] {
  // No country, or no enabled type: the runtime publishes nothing, so the preview shows nothing.
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
  hd.setLanguages(pickHolidayLanguages(systemLanguage, hd.getLanguages?.() ?? []));

  const years = [referenceYear - 1, referenceYear, referenceYear + 1];
  const raws = years.flatMap(y => (hd.getHolidays(y) || []) as SourceHoliday[]);
  const days = buildDayMap(raws, { types: scope.types, excludes: scope.excludeHolidays });
  if (includeBridgeDays) {
    // The localized "bridge day" name is filled in by the card; the preview only needs the date.
    addBridgeDays(days, years, weekendDays(scope.country), "");
  }

  const prefix = String(referenceYear);
  return Array.from(days.values())
    .filter(d => d.date.startsWith(prefix))
    .map(({ date, name, type }) => ({ date, name, type }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
