"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var holiday_engine_exports = {};
__export(holiday_engine_exports, {
  BRIDGE_DAY_NAMES: () => BRIDGE_DAY_NAMES,
  computeHolidays: () => computeHolidays,
  createHolidaysInstance: () => createHolidaysInstance,
  detectBridgeDays: () => detectBridgeDays,
  detectScopeIssues: () => detectScopeIssues,
  logAvailableHolidays: () => logAvailableHolidays,
  toDateKey: () => toDateKey,
  toHolidayId: () => toHolidayId
});
module.exports = __toCommonJS(holiday_engine_exports);
var import_date_holidays = __toESM(require("date-holidays"));
var import_types = require("./types");
var import_error_utils = require("./error-utils");
const EMPTY_DAY = { name: "", isHoliday: false };
const TYPE_PRIORITY = import_types.HOLIDAY_TYPES.map((t) => t.key);
function typeRank(type) {
  const i = TYPE_PRIORITY.indexOf(type);
  return i === -1 ? TYPE_PRIORITY.length : i;
}
const BRIDGE_DAY_NAMES = {
  de: "Br\xFCckentag",
  en: "Bridge day",
  es: "D\xEDa puente",
  fr: "Jour de pont",
  it: "Ponte",
  nl: "Brugdag",
  pl: "Dzie\u0144 pomostowy",
  pt: "Dia de ponte",
  ru: "\u041D\u0435\u0440\u0430\u0431\u043E\u0447\u0438\u0439 \u0434\u0435\u043D\u044C",
  uk: "\u041D\u0435\u0440\u043E\u0431\u043E\u0447\u0438\u0439 \u0434\u0435\u043D\u044C",
  zh: "\u6865\u63A5\u65E5"
};
function computeHolidays(config, languages, referenceDate, instance) {
  const now = referenceDate != null ? referenceDate : /* @__PURE__ */ new Date();
  const hd = instance != null ? instance : createHolidaysInstance(config, languages);
  const { holidays: filtered, unmatchedExcludes } = getFilteredHolidays(hd, now, config, languages);
  const yesterday = getDayInfo(filtered, addDays(now, -1));
  const today = getDayInfo(filtered, now);
  const tomorrow = getDayInfo(filtered, addDays(now, 1));
  const dayAfterTomorrow = getDayInfo(filtered, addDays(now, 2));
  const next = getNextHoliday(filtered, now);
  return { yesterday, today, tomorrow, dayAfterTomorrow, next, unmatchedExcludes };
}
function logAvailableHolidays(config, languages, log, instance) {
  const hd = instance != null ? instance : createHolidaysInstance(config, languages);
  const year = (/* @__PURE__ */ new Date()).getFullYear();
  const holidays = hd.getHolidays(year);
  const matching = holidays.filter((h) => config.holidayTypes.includes(h.type)).map((h) => `${toHolidayId(h.name, h.rule)} (${(0, import_error_utils.oneLine)(h.name)}, ${h.type})`);
  const scope = (0, import_error_utils.oneLine)(
    `${config.country}${config.state ? `/${config.state}` : ""}${config.region ? `/${config.region}` : ""}`
  );
  log(`${scope}: ${matching.length} holidays for ${year} \u2014 IDs: ${matching.join(", ")}`);
}
function createHolidaysInstance(config, languages) {
  let hd;
  if (config.state && config.region) {
    hd = new import_date_holidays.default(config.country, config.state, config.region);
  } else if (config.state) {
    hd = new import_date_holidays.default(config.country, config.state);
  } else {
    hd = new import_date_holidays.default(config.country);
  }
  hd.setLanguages(languages);
  return hd;
}
function detectScopeIssues(config, languages, instance) {
  var _a, _b;
  const hd = instance != null ? instance : createHolidaysInstance(config, languages);
  if (hd.getHolidays((/* @__PURE__ */ new Date()).getFullYear()).length === 0) {
    return [{ kind: "country" }];
  }
  if (config.state && !((_a = hd.getStates(config.country)) == null ? void 0 : _a[config.state])) {
    return [{ kind: "state" }];
  }
  if (config.region && !((_b = hd.getRegions(config.country, config.state)) == null ? void 0 : _b[config.region])) {
    return [{ kind: "region" }];
  }
  return [];
}
function getFilteredHolidays(hd, referenceDate, config, languages) {
  const year = referenceDate.getFullYear();
  const years = [year - 1, year, year + 1];
  const result = /* @__PURE__ */ new Map();
  for (const y of years) {
    const holidays = hd.getHolidays(y);
    for (const h of holidays) {
      if (!config.holidayTypes.includes(h.type)) {
        continue;
      }
      const id = toHolidayId(h.name, h.rule);
      if (config.excludeHolidays.includes(id)) {
        continue;
      }
      const dateKey = h.date.substring(0, 10);
      const existing = result.get(dateKey);
      if (!existing || typeRank(h.type) < typeRank(existing.type)) {
        result.set(dateKey, h);
      }
    }
  }
  if (config.includeBridgeDays) {
    for (const y of years) {
      addBridgeDays(result, y, languages);
    }
  }
  let unmatchedExcludes = [];
  if (config.excludeHolidays.length) {
    const countryWideIds = collectCountryWideIds(config.country, years);
    unmatchedExcludes = config.excludeHolidays.filter((id) => !countryWideIds.has(id));
  }
  return { holidays: result, unmatchedExcludes };
}
function collectCountryWideIds(country, years) {
  const ids = /* @__PURE__ */ new Set();
  const base = new import_date_holidays.default();
  const add = (instance) => {
    for (const y of years) {
      for (const h of instance.getHolidays(y) || []) {
        ids.add(toHolidayId(h.name, h.rule));
      }
    }
  };
  add(new import_date_holidays.default(country));
  const states = base.getStates(country);
  if (states) {
    for (const st of Object.keys(states)) {
      add(new import_date_holidays.default(country, st));
      const regions = base.getRegions(country, st);
      if (regions) {
        for (const rg of Object.keys(regions)) {
          add(new import_date_holidays.default(country, st, rg));
        }
      }
    }
  }
  return ids;
}
function getDayInfo(holidays, date) {
  const key = toDateKey(date);
  const h = holidays.get(key);
  if (!h) {
    return { ...EMPTY_DAY };
  }
  return {
    name: h.name,
    isHoliday: true
  };
}
function getNextHoliday(holidays, referenceDate) {
  const refKey = toDateKey(referenceDate);
  let nearest = null;
  let nearestDate = null;
  for (const [dateKey, h] of holidays) {
    if (dateKey <= refKey) {
      continue;
    }
    const d = /* @__PURE__ */ new Date(`${dateKey}T00:00:00`);
    if (!nearest || d < nearestDate) {
      nearest = h;
      nearestDate = d;
    }
  }
  if (!nearest || !nearestDate) {
    return { ...EMPTY_DAY, date: "", daysUntil: 0 };
  }
  const refMidnight = new Date(referenceDate);
  refMidnight.setHours(0, 0, 0, 0);
  const daysUntil = Math.round((nearestDate.getTime() - refMidnight.getTime()) / 864e5);
  return {
    name: nearest.name,
    isHoliday: true,
    date: toDateKey(nearestDate),
    daysUntil
  };
}
function detectBridgeDays(holidays, year) {
  const bridgeDays = [];
  for (const [dateKey] of holidays) {
    if (!dateKey.startsWith(String(year))) {
      continue;
    }
    const holidayDate = /* @__PURE__ */ new Date(`${dateKey}T00:00:00`);
    const dow = holidayDate.getDay();
    if (dow === 4) {
      const friday = addDays(holidayDate, 1);
      if (!holidays.has(toDateKey(friday))) {
        bridgeDays.push(friday);
      }
    }
    if (dow === 2) {
      const monday = addDays(holidayDate, -1);
      if (!holidays.has(toDateKey(monday))) {
        bridgeDays.push(monday);
      }
      const wednesday = addDays(holidayDate, 1);
      const thursday = addDays(holidayDate, 2);
      if (!holidays.has(toDateKey(wednesday)) && holidays.has(toDateKey(thursday))) {
        bridgeDays.push(wednesday);
      }
    }
  }
  return bridgeDays;
}
function addBridgeDays(holidays, year, languages) {
  var _a, _b, _c;
  const lang = (_b = (_a = languages[0]) == null ? void 0 : _a.split("-")[0]) != null ? _b : "en";
  const name = (_c = BRIDGE_DAY_NAMES[lang]) != null ? _c : BRIDGE_DAY_NAMES.en;
  const bridgeDays = detectBridgeDays(holidays, year);
  for (const bd of bridgeDays) {
    const key = toDateKey(bd);
    if (!holidays.has(key)) {
      holidays.set(key, {
        date: key,
        name,
        type: "bridge",
        rule: ""
      });
    }
  }
}
function toHolidayId(name, rule) {
  if (rule) {
    const clean = rule.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
    if (clean.length > 3) {
      return clean;
    }
  }
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9\s]/g, "").replace(/\s+/g, "_").toLowerCase();
}
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BRIDGE_DAY_NAMES,
  computeHolidays,
  createHolidaysInstance,
  detectBridgeDays,
  detectScopeIssues,
  logAvailableHolidays,
  toDateKey,
  toHolidayId
});
//# sourceMappingURL=holiday-engine.js.map
