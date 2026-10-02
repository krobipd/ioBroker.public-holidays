import Holidays from "date-holidays";
import type { AdapterConfig, ComputedHolidays, DayInfo, NextHoliday } from "./types";
import {
  bridgeDayName,
  buildScopeDays,
  daysBetween,
  excludeKey,
  type HolidayDay,
  isLoadableScopeKey,
  isSubstituteId,
  sameCode,
  shiftKey,
  type SourceHoliday,
  toDateKey,
  toHolidayId,
} from "./holiday-shared";
import { oneLine } from "./log-text";

const EMPTY_DAY: DayInfo = { name: "", isHoliday: false };

/** Options of {@link computeHolidays}. */
export interface ComputeOptions {
  /** Reference "today" for deterministic tests; defaults to the current date. */
  referenceDate?: Date;
  /**
   * The ioBroker system language. It names the adapter's OWN bridge-day text, which exists in all
   * eleven languages — unlike the holiday names, whose language the instance's languages decide per
   * what the country's data can deliver. A German system with a US scope publishes "Brückentag",
   * as the card shows it (audit S1).
   */
  systemLanguage: string;
}

/**
 * The date-holidays instance for a scope. date-holidays treats an empty state/region exactly like
 * none (measured 2026-10-02: all 628 scopes × 2025–2027 identical to the three-way construction).
 * No try/catch here on purpose: the only production caller (onReady) wraps the whole run in one, so
 * a bogus country surfaces as a logged error + stop().
 *
 * @param config the resolved adapter config
 * @returns the instance
 */
export function createHolidaysInstance(config: AdapterConfig): Holidays {
  return new Holidays(config.country, config.state, config.region);
}

/**
 * The published result for a scope: yesterday … the day after tomorrow, the next holiday ahead and
 * the excludes the data no longer backs.
 *
 * @param hd the scope's date-holidays instance, its languages set
 * @param config the resolved adapter config
 * @param options reference date and system language
 * @returns the result to publish
 */
export function computeHolidays(hd: Holidays, config: AdapterConfig, options: ComputeOptions): ComputedHolidays {
  const now = options.referenceDate ?? new Date();
  const todayKey = toDateKey(now);
  const { days, raws, years } = buildScopeDays(hd, now.getFullYear(), {
    types: config.holidayTypes,
    excludes: config.excludeHolidays,
    bridgeDays: config.includeBridgeDays,
    country: config.country,
    bridgeName: bridgeDayName(options.systemLanguage),
  });
  return {
    yesterday: dayInfo(days, shiftKey(todayKey, -1)),
    today: dayInfo(days, todayKey),
    tomorrow: dayInfo(days, shiftKey(todayKey, 1)),
    dayAfterTomorrow: dayInfo(days, shiftKey(todayKey, 2)),
    next: nextHoliday(days, todayKey),
    unmatchedExcludes: unmatchedExcludes(raws, config, years),
  };
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
 * @param hd the scope's date-holidays instance, its languages set
 * @param config the resolved adapter config
 * @param log the sink for the finished line
 * @param referenceDate the date whose year is listed
 */
export function logAvailableHolidays(
  hd: Holidays,
  config: AdapterConfig,
  log: (msg: string) => void,
  referenceDate: Date = new Date(),
): void {
  const year = referenceDate.getFullYear();
  const matching = (hd.getHolidays(year) as SourceHoliday[])
    .filter(h => config.holidayTypes.includes(h.type))
    .map(h => `${toHolidayId(h.name, h.rule)} (${oneLine(h.name)}, ${h.type})`);
  const scope = oneLine([config.country, config.state, config.region].filter(Boolean).join("/"));
  log(`${scope}: ${matching.length} holidays for ${year} — IDs: ${matching.join(", ")}`);
}

/** What is wrong with a configured scope. */
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
 * The key of a code → name map that names the same scope as `wanted` ({@link sameCode}).
 *
 * @param map a code → name map from date-holidays
 * @param wanted the configured code
 * @returns the key as the data spells it, or undefined
 */
function findKey(map: Record<string, string> | undefined, wanted: string): string | undefined {
  return Object.keys(map ?? {}).find(k => sameCode(k, wanted));
}

/**
 * Diagnose a misconfigured scope: an unrecognized country (date-holidays returns no holidays at
 * all), or a state/region that does not exist for the selection (date-holidays would silently fall
 * back to a broader scope). Keeps the date-holidays lookups inside the engine — main.ts only turns
 * the result into a log line. At most ONE issue: a broken broader level suppresses the more
 * specific checks (audit finding F14).
 *
 * @param hd the scope's date-holidays instance
 * @param config the resolved adapter config
 * @param referenceDate the date whose year is probed
 * @returns the single issue found, or null when the scope is sound
 */
export function detectScopeIssue(
  hd: Holidays,
  config: AdapterConfig,
  referenceDate: Date = new Date(),
): ScopeIssue | null {
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
  return ids.has(id) || (isSubstituteId(id) && keys.has(excludeKey(id)));
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
    if (!isSubstituteId(id)) {
      keys.add(excludeKey(id));
    }
  }
  return keys;
}

/**
 * The configured excludes the data no longer backs. An exclude counts as "unmatched" only when its
 * id exists NOWHERE in the country — across the country baseline and every state/region (the same
 * aggregation the exclude dropdown is generated from). A leftover that is still valid in a sibling
 * state (e.g. kept after narrowing state/region) is a harmless no-op and must not warn.
 *
 * That aggregation costs 24 (DE) to 54 (US) date-holidays instances and 110-140 ms, so it only runs
 * when it can still change the answer: the country-wide id set is a SUPERSET of the scope's own ids,
 * so every exclude already found in the scope is valid and needs no further proof (audit finding F7).
 *
 * @param raws every holiday of the scope in the evaluated window
 * @param config the resolved adapter config
 * @param years the years of the evaluated window
 * @returns the excludes no holiday of the country carries
 */
function unmatchedExcludes(raws: readonly SourceHoliday[], config: AdapterConfig, years: number[]): string[] {
  const scopeIds = new Set(raws.map(h => toHolidayId(h.name, h.rule)));
  const scopeKeys = baseKeys(scopeIds);
  const notInScope = config.excludeHolidays.filter(id => !isKnownExclude(id, scopeIds, scopeKeys));
  if (notInScope.length === 0) {
    return [];
  }
  const countryWideIds = collectCountryWideIds(config.country, years);
  const countryWideKeys = baseKeys(countryWideIds);
  return notInScope.filter(id => !isKnownExclude(id, countryWideIds, countryWideKeys));
}

/**
 * Every holiday id that occurs anywhere in a country: the baseline plus every state and region —
 * the same scopes the card's exclude list offers. Ids are rule-based (language-independent), so this
 * default-language instance lines up with the card's localized one.
 *
 * @param country the country code
 * @param years the years to collect
 * @returns the ids
 */
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
  for (const st of Object.keys(base.getStates(country) ?? {})) {
    add(new Holidays(country, st));
    for (const rg of Object.keys(base.getRegions(country, st) ?? {})) {
      add(new Holidays(country, st, rg));
    }
  }
  return ids;
}

/**
 * What a day channel publishes for a calendar key.
 *
 * @param days the day list
 * @param key the calendar key
 * @returns the day's name and flag
 */
function dayInfo(days: Map<string, HolidayDay>, key: string): DayInfo {
  const h = days.get(key);
  return h ? { name: h.name, isHoliday: true } : { ...EMPTY_DAY };
}

/**
 * The next holiday DAY after today. A multi-day holiday running today counts with its next day too —
 * nothing is skipped (krobi 2026-10-02): RU on 3 January gives "New Year Holiday" on 4 January, in
 * 1 day.
 *
 * @param days the day list
 * @param todayKey today's calendar key
 * @returns the next holiday day, or the empty result when none lies ahead
 */
function nextHoliday(days: Map<string, HolidayDay>, todayKey: string): NextHoliday {
  let nearest: HolidayDay | undefined;
  for (const [dateKey, h] of days) {
    if (dateKey > todayKey && (!nearest || dateKey < nearest.date)) {
      nearest = h;
    }
  }
  if (!nearest) {
    return { ...EMPTY_DAY, date: "", daysUntil: 0 };
  }
  return { name: nearest.name, isHoliday: true, date: nearest.date, daysUntil: daysBetween(todayKey, nearest.date) };
}
