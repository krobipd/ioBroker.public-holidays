import {
  type AreaNameSource,
  type CalendarScope,
  enabledTypeKeys,
  freshCalendarFields,
  isCalendarId,
  readTrimmed,
  standardIdOf,
  standardNameOf,
  uniqueCalendarId,
} from "../../src/lib/holiday-shared.js";
// The same resolution of a stored country the runtime applies (both admin lists).
import { resolveCountryName } from "../../src/lib/country-codes.js";

// The calendar list as the card edits it — pure functions on the stored records, so every list
// operation is testable without a page. Every operation returns a NEW list; the card writes it in
// one whole-record write (K14).

/** One stored calendar: its location and holiday fields plus uid, name (with its auto flag) and id. */
export type CalendarRecord = Record<string, unknown>;

/** What the standard name and id are built from besides the calendar itself. */
export interface NamingContext {
  /** The system country as a code, "" when it does not resolve. */
  systemCountry: string;
  /** The system language — the runtime names folders in it. */
  language: string;
  /** The card's date-holidays. */
  source: AreaNameSource;
  /** The country codes the card's date-holidays has data for. */
  supported: ReadonlySet<string>;
}

/**
 * Where a calendar applies and which holidays it holds, the stored country resolved like the runtime
 * resolves it.
 *
 * @param cal the calendar
 * @param ctx system country and date-holidays
 * @returns its scope
 */
export function scopeOf(cal: CalendarRecord, ctx: NamingContext): CalendarScope {
  const stored = readTrimmed(cal, "country");
  return {
    country: stored ? resolveCountryName(stored, ctx.supported).code || stored : "",
    systemCountry: ctx.systemCountry,
    state: readTrimmed(cal, "state"),
    region: readTrimmed(cal, "region"),
    types: enabledTypeKeys(flag => cal[flag]),
  };
}

/**
 * The standard name of a calendar in the system language.
 *
 * @param cal the calendar
 * @param ctx system country, language and date-holidays
 * @returns the name
 */
export function standardName(cal: CalendarRecord, ctx: NamingContext): string {
  return standardNameOf(scopeOf(cal, ctx), ctx.language, ctx.source);
}

/**
 * The name the folder carries: the stored one, else the standard name — what the runtime writes.
 *
 * @param cal the calendar
 * @param ctx system country, language and date-holidays
 * @returns the name
 */
export function displayName(cal: CalendarRecord, ctx: NamingContext): string {
  return readTrimmed(cal, "name") || standardName(cal, ctx);
}

/**
 * The ids of every calendar but one.
 *
 * @param list the calendars
 * @param index the one left out, -1 for none
 * @returns the ids
 */
function idsOfOthers(list: readonly CalendarRecord[], index: number): Set<string> {
  const ids = new Set<string>();
  list.forEach((c, i) => {
    if (i !== index && typeof c.id === "string") {
      ids.add(c.id);
    }
  });
  return ids;
}

/**
 * The standard id of a calendar — where it applies and which holidays it holds.
 *
 * @param cal the calendar
 * @param ctx system country and date-holidays
 * @returns the id, before another calendar's claim adds a number
 */
function standardId(cal: CalendarRecord, ctx: NamingContext): string {
  return standardIdOf(scopeOf(cal, ctx), ctx.source);
}

/**
 * The id after a change. The card never takes an id from the user (krobi 2026-11-21): it is built
 * from location and types, and only when those change — bridge days, excludes and the name leave the
 * folder where it is, so a `-2` stays even when its twin is gone. Back on the location and types the
 * calendar was saved with, it gets its saved id back: an edit undone moves nothing. An id that
 * cannot be saved stays as it is, too, until location or types change or the button builds a new one.
 *
 * @param list the calendars, the changed one already changed
 * @param index the calendar that changed
 * @param before the calendar before the change
 * @param original the calendars as saved
 * @param ctx system country and date-holidays
 * @returns the id
 */
function followingId(
  list: readonly CalendarRecord[],
  index: number,
  before: CalendarRecord,
  original: readonly CalendarRecord[],
  ctx: NamingContext,
): unknown {
  const cal = list[index];
  const base = standardId(cal, ctx);
  if (base === standardId(before, ctx)) {
    return cal.id;
  }
  const others = idsOfOthers(list, index);
  const saved = typeof cal.uid === "string" ? original.find(c => c.uid === cal.uid) : undefined;
  if (saved && isCalendarId(saved.id) && !others.has(saved.id) && standardId(saved, ctx) === base) {
    return saved.id;
  }
  return uniqueCalendarId(base, others);
}

/**
 * Change settings of one calendar — the id follows location and types, the name follows while it
 * is automatic.
 *
 * @param list the calendars
 * @param index the calendar
 * @param patch the changed fields
 * @param original the calendars as saved
 * @param ctx system country, language and date-holidays
 * @returns the new list
 */
export function patchCalendar(
  list: readonly CalendarRecord[],
  index: number,
  patch: CalendarRecord,
  original: readonly CalendarRecord[],
  ctx: NamingContext,
): CalendarRecord[] {
  const next = list.map(c => ({ ...c }));
  next[index] = { ...next[index], ...patch };
  next[index].id = followingId(next, index, list[index], original, ctx);
  if (next[index].nameAuto === true) {
    next[index].name = standardName(next[index], ctx);
  }
  return next;
}

/**
 * A new id for a calendar whose id cannot be saved — only a list edited by hand in the instance
 * object can hold one, never the card. The button that calls it is the only way it changes without
 * a change of location or types; opening the page never writes it (K15).
 *
 * @param list the calendars
 * @param index the calendar
 * @param ctx system country and date-holidays
 * @returns the new list
 */
export function rebuildCalendarId(
  list: readonly CalendarRecord[],
  index: number,
  ctx: NamingContext,
): CalendarRecord[] {
  const next = list.map(c => ({ ...c }));
  next[index].id = uniqueCalendarId(standardId(next[index], ctx), idsOfOthers(next, index));
  return next;
}

/**
 * The user types a name — from then on it is his and stays.
 *
 * @param list the calendars
 * @param index the calendar
 * @param text what the field holds
 * @returns the new list
 */
export function setCalendarName(list: readonly CalendarRecord[], index: number, text: string): CalendarRecord[] {
  return list.map((c, i) => (i === index ? { ...c, name: text, nameAuto: false } : { ...c }));
}

/**
 * A uid no calendar holds or held when the page opened — a new calendar never takes over the folder
 * of one deleted in the same edit.
 *
 * @param list the calendars
 * @param original the calendars as saved
 * @returns the uid
 */
export function nextUid(list: readonly CalendarRecord[], original: readonly CalendarRecord[]): string {
  let max = 0;
  for (const c of [...list, ...original]) {
    const m = typeof c.uid === "string" ? /^c(\d+)$/.exec(c.uid) : null;
    if (m) {
      max = Math.max(max, Number(m[1]));
    }
  }
  return `c${max + 1}`;
}

/**
 * A new calendar at the end of the list, as the single-calendar card started out — no country (the
 * system country applies), the default types — with the standard name and id.
 *
 * @param list the calendars
 * @param original the calendars as saved
 * @param ctx system country, language and date-holidays
 * @returns the new list
 */
export function addCalendar(
  list: readonly CalendarRecord[],
  original: readonly CalendarRecord[],
  ctx: NamingContext,
): CalendarRecord[] {
  const fresh: CalendarRecord = { uid: nextUid(list, original), name: "", nameAuto: true, ...freshCalendarFields() };
  fresh.name = standardName(fresh, ctx);
  fresh.id = uniqueCalendarId(standardId(fresh, ctx), idsOfOthers(list, -1));
  return [...list.map(c => ({ ...c })), fresh];
}

/**
 * A copy below the calendar with all its settings: the name gets the suffix (and is the user's from
 * then on), the id is the standard id of the same location and types with the next free number —
 * built from the standard, never from the copied id, so a copy of `de-by-public-2` is
 * `de-by-public-3`, not `de-by-public-2-2`.
 *
 * @param list the calendars
 * @param index the calendar copied
 * @param original the calendars as saved
 * @param name the copy's name
 * @param ctx system country and date-holidays
 * @returns the new list
 */
export function copyCalendar(
  list: readonly CalendarRecord[],
  index: number,
  original: readonly CalendarRecord[],
  name: string,
  ctx: NamingContext,
): CalendarRecord[] {
  const source = JSON.parse(JSON.stringify(list[index])) as CalendarRecord;
  const copy = {
    ...source,
    uid: nextUid(list, original),
    name,
    nameAuto: false,
    id: uniqueCalendarId(standardId(source, ctx), idsOfOthers(list, -1)),
  };
  const next = list.map(c => ({ ...c }));
  next.splice(index + 1, 0, copy);
  return next;
}

/**
 * The list without the calendar — effective only on saving, like every list in the admin.
 *
 * @param list the calendars
 * @param index the calendar
 * @returns the new list
 */
export function removeCalendar(list: readonly CalendarRecord[], index: number): CalendarRecord[] {
  return list.filter((_c, i) => i !== index).map(c => ({ ...c }));
}

/**
 * The calendar one place up or down — the order of the list only.
 *
 * @param list the calendars
 * @param index the calendar
 * @param delta -1 up, +1 down
 * @returns the new list, unchanged at either end
 */
export function moveCalendar(list: readonly CalendarRecord[], index: number, delta: -1 | 1): CalendarRecord[] {
  const next = list.map(c => ({ ...c }));
  const to = index + delta;
  if (to < 0 || to >= next.length) {
    return next;
  }
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Why a calendar's id cannot be saved: none (or not a valid id) or held by another calendar. */
export type IdProblem = "missing" | "taken" | null;

/**
 * Whether the calendar's id can be saved.
 *
 * @param list the calendars
 * @param index the calendar
 * @returns the problem, null when the id is fine
 */
export function idProblem(list: readonly CalendarRecord[], index: number): IdProblem {
  const id = list[index].id;
  if (!isCalendarId(id)) {
    return "missing";
  }
  return idsOfOthers(list, index).has(id) ? "taken" : null;
}

/** A folder that moves on saving. */
export interface FolderMove {
  /** The calendar's uid. */
  uid: string;
  /** The folder id so far. */
  from: string;
  /** The folder id after saving. */
  to: string;
}

/** A folder that goes with its calendar on saving. */
export interface FolderRemoval {
  /** The folder id. */
  id: string;
  /** The calendar's name as saved. */
  name: string;
}

/**
 * What saving changes in the object tree, the way the run decides it: a saved folder whose id no
 * calendar keeps moves to the calendar with its uid, or goes when that calendar was deleted. A folder
 * whose id a calendar keeps — the same one or another — stays.
 *
 * @param original the calendars as saved
 * @param list the calendars as edited
 * @returns the moves and removals
 */
export function treeChanges(
  original: readonly CalendarRecord[],
  list: readonly CalendarRecord[],
): { moves: FolderMove[]; removals: FolderRemoval[] } {
  const kept = new Set(list.map(c => c.id).filter(isCalendarId));
  const moves: FolderMove[] = [];
  const removals: FolderRemoval[] = [];
  for (const saved of original) {
    if (!isCalendarId(saved.id) || kept.has(saved.id)) {
      continue;
    }
    const now = typeof saved.uid === "string" ? list.find(c => c.uid === saved.uid) : undefined;
    if (now) {
      if (isCalendarId(now.id)) {
        moves.push({ uid: saved.uid as string, from: saved.id, to: now.id });
      }
    } else {
      removals.push({ id: saved.id, name: readTrimmed(saved, "name") });
    }
  }
  return { moves, removals };
}
