// Shared test helpers of the root suite and the card suite. Lives under test/ on purpose: a file under
// src/ without `.test.` in its name would count as production code (npm package, coverage, mutation
// coverage, single-source scan). Type-checked and linted through the root tsconfig (`test/**/*.ts`).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type Holidays from "date-holidays";
import { computeHolidays, createHolidaysInstance } from "../src/lib/holiday-engine.js";
import { HOLIDAY_TYPES, type SourceHoliday } from "../src/lib/holiday-shared.js";
import type { AdapterConfig, ComputedHolidays } from "../src/lib/types.js";

/** The adapter's root directory. */
export const ADAPTER_DIR = join(__dirname, "..");

/** Every holiday type, in priority order. */
export const ALL_TYPES = HOLIDAY_TYPES.map(t => t.key);

/**
 * A file of the adapter, as text.
 *
 * @param rel the path relative to the adapter root
 * @returns the file content
 */
export function adapterFile(rel: string): string {
  return readFileSync(join(ADAPTER_DIR, rel), "utf8");
}

/** The manifest, parsed. */
export function ioPackage(): {
  common: Record<string, unknown>;
  instanceObjects: { _id: string; type: string; common: Record<string, unknown> }[];
} {
  return JSON.parse(adapterFile("io-package.json")) as ReturnType<typeof ioPackage>;
}

/**
 * A resolved adapter config: DE, public holidays only, no excludes, no bridge days — overridden as given.
 *
 * @param over the fields that differ
 * @returns the config
 */
export function makeConfig(over: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    country: "DE",
    state: "",
    region: "",
    holidayTypes: ["public"],
    excludeHolidays: [],
    includeBridgeDays: false,
    ...over,
  };
}

/**
 * The runtime's result for a config, the way onReady builds it: one instance of the scope with the
 * given holiday languages, the bridge day named in `systemLanguage` (default: the first language).
 *
 * @param config the resolved config
 * @param languages the holiday languages
 * @param options the reference date, an instance to use instead, the system language
 * @param options.referenceDate the day the result is for
 * @param options.instance a prepared date-holidays instance (a fake, or one reused across calls)
 * @param options.systemLanguage the ioBroker system language
 * @returns the result
 */
export function compute(
  config: AdapterConfig,
  languages: string[] = ["en"],
  options: { referenceDate?: Date; instance?: Holidays; systemLanguage?: string } = {},
): ComputedHolidays {
  const hd = options.instance ?? createHolidaysInstance(config);
  if (!options.instance) {
    hd.setLanguages(languages);
  }
  return computeHolidays(hd, config, {
    referenceDate: options.referenceDate,
    systemLanguage: options.systemLanguage ?? languages[0] ?? "en",
  });
}

/** A holiday as a fake date-holidays instance hands it over. */
export type FakeHoliday = Pick<SourceHoliday, "date" | "name" | "type" | "rule" | "substitute">;

/**
 * A fake scope constructor for the card's lists: every scope yields `byYear[year]`, and every call
 * is recorded.
 *
 * @param byYear the holidays per year
 * @param languages what the fake's data carries (`getLanguages`)
 * @returns the constructor and its calls
 */
export function makeFakeHolidays(
  byYear: Record<number, FakeHoliday[]>,
  languages: string[] = ["en"],
): {
  make: (country: string, state: string, region: string) => Holidays;
  calls: Array<[string, string, string]>;
} {
  const calls: Array<[string, string, string]> = [];
  const make = (country: string, state: string, region: string): Holidays => {
    calls.push([country, state, region]);
    return {
      setLanguages: () => undefined,
      getLanguages: () => languages,
      getHolidays: (y: number) => byYear[y] ?? [],
    } as unknown as Holidays;
  };
  return { make, calls };
}
