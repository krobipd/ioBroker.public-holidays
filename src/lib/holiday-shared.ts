// The SINGLE source for everything the runtime (src/) and the admin card (src-admin/) must agree
// on: the holiday type list, the exclude id, the same-date collision rule and the bridge-day
// algorithm including its name.
//
// Until v0.15.1 each of these lived twice — once here, once in src-admin — because "importing from
// src/ would risk the MF build". That was an assertion, never a measurement. Measured 2026-09-06:
// `src-admin` type-checks (`tsc`, noEmit) and bundles (`npm run build:admin`, Vite 8 +
// @module-federation/vite 1.19.1) a relative import from `src/lib/` without complaint. So the
// copies are gone and with them the four parity guards that policed them; what remains is the
// single-source guard (single-source.test.ts), which fails if a second definition reappears.
//
// This file must stay IMPORT-FREE. It is pulled into two independent bundles, and a dependency
// here (date-holidays, ioBroker types, React) would drag that dependency into both.

/** One holiday type: the date-holidays key, its `native` checkbox and the admin default. */
export interface HolidayType {
  key: string;
  flag: string;
  defaultOn: boolean;
}

/**
 * The five holiday types date-holidays emits, in priority order (index 0 wins a same-date
 * collision). `defaultOn` mirrors the admin default — only public is enabled out of the box.
 */
export const HOLIDAY_TYPES: HolidayType[] = [
  { key: "public", flag: "typePublic", defaultOn: true },
  { key: "bank", flag: "typeBank", defaultOn: false },
  { key: "school", flag: "typeSchool", defaultOn: false },
  { key: "optional", flag: "typeOptional", defaultOn: false },
  { key: "observance", flag: "typeObservance", defaultOn: false },
];

const TYPE_PRIORITY = HOLIDAY_TYPES.map(t => t.key);

/**
 * Rank of a holiday type for the same-date collision; unknown types rank last.
 *
 * @param type the date-holidays type
 * @returns the index in {@link HOLIDAY_TYPES}, or one past the end for an unknown type
 */
export function typeRank(type: string): number {
  const i = TYPE_PRIORITY.indexOf(type);
  return i === -1 ? TYPE_PRIORITY.length : i;
}

/**
 * The enabled holiday types for a set of raw `native` flags. A `defaultOn` type counts as enabled
 * unless it is explicitly `false`; every other type only when it is explicitly `true` — the admin
 * card and the runtime must read an unset checkbox the same way.
 *
 * @param getFlag reads one raw native field
 * @returns the enabled type keys, in priority order
 */
export function enabledTypeKeys(getFlag: (flag: string) => unknown): string[] {
  return HOLIDAY_TYPES.filter(t => (t.defaultOn ? getFlag(t.flag) !== false : getFlag(t.flag) === true)).map(
    t => t.key,
  );
}

/**
 * The stable id of a holiday: its calculation rule, cleaned. Ids are written by the admin card and
 * matched verbatim against the ids the runtime computes, so both sides MUST derive them here.
 * Measured against date-holidays 3.36.1 over all 206 countries and 2025-2027: 0 of 10 180 holidays
 * fall back to the name branch — every id comes from the rule and is therefore language-independent.
 *
 * @param name the localized holiday name (fallback only)
 * @param rule the date-holidays calculation rule
 * @returns the id used for excludes and for breaking a collision tie
 */
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

/** The three properties that decide which holiday survives when two land on the same date. */
export interface HolidayRanking {
  type: string;
  /** date-holidays marks a holiday moved off a weekend with `substitute: true`. */
  substitute?: boolean;
  id: string;
}

/**
 * Does `candidate` displace `incumbent` on a date both claim?
 *
 * Three rules, applied in order — all three are total, so the outcome never depends on the order
 * date-holidays happens to emit its holidays in (which is what happened until v0.15.1: measured
 * over 2025-2027 against date-holidays 3.36.1, 77 collisions in 42 countries were decided by emit
 * order alone, so a library update could silently swap the published name):
 *
 * 1. **Type priority** — public beats bank beats school beats optional beats observance.
 * 2. **A real holiday beats a substitute** — where a moved day lands on another holiday, the day
 *    that genuinely belongs there is the one worth reporting (AL, KZ, SZ, TW, VI).
 * 3. **The smaller id wins** — arbitrary but stable and language-independent, for the remaining
 *    case of two substitutes on one date (AG, AI, AL, KR, TT).
 *
 * @param candidate the newly seen holiday
 * @param incumbent the holiday already held for that date
 * @returns true when the candidate should replace the incumbent
 */
export function beats(candidate: HolidayRanking, incumbent: HolidayRanking): boolean {
  const rank = typeRank(candidate.type) - typeRank(incumbent.type);
  if (rank !== 0) {
    return rank < 0;
  }
  const candidateIsSubstitute = candidate.substitute === true;
  const incumbentIsSubstitute = incumbent.substitute === true;
  if (candidateIsSubstitute !== incumbentIsSubstitute) {
    return incumbentIsSubstitute;
  }
  return candidate.id < incumbent.id;
}

/** The bridge-day name per language — the SAME text the card's preview labels a bridge day with. */
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

/**
 * The bridge-day name for a language tag ("zh-cn" → "zh"), English when the language is unknown.
 *
 * @param language an ioBroker language tag
 * @returns the localized bridge-day name
 */
export function bridgeDayName(language: string): string {
  const lang = language.toLowerCase().split("-")[0];
  return BRIDGE_DAY_NAMES[lang] ?? BRIDGE_DAY_NAMES.en;
}

/**
 * Shift a `YYYY-MM-DD` key by whole days, staying on local calendar dates. Parsing with an explicit
 * `T00:00:00` (never the bare key, which JS reads as UTC) keeps the weekday correct in
 * negative-UTC zones.
 *
 * @param dateKey the calendar key to shift
 * @param days whole days to add (may be negative)
 * @returns the shifted calendar key
 */
export function shiftKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The bridge days for a set of holiday date-keys in `year`: a working day squeezed between a
 * holiday and the weekend.
 *
 * - a **Thursday** holiday bridges the **Friday**,
 * - a **Tuesday** holiday bridges the **Monday**,
 * - a **Wednesday** framed by a Tuesday *and* a Thursday holiday is bridged as well.
 *
 * A Wednesday holiday alone bridges nothing (reaching the weekend would need two days off), and a
 * bridge day never lands on a day that already is a holiday.
 *
 * @param holidayKeys every holiday date-key currently known (may span several years)
 * @param year only holidays in this year seed a bridge day
 * @returns the bridge-day calendar keys
 */
export function detectBridgeKeys(holidayKeys: Set<string>, year: number): string[] {
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
