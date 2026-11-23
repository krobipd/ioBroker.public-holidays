import type { ComputedHolidays, DayInfo, NextHoliday } from "./types";
import type { KnownObjects } from "./known-objects";
import { errLine } from "./log-text";
import { tName, type I18nKey } from "./i18n";

// The published states: channel and field names ARE the keys of the computed result.
const DAY_CHANNELS = [
  "today",
  "yesterday",
  "tomorrow",
  "dayAfterTomorrow",
] as const satisfies readonly (keyof ComputedHolidays)[];
const DAY_FIELDS = ["name", "isHoliday"] as const satisfies readonly (keyof DayInfo)[];
const NEXT_FIELDS = ["name", "isHoliday", "date", "daysUntil"] as const satisfies readonly (keyof NextHoliday)[];

/**
 * Objects earlier versions created, children before their channel (a channel goes last, when it is
 * empty). The previous owner's 0.0.x releases on npm (Jey-Cee) created `info`, `info.lastSettings`
 * and `aftertomorrow.*` — an upgrade from there left them standing, with `aftertomorrow.boolean`
 * possibly frozen at `true`.
 */
const DEPRECATED_OBJECTS = [
  "today.region",
  "today.type",
  "today.id",
  "yesterday.region",
  "yesterday.type",
  "yesterday.id",
  "tomorrow.region",
  "tomorrow.type",
  "tomorrow.id",
  "dayAfterTomorrow.region",
  "dayAfterTomorrow.type",
  "dayAfterTomorrow.id",
  "next.region",
  "next.type",
  "next.id",
  "next.duration",
  // Renamed to *.isHoliday in v0.11.0 (state named for its meaning, not its type).
  "today.boolean",
  "yesterday.boolean",
  "tomorrow.boolean",
  "dayAfterTomorrow.boolean",
  "next.boolean",
  // The 0.0.x tree of the previous owner.
  "aftertomorrow.name",
  "aftertomorrow.boolean",
  "aftertomorrow",
  "info.lastSettings",
  "info",
];

/**
 * Remove the states earlier versions created. `delObject` on a leaf state takes the VALUE with it,
 * so nothing is left behind in the states database. Whether an id still exists comes from the tree
 * {@link KnownObjects} read once at the start of the run — no read per id.
 *
 * A failure here used to be swallowed by an empty catch commented "already gone" — which is only
 * one of the reasons it can throw, and the other one (an unreachable objects DB) then vanished
 * without a trace (audit finding F8). The run still carries on: a leftover object is cosmetic,
 * losing today's holiday over it is not.
 *
 * @param adapter the adapter instance
 * @param known the adapter's own object tree, loaded
 */
export async function cleanupDeprecatedStates(adapter: ioBroker.Adapter, known: KnownObjects): Promise<void> {
  for (const id of DEPRECATED_OBJECTS) {
    try {
      // A calendar folder may carry one of these names ("info", "aftertomorrow"): a folder is never
      // one of the old objects, which were channels and states.
      const stored = known.get(id) as { type?: unknown } | undefined;
      if (stored && stored.type !== "folder") {
        await known.remove(id);
        adapter.log.debug(`Removed deprecated state: ${id}`);
      }
    } catch (err: unknown) {
      adapter.log.debug(`Could not remove the deprecated state ${id}: ${errLine(err)}`);
    }
  }
}

/** The common part of one object of a calendar folder: its shape, with the i18n keys of its name and explanation. */
interface TreeObject {
  /** The id below the calendar folder. */
  rel: string;
  /** Channel or state. */
  type: "channel" | "state";
  /** The i18n key of the name. */
  name: I18nKey;
  /** The i18n key of the explanation, where the name does not say it all. */
  desc?: I18nKey;
  /** The state's shape; none for a channel. */
  common?: Pick<ioBroker.StateCommon, "type" | "role" | "read" | "write" | "unit" | "def">;
}

/**
 * The objects of one calendar folder: the five channels and twelve states 0.20.x had at the instance
 * root, with the same type, role, unit and default, all read-only. Since the calendars came, the
 * runtime is the one place of this shape (the manifest carries no instance objects any more).
 *
 * The four day channels and their two fields carry no explanation: "Today" / "Holiday name" say
 * everything there is to say. The `next` channel and its fields do — that a holiday falling today
 * is NOT in `next`, that the date stays ISO whatever the display format is, and that `daysUntil`
 * uses 0 for "none found" are all things a user cannot read off the name.
 */
export const CALENDAR_OBJECTS: readonly TreeObject[] = [
  { rel: "today", type: "channel", name: "today" },
  {
    rel: "today.name",
    type: "state",
    name: "name",
    desc: "descDayName",
    common: { type: "string", role: "text", read: true, write: false, def: "" },
  },
  {
    rel: "today.isHoliday",
    type: "state",
    name: "isHoliday",
    desc: "descDayIsHoliday",
    common: { type: "boolean", role: "indicator", read: true, write: false, def: false },
  },
  { rel: "yesterday", type: "channel", name: "yesterday" },
  {
    rel: "yesterday.name",
    type: "state",
    name: "name",
    desc: "descDayName",
    common: { type: "string", role: "text", read: true, write: false, def: "" },
  },
  {
    rel: "yesterday.isHoliday",
    type: "state",
    name: "isHoliday",
    desc: "descDayIsHoliday",
    common: { type: "boolean", role: "indicator", read: true, write: false, def: false },
  },
  { rel: "tomorrow", type: "channel", name: "tomorrow" },
  {
    rel: "tomorrow.name",
    type: "state",
    name: "name",
    desc: "descDayName",
    common: { type: "string", role: "text", read: true, write: false, def: "" },
  },
  {
    rel: "tomorrow.isHoliday",
    type: "state",
    name: "isHoliday",
    desc: "descDayIsHoliday",
    common: { type: "boolean", role: "indicator", read: true, write: false, def: false },
  },
  { rel: "dayAfterTomorrow", type: "channel", name: "dayAfterTomorrow" },
  {
    rel: "dayAfterTomorrow.name",
    type: "state",
    name: "name",
    desc: "descDayName",
    common: { type: "string", role: "text", read: true, write: false, def: "" },
  },
  {
    rel: "dayAfterTomorrow.isHoliday",
    type: "state",
    name: "isHoliday",
    desc: "descDayIsHoliday",
    common: { type: "boolean", role: "indicator", read: true, write: false, def: false },
  },
  { rel: "next", type: "channel", name: "next", desc: "descNext" },
  {
    rel: "next.name",
    type: "state",
    name: "name",
    desc: "descNextName",
    common: { type: "string", role: "text", read: true, write: false, def: "" },
  },
  {
    rel: "next.isHoliday",
    type: "state",
    name: "isHoliday",
    desc: "descNextIsHoliday",
    common: { type: "boolean", role: "indicator", read: true, write: false, def: false },
  },
  {
    rel: "next.date",
    type: "state",
    name: "date",
    desc: "descNextDate",
    common: { type: "string", role: "date", read: true, write: false, def: "" },
  },
  {
    rel: "next.daysUntil",
    type: "state",
    name: "daysUntil",
    desc: "descNextDaysUntil",
    common: { type: "number", role: "value.interval", read: true, write: false, unit: "d", def: 0 },
  },
];

/** The channels of a calendar folder — the ids 0.20.x had at the instance root. */
export const CALENDAR_CHANNELS: readonly string[] = CALENDAR_OBJECTS.filter(o => o.type === "channel").map(o => o.rel);

/** A calendar folder as it is written: its id, the name it carries and the uid that finds it again. */
export interface CalendarFolder {
  /** The folder id below the instance. */
  id: string;
  /** The folder name. */
  name: string;
  /** The calendar's uid ("" when the settings carry none). */
  uid: string;
}

/**
 * Create or bring up to date one calendar folder and its 17 objects. Each write goes through the tree
 * read once at the start of the run (fleet master `known-objects.ts`) and reaches the database only
 * when it changes something — an unchanged daily run writes no object.
 *
 * `extendObject` (never `setObject`): the objects carry user-owned side data — history/logging
 * settings live in `common.custom` — and a full write would drop it. The folder carries the
 * calendar's uid in `native`, so a folder whose id the user changed is found again and moved.
 *
 * @param known the adapter's own object tree, loaded
 * @param folder the calendar's folder
 */
export async function ensureCalendarObjects(known: KnownObjects, folder: CalendarFolder): Promise<void> {
  await known.extend(folder.id, { type: "folder", common: { name: folder.name }, native: { uid: folder.uid } });
  for (const o of CALENDAR_OBJECTS) {
    const common = {
      ...o.common,
      name: tName(o.name),
      ...(o.desc ? { desc: tName(o.desc) } : {}),
    };
    await known.extend(`${folder.id}.${o.rel}`, { type: o.type, common });
  }
}

/** The states of the own namespace as one bulk read returns them: full id → state. */
export type StoredStates = Record<string, ioBroker.State | null | undefined>;

/**
 * Write the twelve states of one calendar's result; a state whose value did not change is left alone.
 * All twelve are read-only (`common.write: false`) — only this adapter writes them — so they are
 * compared in memory against ONE bulk read of the own namespace per run, never per state against the
 * database (`setStateChangedAsync` reads each state singly; fleet rule, inventory resource check).
 * Compared is what js-controller compares: the value strictly, `ack` and `q`.
 *
 * @param adapter the adapter instance
 * @param stored the run's bulk read of the own states
 * @param id the calendar's folder id
 * @param computed the result to publish
 */
export async function publishCalendarStates(
  adapter: ioBroker.Adapter,
  stored: StoredStates,
  id: string,
  computed: ComputedHolidays,
): Promise<void> {
  const publish = async (rel: string, val: string | boolean | number): Promise<void> => {
    const current = stored[`${adapter.namespace}.${id}.${rel}`];
    if (current?.val === val && current.ack && !current.q) {
      return;
    }
    await adapter.setState(`${id}.${rel}`, { val, ack: true });
  };
  for (const ch of DAY_CHANNELS) {
    for (const field of DAY_FIELDS) {
      await publish(`${ch}.${field}`, computed[ch][field]);
    }
  }
  for (const field of NEXT_FIELDS) {
    await publish(`next.${field}`, computed.next[field]);
  }
}
