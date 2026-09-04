import type { ComputedHolidays, DayInfo, NextHoliday } from "./types";
import { tName, type I18nKey } from "./i18n";

const DAY_CHANNELS = ["today", "yesterday", "tomorrow", "dayAfterTomorrow"] as const;
const DAY_FIELDS = ["name", "isHoliday"] as const;
const NEXT_FIELDS = ["name", "isHoliday", "date", "daysUntil"] as const;

interface StateSpec {
  type: ioBroker.CommonType;
  role: string;
  read: boolean;
  write: boolean;
  unit?: string;
}

const FIELD_SPECS: Record<string, StateSpec> = {
  name: { type: "string", role: "text", read: true, write: false },
  isHoliday: { type: "boolean", role: "indicator", read: true, write: false },
  date: { type: "string", role: "date", read: true, write: false },
  daysUntil: { type: "number", role: "value.interval", read: true, write: false, unit: "days" },
};

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

export async function cleanupDeprecatedStates(adapter: ioBroker.Adapter): Promise<void> {
  for (const id of DEPRECATED_STATES) {
    try {
      const obj = await adapter.getObjectAsync(id);
      if (obj) {
        await adapter.delObjectAsync(id);
        adapter.log.debug(`Removed deprecated state: ${id}`);
      }
    } catch {
      // already gone
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
 * @returns the object passed to `extendObject`
 */
function channelObj(channel: string): ioBroker.SettableChannelObject {
  return {
    type: "channel",
    common: { name: tName(channel as I18nKey) },
    native: {},
  };
}

/**
 * The state object for one field, built from {@link FIELD_SPECS}. Same no-`preserve` reasoning as
 * {@link channelObj}.
 *
 * @param field the field name, which doubles as its i18n key
 * @returns the object passed to `extendObject`
 */
function stateObj(field: string): ioBroker.SettableStateObject {
  const spec = FIELD_SPECS[field];
  return {
    type: "state",
    common: {
      name: tName(field as I18nKey),
      type: spec.type,
      role: spec.role,
      read: spec.read,
      write: spec.write,
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
 * @param adapter the adapter instance
 */
export async function ensureObjects(adapter: ioBroker.Adapter): Promise<void> {
  await adapter.extendObjectAsync("today", channelObj("today"));
  await adapter.extendObjectAsync("today.name", stateObj("name"));
  await adapter.extendObjectAsync("today.isHoliday", stateObj("isHoliday"));

  await adapter.extendObjectAsync("yesterday", channelObj("yesterday"));
  await adapter.extendObjectAsync("yesterday.name", stateObj("name"));
  await adapter.extendObjectAsync("yesterday.isHoliday", stateObj("isHoliday"));

  await adapter.extendObjectAsync("tomorrow", channelObj("tomorrow"));
  await adapter.extendObjectAsync("tomorrow.name", stateObj("name"));
  await adapter.extendObjectAsync("tomorrow.isHoliday", stateObj("isHoliday"));

  await adapter.extendObjectAsync("dayAfterTomorrow", channelObj("dayAfterTomorrow"));
  await adapter.extendObjectAsync("dayAfterTomorrow.name", stateObj("name"));
  await adapter.extendObjectAsync("dayAfterTomorrow.isHoliday", stateObj("isHoliday"));

  await adapter.extendObjectAsync("next", channelObj("next"));
  await adapter.extendObjectAsync("next.name", stateObj("name"));
  await adapter.extendObjectAsync("next.isHoliday", stateObj("isHoliday"));
  await adapter.extendObjectAsync("next.date", stateObj("date"));
  await adapter.extendObjectAsync("next.daysUntil", stateObj("daysUntil"));
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
