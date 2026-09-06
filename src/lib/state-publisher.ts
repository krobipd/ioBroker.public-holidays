import type { ComputedHolidays, DayInfo, NextHoliday } from "./types";
import { errText } from "./error-utils";
import { tName, type I18nKey } from "./i18n";
import { FIELD_SPECS } from "./state-specs";

const DAY_CHANNELS = ["today", "yesterday", "tomorrow", "dayAfterTomorrow"] as const;
const DAY_FIELDS = ["name", "isHoliday"] as const;
const NEXT_FIELDS = ["name", "isHoliday", "date", "daysUntil"] as const;

const DEPRECATED_STATES = [
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
];

/**
 * Remove the states earlier versions created. `delObject` on a leaf state takes the VALUE with it,
 * so nothing is left behind in the states database.
 *
 * A failure here used to be swallowed by an empty catch commented "already gone" — which is only
 * one of the reasons it can throw, and the other one (an unreachable objects DB) then vanished
 * without a trace (audit finding F8). The run still carries on: a leftover object is cosmetic,
 * losing today's holiday over it is not.
 *
 * @param adapter the adapter instance
 */
export async function cleanupDeprecatedStates(adapter: ioBroker.Adapter): Promise<void> {
  for (const id of DEPRECATED_STATES) {
    try {
      const obj = await adapter.getObjectAsync(id);
      if (obj) {
        await adapter.delObjectAsync(id);
        adapter.log.debug(`Removed deprecated state: ${id}`);
      }
    } catch (err: unknown) {
      adapter.log.debug(`Could not remove the deprecated state ${id}: ${errText(err)}`);
    }
  }
}

/**
 * The channel object for one of the five channels. NO `preserve` on `common.name`: these names
 * belong to the adapter (translated from `admin/i18n`), not to a user or a manufacturer — with
 * `preserve` a renamed channel would only ever reach FRESH installs, every existing tree would
 * keep the old text (js-controller applies the manifest `instanceObjects` with exactly that
 * preserve, so the runtime call is the only way a rename reaches an existing install).
 *
 * @param channel the channel id, which doubles as its i18n key
 * @param descKey the i18n key of the explanation, omitted where the name says it all
 * @returns the object passed to `extendObject`
 */
function channelObj(channel: string, descKey?: I18nKey): ioBroker.SettableChannelObject {
  return {
    type: "channel",
    common: {
      name: tName(channel as I18nKey),
      ...(descKey ? { desc: tName(descKey) } : {}),
    },
    native: {},
  };
}

/**
 * The state object for one field, built from {@link FIELD_SPECS}. Same no-`preserve` reasoning as
 * {@link channelObj}.
 *
 * `def` is part of the spec, not manifest-only: `extendObject` cannot delete a key, so a default
 * that lives in the manifest alone reaches fresh installs and never an existing tree — the same
 * one-way street the `preserve` fix closed for names (audit finding F9). Guard:
 * instance-objects-reach.test.ts compares the manifest against this table field by field.
 *
 * @param field the field name, which doubles as its i18n key
 * @param descKey the i18n key of the explanation, omitted where the name says it all
 * @returns the object passed to `extendObject`
 */
function stateObj(field: string, descKey?: I18nKey): ioBroker.SettableStateObject {
  const spec = FIELD_SPECS[field];
  return {
    type: "state",
    common: {
      name: tName(field as I18nKey),
      ...(descKey ? { desc: tName(descKey) } : {}),
      type: spec.type,
      role: spec.role,
      read: spec.read,
      write: spec.write,
      def: spec.def,
      ...(spec.unit ? { unit: spec.unit } : {}),
    },
    native: {},
  };
}

/**
 * Create/refresh all 17 objects (5 channels + 12 states) on every run.
 *
 * The ids are spelled out instead of looped for a reason: the manifest carries the same 17 as
 * `instanceObjects`, and the consistency gate `audit_instanceobjects_reach` checks that each of
 * them is refreshed at runtime by looking for a literal `extendObject("<id>"` in `src/` — a
 * template-built id would satisfy the tree but not the check that guards it.
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
 */
export async function ensureObjects(adapter: ioBroker.Adapter): Promise<void> {
  await adapter.extendObjectAsync("today", channelObj("today"));
  await adapter.extendObjectAsync("today.name", stateObj("name", "descDayName"));
  await adapter.extendObjectAsync("today.isHoliday", stateObj("isHoliday", "descDayIsHoliday"));

  await adapter.extendObjectAsync("yesterday", channelObj("yesterday"));
  await adapter.extendObjectAsync("yesterday.name", stateObj("name", "descDayName"));
  await adapter.extendObjectAsync("yesterday.isHoliday", stateObj("isHoliday", "descDayIsHoliday"));

  await adapter.extendObjectAsync("tomorrow", channelObj("tomorrow"));
  await adapter.extendObjectAsync("tomorrow.name", stateObj("name", "descDayName"));
  await adapter.extendObjectAsync("tomorrow.isHoliday", stateObj("isHoliday", "descDayIsHoliday"));

  await adapter.extendObjectAsync("dayAfterTomorrow", channelObj("dayAfterTomorrow"));
  await adapter.extendObjectAsync("dayAfterTomorrow.name", stateObj("name", "descDayName"));
  await adapter.extendObjectAsync("dayAfterTomorrow.isHoliday", stateObj("isHoliday", "descDayIsHoliday"));

  await adapter.extendObjectAsync("next", channelObj("next", "descNext"));
  await adapter.extendObjectAsync("next.name", stateObj("name", "descNextName"));
  await adapter.extendObjectAsync("next.isHoliday", stateObj("isHoliday", "descNextIsHoliday"));
  await adapter.extendObjectAsync("next.date", stateObj("date", "descNextDate"));
  await adapter.extendObjectAsync("next.daysUntil", stateObj("daysUntil", "descNextDaysUntil"));
}

// Map state-field name → value getter.
const DAY_VALUE: Record<string, (d: DayInfo) => string | boolean> = {
  name: d => d.name,
  isHoliday: d => d.isHoliday,
};

const NEXT_VALUE: Record<string, (n: NextHoliday) => string | boolean | number> = {
  name: n => n.name,
  isHoliday: n => n.isHoliday,
  date: n => n.date,
  daysUntil: n => n.daysUntil,
};

export async function publishStates(adapter: ioBroker.Adapter, computed: ComputedHolidays): Promise<void> {
  const dayMap: Record<string, DayInfo> = {
    today: computed.today,
    yesterday: computed.yesterday,
    tomorrow: computed.tomorrow,
    dayAfterTomorrow: computed.dayAfterTomorrow,
  };

  for (const ch of DAY_CHANNELS) {
    const info = dayMap[ch];
    for (const field of DAY_FIELDS) {
      await adapter.setStateChangedAsync(`${ch}.${field}`, DAY_VALUE[field](info), true);
    }
  }

  for (const field of NEXT_FIELDS) {
    await adapter.setStateChangedAsync(`next.${field}`, NEXT_VALUE[field](computed.next), true);
  }
}
