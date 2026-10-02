import { I18n } from "@iobroker/adapter-core";
import Holidays from "date-holidays";
import type translations from "../../admin/i18n/en.json";
import { type CountryResolution, resolveCountryName } from "./country-codes";
import { errLine } from "./log-text";
import { pickHolidayLanguages } from "./holiday-shared";

// Pure helpers the admin card shares live in holiday-shared.ts; re-exported here for the runtime.
export { formatDateForDisplay, SUPPORTED_LANGS } from "./holiday-shared";

export type I18nKey = keyof typeof translations;

/**
 * The translations of an admin/i18n key, for an object name or explanation.
 *
 * @param key the i18n key
 * @returns the translation object
 */
export function tName(key: I18nKey): ioBroker.StringOrTranslated {
  return I18n.getTranslatedObject(key);
}

// Takes the already-built date-holidays instance (its getLanguages() is country-scoped) so the
// caller need not construct a throwaway second instance just to detect languages (audit L4).
// The same rule the admin card applies (holiday-shared pickHolidayLanguages), fed with what the
// scope's data carries.
/**
 * The holiday languages for the system language and a scope.
 *
 * @param systemLang the ioBroker system language
 * @param holidays the scope's date-holidays instance
 * @returns the languages to set, most preferred first
 */
export function resolveLanguages(systemLang: string, holidays: Holidays): string[] {
  return pickHolidayLanguages(systemLang, holidays.getLanguages());
}

// ioBroker.admin stores the country NAME (e.g. "Austria", or "Vietnam" from the first-run wizard)
// in system.config.common.country, not the ISO code. date-holidays needs the alpha-2 code and
// silently returns [] for a name. Already-a-code values are accepted too.
let supportedCodes: Set<string> | null = null;

/**
 * Resolve a stored country value to a date-holidays code, with the reason when that fails.
 *
 * @param value the stored value
 * @returns the resolution (see country-codes resolveCountryName)
 */
export function resolveCountry(value: string): CountryResolution {
  if (!supportedCodes) {
    supportedCodes = new Set(Object.keys(new Holidays().getCountries()));
  }
  return resolveCountryName(value, supportedCodes);
}

/**
 * Resolve a stored country value to a date-holidays code.
 *
 * @param value the stored value
 * @returns the code, or "" when it cannot be resolved
 */
export function resolveCountryCode(value: string): string {
  return resolveCountry(value).code;
}

/** The three `system.config` fields this adapter reads. */
export interface SystemConfig {
  /** The system country NAME, "" when unset. */
  country: string;
  /** The system language, "en" when unset. */
  language: string;
  /** The system-wide date display format (e.g. "DD.MM.YYYY"); "" when unset. */
  dateFormat: string;
}

/**
 * Read the three `system.config` fields this adapter cares about, in one object read.
 *
 * A failure is not fatal, but it is NOT silent either: three user-visible things change at once —
 * country auto-detection stops working, holiday names fall back to English and the log date falls
 * back to ISO. Until v0.15.1 that happened without a word in the log, leaving three symptoms and
 * no cause (audit finding F8).
 *
 * @param adapter the adapter instance
 * @returns the system country, language and date format, with safe defaults on failure
 */
export async function getSystemConfig(adapter: ioBroker.Adapter): Promise<SystemConfig> {
  try {
    const obj = (await adapter.getForeignObjectAsync("system.config")) as ioBroker.SystemConfigObject | null;
    const common = obj?.common;
    return {
      country: typeof common?.country === "string" ? common.country : "",
      language: (typeof common?.language === "string" ? common.language : "") || "en",
      dateFormat: typeof common?.dateFormat === "string" ? common.dateFormat : "",
    };
  } catch (err: unknown) {
    adapter.log.warn(
      `Could not read the ioBroker system settings (${errLine(err)}) — no country auto-detection, holiday names in English, log dates in ISO format`,
    );
    return { country: "", language: "en", dateFormat: "" };
  }
}
