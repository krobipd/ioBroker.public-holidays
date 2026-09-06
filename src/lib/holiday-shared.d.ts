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
export declare const HOLIDAY_TYPES: HolidayType[];
/**
 * Rank of a holiday type for the same-date collision; unknown types rank last.
 *
 * @param type the date-holidays type
 * @returns the index in {@link HOLIDAY_TYPES}, or one past the end for an unknown type
 */
export declare function typeRank(type: string): number;
/**
 * The enabled holiday types for a set of raw `native` flags. A `defaultOn` type counts as enabled
 * unless it is explicitly `false`; every other type only when it is explicitly `true` — the admin
 * card and the runtime must read an unset checkbox the same way.
 *
 * @param getFlag reads one raw native field
 * @returns the enabled type keys, in priority order
 */
export declare function enabledTypeKeys(getFlag: (flag: string) => unknown): string[];
/**
 * The stable id of a holiday: its calculation rule, cleaned. Ids are written by the admin card and
 * matched verbatim against the ids the runtime computes, so both sides MUST derive them here.
 * Measured against date-holidays 3.36.0 over all 206 countries and 2025-2027: 0 of 10 173 holidays
 * fall back to the name branch — every id comes from the rule and is therefore language-independent.
 *
 * @param name the localized holiday name (fallback only)
 * @param rule the date-holidays calculation rule
 * @returns the id used for excludes and for breaking a collision tie
 */
export declare function toHolidayId(name: string, rule?: string): string;
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
 * over 2025-2027, 64 collisions in 39 countries were decided by emit order alone, so a library
 * update could silently swap the published name):
 *
 * 1. **Type priority** — public beats bank beats school beats optional beats observance.
 * 2. **A real holiday beats a substitute** — where a moved day lands on another holiday, the day
 *    that genuinely belongs there is the one worth reporting (AL, KZ, SZ, TW, VI).
 * 3. **The smaller id wins** — arbitrary but stable and language-independent, for the remaining
 *    case of two substitutes on one date (AG, AI, KR, TT).
 *
 * @param candidate the newly seen holiday
 * @param incumbent the holiday already held for that date
 * @returns true when the candidate should replace the incumbent
 */
export declare function beats(candidate: HolidayRanking, incumbent: HolidayRanking): boolean;
/** The bridge-day name per language — the SAME text the card's preview labels a bridge day with. */
export declare const BRIDGE_DAY_NAMES: Record<string, string>;
/**
 * The bridge-day name for a language tag ("zh-cn" → "zh"), English when the language is unknown.
 *
 * @param language an ioBroker language tag
 * @returns the localized bridge-day name
 */
export declare function bridgeDayName(language: string): string;
/**
 * Shift a `YYYY-MM-DD` key by whole days, staying on local calendar dates. Parsing with an explicit
 * `T00:00:00` (never the bare key, which JS reads as UTC) keeps the weekday correct in
 * negative-UTC zones.
 *
 * @param dateKey the calendar key to shift
 * @param days whole days to add (may be negative)
 * @returns the shifted calendar key
 */
export declare function shiftKey(dateKey: string, days: number): string;
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
export declare function detectBridgeKeys(holidayKeys: Set<string>, year: number): string[];
