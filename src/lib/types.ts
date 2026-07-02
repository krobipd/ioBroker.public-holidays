export interface AdapterConfig {
  country: string;
  state: string;
  region: string;
  holidayTypes: string[];
  excludeHolidays: string[];
  includeBridgeDays: boolean;
}

// The five holiday types date-holidays emits, in priority order (index 0 wins a same-date
// collision). `flag` is the native config checkbox; `defaultOn` mirrors the admin default —
// only public is enabled out of the box. Single source of truth for validateConfig (main.ts)
// and the engine's collision-priority ranking (holiday-engine.ts).
export const HOLIDAY_TYPES: { key: string; flag: string; defaultOn: boolean }[] = [
  { key: "public", flag: "typePublic", defaultOn: true },
  { key: "bank", flag: "typeBank", defaultOn: false },
  { key: "school", flag: "typeSchool", defaultOn: false },
  { key: "optional", flag: "typeOptional", defaultOn: false },
  { key: "observance", flag: "typeObservance", defaultOn: false },
];

export interface DayInfo {
  name: string;
  isHoliday: boolean;
}

export interface NextHoliday extends DayInfo {
  date: string;
  daysUntil: number;
}

export interface ComputedHolidays {
  yesterday: DayInfo;
  today: DayInfo;
  tomorrow: DayInfo;
  dayAfterTomorrow: DayInfo;
  next: NextHoliday;
  /** Configured exclude IDs that matched no holiday in the data (likely stale after a date-holidays update). */
  unmatchedExcludes: string[];
}
