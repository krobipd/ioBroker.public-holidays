import Holidays from "date-holidays";
import type { AdapterConfig, ComputedHolidays, DayInfo, NextHoliday } from "./types";
import { HOLIDAY_TYPES } from "./types";
import { oneLine } from "./error-utils";

// Exported for unit tests only — production callers stay inside this module.
export interface RawHoliday {
  date: string;
  name: string;
  type: string;
  rule?: string;
}

const EMPTY_DAY: DayInfo = { name: "", isHoliday: false };

// Same-date collision priority: the higher-priority (lower index) type wins, so the
// surviving name is deterministic instead of depending on date-holidays' emit order.
// Unknown types rank last. Order comes from HOLIDAY_TYPES (single source shared with main.ts).
const TYPE_PRIORITY = HOLIDAY_TYPES.map(t => t.key);
function typeRank(type: string): number {
  const i = TYPE_PRIORITY.indexOf(type);
  return i === -1 ? TYPE_PRIORITY.length : i;
}

export const BRIDGE_DAY_NAMES: Record<string, string> = {
  de: "Brückentag",
  en: "Bridge day",
  es: "Día puente",
  fr: "Jour de pont",
  it: "Ponte",
  nl: "Brugdag",
  pl: "Dzień pomostowy",
  pt: "Dia de ponte",
  ru: "Нерабочий день",
  uk: "Неробочий день",
  zh: "桥接日",
};

export function computeHolidays(
  config: AdapterConfig,
  languages: string[],
  referenceDate?: Date,
  instance?: Holidays,
): ComputedHolidays {
  const now = referenceDate ?? new Date();
  const hd = instance ?? createHolidaysInstance(config, languages);
  const { holidays: filtered, unmatchedExcludes } = getFilteredHolidays(hd, now, config, languages);

  const yesterday = getDayInfo(filtered, addDays(now, -1));
  const today = getDayInfo(filtered, now);
  const tomorrow = getDayInfo(filtered, addDays(now, 1));
  const dayAfterTomorrow = getDayInfo(filtered, addDays(now, 2));
  const next = getNextHoliday(filtered, now);

  return { yesterday, today, tomorrow, dayAfterTomorrow, next, unmatchedExcludes };
}

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

export function createHolidaysInstance(config: AdapterConfig, languages: string[]): Holidays {
  let hd: Holidays;
  if (config.state && config.region) {
    hd = new Holidays(config.country, config.state, config.region);
  } else if (config.state) {
    hd = new Holidays(config.country, config.state);
  } else {
    hd = new Holidays(config.country);
  }
  hd.setLanguages(languages);
  return hd;
}

export interface ScopeIssue {
  kind: "country" | "state" | "region";
}

// Diagnostic check for a misconfigured scope: an unrecognized country (date-holidays returns
// no holidays at all), or a state/region that does not exist for the selection (date-holidays
// would silently fall back to a broader scope). Keeps the date-holidays lookups
// (getHolidays/getStates/getRegions) inside the engine — main.ts only turns the result into a
// log line. Mirrors the previous inline behaviour: at most one issue, a broken broader level
// (country) suppresses the more specific checks.
export function detectScopeIssues(config: AdapterConfig, languages: string[], instance?: Holidays): ScopeIssue[] {
  const hd = instance ?? createHolidaysInstance(config, languages);
  if (hd.getHolidays(new Date().getFullYear()).length === 0) {
    return [{ kind: "country" }];
  }
  if (config.state && !hd.getStates(config.country)?.[config.state]) {
    return [{ kind: "state" }];
  }
  if (config.region && !hd.getRegions(config.country, config.state)?.[config.region]) {
    return [{ kind: "region" }];
  }
  return [];
}

interface FilteredHolidays {
  holidays: Map<string, RawHoliday>;
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
  const result = new Map<string, RawHoliday>();

  for (const y of years) {
    const holidays = hd.getHolidays(y) as RawHoliday[];
    for (const h of holidays) {
      if (!config.holidayTypes.includes(h.type)) {
        continue;
      }
      const id = toHolidayId(h.name, h.rule);
      if (config.excludeHolidays.includes(id)) {
        continue;
      }
      const dateKey = h.date.substring(0, 10);
      const existing = result.get(dateKey);
      if (!existing || typeRank(h.type) < typeRank(existing.type)) {
        result.set(dateKey, h);
      }
    }
  }

  if (config.includeBridgeDays) {
    for (const y of years) {
      addBridgeDays(result, y, languages);
    }
  }

  // An exclude counts as "unmatched" only when its id exists NOWHERE in the country —
  // across the country baseline and every state/region (the same aggregation the exclude
  // dropdown is generated from). A leftover that is still valid in a sibling state (e.g.
  // kept after narrowing state/region) is a harmless no-op and must not warn; only a
  // genuine date-holidays rename/removal should. All types are aggregated so a disabled
  // type does not make a still-valid exclude look stale.
  // Skip the country-wide aggregation (dozens of Holidays instances across every state and
  // region) entirely when there is nothing to validate — the common case of no excludes.
  // When there ARE excludes, build the id set ONCE (hoisted out of the filter, not rebuilt
  // once per exclude id).
  let unmatchedExcludes: string[] = [];
  if (config.excludeHolidays.length) {
    const countryWideIds = collectCountryWideIds(config.country, years);
    unmatchedExcludes = config.excludeHolidays.filter(id => !countryWideIds.has(id));
  }
  return { holidays: result, unmatchedExcludes };
}

// Every holiday id that occurs anywhere in a country: the baseline plus every state and
// region. Mirrors scripts/generate-country-data.ts so the runtime "unmatched exclude"
// check stays consistent with the options the admin dropdown offers. Uses date-holidays'
// default language, exactly like the generator, so name-derived ids line up.
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

function getDayInfo(holidays: Map<string, RawHoliday>, date: Date): DayInfo {
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

function getNextHoliday(holidays: Map<string, RawHoliday>, referenceDate: Date): NextHoliday {
  const refKey = toDateKey(referenceDate);
  let nearest: RawHoliday | null = null;
  let nearestDate: Date | null = null;

  for (const [dateKey, h] of holidays) {
    if (dateKey <= refKey) {
      continue;
    }
    const d = new Date(`${dateKey}T00:00:00`);
    if (!nearest || d < nearestDate!) {
      nearest = h;
      nearestDate = d;
    }
  }

  if (!nearest || !nearestDate) {
    return { ...EMPTY_DAY, date: "", daysUntil: 0 };
  }

  const refMidnight = new Date(referenceDate);
  refMidnight.setHours(0, 0, 0, 0);
  const daysUntil = Math.round((nearestDate.getTime() - refMidnight.getTime()) / 86400000);

  return {
    name: nearest.name,
    isHoliday: true,
    date: toDateKey(nearestDate),
    daysUntil,
  };
}

export function detectBridgeDays(holidays: Map<string, RawHoliday>, year: number): Date[] {
  const bridgeDays: Date[] = [];
  for (const [dateKey] of holidays) {
    if (!dateKey.startsWith(String(year))) {
      continue;
    }
    const holidayDate = new Date(`${dateKey}T00:00:00`);
    const dow = holidayDate.getDay();

    if (dow === 4) {
      // Thursday holiday → bridge the Friday before the weekend.
      const friday = addDays(holidayDate, 1);
      if (!holidays.has(toDateKey(friday))) {
        bridgeDays.push(friday);
      }
    }

    if (dow === 2) {
      // Tuesday holiday → bridge the Monday after the weekend.
      const monday = addDays(holidayDate, -1);
      if (!holidays.has(toDateKey(monday))) {
        bridgeDays.push(monday);
      }
      // …and a free Wednesday bracketed by this Tuesday holiday and a Thursday holiday.
      const wednesday = addDays(holidayDate, 1);
      const thursday = addDays(holidayDate, 2);
      if (!holidays.has(toDateKey(wednesday)) && holidays.has(toDateKey(thursday))) {
        bridgeDays.push(wednesday);
      }
    }
  }
  return bridgeDays;
}

function addBridgeDays(holidays: Map<string, RawHoliday>, year: number, languages: string[]): void {
  const lang = languages[0]?.split("-")[0] ?? "en";
  const name = BRIDGE_DAY_NAMES[lang] ?? BRIDGE_DAY_NAMES.en;
  const bridgeDays = detectBridgeDays(holidays, year);
  for (const bd of bridgeDays) {
    const key = toDateKey(bd);
    if (!holidays.has(key)) {
      holidays.set(key, {
        date: key,
        name,
        type: "bridge",
        rule: "",
      });
    }
  }
}

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
