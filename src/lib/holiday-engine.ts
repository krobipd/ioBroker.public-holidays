import Holidays from "date-holidays";
import type { AdapterConfig, ComputedHolidays, DayInfo, NextHoliday } from "./types";
import {
  addBridgeDays,
  bridgeDayName,
  buildDayMap,
  detectBridgeKeys,
  excludeKey,
  type HolidayDay,
  type SourceHoliday,
  toHolidayId,
  weekendDays,
} from "./holiday-shared";
import { oneLine } from "./error-utils";

// The type list, the exclude id, the collision rule and the bridge-day algorithm live in
// holiday-shared.ts — the admin card imports the very same module, so there is nothing left to
// keep in sync. Re-exported here because this module is the engine's public face.
export { BRIDGE_DAY_NAMES, toHolidayId } from "./holiday-shared";

/**
 * A holiday exactly as date-holidays hands it over. `start`/`end` are read for ONE thing only — how
 * many days a holiday lasts (holiday-shared `expandHolidayDays`). The calendar key of the first day
 * still comes from the `date` string, never from an instant, which keeps every key time-zone-safe
 * (the reason these two fields were left out until 0.17.0 — and with them every day after the first
 * of a multi-day holiday).
 */
export type RawHoliday = SourceHoliday;

const EMPTY_DAY: DayInfo = { name: "", isHoliday: false };

export interface ComputeOptions {
  /** Reference "today" for deterministic tests; defaults to the current date. */
  referenceDate?: Date;
  /** Pre-built date-holidays instance to reuse instead of constructing a fresh one. */
  instance?: Holidays;
  /**
   * The ioBroker system language. It names the adapter's OWN bridge-day text, which exists in all
   * eleven languages — unlike the holiday names, whose language `languages` decides per what the
   * country's data can deliver. Without it the bridge day follows the data language: a German
   * system with a US scope published "Bridge day" while the card showed "Brückentag" (audit S1).
   */
  systemLanguage?: string;
}

export function computeHolidays(
  config: AdapterConfig,
  languages: string[],
  options: ComputeOptions = {},
): ComputedHolidays {
  const now = options.referenceDate ?? new Date();
  const hd = options.instance ?? createHolidaysInstance(config, languages);
  const bridgeName = bridgeDayName(options.systemLanguage ?? languages[0] ?? "en");
  const { holidays: filtered, unmatchedExcludes } = getFilteredHolidays(hd, now, config, bridgeName);

  const yesterday = getDayInfo(filtered, addDays(now, -1));
  const today = getDayInfo(filtered, now);
  const tomorrow = getDayInfo(filtered, addDays(now, 1));
  const dayAfterTomorrow = getDayInfo(filtered, addDays(now, 2));
  const next = getNextHoliday(filtered, now);

  return { yesterday, today, tomorrow, dayAfterTomorrow, next, unmatchedExcludes };
}

/**
 * The result of a scope with no holidays at all — what `computeHolidays` yields when nothing
 * matches, and the manifest defaults of the twelve states. Published when no country can be
 * resolved, so the previous run's values do not stand forever.
 *
 * @returns an all-empty result
 */
export function emptyResult(): ComputedHolidays {
  return {
    yesterday: EMPTY_DAY,
    today: EMPTY_DAY,
    tomorrow: EMPTY_DAY,
    dayAfterTomorrow: EMPTY_DAY,
    next: { ...EMPTY_DAY, date: "", daysUntil: 0 },
    unmatchedExcludes: [],
  };
}

/**
 * The debug line listing every holiday of the current year with its exclude id — the reference a
 * user needs when an exclude does not match.
 *
 * Only call this when debug output is actually on: it computes a whole extra year and builds the
 * full string before the log level is ever consulted, so an unguarded call did that work once a
 * day for nobody (audit finding F12).
 *
 * @param config the resolved adapter config
 * @param languages the resolved holiday languages
 * @param log the sink for the finished line
 * @param instance the already-built date-holidays instance to reuse
 */
export function logAvailableHolidays(
  config: AdapterConfig,
  languages: string[],
  log: (msg: string) => void,
  instance?: Holidays,
  referenceDate: Date = new Date(),
): void {
  const hd = instance ?? createHolidaysInstance(config, languages);
  const year = referenceDate.getFullYear();
  const holidays = hd.getHolidays(year) as RawHoliday[];
  const matching = holidays
    .filter(h => config.holidayTypes.includes(h.type))
    .map(h => `${toHolidayId(h.name, h.rule)} (${oneLine(h.name)}, ${h.type})`);
  const scope = oneLine(
    `${config.country}${config.state ? `/${config.state}` : ""}${config.region ? `/${config.region}` : ""}`,
  );
  log(`${scope}: ${matching.length} holidays for ${year} — IDs: ${matching.join(", ")}`);
}

// Construct the date-holidays instance for a scope. `languages` is optional so a caller can build
// the instance first, read getLanguages() off it, then set the resolved languages afterwards
// (main.ts) instead of constructing a throwaway second instance just for language detection
// (audit finding L4). No try/catch here on purpose: the only production caller (onReady) wraps the
// whole run in one, so a bogus country surfaces as a logged error + stop(). The admin component
// guards its own `new Holidays()` because it has no such outer handler — the asymmetry is
// intentional (audit finding L4).
export function createHolidaysInstance(config: AdapterConfig, languages?: string[]): Holidays {
  let hd: Holidays;
  if (config.state && config.region) {
    hd = new Holidays(config.country, config.state, config.region);
  } else if (config.state) {
    hd = new Holidays(config.country, config.state);
  } else {
    hd = new Holidays(config.country);
  }
  if (languages) {
    hd.setLanguages(languages);
  }
  return hd;
}

export interface ScopeIssue {
  /**
   * `unloadable`: the state/region exists in date-holidays' data, but its key is written in mixed
   * case and date-holidays upper-cases every key it is handed (`splitName`), so it silently loads the
   * broader scope instead — 12 scopes in 3.37.0 (ten islands of the Cook Islands, NZ Timaru and
   * Buller), measured: all twelve yield exactly the parent's holidays. Nothing the adapter passes
   * reaches them (the object form of the constructor fails the same way).
   */
  kind: "country" | "state" | "region" | "unloadable";
}

/**
 * The key of a map whose spelling matches `wanted` regardless of case — date-holidays upper-cases
 * what it is given, so a hand-written `by` selects BY; only the lookup here was case-sensitive.
 *
 * @param map a code → name map from date-holidays
 * @param wanted the configured code
 * @returns the key as the data spells it, or undefined
 */
function findKey(map: Record<string, string> | undefined, wanted: string): string | undefined {
  const upper = wanted.toUpperCase();
  return Object.keys(map ?? {}).find(k => k.toUpperCase() === upper);
}

/**
 * Whether date-holidays can load a scope key at all (see {@link ScopeIssue} `unloadable`).
 *
 * @param key the state or region key as the data spells it
 * @returns false for a mixed-case key
 */
export function isLoadableScopeKey(key: string): boolean {
  return key === key.toUpperCase();
}

/**
 * Diagnose a misconfigured scope: an unrecognized country (date-holidays returns no holidays at
 * all), or a state/region that does not exist for the selection (date-holidays would silently fall
 * back to a broader scope). Keeps the date-holidays lookups inside the engine — main.ts only turns
 * the result into a log line.
 *
 * At most ONE issue can be reported, and a broken broader level suppresses the more specific
 * checks, so the return type says so directly instead of handing back an array that never holds
 * more than one element (audit finding F14).
 *
 * @param config the resolved adapter config
 * @param languages the resolved holiday languages
 * @param instance the already-built date-holidays instance to reuse
 * @returns the single issue found, or null when the scope is sound
 */
export function detectScopeIssue(
  config: AdapterConfig,
  languages: string[],
  instance?: Holidays,
  referenceDate: Date = new Date(),
): ScopeIssue | null {
  const hd = instance ?? createHolidaysInstance(config, languages);
  if (hd.getHolidays(referenceDate.getFullYear()).length === 0) {
    return { kind: "country" };
  }
  const state = config.state ? findKey(hd.getStates(config.country), config.state) : undefined;
  if (config.state && state === undefined) {
    return { kind: "state" };
  }
  const region =
    config.region && state !== undefined ? findKey(hd.getRegions(config.country, state), config.region) : undefined;
  if (config.region && region === undefined) {
    return { kind: "region" };
  }
  if ((state !== undefined && !isLoadableScopeKey(state)) || (region !== undefined && !isLoadableScopeKey(region))) {
    return { kind: "unloadable" };
  }
  return null;
}

interface FilteredHolidays {
  holidays: Map<string, HolidayDay>;
  unmatchedExcludes: string[];
}

/**
 * Is an exclude still backed by the data? It is when its id occurs, or — for the id of a
 * substitute day, which only exists in the years a holiday is moved — when a holiday with the same
 * date part does (GB Boxing Day's substitute appears in 2026 and 2027, then not before 2032).
 *
 * @param id the excluded id
 * @param ids every id the data offers
 * @param keys the date parts of the non-substitute ids
 * @returns true when the exclude still refers to something
 */
function isKnownExclude(id: string, ids: Set<string>, keys: Set<string>): boolean {
  return ids.has(id) || (id.startsWith("substitutes_") && keys.has(excludeKey(id)));
}

/**
 * The date parts of the non-substitute ids of a set.
 *
 * @param ids holiday ids
 * @returns their date parts
 */
function baseKeys(ids: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const id of ids) {
    if (!id.startsWith("substitutes_")) {
      keys.add(excludeKey(id));
    }
  }
  return keys;
}

function getFilteredHolidays(
  hd: Holidays,
  referenceDate: Date,
  config: AdapterConfig,
  bridgeName: string,
): FilteredHolidays {
  const year = referenceDate.getFullYear();
  const years = [year - 1, year, year + 1];
  const raws = years.flatMap(y => (hd.getHolidays(y) || []) as RawHoliday[]);
  // The list itself is built by the SAME function the card's preview calls (holiday-shared).
  const result = buildDayMap(raws, { types: config.holidayTypes, excludes: config.excludeHolidays });
  if (config.includeBridgeDays) {
    addBridgeDays(result, years, weekendDays(config.country), bridgeName);
  }

  // Every id the configured scope offers, regardless of type or exclude, so the stale-exclude check
  // below can usually answer from it.
  const scopeIds = new Set(raws.map(h => toHolidayId(h.name, h.rule)));

  // An exclude counts as "unmatched" only when its id exists NOWHERE in the country — across the
  // country baseline and every state/region (the same aggregation the exclude dropdown is
  // generated from). A leftover that is still valid in a sibling state (e.g. kept after narrowing
  // state/region) is a harmless no-op and must not warn.
  //
  // That aggregation costs 24 (DE) to 54 (US) date-holidays instances and 110-140 ms, so it only
  // runs when it can still change the answer: the country-wide id set is a SUPERSET of the scope's
  // own ids, so every exclude already found in `scopeIds` is valid and needs no further proof
  // (audit finding F7).
  let unmatchedExcludes: string[] = [];
  const scopeKeys = baseKeys(scopeIds);
  const notInScope = config.excludeHolidays.filter(id => !isKnownExclude(id, scopeIds, scopeKeys));
  if (notInScope.length) {
    const countryWideIds = collectCountryWideIds(config.country, years);
    const countryWideKeys = baseKeys(countryWideIds);
    unmatchedExcludes = notInScope.filter(id => !isKnownExclude(id, countryWideIds, countryWideKeys));
  }
  return { holidays: result, unmatchedExcludes };
}

// Every holiday id that occurs anywhere in a country: the baseline plus every state and
// region. Aggregates the same scopes the admin exclude tier offers (src-admin
// buildExcludeOptions across all state/region combinations) so the runtime "unmatched exclude"
// check stays consistent with what the card lets the user pick. Ids are rule-based
// (language-independent), so this default-language instance lines up with the card's localized one.
function collectCountryWideIds(country: string, years: number[]): Set<string> {
  const ids = new Set<string>();
  const base = new Holidays();
  const add = (instance: Holidays): void => {
    for (const y of years) {
      for (const h of instance.getHolidays(y) || []) {
        ids.add(toHolidayId(h.name, h.rule));
      }
    }
  };

  add(new Holidays(country));
  const states = base.getStates(country);
  if (states) {
    for (const st of Object.keys(states)) {
      add(new Holidays(country, st));
      const regions = base.getRegions(country, st);
      if (regions) {
        for (const rg of Object.keys(regions)) {
          add(new Holidays(country, st, rg));
        }
      }
    }
  }
  return ids;
}

function getDayInfo(holidays: Map<string, HolidayDay>, date: Date): DayInfo {
  const key = toDateKey(date);
  const h = holidays.get(key);
  if (!h) {
    return { ...EMPTY_DAY };
  }
  return {
    name: h.name,
    isHoliday: true,
  };
}

// The next holiday still AHEAD: a holiday running today stays in `today` — so the remaining days of
// the occurrence running today are skipped too (RU on 3 January: today "New Year Holiday", next
// Christmas on 7 January, not "New Year Holiday, in 1 day" four days in a row).
function getNextHoliday(holidays: Map<string, HolidayDay>, referenceDate: Date): NextHoliday {
  const refKey = toDateKey(referenceDate);
  const runningToday = holidays.get(refKey)?.occurrence;
  let nearest: HolidayDay | null = null;
  let nearestKey = "";

  for (const [dateKey, h] of holidays) {
    if (dateKey <= refKey || h.occurrence === runningToday) {
      continue;
    }
    if (!nearest || dateKey < nearestKey) {
      nearest = h;
      nearestKey = dateKey;
    }
  }

  if (!nearest) {
    return { ...EMPTY_DAY, date: "", daysUntil: 0 };
  }

  const refMidnight = new Date(referenceDate);
  refMidnight.setHours(0, 0, 0, 0);
  const nearestDate = new Date(`${nearestKey}T00:00:00`);
  // Local midnight to local midnight is not a whole multiple of 24 h across a DST switch —
  // rounding turns the 23 h / 25 h day back into the calendar distance the user means.
  const daysUntil = Math.round((nearestDate.getTime() - refMidnight.getTime()) / 86400000);

  return {
    name: nearest.name,
    isHoliday: true,
    date: nearestKey,
    daysUntil,
  };
}

/**
 * The bridge days among a map of holidays, as Dates. Thin wrapper over the shared
 * {@link detectBridgeKeys}, which the admin preview reaches through the same day list.
 *
 * @param holidays the holidays known so far, keyed by calendar date (every entry a trigger)
 * @param year only holidays in this year seed a bridge day
 * @param weekend the country's weekend days (Saturday + Sunday when omitted)
 * @returns the bridge days
 */
export function detectBridgeDays(
  holidays: Map<string, unknown>,
  year: number,
  weekend: readonly number[] = weekendDays(""),
): Date[] {
  const keys = new Set(holidays.keys());
  return detectBridgeKeys(keys, keys, year, weekend).map(key => new Date(`${key}T00:00:00`));
}

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
