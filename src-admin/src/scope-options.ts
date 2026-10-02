// Pure cascade logic for the guided admin card, deliberately free of React/MUI so its tests exercise
// it without rendering. The country/state/region taxonomy is served
// client-side from the card's own bundled date-holidays, replacing the 145 KB static jsonConfig
// the generator used to emit. Its bundled version is held equal to the runtime's by
// `npm run update:date-holidays` (guard: date-holidays-currency.test.ts).
//
// The collision rule and the bridge-day algorithm come from src/lib/holiday-shared.ts — the SAME
// module the runtime uses, so the preview cannot drift from what gets published.
import Holidays from "date-holidays";
import { buildScopeDays, isLoadableScopeKey, pickHolidayLanguages } from "../../src/lib/holiday-shared.js";
import { type MakeScopedHolidays, makeScopedHolidays, type ScopeSelection } from "./scoped-holidays";

/** One entry of a country/state/region picker. */
export interface ScopeOption {
  /** The code that is stored. */
  value: string;
  /** "Name (CODE)". */
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
      ...(isLoadableScopeKey(value) ? {} : { unloadable: true }),
    }));
}

/**
 * The display name of a country in the admin language. date-holidays translates country names for
 * a handful of countries only, so a German list read "日本 (JP)" and
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

/**
 * The country options in the admin language.
 *
 * @param lang the admin language
 * @param makeHd builds a date-holidays instance
 * @returns the options, sorted by name
 */
export function getCountryOptions(lang: string, makeHd: MakeHolidays = defaultMakeHolidays): ScopeOption[] {
  return toOptions(makeHd().getCountries(lang), lang, regionNamer(lang));
}

/**
 * The state options of a country.
 *
 * @param country the country code
 * @param lang the admin language
 * @param makeHd builds a date-holidays instance
 * @returns the options, sorted by name; [] without a country
 */
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

/**
 * The region options of a state.
 *
 * @param country the country code
 * @param state the state code
 * @param lang the admin language
 * @param makeHd builds a date-holidays instance
 * @returns the options, sorted by name; [] without country and state
 */
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

/** The scope the preview is built for: the selection plus what the runtime filters by. */
export interface PreviewScope extends ScopeSelection {
  /** The excluded holiday ids. */
  excludeHolidays: string[];
  /** Whether bridge days are reported. */
  includeBridgeDays: boolean;
}

/** One chip of the preview. */
export interface PreviewHoliday {
  /** Calendar date YYYY-MM-DD. */
  date: string;
  /** The holiday name ("" for a bridge day — the card names it). */
  name: string;
  /** The date-holidays type, or "bridge". */
  type: string;
}

/**
 * The holidays the runtime would publish for `scope` in `referenceYear`, built by the SAME function
 * the runtime uses (holiday-shared buildScopeDays, the same three-year window), then cut to the year
 * shown ("N holidays for 2026") — a bridge day across the year boundary (31 December before a Friday
 * New Year) is decided the same way on both sides. Names come in the language the runtime publishes,
 * the system language (holiday-shared pickHolidayLanguages).
 *
 * @param scope the scope, the enabled types, the excludes and the bridge-day switch
 * @param options the system language, the year shown and the scope constructor
 * @param options.systemLanguage the ioBroker system language
 * @param options.referenceYear the year shown
 * @param options.makeHolidays builds the scope's date-holidays instance
 * @returns the days of the year, in date order
 */
export function buildPreviewHolidays(
  scope: PreviewScope,
  options: { systemLanguage: string; referenceYear: number; makeHolidays?: MakeScopedHolidays },
): PreviewHoliday[] {
  // No country, or no enabled type: the runtime publishes nothing, so the preview shows nothing.
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

  // The localized "bridge day" name is filled in by the card; the preview only needs the date.
  const { days } = buildScopeDays(hd, options.referenceYear, {
    types: scope.types,
    excludes: scope.excludeHolidays,
    bridgeDays: scope.includeBridgeDays,
    country: scope.country,
    bridgeName: "",
  });
  const prefix = String(options.referenceYear);
  return Array.from(days.values())
    .filter(d => d.date.startsWith(prefix))
    .map(({ date, name, type }) => ({ date, name, type }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
