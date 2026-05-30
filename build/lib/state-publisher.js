"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var state_publisher_exports = {};
__export(state_publisher_exports, {
  cleanupDeprecatedStates: () => cleanupDeprecatedStates,
  ensureObjects: () => ensureObjects,
  publishStates: () => publishStates
});
module.exports = __toCommonJS(state_publisher_exports);
var import_i18n = require("./i18n");
const DAY_CHANNELS = ["today", "yesterday", "tomorrow", "dayAfterTomorrow"];
const DAY_FIELDS = ["name", "boolean"];
const NEXT_FIELDS = ["name", "boolean", "date", "daysUntil"];
const FIELD_SPECS = {
  name: { type: "string", role: "text", read: true, write: false },
  boolean: { type: "boolean", role: "indicator", read: true, write: false },
  date: { type: "string", role: "text", read: true, write: false },
  daysUntil: { type: "number", role: "value", read: true, write: false }
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
  "next.duration"
];
async function cleanupDeprecatedStates(adapter) {
  for (const id of DEPRECATED_STATES) {
    try {
      const obj = await adapter.getObjectAsync(id);
      if (obj) {
        await adapter.delObjectAsync(id);
        adapter.log.debug(`Removed deprecated state: ${id}`);
      }
    } catch {
    }
  }
}
async function ensureObjects(adapter) {
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
async function ensureChannel(adapter, channel) {
  await adapter.extendObjectAsync(
    channel,
    {
      type: "channel",
      common: { name: (0, import_i18n.tName)(channel) },
      native: {}
    },
    { preserve: { common: ["name"] } }
  );
}
async function ensureState(adapter, channel, field) {
  const spec = FIELD_SPECS[field];
  if (!spec) {
    return;
  }
  await adapter.extendObjectAsync(
    `${channel}.${field}`,
    {
      type: "state",
      common: {
        name: (0, import_i18n.tName)(field),
        type: spec.type,
        role: spec.role,
        read: spec.read,
        write: spec.write
      },
      native: {}
    },
    { preserve: { common: ["name"] } }
  );
}
const DAY_VALUE = {
  name: (d) => d.name,
  boolean: (d) => d.isHoliday
};
const NEXT_VALUE = {
  name: (n) => n.name,
  boolean: (n) => n.isHoliday,
  date: (n) => n.date,
  daysUntil: (n) => n.daysUntil
};
async function publishStates(adapter, computed) {
  const dayMap = {
    today: computed.today,
    yesterday: computed.yesterday,
    tomorrow: computed.tomorrow,
    dayAfterTomorrow: computed.dayAfterTomorrow
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  cleanupDeprecatedStates,
  ensureObjects,
  publishStates
});
//# sourceMappingURL=state-publisher.js.map
