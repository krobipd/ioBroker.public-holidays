import type { ComputedHolidays, DayInfo, NextHoliday } from "./types";
import { coveredBy, type KnownObjects } from "./known-objects";
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
      if (known.get(id)) {
        await known.remove(id);
        adapter.log.debug(`Removed deprecated state: ${id}`);
      }
    } catch (err: unknown) {
      adapter.log.debug(`Could not remove the deprecated state ${id}: ${errLine(err)}`);
    }
  }
}

/**
 * The runtime refresh of one channel: name and explanation only.
 *
 * js-controller applies the manifest's `instanceObjects` on EVERY adapter start (7.2.2
 * `_createInstancesObjects` → `_extendObjects`) with `preserve: { common: ["name"], native: true }`
 * — so `type`, `role`, `unit`, `def` and `desc` reach an existing tree by themselves, and
 * `common.name` is the one field frozen to whatever the version that created the object wrote.
 * This call is what makes a rename reach an existing install; it deliberately carries NO
 * `preserve`: these names belong to the adapter (translated from `admin/i18n`), not to a user or
 * a manufacturer. Everything else stays in the manifest, the single source of the object shape.
 *
 * @param channel the channel id, which doubles as its i18n key
 * @param descKey the i18n key of the explanation, omitted where the name says it all
 * @returns the patch passed to `extendObject`
 */
function channelObj(channel: string, descKey?: I18nKey): ioBroker.PartialChannelObject {
  return {
    type: "channel",
    common: {
      name: tName(channel as I18nKey),
      ...(descKey ? { desc: tName(descKey) } : {}),
    },
  };
}

/**
 * The runtime refresh of one state: name and explanation only — same reasoning as
 * {@link channelObj}. (Until v0.16.0 this carried a hand copy of type/role/read/write/unit/def,
 * built on the premise that a manifest-only field never reaches an existing tree; the platform
 * source says otherwise, see above.)
 *
 * @param field the field name, which doubles as its i18n key
 * @param descKey the i18n key of the explanation, omitted where the name says it all
 * @returns the patch passed to `extendObject`
 */
function stateObj(field: string, descKey?: I18nKey): ioBroker.PartialStateObject {
  return {
    type: "state",
    common: {
      name: tName(field as I18nKey),
      ...(descKey ? { desc: tName(descKey) } : {}),
    },
  };
}

/**
 * Write one refresh only when the stored object does not already carry it — js-controller writes an
 * extendObject without comparing, so an unconditional refresh wrote 17 unchanged objects and sent 17
 * object change events on every daily run. The stored object comes from the tree read once at the
 * start of the run (fleet master `known-objects.ts`); an object the tree does not hold is written.
 *
 * @param known the adapter's own object tree, loaded
 * @param id the object id
 * @param patch the name/desc refresh
 * @param write the literal extendObject call for this id
 */
async function refresh(
  known: KnownObjects,
  id: string,
  patch: ioBroker.PartialChannelObject | ioBroker.PartialStateObject,
  write: (obj: ioBroker.PartialObject) => Promise<unknown>,
): Promise<void> {
  if (coveredBy(patch, known.get(id))) {
    return;
  }
  await write(patch);
}

/**
 * Create/refresh all 17 objects (5 channels + 12 states) on every run.
 *
 * The ids are spelled out instead of looped for a reason: the manifest carries the same 17 as
 * `instanceObjects`, and the package check `instance-objects-refresh` checks that each of them is
 * refreshed at runtime by looking for a literal `extendObject("<id>"` in `src/` — a template-built
 * id would satisfy the tree but not the check that guards it.
 *
 * `extendObject` (never `setObject`): the objects carry user-owned side data — history/logging
 * settings live in `common.custom` — and a full write would drop it.
 *
 * The four day channels and their two fields carry no explanation: "Today" / "Holiday name" say
 * everything there is to say. The `next` channel and its fields do — that a holiday falling today
 * is NOT in `next`, that the date stays ISO whatever the display format is, and that `daysUntil`
 * uses 0 for "none found" are all things a user cannot read off the name.
 *
 * @param adapter the adapter instance
 * @param known the adapter's own object tree, loaded
 */
export async function ensureObjects(adapter: ioBroker.Adapter, known: KnownObjects): Promise<void> {
  await refresh(known, "today", channelObj("today"), o => adapter.extendObject("today", o));
  await refresh(known, "today.name", stateObj("name", "descDayName"), o => adapter.extendObject("today.name", o));
  await refresh(known, "today.isHoliday", stateObj("isHoliday", "descDayIsHoliday"), o =>
    adapter.extendObject("today.isHoliday", o),
  );

  await refresh(known, "yesterday", channelObj("yesterday"), o => adapter.extendObject("yesterday", o));
  await refresh(known, "yesterday.name", stateObj("name", "descDayName"), o =>
    adapter.extendObject("yesterday.name", o),
  );
  await refresh(known, "yesterday.isHoliday", stateObj("isHoliday", "descDayIsHoliday"), o =>
    adapter.extendObject("yesterday.isHoliday", o),
  );

  await refresh(known, "tomorrow", channelObj("tomorrow"), o => adapter.extendObject("tomorrow", o));
  await refresh(known, "tomorrow.name", stateObj("name", "descDayName"), o => adapter.extendObject("tomorrow.name", o));
  await refresh(known, "tomorrow.isHoliday", stateObj("isHoliday", "descDayIsHoliday"), o =>
    adapter.extendObject("tomorrow.isHoliday", o),
  );

  await refresh(known, "dayAfterTomorrow", channelObj("dayAfterTomorrow"), o =>
    adapter.extendObject("dayAfterTomorrow", o),
  );
  await refresh(known, "dayAfterTomorrow.name", stateObj("name", "descDayName"), o =>
    adapter.extendObject("dayAfterTomorrow.name", o),
  );
  await refresh(known, "dayAfterTomorrow.isHoliday", stateObj("isHoliday", "descDayIsHoliday"), o =>
    adapter.extendObject("dayAfterTomorrow.isHoliday", o),
  );

  await refresh(known, "next", channelObj("next", "descNext"), o => adapter.extendObject("next", o));
  await refresh(known, "next.name", stateObj("name", "descNextName"), o => adapter.extendObject("next.name", o));
  await refresh(known, "next.isHoliday", stateObj("isHoliday", "descNextIsHoliday"), o =>
    adapter.extendObject("next.isHoliday", o),
  );
  await refresh(known, "next.date", stateObj("date", "descNextDate"), o => adapter.extendObject("next.date", o));
  await refresh(known, "next.daysUntil", stateObj("daysUntil", "descNextDaysUntil"), o =>
    adapter.extendObject("next.daysUntil", o),
  );
}

/**
 * Write the twelve states of a computed result; a state whose value did not change is left alone.
 * All twelve are read-only (`common.write: false`) — only this adapter writes them — so they are
 * compared in memory against ONE bulk read of the own namespace, never per state against the
 * database (`setStateChangedAsync` reads each state singly; fleet rule, inventory resource check).
 * Compared is what js-controller compares: the value strictly, `ack` and `q`.
 *
 * @param adapter the adapter instance
 * @param computed the result to publish
 */
export async function publishStates(adapter: ioBroker.Adapter, computed: ComputedHolidays): Promise<void> {
  const stored = await adapter.getStatesAsync(`${adapter.namespace}.*`);
  const publish = async (id: string, val: string | boolean | number): Promise<void> => {
    const current = stored[`${adapter.namespace}.${id}`];
    if (current?.val === val && current.ack && !current.q) {
      return;
    }
    await adapter.setState(id, { val, ack: true });
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
