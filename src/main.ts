import * as utils from "@iobroker/adapter-core";
import { I18n } from "@iobroker/adapter-core";
import { join } from "node:path";
import { errText, oneLine } from "./lib/error-utils";
import { computeHolidays, createHolidaysInstance, detectScopeIssues, logAvailableHolidays } from "./lib/holiday-engine";
import { getSystemConfig, resolveCountryCode, resolveLanguages } from "./lib/i18n";
import { cleanupDeprecatedStates, ensureObjects, publishStates } from "./lib/state-publisher";
import { HOLIDAY_TYPES, type AdapterConfig } from "./lib/types";

// Exported so the orchestration unit tests can drive onReady/validateConfig directly.
export class PublicHolidaysAdapter extends utils.Adapter {
  constructor(options: Partial<utils.AdapterOptions> = {}) {
    super({ ...options, name: "public-holidays" });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }

  private async onReady(): Promise<void> {
    try {
      const instanceObj = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
      if (instanceObj?.common?.mode === "daemon") {
        this.log.info("Migrating from daemon to schedule mode");
        await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
          common: { mode: "schedule", schedule: "0 0 * * *" },
        });
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

      const languages = resolveLanguages(sysConfig.language, config.country);
      this.log.debug(`System language: ${oneLine(sysConfig.language)}, holiday languages: [${languages.join(", ")}]`);

      const hd = createHolidaysInstance(config, languages);
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

      const computed = computeHolidays(config, languages, undefined, hd);
      if (computed.unmatchedExcludes.length > 0) {
        this.log.warn(
          `These excluded holidays no longer match any holiday (possibly renamed by a date-holidays update): ${oneLine(
            computed.unmatchedExcludes.join(", "),
          )}`,
        );
      }

      logAvailableHolidays(config, languages, msg => this.log.debug(msg), hd);

      const nextText = computed.next.isHoliday
        ? `${oneLine(computed.next.name)} in ${computed.next.daysUntil} days`
        : "no upcoming holiday";
      const summary = `Today: ${
        computed.today.isHoliday ? oneLine(computed.today.name) : "no holiday"
      }, next: ${nextText}`;
      // Only a day that is actually a holiday is a noteworthy event; the daily "no holiday" run
      // stays at debug so the log is not a routine heartbeat (audit finding L3).
      if (computed.today.isHoliday) {
        this.log.info(summary);
      } else {
        this.log.debug(summary);
      }

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

  private onUnload(callback: () => void): void {
    callback();
  }
}

if (require.main !== module) {
  module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new PublicHolidaysAdapter(options);
} else {
  new PublicHolidaysAdapter();
}
