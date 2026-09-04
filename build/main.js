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
  /**
   * Bring this instance's own object in line with the current manifest and report whether
   * anything had to be written. Every correction goes into ONE write, because each write of the
   * own instance object costs a restart:
   *
   * - `mode: daemon` → the pre-schedule layout. Was already migrated here, but the run then
   *   carried on writing states while the host was already restarting the instance.
   * - `common.supportedMessages` → dropped from the manifest, which only helps a FRESH install:
   *   an upgrade merges the manifest into the existing instance object and never removes a key,
   *   so the old value survives in the database — and that is what the host reads. With
   *   `stopInstance` the host kills the process one second after asking it to stop, in the
   *   middle of a holiday run, and this adapter has no message handler to answer with.
   *   The key is CLEARED (`null`), never rewritten to `{ stopInstance: false }`:
   *   `supportedMessages` is a positive list, not a switch — as long as it is an object,
   *   `isMessageboxSupported()` ignores `common.messagebox`, and with no value other than
   *   `false` in it the adapter is never subscribed to messages at all. Triggering on the mere
   *   EXISTENCE of the key (not on `stopInstance`) is what makes the correction converge: an
   *   already-cleared key reads back as `null`/absent and is left alone, so there is no restart
   *   loop, and a half-corrected install from an earlier version is still repaired.
   * - `native.excludePublic` → the exclude field of the pre-0.9.0 config. The runtime ignores it,
   *   but it stays in the instance object forever unless it is cleared here.
   *
   * @returns true when something was written and the restart is coming — the caller has to
   *   stand down instead of computing in a process that is going away.
   */
  async repairInstanceObject() {
    var _a, _b, _c;
    const id = `system.adapter.${this.namespace}`;
    try {
      const instanceObj = await this.getForeignObjectAsync(id);
      const common = {};
      const native = {};
      if (((_a = instanceObj == null ? void 0 : instanceObj.common) == null ? void 0 : _a.mode) === "daemon") {
        this.log.info("Migrating from daemon to schedule mode");
        Object.assign(common, { mode: "schedule", schedule: "0 0 * * *" });
      }
      const supported = (_b = instanceObj == null ? void 0 : instanceObj.common) == null ? void 0 : _b.supportedMessages;
      if (supported !== void 0 && supported !== null) {
        this.log.info("Correcting a leftover setting from an earlier version \u2014 this instance restarts once");
        common.supportedMessages = null;
      }
      const legacyExclude = (_c = instanceObj == null ? void 0 : instanceObj.native) == null ? void 0 : _c.excludePublic;
      if (legacyExclude !== void 0 && legacyExclude !== null) {
        this.log.debug("Clearing the leftover excludePublic setting from a pre-0.9.0 version");
        native.excludePublic = null;
      }
      const patch = {};
      if (Object.keys(common).length > 0) {
        patch.common = common;
      }
      if (Object.keys(native).length > 0) {
        patch.native = native;
      }
      if (Object.keys(patch).length === 0) {
        return false;
      }
      await this.extendForeignObjectAsync(id, patch);
      return true;
    } catch (err) {
      this.log.debug(`Could not check the instance object ${id}: ${(0, import_error_utils.errText)(err)}`);
      return false;
    }
  }
  async onReady() {
    var _a, _b, _c;
    try {
      if (await this.repairInstanceObject()) {
        void ((_a = this.stop) == null ? void 0 : _a.call(this));
        return;
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
      if (config.holidayTypes.length === 0) {
        this.log.warn("No holiday type is enabled \u2014 no holidays will be reported; enable at least one in the settings");
      }
      const hd = (0, import_holiday_engine.createHolidaysInstance)(config);
      const languages = (0, import_i18n.resolveLanguages)(sysConfig.language, hd);
      hd.setLanguages(languages);
      this.log.debug(`System language: ${(0, import_error_utils.oneLine)(sysConfig.language)}, holiday languages: [${languages.join(", ")}]`);
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
      const computed = (0, import_holiday_engine.computeHolidays)(config, languages, { instance: hd });
      if (computed.unmatchedExcludes.length > 0) {
        this.log.warn(
          `These excluded holidays no longer match any holiday (possibly renamed by a date-holidays update): ${(0, import_error_utils.oneLine)(
            computed.unmatchedExcludes.join(", ")
          )}`
        );
      }
      (0, import_holiday_engine.logAvailableHolidays)(config, languages, (msg) => this.log.debug(msg), hd);
      const nextText = computed.next.isHoliday ? `${(0, import_error_utils.oneLine)(computed.next.name)} on ${(0, import_i18n.formatDateForDisplay)(computed.next.date, sysConfig.dateFormat)} (in ${computed.next.daysUntil} days)` : "no upcoming holiday";
      const summary = `Today: ${computed.today.isHoliday ? (0, import_error_utils.oneLine)(computed.today.name) : "no holiday"}, next holiday: ${nextText}`;
      this.log.info(summary);
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
  /**
   * Deliberately empty apart from the callback: this adapter holds no connection, no timer and
   * no device marker — it computes, publishes and stops itself. There is nothing that would have
   * to be written on the way out, so nothing has to be awaited before reporting done. What DID
   * matter is that `onUnload` runs at all, which is why the manifest no longer declares
   * `supportedMessages.stopInstance` (see {@link repairInstanceObject}).
   *
   * @param callback js-controller's "shutdown finished" signal
   */
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
