import { errLine } from "./log-text";

/** The three `system.config` fields this adapter reads. */
export interface SystemConfig {
  /** The system country NAME, "" when unset. */
  country: string;
  /** The system language, "en" when unset. */
  language: string;
  /** The system-wide date display format (e.g. "DD.MM.YYYY"); "" when unset. */
  dateFormat: string;
}

/**
 * Read the three `system.config` fields this adapter cares about, in one object read.
 *
 * A failure is not fatal, but it is NOT silent either: three user-visible things change at once —
 * country auto-detection stops working, holiday names fall back to English and the log date falls
 * back to ISO. Until v0.15.1 that happened without a word in the log, leaving three symptoms and
 * no cause (audit finding F8).
 *
 * @param adapter the adapter instance
 * @returns the system country, language and date format, with safe defaults on failure
 */
export async function getSystemConfig(adapter: ioBroker.Adapter): Promise<SystemConfig> {
  try {
    const obj = (await adapter.getForeignObjectAsync("system.config")) as ioBroker.SystemConfigObject | null;
    const common = obj?.common;
    return {
      country: typeof common?.country === "string" ? common.country : "",
      language: (typeof common?.language === "string" ? common.language : "") || "en",
      dateFormat: typeof common?.dateFormat === "string" ? common.dateFormat : "",
    };
  } catch (err: unknown) {
    adapter.log.warn(
      `Could not read the ioBroker system settings (${errLine(err)}) — no country auto-detection, holiday names in English, log dates in ISO format`,
    );
    return { country: "", language: "en", dateFormat: "" };
  }
}
