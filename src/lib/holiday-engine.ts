import Holidays from "date-holidays";
import type { AdapterConfig, ComputedHolidays, DayInfo, NextHoliday } from "./types";
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
// Unknown types rank last.
const TYPE_PRIORITY = ["public", "bank", "school", "optional", "observance"];
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
  // Every holiday id seen in the data (all types, all years) — used to detect
  // configured excludes that match nothing. Built BEFORE the type filter so a
  // disabled type does not make a still-valid exclude look stale.
  const allIds = new Set<string>();

  for (const y of years) {
    const holidays = hd.getHolidays(y) as RawHoliday[];
    for (const h of holidays) {
      const id = toHolidayId(h.name, h.rule);
      allIds.add(id);
      if (!config.holidayTypes.includes(h.type)) {
        continue;
      }
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

  const unmatchedExcludes = config.excludeHolidays.filter(id => !allIds.has(id));
  return { holidays: result, unmatchedExcludes };
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
    .replace(/[̀-ͯ]/g, "")
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
