import * as utils from "@iobroker/adapter-core";
import { I18n } from "@iobroker/adapter-core";
import { join } from "node:path";
import { reconcileCalendarTree } from "./lib/calendar-tree";
import { calendarName, hasLegacySettings, legacyCalendar, legacyTakeover, usableCalendars } from "./lib/calendars";
import { configuredCountry, parseConfig } from "./lib/config";
import { errText } from "./lib/err-text";
import { KnownObjects } from "./lib/known-objects";
import { errLine, oneLine } from "./lib/log-text";
import { resolveCountry } from "./lib/country";
import {
  computeHolidays,
  createHolidaysInstance,
  detectScopeIssue,
  emptyResult,
  logAvailableHolidays,
} from "./lib/holiday-engine";
import { pickHolidayLanguages, readCalendarList } from "./lib/holiday-shared";
import { migrateNativeKeys, type NativeKeyMigration } from "./lib/native-key-migration";
import { REPORT_MS } from "./lib/object-removal";
import {
  calendarSummaryLine,
  DAMAGED_LIST_TEXT,
  forCalendar,
  hostZoneNote,
  NO_CALENDAR_TEXT,
  scopeIssueText,
  skippedCalendarText,
  staleExcludesText,
  systemCountryProblemText,
} from "./lib/run-messages";
import { failStart, SettingsError } from "./lib/start-failure";
import { cleanupDeprecatedStates, ensureCalendarObjects, publishCalendarStates } from "./lib/state-publisher";
import { getSystemConfig, type SystemConfig } from "./lib/system-config";
import type { Calendar, ComputedHolidays } from "./lib/types";

/**
 * Settings keys earlier versions declared and this one no longer reads — nulled on the first start
 * after an update by the fleet helper (js-controller never deletes a native key). The keys of the
 * single calendar of 0.20.x are taken over in the same write (migrateSettings):
 * - `excludePublic`: the exclude field of the pre-0.9.0 config.
 * - `holidays`: the previous owner's 0.0.x releases on npm (Jey-Cee) declared it.
 */
const MIGRATIONS: NativeKeyMigration[] = [{ drop: "excludePublic" }, { drop: "holidays" }];

/** The adapter: one holiday run per start, then it stops (schedule mode). */
export class PublicHolidaysAdapter extends utils.Adapter {
  /** Set once the instance is stopping (onUnload began): a stop during the start is no start failure. */
  private stopping = false;

  /** @param options the adapter options js-controller passes in */
  public constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "public-holidays" });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  /**
   * The settings migration of this start, in ONE write (each write of the own instance object costs a
   * restart): the keys of MIGRATIONS, and — on the first start after an update from 0.20.x — the
   * takeover of the single calendar the whole instance was into the first entry of the calendar list.
   * Every old key is a rename source onto the list, so the list is written whichever of them the
   * installation still holds, and every one of them is cleared in the same write; the manifest's
   * default list, which the update added beside them, is replaced.
   *
   * @returns true when the instance object was written and the restart is coming
   */
  private async migrateSettings(): Promise<boolean> {
    const native = this.config as Record<string, unknown>;
    let calendar: Record<string, unknown> | undefined;
    if (hasLegacySettings(native)) {
      const system = await getSystemConfig(this);
      calendar = legacyCalendar(native, system.country ? resolveCountry(system.country).code : "");
    }
    const takeover = legacyTakeover(() => (calendar ? [calendar] : undefined));
    return await migrateNativeKeys(this, [...takeover, ...MIGRATIONS], errText);
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
      this.log.debug(`Could not check the instance object ${id}: ${errLine(err)}`);
      return false;
    }
  }

  private async onReady(): Promise<void> {
    try {
      // The translations load first (fleet form): js-controller delivers messages before onReady has
      // finished, and loading them writes nothing, so it costs the restart paths below nothing.
      await I18n.init(join(this.adapterDir, "admin"), this);

      // Every instance-object change restarts the instance, so there is no point computing
      // and publishing in a process that is on its way out. The settings migration comes first
      // (fleet form); an installation that needs both writes restarts twice, once per write.
      if (await this.migrateSettings()) {
        void this.stop?.();
        return;
      }
      if (await this.repairInstanceObject()) {
        void this.stop?.();
        return;
      }

      // The own tree, read once: every object write below is compared against it (fleet master).
      const known = new KnownObjects(this);
      await known.load();

      this.log.debug("Computing holidays...");
      const sysConfig = await getSystemConfig(this);

      // A setting that holds no list at all is damaged: creating, moving or deleting folders from it
      // could take a user's tree away, so the run changes nothing — and ends as a settings error
      // (fleet start-failure standard): one error line, a notification, and the instance waits for
      // the user to save the settings.
      const list = readCalendarList(this.config as Record<string, unknown>);
      if (!list) {
        throw new SettingsError(DAMAGED_LIST_TEXT);
      }
      if (list.length === 0) {
        this.log.warn(NO_CALENDAR_TEXT);
      }
      const { calendars, skipped } = usableCalendars(list);
      for (const s of skipped) {
        this.log.warn(skippedCalendarText(s));
      }

      let systemCountry = "";
      let systemCountryProblem = "";
      if (sysConfig.country) {
        const detected = resolveCountry(sysConfig.country);
        systemCountry = detected.code;
        if (!systemCountry) {
          systemCountryProblem = systemCountryProblemText(detected.reason, sysConfig.country);
        }
      }
      const folders = calendars.map(c => ({
        id: c.id,
        uid: c.uid,
        name: calendarName(c.settings, systemCountry, sysConfig.language),
      }));

      // The tree follows the list before anything is published: the folder of a deleted calendar
      // goes. A folder that moves (the tree of 0.20.x, a calendar with a new id) is the fleet's move
      // master's work and stays untouched here (calendar-tree.ts).
      await cleanupDeprecatedStates(this, known);
      const changes = await reconcileCalendarTree(known, this.namespace, folders);
      const stored = await this.getStatesAsync(`${this.namespace}.*`);

      const results: Array<{ id: string; computed: ComputedHolidays }> = [];
      for (const [i, calendar] of calendars.entries()) {
        const computed = this.computeCalendar(calendar, sysConfig, systemCountry, systemCountryProblem);
        await ensureCalendarObjects(known, folders[i]);
        await publishCalendarStates(this, stored, calendar.id, computed);
        results.push({ id: calendar.id, computed });
      }

      // Logged at info on every run — the start run and each daily schedule run — so the next
      // holiday is always visible in the log (krobi 2026-08-10), one line naming every calendar.
      // Written AFTER the states, so the line never reports values that did not reach the database.
      if (results.length > 0) {
        this.log.info(calendarSummaryLine(results, sysConfig.dateFormat));
      }

      // A removed folder may have kept a recorded datapoint (the user's deletion options); the fleet
      // removal names it in one line once no removal came for REPORT_MS — written on a timer the stop
      // would clear, so the run waits for it.
      if (changes.removed.length > 0) {
        await this.delay(REPORT_MS + 100);
      }
    } catch (err: unknown) {
      // The Sentry plugin only hooks uncaught exceptions — a caught error has to be handed over
      // (plugin README, "Send specific errors to Sentry"), and before failStart, which ends the
      // process. A settings error is the user's to fix, not an adapter defect, and a stop during
      // the start is no failure at all. The two other catches (instance-object repair,
      // deprecated-state cleanup) stay quiet on purpose: expected broker hiccups with a local
      // fallback, not adapter defects.
      if (!this.stopping && !(err instanceof SettingsError) && this.supportsFeature("PLUGINS")) {
        await this.reportToSentry(err);
      }
      // src/lib/start-failure.ts (fleet master): one error line, then exit code 11 with a
      // notification for a settings error, 6 for anything else; a stop during the start one
      // debug line. Nothing to clean up: the run holds no connection, timer or server.
      await failStart(this, err, { stopping: this.stopping });
      return;
    }
    void this.stop?.();
  }

  /**
   * One calendar's result. A calendar without a country (none set, and the system country does not
   * resolve) publishes a truthful empty result instead of leaving the previous run's values standing:
   * a `today.isHoliday` that stays `true` forever because the country was cleared is a wrong datapoint
   * with no expiry. Every line names the calendar.
   *
   * @param calendar the calendar
   * @param sysConfig the system settings
   * @param systemCountry the system country's code ("" when it does not resolve)
   * @param systemCountryProblem why the system country does not resolve ("" when it does or is unset)
   * @returns the result to publish
   */
  private computeCalendar(
    calendar: Calendar,
    sysConfig: SystemConfig,
    systemCountry: string,
    systemCountryProblem: string,
  ): ComputedHolidays {
    const { id, settings } = calendar;
    const configured = configuredCountry(settings);
    const config = parseConfig(settings, configured ? "" : systemCountry);
    if (!config) {
      this.log.warn(forCalendar(id, systemCountryProblem || "No country configured — open adapter settings"));
      return emptyResult();
    }
    if (!configured) {
      this.log.debug(forCalendar(id, `Using system country: ${config.country}`));
    }

    // Every holiday type unchecked filters everything away — one click on the "public" box is
    // enough to get there. Say so instead of publishing empty states without a word, and keep
    // going: stopping here would leave yesterday's values standing, which is worse than a
    // truthful empty result.
    if (config.holidayTypes.length === 0) {
      this.log.warn(
        forCalendar(
          id,
          "No holiday type is enabled — no holidays will be reported; enable at least one in the settings",
        ),
      );
    }

    // ONE date-holidays instance for language detection, scope checks and computation —
    // getLanguages() is country-scoped, so the full-scope instance answers it (audit finding L4).
    const hd = createHolidaysInstance(config);
    const languages = pickHolidayLanguages(sysConfig.language, hd.getLanguages());
    hd.setLanguages(languages);
    this.log.debug(
      forCalendar(id, `System language: ${oneLine(sysConfig.language)}, holiday languages: [${languages.join(", ")}]`),
    );

    const zoneNote = hostZoneNote(Intl.DateTimeFormat().resolvedOptions().timeZone, config.country, hd.getTimezones());
    if (zoneNote) {
      this.log.debug(forCalendar(id, zoneNote));
    }

    const issue = detectScopeIssue(hd, config);
    if (issue) {
      this.log.warn(forCalendar(id, scopeIssueText(issue, config)));
    }

    const computed = computeHolidays(hd, config, { systemLanguage: sysConfig.language });
    if (computed.unmatchedExcludes.length > 0) {
      this.log.warn(forCalendar(id, staleExcludesText(computed.unmatchedExcludes)));
    }

    // Guarded, not unconditional: the listing computes an extra year and builds a line naming
    // every holiday, which is pure waste while nobody reads debug output (audit finding F12).
    if (this.log.level === "debug" || this.log.level === "silly") {
      logAvailableHolidays(hd, config, msg => this.log.debug(forCalendar(id, msg)));
    }
    return computed;
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
      this.log.debug(`Could not hand the error to Sentry: ${errLine(reportErr)}`);
    }
  }

  /**
   * Only the stop marker and the callback: this adapter holds no connection, no timer and no
   * device marker — it computes, publishes and stops itself. There is nothing that would have to
   * be written on the way out, so nothing has to be awaited before reporting done. The marker
   * tells a start that fails because the instance closes from a start failure (failStart). What
   * DID matter is that `onUnload` runs at all, which is why the manifest no longer declares
   * `supportedMessages.stopInstance` (see {@link repairInstanceObject}).
   *
   * @param callback js-controller's "shutdown finished" signal
   */
  private onUnload(callback: () => void): void {
    this.stopping = true;
    callback();
  }
}

if (require.main !== module) {
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new PublicHolidaysAdapter(options);
} else {
  new PublicHolidaysAdapter();
}
