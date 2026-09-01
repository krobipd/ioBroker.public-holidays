// Pure cascade logic for the guided admin card, deliberately free of React/MUI so a vitest test
// under src/ can import and exercise it directly. src-admin is an isolated Module-Federation/Vite
// bundle — this file must NOT import from src/ (that would risk the MF build). The country/state/
// region taxonomy is served client-side from the card's own bundled date-holidays, replacing the
// 145 KB static jsonConfig the generator used to emit. Its bundled version is held equal to the
// runtime's by scripts/check-date-holidays.mjs (guard: date-holidays-version-parity.test.ts).
import Holidays from "date-holidays";
// Explicit .js extension: this module is imported by the src/lib vitest suite, so the ROOT tsconfig
// (node16 ESM resolution) type-checks it too and requires an extension on relative imports. Vite
// and the src-admin tsconfig resolve it to the .ts file all the same.
import { toHolidayId, TYPE_FLAGS } from "./exclude-options.js";

export interface ScopeOption {
  value: string;
  label: string;
}

type MakeHolidays = () => Holidays;
const defaultMakeHolidays: MakeHolidays = () => new Holidays();

// date-holidays returns a `{ code: name }` map (or undefined for an unknown scope). Turn it into
// options labelled "Name (CODE)" — the code stays visible because it is what the runtime stores —
// sorted by the localized name. Backslashes appear in a few raw names and are stripped, matching
// the old generator.
function toOptions(map: Record<string, string> | undefined, lang: string): ScopeOption[] {
  if (!map) {
    return [];
  }
  return Object.entries(map)
    .map(([value, name]) => ({ value, name: name.replace(/\\/g, "") }))
    .sort((a, b) => a.name.localeCompare(b.name, lang))
    .map(({ value, name }) => ({ value, label: `${name} (${value})` }));
}

export function getCountryOptions(lang: string, makeHd: MakeHolidays = defaultMakeHolidays): ScopeOption[] {
  return toOptions(makeHd().getCountries(lang), lang);
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
  /** Enabled holiday types; an empty list means "no type filter" (offer all). */
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

// Same-date collision priority: index in TYPE_FLAGS (public = 0 wins); unknown ranks last.
// Mirrors typeRank in holiday-engine.ts, both sourced from the shared type list — the runtime's
// TYPE_PRIORITY comes from HOLIDAY_TYPES, the admin's from TYPE_FLAGS, kept identical by
// exclude-type-flags-parity.test.ts.
function typeRank(type: string): number {
  const i = TYPE_FLAGS.findIndex(t => t.type === type);
  return i === -1 ? TYPE_FLAGS.length : i;
}

// The holidays the runtime would publish for `scope` in `referenceYear`: type filter + exclude
// filter + same-date dedupe by type priority — mirroring holiday-engine.getFilteredHolidays for a
// single year (the preview shows one year, "N holidays for 2026"). `makeHolidays` is injectable so
// the logic is testable without the date-holidays constructor.
export function buildPreviewHolidays(
  scope: PreviewScope,
  includeBridgeDays: boolean,
  lang: string,
  referenceYear: number,
  makeHolidays: MakeScopedHolidays = defaultMakeScoped,
): PreviewHoliday[] {
  if (!scope.country) {
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

  const byDate = new Map<string, PreviewHoliday>();
  for (const h of hd.getHolidays(referenceYear) || []) {
    if (scope.types.length && !scope.types.includes(h.type)) {
      continue;
    }
    const id = toHolidayId(h.name, h.rule);
    if (scope.excludeHolidays.includes(id)) {
      continue;
    }
    const dateKey = (h.date || "").substring(0, 10);
    const existing = byDate.get(dateKey);
    if (!existing || typeRank(h.type) < typeRank(existing.type)) {
      byDate.set(dateKey, { date: dateKey, name: h.name, type: h.type });
    }
  }

  if (includeBridgeDays) {
    const keys = new Set(byDate.keys());
    for (const bridgeKey of detectPreviewBridgeDays(keys, referenceYear)) {
      // A bridge day never overrides a real holiday (mirrors addBridgeDays in holiday-engine.ts).
      // The localized "bridge day" name is filled in by the card; the preview only needs the date.
      if (!byDate.has(bridgeKey)) {
        byDate.set(bridgeKey, { date: bridgeKey, name: "", type: "bridge" });
      }
    }
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// Shift a YYYY-MM-DD key by whole days, staying on local calendar dates. Parsing with an explicit
// T00:00:00 (never bare "YYYY-MM-DD", which is UTC) keeps the weekday correct in negative-UTC
// zones — the same construction holiday-engine.ts uses.
function shiftKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Bridge days for a set of holiday date-keys in `year`. MUST stay behaviourally identical to
// detectBridgeDays in src/lib/holiday-engine.ts (Thu→Fri, Tue→Mon, plus a Wed bracketed by a Tue
// and a Thu holiday); src-admin can't import it, so it is duplicated and guarded by
// scope-options-bridge-parity.test.ts.
export function detectPreviewBridgeDays(holidayKeys: Set<string>, year: number): string[] {
  const bridges: string[] = [];
  for (const dateKey of holidayKeys) {
    if (!dateKey.startsWith(String(year))) {
      continue;
    }
    const dow = new Date(`${dateKey}T00:00:00`).getDay();
    if (dow === 4) {
      const friday = shiftKey(dateKey, 1);
      if (!holidayKeys.has(friday)) {
        bridges.push(friday);
      }
    }
    if (dow === 2) {
      const monday = shiftKey(dateKey, -1);
      if (!holidayKeys.has(monday)) {
        bridges.push(monday);
      }
      const wednesday = shiftKey(dateKey, 1);
      const thursday = shiftKey(dateKey, 2);
      if (!holidayKeys.has(wednesday) && holidayKeys.has(thursday)) {
        bridges.push(wednesday);
      }
    }
  }
  return bridges;
}
