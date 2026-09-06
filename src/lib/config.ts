import { enabledTypeKeys } from "./holiday-shared";
import { resolveCountryCode } from "./i18n";
import type { AdapterConfig } from "./types";

/**
 * Turn the raw `native` record into the typed config the engine works with, or `null` when no
 * country can be determined at all.
 *
 * Lives here rather than on the adapter class: it reads nothing but its argument, so the config
 * rules are testable without an adapter stub — the same separation the rest of `lib/` already has.
 *
 * Both country paths — the explicitly configured one and the one detected from
 * `system.config.common.country` — go through {@link resolveCountryCode}. ioBroker.admin stores a
 * country NAME ("Austria"), date-holidays needs the alpha-2 code, and until v0.15.1 only the
 * detected path translated: a name that had found its way into `native.country` (a hand-edited
 * object, a script setup, an imported config) failed with "not recognized" although the very same
 * value resolved fine one line further up. An unresolvable value is KEPT verbatim so the scope
 * diagnostic can name it, instead of degrading into "no country configured".
 *
 * @param raw the adapter's `native` record, untyped
 * @param fallbackCountry the country detected from the ioBroker system settings ("" when none)
 * @returns the typed config, or null when neither source yields a country
 */
export function parseConfig(raw: Record<string, unknown>, fallbackCountry = ""): AdapterConfig | null {
  const configured = configuredCountry(raw);
  const country = configured ? resolveCountryCode(configured) || configured : fallbackCountry;
  if (!country) {
    return null;
  }

  return {
    country,
    state: readTrimmed(raw, "state"),
    region: readTrimmed(raw, "region"),
    holidayTypes: enabledTypeKeys(flag => raw[flag]),
    excludeHolidays: toStringArray(raw.excludeHolidays),
    includeBridgeDays: raw.includeBridgeDays === true,
  };
}

/**
 * The country the user typed into the settings, trimmed and untranslated; "" when unset. Told
 * apart from the detected one because only an EMPTY setting hands over to the system country.
 *
 * @param raw the `native` record
 * @returns the configured country as stored, or ""
 */
export function configuredCountry(raw: Record<string, unknown>): string {
  return readTrimmed(raw, "country");
}

/**
 * One trimmed string field of the raw config; "" when unset or not a string.
 *
 * @param raw the `native` record
 * @param attr the field name
 * @returns the trimmed value, or ""
 */
function readTrimmed(raw: Record<string, unknown>, attr: string): string {
  const v = raw[attr];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * The string entries of a raw config array; [] for anything else.
 *
 * @param val the raw field value
 * @returns the strings it contains
 */
function toStringArray(val: unknown): string[] {
  return Array.isArray(val) ? val.filter((x): x is string => typeof x === "string") : [];
}
