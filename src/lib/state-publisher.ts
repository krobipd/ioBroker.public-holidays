import type { ComputedHolidays, DayInfo, NextHoliday } from "./types";
import { tName, type I18nKey } from "./i18n";

const DAY_CHANNELS = ["today", "yesterday", "tomorrow", "dayAfterTomorrow"] as const;
const DAY_FIELDS = ["name", "boolean"] as const;
const NEXT_FIELDS = ["name", "boolean", "date", "daysUntil"] as const;

interface StateSpec {
  type: ioBroker.CommonType;
  role: string;
  read: boolean;
  write: boolean;
  unit?: string;
}

const FIELD_SPECS: Record<string, StateSpec> = {
  name: { type: "string", role: "text", read: true, write: false },
  boolean: { type: "boolean", role: "indicator", read: true, write: false },
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

export async function ensureObjects(adapter: ioBroker.Adapter): Promise<void> {
  for (const ch of DAY_CHANNELS) {
    await ensureChannel(adapter, ch);
    for (const field of DAY_FIELDS) {
      await ensureState(adapter, ch, field);
    }
  }

  await ensureChannel(adapter, "next");
  for (const field of NEXT_FIELDS) {
    await ensureState(adapter, "next", field);
  }
}

async function ensureChannel(adapter: ioBroker.Adapter, channel: string): Promise<void> {
  await adapter.extendObjectAsync(
    channel,
    {
      type: "channel",
      common: { name: tName(channel as I18nKey) },
      native: {},
    },
    { preserve: { common: ["name"] } },
  );
}

async function ensureState(adapter: ioBroker.Adapter, channel: string, field: string): Promise<void> {
  const spec = FIELD_SPECS[field];
  await adapter.extendObjectAsync(
    `${channel}.${field}`,
    {
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
    },
    { preserve: { common: ["name"] } },
  );
}

// Map state-field name → value getter (bridges field id "boolean" ↔ property "isHoliday").
const DAY_VALUE: Record<string, (d: DayInfo) => string | boolean> = {
  name: d => d.name,
  boolean: d => d.isHoliday,
};

const NEXT_VALUE: Record<string, (n: NextHoliday) => string | boolean | number> = {
  name: n => n.name,
  boolean: n => n.isHoliday,
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
