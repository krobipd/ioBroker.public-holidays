import { I18n } from "@iobroker/adapter-core";
import Holidays from "date-holidays";
import type translations from "../../admin/i18n/en.json";
import { COUNTRY_NAME_TO_CODE } from "./country-codes";
import { errText } from "./error-utils";

export type I18nKey = keyof typeof translations;

export const SUPPORTED_LANGS = ["de", "en", "es", "fr", "it", "nl", "pl", "pt", "ru", "uk", "zh"];

export function tName(key: I18nKey): ioBroker.StringOrTranslated {
  return I18n.getTranslatedObject(key);
}

// Takes the already-built date-holidays instance (its getLanguages() is country-scoped) so the
// caller need not construct a throwaway second instance just to detect languages (audit L4).
export function resolveLanguages(systemLang: string, holidays: Holidays): string[] {
  const lang = systemLang.toLowerCase().split("-")[0];
  if (!SUPPORTED_LANGS.includes(lang)) {
    return ["en"];
  }

  if (holidays.getLanguages().includes(lang)) {
    return lang === "en" ? ["en"] : [lang, "en"];
  }
  return ["en"];
}

// ioBroker.admin stores the country NAME (e.g. "Austria") in system.config.common.country,
// not the ISO code. date-holidays needs the alpha-2 code and silently returns [] for a name.
// Resolve name -> supported code; return "" if it cannot be mapped (caller falls back to
// "no country configured"). Already-a-code values are accepted too.
let supportedCodes: Set<string> | null = null;
let nameToCode: Map<string, string> | null = null;

export function resolveCountryCode(value: string): string {
  const v = value.trim();
  if (!v) {
    return "";
  }
  if (!supportedCodes) {
    supportedCodes = new Set(Object.keys(new Holidays().getCountries()));
  }
  if (!nameToCode) {
    nameToCode = new Map(Object.entries(COUNTRY_NAME_TO_CODE).map(([name, code]) => [name.toLowerCase(), code]));
  }

  const upper = v.toUpperCase();
  if (v.length === 2 && supportedCodes.has(upper)) {
    return upper;
  }
  const mapped = nameToCode.get(v.toLowerCase());
  return mapped && supportedCodes.has(mapped) ? mapped : "";
}

export interface SystemConfig {
  country: string;
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
      `Could not read the ioBroker system settings (${errText(err)}) — no country auto-detection, holiday names in English, log dates in ISO format`,
    );
    return { country: "", language: "en", dateFormat: "" };
  }
}

/**
 * Render a calendar key (YYYY-MM-DD) in the system's configured date display format
 * ("DD.MM.YYYY" → "26.10.2026") for human-facing log lines. The machine-facing
 * `next.date` state keeps the ISO form — scripts and comparisons rely on it.
 * An empty/unrecognized format (or a malformed key) returns the key unchanged.
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
