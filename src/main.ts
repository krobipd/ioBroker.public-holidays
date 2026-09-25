import * as utils from "@iobroker/adapter-core";
import { I18n } from "@iobroker/adapter-core";
import { join } from "node:path";
import { configuredCountry, parseConfig } from "./lib/config";
import { errText, oneLine } from "./lib/error-utils";
import {
  computeHolidays,
  createHolidaysInstance,
  detectScopeIssue,
  emptyResult,
  logAvailableHolidays,
} from "./lib/holiday-engine";
import { formatDateForDisplay, getSystemConfig, resolveCountry, resolveLanguages } from "./lib/i18n";
import { migrateNativeKeys, type NativeKeyMigration } from "./lib/native-key-migration";
import { cleanupDeprecatedStates, ensureObjects, publishStates } from "./lib/state-publisher";

/**
 * Settings keys earlier versions declared and this one no longer reads — nulled on the first start
 * after an update by the fleet helper (js-controller never deletes a native key):
 * - `excludePublic`: the exclude field of the pre-0.9.0 config.
 * - `holidays`: the previous owner's 0.0.x releases on npm (Jey-Cee) declared it.
 */
const MIGRATIONS: NativeKeyMigration[] = [{ drop: "excludePublic" }, { drop: "holidays" }];

// Exported so the orchestration unit tests can drive onReady directly.
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
   *
   * Obsolete `native` keys are NOT handled here: the fleet helper `migrateNativeKeys` (MIGRATIONS
   * above) owns them, and a second cleanup of the same key would take turns with it.
   *
   * @returns true when something was written and the restart is coming — the caller has to
   *   stand down instead of computing in a process that is going away.
   */
  private async repairInstanceObject(): Promise<boolean> {
    const id = `system.adapter.${this.namespace}`;
    try {
      const instanceObj = await this.getForeignObjectAsync(id);
      const common: Record<string, unknown> = {};

      if (instanceObj?.common?.mode === "daemon") {
        this.log.info("Migrating from daemon to schedule mode");
        Object.assign(common, { mode: "schedule", schedule: "0 0 * * *" });
      }

      const supported = instanceObj?.common?.supportedMessages;
      if (supported !== undefined && supported !== null) {
        this.log.info("Correcting a leftover setting from an earlier version — this instance restarts once");
        common.supportedMessages = null;
      }

      if (Object.keys(common).length === 0) {
        return false;
      }
      await this.extendForeignObjectAsync(id, { common });
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
      // and publishing in a process that is on its way out. The settings migration comes first
      // (fleet form); an installation that needs both writes restarts twice, once per write.
      if (await migrateNativeKeys(this, MIGRATIONS, errText)) {
        void this.stop?.();
        return;
      }
      if (await this.repairInstanceObject()) {
        void this.stop?.();
        return;
      }

      await I18n.init(join(this.adapterDir, "admin"), this);

      this.log.debug("Computing holidays...");
      const sysConfig = await getSystemConfig(this);
      const raw = this.config as Record<string, unknown>;

      let detectedCountry = "";
      let systemCountryProblem = "";
      if (!configuredCountry(raw) && sysConfig.country) {
        const detected = resolveCountry(sysConfig.country);
        detectedCountry = detected.code;
        if (detectedCountry) {
          this.log.debug(`Using system country: ${detectedCountry}`);
        } else {
          const name = oneLine(sysConfig.country);
          systemCountryProblem =
            detected.reason === "ambiguous"
              ? `System country '${name}' covers several countries — choose the country in the adapter settings`
              : detected.reason === "no-data"
                ? `System country '${name}' has no holiday data — choose a country in the adapter settings`
                : `System country '${name}' is not recognized — choose a country in the adapter settings`;
        }
      }

      const config = parseConfig(raw, detectedCountry);
      if (!config) {
        this.log.warn(systemCountryProblem || "No country configured — open adapter settings");
        // Publish a truthful empty result instead of leaving the previous run's values standing
        // (the same reasoning as the empty type selection below): a `today.isHoliday` that stays
        // `true` forever because the country was cleared is a wrong datapoint with no expiry.
        await ensureObjects(this);
        await publishStates(this, emptyResult());
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

      const issue = detectScopeIssue(config, languages, hd);
      if (issue?.kind === "country") {
        this.log.warn(`Country '${oneLine(config.country)}' is not recognized — check the country setting`);
      } else if (issue?.kind === "state") {
        this.log.warn(
          `State '${oneLine(config.state)}' is unknown for ${oneLine(config.country)} — using country-level holidays`,
        );
      } else if (issue?.kind === "region") {
        const scope = config.state ? `${oneLine(config.country)}/${oneLine(config.state)}` : oneLine(config.country);
        this.log.warn(`Region '${oneLine(config.region)}' is unknown for ${scope} — using broader holidays`);
      } else if (issue?.kind === "unloadable") {
        const key = oneLine(config.region || config.state);
        this.log.warn(`date-holidays cannot load '${key}' (library defect) — using the broader scope's holidays`);
      }

      const computed = computeHolidays(config, languages, { instance: hd, systemLanguage: sysConfig.language });
      if (computed.unmatchedExcludes.length > 0) {
        this.log.warn(
          `These excluded holidays no longer occur in the holiday data (a one-off date that has passed, or changed by a date-holidays update): ${oneLine(
            computed.unmatchedExcludes.join(", "),
          )}`,
        );
      }

      // Guarded, not unconditional: the listing computes an extra year and builds a line naming
      // every holiday, which is pure waste while nobody reads debug output (audit finding F12).
      if (this.log.level === "debug" || this.log.level === "silly") {
        logAvailableHolidays(config, languages, msg => this.log.debug(msg), hd);
      }

      await cleanupDeprecatedStates(this);
      await ensureObjects(this);
      await publishStates(this, computed);

      // The log line shows the date the way the user's ioBroker displays dates
      // (system.config dateFormat, e.g. "26.10.2026"); the next.date STATE stays ISO.
      const days = computed.next.daysUntil;
      const nextText = computed.next.isHoliday
        ? `${oneLine(computed.next.name)} on ${formatDateForDisplay(computed.next.date, sysConfig.dateFormat)} (in ${days} ${days === 1 ? "day" : "days"})`
        : "no upcoming holiday";
      const summary = `Today: ${
        computed.today.isHoliday ? oneLine(computed.today.name) : "no holiday"
      }, next holiday: ${nextText}`;
      // Logged at info on every run — the start run and each daily schedule run — so the next
      // holiday is always visible in the log (krobi 2026-08-10). Written AFTER the states, so the
      // line never reports values that did not reach the database.
      this.log.info(summary);
    } catch (err: unknown) {
      this.log.error(`onReady failed: ${errText(err)}`);
      // The Sentry plugin only hooks uncaught exceptions — a caught error has to be handed over
      // (plugin README, "Send specific errors to Sentry"). The two other catches (instance-object
      // repair, deprecated-state cleanup) stay quiet on purpose: expected broker hiccups with a
      // local fallback, not adapter defects.
      if (this.supportsFeature?.("PLUGINS")) {
        await this.reportToSentry(err);
      }
    }
    void this.stop?.();
  }

  /**
   * Hand a caught error to Sentry and wait for it to leave: a schedule adapter stops right after,
   * and the process exits about half a second later — an event still queued then is lost (measured
   * 2026-06-07: only an explicit flush brought the test event through).
   *
   * @param err the caught error
   */
  private async reportToSentry(err: unknown): Promise<void> {
    try {
      const sentry = this.getPluginInstance("sentry")?.getSentryObject();
      sentry?.captureException(err);
      await sentry?.flush?.(2000);
    } catch (reportErr: unknown) {
      this.log.debug(`Could not hand the error to Sentry: ${errText(reportErr)}`);
    }
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
