import Holidays from "date-holidays";
import type { AdapterConfig, ComputedHolidays, DayInfo, NextHoliday } from "./types";
import { beats, bridgeDayName, detectBridgeKeys, toHolidayId } from "./holiday-shared";
import { oneLine } from "./error-utils";

// The type list, the exclude id, the collision rule and the bridge-day algorithm live in
// holiday-shared.ts — the admin card imports the very same module, so there is nothing left to
// keep in sync. Re-exported here because this module is the engine's public face.
export { BRIDGE_DAY_NAMES, toHolidayId } from "./holiday-shared";

/** A holiday exactly as date-holidays hands it over. */
export interface RawHoliday {
  date: string;
  name: string;
  type: string;
  rule?: string;
  /** date-holidays sets this on a holiday that was moved off a weekend. */
  substitute?: boolean;
}

/** A holiday that survived the filters, with the id it was matched by. */
interface ScopedHoliday extends RawHoliday {
  id: string;
}

const EMPTY_DAY: DayInfo = { name: "", isHoliday: false };

export interface ComputeOptions {
  /** Reference "today" for deterministic tests; defaults to the current date. */
  referenceDate?: Date;
  /** Pre-built date-holidays instance to reuse instead of constructing a fresh one. */
  instance?: Holidays;
}

export function computeHolidays(
  config: AdapterConfig,
  languages: string[],
  options: ComputeOptions = {},
): ComputedHolidays {
  const now = options.referenceDate ?? new Date();
  const hd = options.instance ?? createHolidaysInstance(config, languages);
  const { holidays: filtered, unmatchedExcludes } = getFilteredHolidays(hd, now, config, languages);

  const yesterday = getDayInfo(filtered, addDays(now, -1));
  const today = getDayInfo(filtered, now);
  const tomorrow = getDayInfo(filtered, addDays(now, 1));
  const dayAfterTomorrow = getDayInfo(filtered, addDays(now, 2));
  const next = getNextHoliday(filtered, now);

  return { yesterday, today, tomorrow, dayAfterTomorrow, next, unmatchedExcludes };
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
): void {
  const hd = instance ?? createHolidaysInstance(config, languages);
  const year = new Date().getFullYear();
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
  kind: "country" | "state" | "region";
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
export function detectScopeIssue(config: AdapterConfig, languages: string[], instance?: Holidays): ScopeIssue | null {
  const hd = instance ?? createHolidaysInstance(config, languages);
  if (hd.getHolidays(new Date().getFullYear()).length === 0) {
    return { kind: "country" };
  }
  if (config.state && !hd.getStates(config.country)?.[config.state]) {
    return { kind: "state" };
  }
  if (config.region && !hd.getRegions(config.country, config.state)?.[config.region]) {
    return { kind: "region" };
  }
  return null;
}

interface FilteredHolidays {
  holidays: Map<string, ScopedHoliday>;
  unmatchedExcludes: string[];
}

function getFilteredHolidays(
  hd: Holidays,
  referenceDate: Date,
  config: AdapterConfig,
  languages: string[],
): FilteredHolidays {
  const year = referenceDate.getFullYear();
  const years = [year - 1, year, year + 1];
  const result = new Map<string, ScopedHoliday>();
  // Every id the configured scope offers, regardless of type or exclude — collected while we walk
  // the data anyway, so the stale-exclude check below can usually answer from it (see there).
  const scopeIds = new Set<string>();

  for (const y of years) {
    const holidays = hd.getHolidays(y) as RawHoliday[];
    for (const h of holidays) {
      const id = toHolidayId(h.name, h.rule);
      scopeIds.add(id);
      if (!config.holidayTypes.includes(h.type)) {
        continue;
      }
      if (config.excludeHolidays.includes(id)) {
        continue;
      }
      const dateKey = h.date.substring(0, 10);
      const existing = result.get(dateKey);
      const candidate: ScopedHoliday = { ...h, id };
      if (!existing || beats(candidate, existing)) {
        result.set(dateKey, candidate);
      }
    }
  }

  if (config.includeBridgeDays) {
    for (const y of years) {
      addBridgeDays(result, y, languages);
    }
  }

  // An exclude counts as "unmatched" only when its id exists NOWHERE in the country — across the
  // country baseline and every state/region (the same aggregation the exclude dropdown is
  // generated from). A leftover that is still valid in a sibling state (e.g. kept after narrowing
  // state/region) is a harmless no-op and must not warn; only a genuine date-holidays
  // rename/removal should.
  //
  // That aggregation costs 24 (DE) to 54 (US) date-holidays instances and 110-140 ms, so it only
  // runs when it can still change the answer: the country-wide id set is a SUPERSET of the scope's
  // own ids, so every exclude already found in `scopeIds` is valid and needs no further proof. In
  // the normal case — all excludes still match — the expensive walk is skipped entirely
  // (audit finding F7).
  let unmatchedExcludes: string[] = [];
  if (config.excludeHolidays.length) {
    const notInScope = config.excludeHolidays.filter(id => !scopeIds.has(id));
    if (notInScope.length) {
      const countryWideIds = collectCountryWideIds(config.country, years);
      unmatchedExcludes = notInScope.filter(id => !countryWideIds.has(id));
    }
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

function getDayInfo(holidays: Map<string, ScopedHoliday>, date: Date): DayInfo {
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

function getNextHoliday(holidays: Map<string, ScopedHoliday>, referenceDate: Date): NextHoliday {
  const refKey = toDateKey(referenceDate);
  let nearest: ScopedHoliday | null = null;
  let nearestKey = "";

  for (const [dateKey, h] of holidays) {
    if (dateKey <= refKey) {
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
 * {@link detectBridgeKeys}, which the admin preview calls with the same keys.
 *
 * @param holidays the holidays known so far, keyed by calendar date
 * @param year only holidays in this year seed a bridge day
 * @returns the bridge days
 */
export function detectBridgeDays(holidays: Map<string, ScopedHoliday | RawHoliday>, year: number): Date[] {
  return detectBridgeKeys(new Set(holidays.keys()), year).map(key => new Date(`${key}T00:00:00`));
}

function addBridgeDays(holidays: Map<string, ScopedHoliday>, year: number, languages: string[]): void {
  const name = bridgeDayName(languages[0] ?? "en");
  for (const key of detectBridgeKeys(new Set(holidays.keys()), year)) {
    if (!holidays.has(key)) {
      holidays.set(key, {
        date: key,
        name,
        type: "bridge",
        rule: "",
        id: `bridge_${key}`,
      });
    }
  }
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
