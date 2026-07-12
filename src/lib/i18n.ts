import { I18n } from "@iobroker/adapter-core";
import Holidays from "date-holidays";
import type translations from "../../admin/i18n/en.json";
import { COUNTRY_NAME_TO_CODE } from "./country-codes";

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

export async function getSystemConfig(adapter: ioBroker.Adapter): Promise<{ country: string; language: string }> {
  try {
    const obj = (await adapter.getForeignObjectAsync("system.config")) as ioBroker.SystemConfigObject | null;
    const common = obj?.common;
    return {
      country: typeof common?.country === "string" ? common.country : "",
      language: (typeof common?.language === "string" ? common.language : "") || "en",
    };
  } catch {
    return { country: "", language: "en" };
  }
}
