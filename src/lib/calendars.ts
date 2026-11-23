import Holidays from "date-holidays";
import { resolveCountry } from "./country";
import {
  CALENDAR_LIST_KEY,
  type CalendarScope,
  enabledTypeKeys,
  FIRST_CALENDAR_UID,
  freshCalendarFields,
  isCalendarId,
  readTrimmed,
  standardIdOf,
  standardNameOf,
} from "./holiday-shared";
import type { NativeKeyRename } from "./native-key-migration";
import type { Calendar } from "./types";

/**
 * The takeover of 0.20.x for the fleet migration table: every settings key of the one calendar the whole
 * instance was is a rename source onto the calendar list. An update keeps those keys (js-controller never
 * deletes a native key) and adds the manifest's default list beside them; the first start writes the list
 * whichever of them the installation still holds, replaces the default list and clears every old key — in
 * the one write of migrateNativeKeys.
 *
 * @param list the calendar list the old keys become — called only while one of them holds a value
 * @returns the renames, one per old key
 */
export function legacyTakeover(list: () => unknown): NativeKeyRename[] {
  return [
    { from: "country", to: CALENDAR_LIST_KEY, coerce: list },
    { from: "state", to: CALENDAR_LIST_KEY, coerce: list },
    { from: "region", to: CALENDAR_LIST_KEY, coerce: list },
    { from: "typePublic", to: CALENDAR_LIST_KEY, coerce: list },
    { from: "typeBank", to: CALENDAR_LIST_KEY, coerce: list },
    { from: "typeSchool", to: CALENDAR_LIST_KEY, coerce: list },
    { from: "typeOptional", to: CALENDAR_LIST_KEY, coerce: list },
    { from: "typeObservance", to: CALENDAR_LIST_KEY, coerce: list },
    { from: "excludeHolidays", to: CALENDAR_LIST_KEY, coerce: list },
    { from: "includeBridgeDays", to: CALENDAR_LIST_KEY, coerce: list },
  ];
}

/** The settings keys of 0.20.x and earlier — the sources of the takeover. */
export const LEGACY_SETTING_KEYS: readonly string[] = legacyTakeover(() => undefined).map(r => r.from);

/**
 * Whether the settings still hold the single calendar of 0.20.x — any of its keys with a value.
 *
 * @param native the instance's `native` record
 * @returns true while the takeover is still due
 */
export function hasLegacySettings(native: Record<string, unknown>): boolean {
  return LEGACY_SETTING_KEYS.some(key => native[key] !== undefined && native[key] !== null);
}

/**
 * The stored country of a calendar as a code — a name that found its way into the settings ("Austria")
 * resolves like the runtime resolves it; "" when the calendar follows the system country.
 *
 * @param settings the calendar record
 * @returns the code, the stored value verbatim when it does not resolve, or ""
 */
export function storedCountryCode(settings: Record<string, unknown>): string {
  const configured = readTrimmed(settings, "country");
  return configured ? resolveCountry(configured).code || configured : "";
}

/**
 * Where a calendar applies and which holidays it holds.
 *
 * @param settings the calendar record
 * @param systemCountry the system country's code ("" when none resolves)
 * @returns the scope its standard id and name are built from
 */
export function calendarScope(settings: Record<string, unknown>, systemCountry: string): CalendarScope {
  return {
    country: storedCountryCode(settings),
    systemCountry,
    state: readTrimmed(settings, "state"),
    region: readTrimmed(settings, "region"),
    types: enabledTypeKeys(flag => settings[flag]),
  };
}

/**
 * The first calendar an update builds from the settings of 0.20.x: the same location, types, excludes
 * and bridge days, the standard id (so the old tree moves to a predictable folder; it follows location
 * and types from then on, like every id) and the standard name, marked automatic — it follows the
 * location until the user types one.
 *
 * @param native the instance's `native` record with the keys of 0.20.x
 * @param systemCountry the system country's code ("" when none resolves)
 * @returns the calendar record
 */
export function legacyCalendar(native: Record<string, unknown>, systemCountry: string): Record<string, unknown> {
  const settings = freshCalendarFields();
  for (const key of LEGACY_SETTING_KEYS) {
    if (native[key] !== undefined && native[key] !== null) {
      settings[key] = native[key];
    }
  }
  return {
    uid: FIRST_CALENDAR_UID,
    name: "",
    nameAuto: true,
    id: standardIdOf(calendarScope(settings, systemCountry), new Holidays()),
    ...settings,
  };
}

/**
 * The name a calendar's folder carries: the stored one, else — a calendar whose settings were never
 * saved from the card, the manifest default, the update's first calendar — the standard name in the
 * system language, built by the same function the card uses.
 *
 * @param settings the calendar record
 * @param systemCountry the system country's code
 * @param language the system language
 * @returns the folder name
 */
export function calendarName(settings: Record<string, unknown>, systemCountry: string, language: string): string {
  return (
    readTrimmed(settings, "name") || standardNameOf(calendarScope(settings, systemCountry), language, new Holidays())
  );
}

/** Why a calendar of the list is not run. */
export interface SkippedCalendar {
  /** Its position in the list, from 1. */
  position: number;
  /** `id`: no usable id; `duplicate`: a calendar before it holds the id. */
  reason: "id" | "duplicate";
  /** The stored id, as far as it is text. */
  id: string;
}

/**
 * The calendars of the list a run works on — each with a usable id, the first of any id that occurs
 * twice (the card refuses to save either; a hand-edited setting may carry them).
 *
 * @param list the stored calendar records
 * @returns the calendars to run and the ones skipped
 */
export function usableCalendars(list: readonly Record<string, unknown>[]): {
  calendars: Calendar[];
  skipped: SkippedCalendar[];
} {
  const calendars: Calendar[] = [];
  const skipped: SkippedCalendar[] = [];
  const seen = new Set<string>();
  list.forEach((settings, index) => {
    const id = settings.id;
    if (!isCalendarId(id)) {
      skipped.push({ position: index + 1, reason: "id", id: typeof id === "string" ? id : "" });
      return;
    }
    if (seen.has(id)) {
      skipped.push({ position: index + 1, reason: "duplicate", id });
      return;
    }
    seen.add(id);
    calendars.push({ uid: typeof settings.uid === "string" ? settings.uid : "", id, settings });
  });
  return { calendars, skipped };
}
