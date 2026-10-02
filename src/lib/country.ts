import Holidays from "date-holidays";
import { type CountryResolution, resolveCountryName } from "./country-codes";

// ioBroker.admin stores the country NAME (e.g. "Austria", or "Vietnam" from the first-run wizard)
// in system.config.common.country, not the ISO code. date-holidays needs the alpha-2 code and
// silently returns [] for a name. Already-a-code values are accepted too.
let supportedCodes: Set<string> | null = null;

/**
 * Resolve a stored country value to a date-holidays code, with the reason when that fails — against
 * the countries the installed date-holidays carries (read once).
 *
 * @param value the stored value
 * @returns the resolution (see country-codes resolveCountryName)
 */
export function resolveCountry(value: string): CountryResolution {
  supportedCodes ??= new Set(Object.keys(new Holidays().getCountries()));
  return resolveCountryName(value, supportedCodes);
}
