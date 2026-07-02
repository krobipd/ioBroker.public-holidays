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
var main_exports = {};
__export(main_exports, {
  PublicHolidaysAdapter: () => PublicHolidaysAdapter
});
module.exports = __toCommonJS(main_exports);
var utils = __toESM(require("@iobroker/adapter-core"));
var import_adapter_core = require("@iobroker/adapter-core");
var import_node_path = require("node:path");
var import_error_utils = require("./lib/error-utils");
var import_holiday_engine = require("./lib/holiday-engine");
var import_i18n = require("./lib/i18n");
var import_state_publisher = require("./lib/state-publisher");
var import_types = require("./lib/types");
class PublicHolidaysAdapter extends utils.Adapter {
  constructor(options = {}) {
    super({ ...options, name: "public-holidays" });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    var _a, _b, _c;
    try {
      const instanceObj = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
      if (((_a = instanceObj == null ? void 0 : instanceObj.common) == null ? void 0 : _a.mode) === "daemon") {
        this.log.info("Migrating from daemon to schedule mode");
        await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
          common: { mode: "schedule", schedule: "0 0 * * *" }
        });
      }
      await import_adapter_core.I18n.init((0, import_node_path.join)(this.adapterDir, "admin"), this);
      this.log.debug("Computing holidays...");
      const sysConfig = await (0, import_i18n.getSystemConfig)(this);
      let detectedCountry = "";
      const explicitCountry = this.configuredCountry();
      if (!explicitCountry && sysConfig.country) {
        detectedCountry = (0, import_i18n.resolveCountryCode)(sysConfig.country);
        if (detectedCountry) {
          this.log.info(`Using system country: ${detectedCountry}`);
        }
      }
      const config = this.validateConfig(detectedCountry);
      if (!config) {
        this.log.warn("No country configured \u2014 open adapter settings");
        void ((_b = this.stop) == null ? void 0 : _b.call(this));
        return;
      }
      const languages = (0, import_i18n.resolveLanguages)(sysConfig.language, config.country);
      this.log.debug(`System language: ${(0, import_error_utils.oneLine)(sysConfig.language)}, holiday languages: [${languages.join(", ")}]`);
      const hd = (0, import_holiday_engine.createHolidaysInstance)(config, languages);
      for (const issue of (0, import_holiday_engine.detectScopeIssues)(config, languages, hd)) {
        if (issue.kind === "country") {
          this.log.warn(`Country '${(0, import_error_utils.oneLine)(config.country)}' is not recognized \u2014 check the country setting`);
        } else if (issue.kind === "state") {
          this.log.warn(
            `State '${(0, import_error_utils.oneLine)(config.state)}' is unknown for ${(0, import_error_utils.oneLine)(config.country)} \u2014 using country-level holidays`
          );
        } else {
          this.log.warn(
            `Region '${(0, import_error_utils.oneLine)(config.region)}' is unknown for ${(0, import_error_utils.oneLine)(config.country)}/${(0, import_error_utils.oneLine)(config.state)} \u2014 using broader holidays`
          );
        }
      }
      const computed = (0, import_holiday_engine.computeHolidays)(config, languages, void 0, hd);
      if (computed.unmatchedExcludes.length > 0) {
        this.log.warn(
          `These excluded holidays no longer match any holiday (possibly renamed by a date-holidays update): ${(0, import_error_utils.oneLine)(
            computed.unmatchedExcludes.join(", ")
          )}`
        );
      }
      (0, import_holiday_engine.logAvailableHolidays)(config, languages, (msg) => this.log.debug(msg), hd);
      const nextText = computed.next.isHoliday ? `${(0, import_error_utils.oneLine)(computed.next.name)} in ${computed.next.daysUntil} days` : "no upcoming holiday";
      this.log.info(
        `Today: ${computed.today.isHoliday ? (0, import_error_utils.oneLine)(computed.today.name) : "no holiday"}, next: ${nextText}`
      );
      await (0, import_state_publisher.cleanupDeprecatedStates)(this);
      await (0, import_state_publisher.ensureObjects)(this);
      await (0, import_state_publisher.publishStates)(this, computed);
      this.log.debug("All holidays computed and published");
    } catch (err) {
      this.log.error(`onReady failed: ${(0, import_error_utils.errText)(err)}`);
    }
    void ((_c = this.stop) == null ? void 0 : _c.call(this));
  }
  /** The raw (untyped) native config — single cast point for all config reads. */
  rawConfig() {
    return this.config;
  }
  /** The explicitly configured country, trimmed; "" when unset/non-string. */
  configuredCountry() {
    const c = this.rawConfig().country;
    return typeof c === "string" ? c.trim() : "";
  }
  validateConfig(fallbackCountry = "") {
    const raw = this.rawConfig();
    const country = this.configuredCountry() || fallbackCountry;
    if (!country) {
      return null;
    }
    const holidayTypes = import_types.HOLIDAY_TYPES.filter((t) => t.defaultOn ? raw[t.flag] !== false : raw[t.flag] === true).map(
      (t) => t.key
    );
    return {
      country,
      state: typeof raw.state === "string" ? raw.state.trim() : "",
      region: typeof raw.region === "string" ? raw.region.trim() : "",
      holidayTypes,
      excludeHolidays: PublicHolidaysAdapter.toStringArray(raw.excludeHolidays),
      includeBridgeDays: raw.includeBridgeDays === true
    };
  }
  static toStringArray(val) {
    return Array.isArray(val) ? val.filter((x) => typeof x === "string") : [];
  }
  onUnload(callback) {
    callback();
  }
}
if (require.main !== module) {
  module.exports = (options) => new PublicHolidaysAdapter(options);
} else {
  new PublicHolidaysAdapter();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PublicHolidaysAdapter
});
//# sourceMappingURL=main.js.map
