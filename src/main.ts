import * as utils from "@iobroker/adapter-core";
import { I18n } from "@iobroker/adapter-core";
import { join } from "node:path";
import { errText, oneLine } from "./lib/error-utils";
import { computeHolidays, createHolidaysInstance, detectScopeIssues, logAvailableHolidays } from "./lib/holiday-engine";
import { formatDateForDisplay, getSystemConfig, resolveCountryCode, resolveLanguages } from "./lib/i18n";
import { cleanupDeprecatedStates, ensureObjects, publishStates } from "./lib/state-publisher";
import { HOLIDAY_TYPES, type AdapterConfig } from "./lib/types";

// Exported so the orchestration unit tests can drive onReady/validateConfig directly.
export class PublicHolidaysAdapter extends utils.Adapter {
  constructor(options: Partial<utils.AdapterOptions> = {}) {
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
  private async repairInstanceObject(): Promise<boolean> {
    const id = `system.adapter.${this.namespace}`;
    try {
      const instanceObj = await this.getForeignObjectAsync(id);
      const common: Record<string, unknown> = {};
      const native: Record<string, unknown> = {};

      if (instanceObj?.common?.mode === "daemon") {
        this.log.info("Migrating from daemon to schedule mode");
        Object.assign(common, { mode: "schedule", schedule: "0 0 * * *" });
      }

      const supported = instanceObj?.common?.supportedMessages;
      if (supported !== undefined && supported !== null) {
        this.log.info("Correcting a leftover setting from an earlier version — this instance restarts once");
        common.supportedMessages = null;
      }

      const legacyExclude = (instanceObj?.native as Record<string, unknown> | undefined)?.excludePublic;
      if (legacyExclude !== undefined && legacyExclude !== null) {
        this.log.debug("Clearing the leftover excludePublic setting from a pre-0.9.0 version");
        native.excludePublic = null;
      }

      const patch: Record<string, unknown> = {};
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
    } catch (err: unknown) {
      // Objects DB unreachable — not worth failing the run over; the next run retries.
      this.log.debug(`Could not check the instance object ${id}: ${errText(err)}`);
      return false;
    }
  }

  private async onReady(): Promise<void> {
    try {
      // Every instance-object change restarts the instance, so there is no point computing
      // and publishing in a process that is on its way out.
      if (await this.repairInstanceObject()) {
        void this.stop?.();
        return;
      }

      await I18n.init(join(this.adapterDir, "admin"), this);

      this.log.debug("Computing holidays...");
      const sysConfig = await getSystemConfig(this);

      let detectedCountry = "";
      const explicitCountry = this.configuredCountry();
      if (!explicitCountry && sysConfig.country) {
        detectedCountry = resolveCountryCode(sysConfig.country);
        if (detectedCountry) {
          this.log.info(`Using system country: ${detectedCountry}`);
        }
      }

      const config = this.validateConfig(detectedCountry);
      if (!config) {
        this.log.warn("No country configured — open adapter settings");
        void this.stop?.();
        return;
      }

      // Every holiday type unchecked filters everything away — one click on the "public" box is
      // enough to get there. Say so instead of publishing empty states without a word, and keep
      // going: stopping here would leave yesterday's values standing, which is worse than a
      // truthful empty result.
      if (config.holidayTypes.length === 0) {
        this.log.warn("No holiday type is enabled — no holidays will be reported; enable at least one in the settings");
      }

      // Build the date-holidays instance once and reuse it for language detection, scope checks
      // and computation. getLanguages() is country-scoped, so the full-scope instance answers it
      // just as well — no throwaway second instance (audit finding L4).
      const hd = createHolidaysInstance(config);
      const languages = resolveLanguages(sysConfig.language, hd);
      hd.setLanguages(languages);
      this.log.debug(`System language: ${oneLine(sysConfig.language)}, holiday languages: [${languages.join(", ")}]`);

      for (const issue of detectScopeIssues(config, languages, hd)) {
        if (issue.kind === "country") {
          this.log.warn(`Country '${oneLine(config.country)}' is not recognized — check the country setting`);
        } else if (issue.kind === "state") {
          this.log.warn(
            `State '${oneLine(config.state)}' is unknown for ${oneLine(config.country)} — using country-level holidays`,
          );
        } else {
          this.log.warn(
            `Region '${oneLine(config.region)}' is unknown for ${oneLine(config.country)}/${oneLine(config.state)} — using broader holidays`,
          );
        }
      }

      const computed = computeHolidays(config, languages, { instance: hd });
      if (computed.unmatchedExcludes.length > 0) {
        this.log.warn(
          `These excluded holidays no longer match any holiday (possibly renamed by a date-holidays update): ${oneLine(
            computed.unmatchedExcludes.join(", "),
          )}`,
        );
      }

      logAvailableHolidays(config, languages, msg => this.log.debug(msg), hd);

      // The log line shows the date the way the user's ioBroker displays dates
      // (system.config dateFormat, e.g. "26.10.2026"); the next.date STATE stays ISO.
      const nextText = computed.next.isHoliday
        ? `${oneLine(computed.next.name)} on ${formatDateForDisplay(computed.next.date, sysConfig.dateFormat)} (in ${computed.next.daysUntil} days)`
        : "no upcoming holiday";
      const summary = `Today: ${
        computed.today.isHoliday ? oneLine(computed.today.name) : "no holiday"
      }, next holiday: ${nextText}`;
      // Logged at info on every run — the start run and each daily schedule run — so the next
      // holiday is always visible in the log (krobi 2026-08-10). This supersedes the earlier
      // "no-holiday day stays at debug" choice (audit L3): on an adapter that runs once a day the
      // single line is wanted, not a noisy heartbeat.
      this.log.info(summary);

      await cleanupDeprecatedStates(this);
      await ensureObjects(this);
      await publishStates(this, computed);

      this.log.debug("All holidays computed and published");
    } catch (err: unknown) {
      this.log.error(`onReady failed: ${errText(err)}`);
    }
    void this.stop?.();
  }

  /** The raw (untyped) native config — single cast point for all config reads. */
  private rawConfig(): Record<string, unknown> {
    return this.config as Record<string, unknown>;
  }

  /** The explicitly configured country, trimmed; "" when unset/non-string. */
  private configuredCountry(): string {
    const c = this.rawConfig().country;
    return typeof c === "string" ? c.trim() : "";
  }

  private validateConfig(fallbackCountry = ""): AdapterConfig | null {
    const raw = this.rawConfig();
    const country = this.configuredCountry() || fallbackCountry;
    if (!country) {
      return null;
    }

    const holidayTypes = HOLIDAY_TYPES.filter(t => (t.defaultOn ? raw[t.flag] !== false : raw[t.flag] === true)).map(
      t => t.key,
    );

    return {
      country,
      state: typeof raw.state === "string" ? raw.state.trim() : "",
      region: typeof raw.region === "string" ? raw.region.trim() : "",
      holidayTypes,
      excludeHolidays: PublicHolidaysAdapter.toStringArray(raw.excludeHolidays),
      includeBridgeDays: raw.includeBridgeDays === true,
    };
  }

  private static toStringArray(val: unknown): string[] {
    return Array.isArray(val) ? val.filter((x): x is string => typeof x === "string") : [];
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
  private onUnload(callback: () => void): void {
    callback();
  }
}

if (require.main !== module) {
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new PublicHolidaysAdapter(options);
} else {
  new PublicHolidaysAdapter();
}
