/** The adapter settings the engine works with, resolved from the raw `native` record. */
export interface AdapterConfig {
  /** The date-holidays country code ("DE"), or the stored value verbatim when it cannot be resolved. */
  country: string;
  /** The state code within the country, "" for none. */
  state: string;
  /** The region code within the state, "" for none. */
  region: string;
  /** The enabled date-holidays types, in priority order. */
  holidayTypes: string[];
  /** The excluded holiday ids. */
  excludeHolidays: string[];
  /** Whether bridge days are reported. */
  includeBridgeDays: boolean;
}

/** What one day channel publishes. */
export interface DayInfo {
  /** The holiday name, "" when the day is none. */
  name: string;
  /** Whether the day is a holiday (or bridge day). */
  isHoliday: boolean;
}

/** What the `next` channel publishes. */
export interface NextHoliday extends DayInfo {
  /** The calendar date YYYY-MM-DD, "" when none was found. */
  date: string;
  /** Whole days from today, 0 when none was found. */
  daysUntil: number;
}

/** The result of one run. */
export interface ComputedHolidays {
  /** Yesterday. */
  yesterday: DayInfo;
  /** Today. */
  today: DayInfo;
  /** Tomorrow. */
  tomorrow: DayInfo;
  /** The day after tomorrow. */
  dayAfterTomorrow: DayInfo;
  /** The next holiday still ahead. */
  next: NextHoliday;
  /** Configured exclude IDs that matched no holiday in the data (likely stale after a date-holidays update). */
  unmatchedExcludes: string[];
}
