import React from "react";

import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from "@iobroker/json-config";
import { I18n } from "@iobroker/gui-components";

import { CALENDAR_LIST_KEY, readCalendarList } from "../../src/lib/holiday-shared.js";
import { type CalendarRecord, idProblem } from "./calendar-list";
import { CalendarList } from "./CalendarList";

/**
 * The system settings the runtime reads, from the admin's context.
 *
 * @param props the mount's props
 * @returns system country (a name), language and date format
 */
export function systemSettingsOf(props: ConfigGenericProps): { country: string; language: string; dateFormat: string } {
  const sys = props.oContext?.systemConfig as ioBroker.SystemConfigCommon | undefined;
  return {
    country: typeof sys?.country === "string" ? sys.country : "",
    // The runtime names folders and holidays in the SYSTEM language and prints dates in the system
    // format — the card has to read the same, whatever language the admin page itself is shown in.
    language: (typeof sys?.language === "string" ? sys.language : "") || "en",
    dateFormat: typeof sys?.dateFormat === "string" ? sys.dateFormat : "",
  };
}

/**
 * The instance namespace the folders live under.
 *
 * @param props the mount's props
 * @returns e.g. `public-holidays.0`
 */
export function namespaceOf(props: ConfigGenericProps): string {
  return `${props.oContext?.adapterName ?? "public-holidays"}.${props.oContext?.instance ?? 0}`;
}

/**
 * jsonConfig `type: custom` mount for the calendar list. It owns the `calendars` field and writes
 * the whole list in ONE whole-record write: `ConfigGeneric.onChange` snapshots `props.data` per
 * call, so two calls in the same tick both start from the unchanged record and the second write
 * wins (measured against `@iobroker/json-config` 9.0.16 — audit finding B1). An id that is empty or
 * held twice is reported through `onError`, which keeps the Save button locked.
 */
export default class CalendarsConfig extends ConfigGeneric<ConfigGenericProps, ConfigGenericState> {
  /** The error last reported, so a render does not report it again. */
  private reported: string | undefined = undefined;

  private readonly writeList = (list: CalendarRecord[]): void => {
    const data = JSON.parse(JSON.stringify(this.props.data)) as Record<string, unknown>;
    data[CALENDAR_LIST_KEY] = list;
    this.props.onChange(data);
  };

  /** Report a calendar whose id cannot be saved — or clear the report once every id is fine. */
  private reportIdProblems(): void {
    const list = readCalendarList(this.props.data as Record<string, unknown>) ?? [];
    const problem = list.map((_c, i) => idProblem(list, i)).find(p => p !== null);
    const error = problem ? I18n.t(problem === "taken" ? "ph_cal_id_taken" : "ph_cal_id_missing") : undefined;
    if (error !== this.reported) {
      this.reported = error;
      this.onError(this.props.attr, error);
    }
  }

  /** Mount: the generic setup, then the id check of the stored list. */
  public async componentDidMount(): Promise<void> {
    await super.componentDidMount();
    this.reportIdProblems();
  }

  /** Every change of the list: the id check again. */
  public componentDidUpdate(): void {
    this.reportIdProblems();
  }

  /** @returns the calendar list, fed with the system settings the runtime uses */
  public renderItem(): React.JSX.Element {
    const sys = systemSettingsOf(this.props);
    return (
      <CalendarList
        data={this.props.data as Record<string, unknown>}
        originalData={(this.props.originalData ?? {}) as Record<string, unknown>}
        namespace={namespaceOf(this.props)}
        systemCountry={sys.country}
        systemLanguage={sys.language}
        dateFormat={sys.dateFormat}
        onWriteList={this.writeList}
      />
    );
  }
}
