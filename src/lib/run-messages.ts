import type { SkippedCalendar } from "./calendars";
import type { CountryResolution } from "./country-codes";
import type { ScopeIssue } from "./holiday-engine";
import { formatDateForDisplay } from "./holiday-shared";
import { oneLine } from "./log-text";
import type { AdapterConfig, ComputedHolidays } from "./types";

// The texts a run writes to the log — pure functions of what the run found, so every wording is
// testable without an adapter. Every value that comes from outside (a configured code, a system
// setting, a holiday name) goes through oneLine: it cannot forge an extra log line.

/**
 * Why the ioBroker system country could not be used.
 *
 * @param reason why the resolution failed
 * @param name the stored system country
 * @returns the warning
 */
export function systemCountryProblemText(reason: CountryResolution["reason"], name: string): string {
  const country = oneLine(name);
  if (reason === "ambiguous") {
    return `System country '${country}' covers several countries — choose the country in the adapter settings`;
  }
  if (reason === "no-data") {
    return `System country '${country}' has no holiday data — choose a country in the adapter settings`;
  }
  return `System country '${country}' is not recognized — choose a country in the adapter settings`;
}

/**
 * The warning for a scope the holiday data does not know as configured.
 *
 * @param issue what is wrong with the scope
 * @param config the resolved adapter config
 * @returns the warning
 */
export function scopeIssueText(issue: ScopeIssue, config: AdapterConfig): string {
  const country = oneLine(config.country);
  if (issue.kind === "country") {
    return `Country '${country}' is not recognized — check the country setting`;
  }
  if (issue.kind === "state") {
    return `State '${oneLine(config.state)}' is unknown for ${country} — using country-level holidays`;
  }
  if (issue.kind === "region") {
    const scope = [config.country, config.state].filter(Boolean).map(oneLine).join("/");
    return `Region '${oneLine(config.region)}' is unknown for ${scope} — using broader holidays`;
  }
  return `date-holidays cannot load '${oneLine(config.region || config.state)}' (library defect) — using the broader scope's holidays`;
}

/**
 * The debug note when the host clock runs in none of the country's time zones — the days follow
 * the host clock (the daily run fires at the host's midnight); a container left on UTC while the
 * country is elsewhere shifts every day by hours. A note, not a warning: a country other than the
 * host's own is a legitimate choice.
 *
 * @param hostZone the host's time zone
 * @param country the country code
 * @param countryZones the country's time zones
 * @returns the note, or "" when the host is in one of them (or the data names none)
 */
export function hostZoneNote(hostZone: string, country: string, countryZones: readonly string[]): string {
  if (countryZones.length === 0 || countryZones.includes(hostZone)) {
    return "";
  }
  return `Host time zone ${oneLine(hostZone)} is not one of ${oneLine(country)}'s (${countryZones.join(", ")}) — days follow the host clock`;
}

/**
 * The warning for excludes no holiday of the country carries any more.
 *
 * @param ids the unmatched exclude ids
 * @returns the warning
 */
export function staleExcludesText(ids: readonly string[]): string {
  return `These excluded holidays no longer occur in the holiday data (a one-off date that has passed, or changed by a date-holidays update): ${oneLine(ids.join(", "))}`;
}

/**
 * The info line every run ends with: today and the next holiday, the date the way the user's
 * ioBroker displays dates (system.config dateFormat, e.g. "26.10.2026") — the next.date STATE stays ISO.
 *
 * @param computed the published result
 * @param dateFormat the system date format
 * @returns the line
 */
export function summaryLine(computed: ComputedHolidays, dateFormat: string): string {
  const { next, today } = computed;
  const days = next.daysUntil === 1 ? "1 day" : `${next.daysUntil} days`;
  const nextText = next.isHoliday
    ? `${oneLine(next.name)} on ${formatDateForDisplay(next.date, dateFormat)} (in ${days})`
    : "no upcoming holiday";
  return `Today: ${today.isHoliday ? oneLine(today.name) : "no holiday"}, next holiday: ${nextText}`;
}

/**
 * A line about one calendar — every warning and note of a calendar's computation names its folder,
 * so a user with several calendars sees which one it is about.
 *
 * @param id the calendar's folder id
 * @param text the line
 * @returns the line with the calendar in front
 */
export function forCalendar(id: string, text: string): string {
  return `${id}: ${text}`;
}

/** The warning when the settings hold no calendar list at all — nothing is created, moved or deleted. */
export const DAMAGED_LIST_TEXT =
  "The calendar list in the settings is damaged — nothing was changed; open the adapter settings and save them";

/** The warning when the list is empty. */
export const NO_CALENDAR_TEXT = "No calendar is set up — add one in the adapter settings";

/**
 * The warning for a calendar the run skips.
 *
 * @param skipped the calendar and why
 * @returns the warning
 */
export function skippedCalendarText(skipped: SkippedCalendar): string {
  return skipped.reason === "id"
    ? `Calendar ${skipped.position} has no valid id${skipped.id ? ` ('${oneLine(skipped.id)}')` : ""} — skipped; open the adapter settings`
    : `Calendar ${skipped.position} uses the id '${oneLine(skipped.id)}' of a calendar above it — skipped; open the adapter settings`;
}

/**
 * The one info line of a run (P-04): per calendar its folder, today and the next holiday.
 *
 * @param results each calendar's folder id and published result, in list order
 * @param dateFormat the system date format
 * @returns the line
 */
export function calendarSummaryLine(
  results: ReadonlyArray<{ id: string; computed: ComputedHolidays }>,
  dateFormat: string,
): string {
  return results.map(r => forCalendar(r.id, summaryLine(r.computed, dateFormat))).join("; ");
}
