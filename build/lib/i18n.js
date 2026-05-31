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
var i18n_exports = {};
__export(i18n_exports, {
  SUPPORTED_LANGS: () => SUPPORTED_LANGS,
  getSystemConfig: () => getSystemConfig,
  resolveCountryCode: () => resolveCountryCode,
  resolveLanguages: () => resolveLanguages,
  tName: () => tName
});
module.exports = __toCommonJS(i18n_exports);
var import_adapter_core = require("@iobroker/adapter-core");
var import_date_holidays = __toESM(require("date-holidays"));
var import_country_codes = require("./country-codes");
const SUPPORTED_LANGS = ["de", "en", "es", "fr", "it", "nl", "pl", "pt", "ru", "uk", "zh"];
function tName(key) {
  return import_adapter_core.I18n.getTranslatedObject(key);
}
function resolveLanguages(systemLang, country) {
  const lang = systemLang.toLowerCase().split("-")[0];
  if (!SUPPORTED_LANGS.includes(lang)) {
    return ["en"];
  }
  const h = new import_date_holidays.default(country);
  const available = h.getLanguages();
  if (available.includes(lang)) {
    return lang === "en" ? ["en"] : [lang, "en"];
  }
  return ["en"];
}
let supportedCodes = null;
let nameToCode = null;
function resolveCountryCode(value) {
  const v = value.trim();
  if (!v) {
    return "";
  }
  if (!supportedCodes) {
    supportedCodes = new Set(Object.keys(new import_date_holidays.default().getCountries()));
  }
  if (!nameToCode) {
    nameToCode = new Map(Object.entries(import_country_codes.COUNTRY_NAME_TO_CODE).map(([name, code]) => [name.toLowerCase(), code]));
  }
  const upper = v.toUpperCase();
  if (v.length === 2 && supportedCodes.has(upper)) {
    return upper;
  }
  const mapped = nameToCode.get(v.toLowerCase());
  return mapped && supportedCodes.has(mapped) ? mapped : "";
}
async function getSystemConfig(adapter) {
  try {
    const obj = await adapter.getForeignObjectAsync("system.config");
    const common = obj == null ? void 0 : obj.common;
    return {
      country: typeof (common == null ? void 0 : common.country) === "string" ? common.country : "",
      language: (typeof (common == null ? void 0 : common.language) === "string" ? common.language : "") || "en"
    };
  } catch {
    return { country: "", language: "en" };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  SUPPORTED_LANGS,
  getSystemConfig,
  resolveCountryCode,
  resolveLanguages,
  tName
});
//# sourceMappingURL=i18n.js.map
