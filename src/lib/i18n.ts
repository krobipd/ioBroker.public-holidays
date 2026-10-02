import { I18n } from "@iobroker/adapter-core";
import type translations from "../../admin/i18n/en.json";

/** A key of `admin/i18n/en.json`. */
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
