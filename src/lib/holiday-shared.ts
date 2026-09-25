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
  ru: "День-мост",
  uk: "День-міст",
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

/** The languages the adapter can present holiday names in (ioBroker languages, "zh-cn" as "zh"). */
export const SUPPORTED_LANGS = ["de", "en", "es", "fr", "it", "nl", "pl", "pt", "ru", "uk", "zh"];

/**
 * The languages to ask date-holidays for: the system language when the country's data carries it,
 * with English behind it as the fallback; English alone otherwise. The runtime AND the card's preview
 * and exclude list use this, so the names the card shows are the names the adapter publishes —
 * until 0.17.0 the card asked for the admin language alone, date-holidays then fell back to the
 * country's own language, and 10 of 11 languages showed names that never reached a state.
 *
 * @param systemLang the ioBroker system language ("de", "zh-cn", ...)
 * @param available the languages the country's data carries (`Holidays#getLanguages()`)
 * @returns the languages to set, most preferred first
 */
export function pickHolidayLanguages(systemLang: string, available: readonly string[]): string[] {
  const lang = systemLang.toLowerCase().split("-")[0];
  if (!SUPPORTED_LANGS.includes(lang) || !available.includes(lang)) {
    return ["en"];
  }
  return lang === "en" ? ["en"] : [lang, "en"];
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
 * The weekday of a calendar key, 0 = Sunday … 6 = Saturday.
 *
 * @param dateKey the calendar key
 * @returns the weekday number
 */
function weekday(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00`).getDay();
}

// --- holidays that last several days -------------------------------------------------------------

/** A holiday as date-holidays hands it over — only the fields the day list reads. */
export interface SourceHoliday {
  /** Local start as "YYYY-MM-DD hh:mm:ss", with " -hhmm" when it begins on the eve. */
  date: string;
  /** Start instant (date-holidays computes it in the country's time zone). */
  start?: Date;
  /** End instant, exclusive. */
  end?: Date;
  name: string;
  type: string;
  rule?: string;
  /** date-holidays sets this on a holiday that was moved off a weekend. */
  substitute?: boolean;
}

const DAY_MS = 86400000;
const NOON_MS = 43200000;
const DATE_TIME = /^\d{4}-\d{2}-\d{2} (\d{2}):(\d{2}):(\d{2})(?: ([+-])(\d{2})(\d{2}))?/;

/**
 * The local time a holiday starts at on its first day, in ms after midnight, and the offset of an
 * eve start. `null` when the date string carries no time (defensive — date-holidays always does).
 *
 * @param date the date-holidays date string
 */
function startClock(date: string): { timeMs: number; eveMs: number } | null {
  const m = DATE_TIME.exec(date);
  if (!m) {
    return null;
  }
  const timeMs = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
  const offsetMs = m[4] ? (Number(m[5]) * 60 + Number(m[6])) * 60000 : 0;
  // " -0600" = the holiday starts six hours BEFORE midnight of its date (Hebrew/Hijri days begin at dusk).
  return { timeMs, eveMs: m[4] === "-" ? offsetMs : -offsetMs };
}

/**
 * Whether a holiday covers its first day from the start — it begins at local midnight or on the
 * eve. A part-day entry (DE Christmas Eve from 14:00) is a holiday, but not a day off that can
 * make the next working day a bridge day.
 *
 * @param h the holiday
 * @returns true for a whole-day holiday
 */
export function isFullDay(h: Pick<SourceHoliday, "date">): boolean {
  const clock = startClock(h.date);
  return clock === null || clock.timeMs === 0;
}

/**
 * Every calendar day a holiday covers. The first day is the calendar date date-holidays names
 * (never derived from an instant — that keeps the key time-zone-safe); every further day counts
 * when the holiday still runs at noon local time on it. date-holidays models multi-day holidays
 * as ONE entry with a duration (`01-02 P5D`, `1 Shawwal PT90H`) — until 0.17.0 only the first day
 * was reported, in 30 countries' default configuration (RU New Year holidays, KR Seollal/Chuseok,
 * VN Tết, Eid in TR/SA/EG/PK …). The eve of a Hebrew/Hijri holiday (from dusk) is not a day.
 *
 * Local midnight of the first day is `start − start time + eve offset`, noon of day k is that plus
 * k days and 12 h — pure arithmetic on the instants date-holidays computed, no time-zone library;
 * a daylight-saving switch moves it by an hour, which noon absorbs.
 *
 * @param h the holiday
 * @returns the calendar keys, first day first
 */
export function expandHolidayDays(h: Pick<SourceHoliday, "date" | "start" | "end">): string[] {
  const first = h.date.substring(0, 10);
  const keys = [first];
  const clock = startClock(h.date);
  if (!clock || !(h.start instanceof Date) || !(h.end instanceof Date)) {
    return keys;
  }
  const midnight = h.start.getTime() - clock.timeMs + clock.eveMs;
  const end = h.end.getTime();
  // 60 days is far beyond any holiday date-holidays carries (the longest is 9 days) — a guard
  // against a malformed duration, not a limit anyone reaches.
  for (let k = 1; k < 60 && midnight + k * DAY_MS + NOON_MS < end; k++) {
    keys.push(shiftKey(first, k));
  }
  return keys;
}

// --- weekend and bridge days ---------------------------------------------------------------------

/**
 * Countries whose weekend is not Saturday + Sunday (0 = Sunday … 6 = Saturday). Source: the
 * weekend data date-holidays itself carries (BD — the only entry that differs from Saturday +
 * Sunday), otherwise Unicode CLDR weekData as Node's `Intl.Locale#getWeekInfo` reports it (the
 * guard weekend.test.ts holds this table against both for every country date-holidays knows).
 */
const WEEKEND_EXCEPTIONS: Record<string, readonly number[]> = {
  BD: [5, 6],
  BH: [5, 6],
  DZ: [5, 6],
  EG: [5, 6],
  IL: [5, 6],
  LY: [5, 6],
  SA: [5, 6],
  SD: [5, 6],
  IR: [5],
  IN: [0],
  UG: [0],
};

/**
 * The weekend days of a country.
 *
 * @param country the alpha-2 country code
 * @returns the weekday numbers (0 = Sunday … 6 = Saturday)
 */
export function weekendDays(country: string): readonly number[] {
  return WEEKEND_EXCEPTIONS[country.toUpperCase()] ?? [6, 0];
}

/** The holiday types that are a day off — only these make a neighbouring working day a bridge day. */
export const BRIDGE_TRIGGER_TYPES = ["public", "bank"];

/**
 * The bridge days in `year`: a working day squeezed between two days off, at least one of them a
 * holiday — so a single day off bridges the gap to the weekend or to the next holiday. With a
 * Saturday + Sunday weekend that is a Friday after a Thursday holiday, a Monday before a Tuesday
 * holiday, and a weekday framed by two holidays (Wednesday between Tuesday and Thursday, Tuesday
 * between Monday and Wednesday …). The weekend is the country's own: a Friday + Saturday weekend
 * makes Thursday the bridge after a Wednesday holiday, and never a Friday.
 *
 * A bridge day never lands on a weekend day or on a holiday, and a bridge day never makes another
 * one (`holidayKeys` holds the holidays only).
 *
 * @param holidayKeys every holiday date-key currently known (may span several years)
 * @param triggerKeys the holiday date-keys that may start a bridge (whole-day days off)
 * @param year only triggers in this year start a bridge day
 * @param weekend the country's weekend days
 * @returns the bridge-day calendar keys
 */
export function detectBridgeKeys(
  holidayKeys: Set<string>,
  triggerKeys: Iterable<string>,
  year: number,
  weekend: readonly number[],
): string[] {
  const isOff = (key: string): boolean => weekend.includes(weekday(key)) || holidayKeys.has(key);
  const bridges = new Set<string>();
  const prefix = String(year);
  for (const trigger of triggerKeys) {
    if (!trigger.startsWith(prefix)) {
      continue;
    }
    for (const candidate of [shiftKey(trigger, -1), shiftKey(trigger, 1)]) {
      if (!isOff(candidate) && isOff(shiftKey(candidate, -1)) && isOff(shiftKey(candidate, 1))) {
        bridges.add(candidate);
      }
    }
  }
  return [...bridges];
}

// --- excluding a holiday together with its substitutes -------------------------------------------

const CONDITION = /_(?:if|not_on|and)_/;

/**
 * The date part of a holiday id — the id without the `substitutes_` prefix, cut before its first
 * condition: `substitutes_12-26_if_saturday_then_next_monday` and `12-26` both give `12-26`.
 * Measured over all 628 scopes and 2020-2035 (date-holidays 3.37.0): every substitute id carries
 * an `_if_` (some as `_and_if_`), a few base ids a `_not_on_`.
 *
 * @param id a holiday id
 * @returns its date part
 */
export function excludeKey(id: string): string {
  const s = id.startsWith("substitutes_") ? id.slice("substitutes_".length) : id;
  const m = CONDITION.exec(s);
  return m ? s.slice(0, m.index) : s;
}

/**
 * Whether an entry is a moved day: flagged by date-holidays, or computed by a `substitutes` rule
 * (HK "The first weekday after Christmas Day" carries the rule but not the flag).
 *
 * @param h the holiday
 * @param id its id
 */
function isSubstituteEntry(h: Pick<SourceHoliday, "substitute">, id: string): boolean {
  return h.substitute === true || id.startsWith("substitutes_");
}

/**
 * Which holiday each substitute day stands in for, as id → id. A substitute (GB "Boxing Day
 * (substitute day)" on 2026-12-28) has an id of its own, so excluding Boxing Day used to leave its
 * substitute standing. A substitute is attributed to the one non-substitute holiday of the same
 * scope with the same {@link excludeKey}; where several share it (US-TX: Emancipation Day and
 * Juneteenth, both 06-19), to the one whose name starts the substitute's name; otherwise to none —
 * a wrong attribution would silently drop another holiday's day.
 *
 * @param raws every holiday of the scope in the evaluated window, all types
 * @returns substitute id → the id of the holiday it replaces
 */
export function substituteBases(raws: readonly SourceHoliday[]): Map<string, string> {
  const bases = new Map<string, Map<string, string>>();
  for (const h of raws) {
    const id = toHolidayId(h.name, h.rule);
    if (!isSubstituteEntry(h, id)) {
      const key = excludeKey(id);
      const named = bases.get(key) ?? new Map<string, string>();
      named.set(id, h.name);
      bases.set(key, named);
    }
  }
  const result = new Map<string, string>();
  for (const h of raws) {
    const id = toHolidayId(h.name, h.rule);
    if (!isSubstituteEntry(h, id) || result.has(id)) {
      continue;
    }
    const candidates = bases.get(excludeKey(id));
    if (!candidates) {
      continue;
    }
    const ids = [...candidates.keys()];
    const chosen = ids.length === 1 ? ids : ids.filter(base => h.name.startsWith(candidates.get(base) ?? "\u0000"));
    if (chosen.length === 1 && chosen[0] !== id) {
      result.set(id, chosen[0]);
    }
  }
  return result;
}

// --- the day list the runtime publishes and the card previews ------------------------------------

/** One calendar day of the result. */
export interface HolidayDay extends HolidayRanking {
  /** Calendar date YYYY-MM-DD. */
  date: string;
  name: string;
  /** The date-holidays type, or "bridge". */
  type: string;
  /** The holiday occurrence the day belongs to (`<id>@<first day>`) — tells "the same holiday, next day" apart. */
  occurrence: string;
  /** False for a part-day holiday (see {@link isFullDay}). */
  fullDay: boolean;
}

/**
 * The holiday days of a scope: type filter → exclude (an excluded holiday takes its substitutes
 * along, see {@link substituteBases}) → every day of a multi-day holiday → the same-date collision
 * rule {@link beats}. The runtime and the card's preview both build their list here, so the
 * preview cannot drift from what gets published.
 *
 * @param raws every holiday of the scope in the evaluated window, all types
 * @param options the enabled types and the excluded ids
 * @param options.types the enabled holiday types
 * @param options.excludes the excluded holiday ids
 * @returns the days, keyed by calendar date
 */
export function buildDayMap(
  raws: readonly SourceHoliday[],
  options: { types: readonly string[]; excludes: readonly string[] },
): Map<string, HolidayDay> {
  const excluded = new Set(options.excludes);
  const bases = substituteBases(raws);
  const days = new Map<string, HolidayDay>();
  for (const h of raws) {
    if (!options.types.includes(h.type)) {
      continue;
    }
    const id = toHolidayId(h.name, h.rule);
    const base = bases.get(id);
    if (excluded.has(id) || (base !== undefined && excluded.has(base))) {
      continue;
    }
    const keys = expandHolidayDays(h);
    const occurrence = `${id}@${keys[0]}`;
    const fullDay = isFullDay(h);
    keys.forEach((date, i) => {
      const candidate: HolidayDay = {
        date,
        name: h.name,
        type: h.type,
        id,
        substitute: h.substitute,
        occurrence,
        // A follow-up day of a multi-day holiday is a whole day off by construction (noon rule).
        fullDay: i > 0 || fullDay,
      };
      const existing = days.get(date);
      if (!existing || beats(candidate, existing)) {
        days.set(date, candidate);
      }
    });
  }
  return days;
}

/**
 * Add the bridge days of `years` to a day list. The holiday keys are taken once, before the first
 * bridge is added, so a bridge day never starts another one — across the year boundary as well.
 *
 * @param days the holiday days (changed in place)
 * @param years the years whose holidays may start a bridge day
 * @param weekend the country's weekend days
 * @param name the bridge-day name to publish
 */
export function addBridgeDays(
  days: Map<string, HolidayDay>,
  years: readonly number[],
  weekend: readonly number[],
  name: string,
): void {
  const holidayKeys = new Set(days.keys());
  const triggers = [...days.values()].filter(d => d.fullDay && BRIDGE_TRIGGER_TYPES.includes(d.type)).map(d => d.date);
  for (const year of years) {
    for (const key of detectBridgeKeys(holidayKeys, triggers, year, weekend)) {
      if (!days.has(key)) {
        days.set(key, {
          date: key,
          name,
          type: "bridge",
          id: `bridge_${key}`,
          occurrence: `bridge@${key}`,
          fullDay: true,
        });
      }
    }
  }
}

// --- dates for people ----------------------------------------------------------------------------

/**
 * Render a calendar key (YYYY-MM-DD) in the system's configured date display format
 * ("DD.MM.YYYY" → "26.10.2026") for human-facing text. The machine-facing `next.date` state keeps
 * the ISO form — scripts and comparisons rely on it. An empty/unrecognized format (or a malformed
 * key) returns the key unchanged.
 *
 * @param dateKey the ISO calendar date (YYYY-MM-DD)
 * @param dateFormat the system date format using DD / MM / YYYY (or YY) tokens
 * @returns the formatted date, or the untouched key when formatting is not possible
 */
export function formatDateForDisplay(dateKey: string, dateFormat: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m || !dateFormat.includes("DD") || !dateFormat.includes("MM") || !/Y{2,4}/.test(dateFormat)) {
    return dateKey;
  }
  const [, year, month, day] = m;
  return dateFormat.replace("YYYY", year).replace("YY", year.slice(-2)).replace("MM", month).replace("DD", day);
}

/**
 * Day and month of a calendar key in the order of the system date format, without the year — the
 * card's chips ("14.05." for DD.MM.YYYY, "05/14" for MM/DD/YYYY). Falls back to "DD.MM.".
 *
 * @param dateKey the ISO calendar date (YYYY-MM-DD)
 * @param dateFormat the system date format
 * @returns the short day label
 */
export function formatDayMonth(dateKey: string, dateFormat: string): string {
  const [, month, day] = dateKey.split("-");
  if (!month || !day) {
    return dateKey;
  }
  const dd = dateFormat.indexOf("DD");
  const mm = dateFormat.indexOf("MM");
  if (dd === -1 || mm === -1) {
    return `${day}.${month}.`;
  }
  const between = dateFormat.slice(Math.min(dd, mm) + 2, Math.max(dd, mm));
  const separator = between || ".";
  return dd < mm ? `${day}${separator}${month}${separator === "." ? "." : ""}` : `${month}${separator}${day}`;
}
