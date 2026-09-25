import React from "react";

import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from "@iobroker/json-config";

import { HolidayPanel } from "./HolidayPanel";

/**
 * jsonConfig `type: custom` mount for the guided holiday card. Value-owning: it hands the whole
 * flat `native` record to {@link HolidayPanel} and writes every field back through
 * `ConfigGeneric.onChange(attr, value)` — the same path native fields use, so the admin Save
 * button activates and no data migration is needed (the card keeps the exact field names of the
 * old two-tab jsonConfig: country/state/region, typePublic…typeObservance, includeBridgeDays,
 * excludeHolidays). Keeps no state of its own; the controlled inputs live in the plain,
 * jsdom-friendly {@link HolidayPanel}.
 */
export default class HolidayConfig extends ConfigGeneric<ConfigGenericProps, ConfigGenericState> {
  // Both callbacks are bound once so they are referentially stable across renders.
  private readonly handleChange = (attr: string, value: unknown): void => void this.onChange(attr, value);

  // Several fields in ONE write. `ConfigGeneric.onChange` snapshots `props.data` per call, so two
  // calls in the same tick both start from the unchanged record and the second write wins over the
  // first (measured against @iobroker/json-config 9.0.16 — audit finding B1). This is the same
  // whole-record path `ConfigGeneric.onChange` ends in (`this.props.onChange(data)`), minus the
  // schema hooks (confirm / *DependsOn) this schema does not use.
  private readonly handleChangeMany = (patch: Record<string, unknown>): void => {
    const data = { ...(JSON.parse(JSON.stringify(this.props.data)) as Record<string, unknown>), ...patch };
    this.props.onChange(data);
  };

  renderItem(): React.JSX.Element {
    const sys = this.props.oContext?.systemConfig as ioBroker.SystemConfigCommon | undefined;
    const systemCountry = typeof sys?.country === "string" ? sys.country : "";
    // The runtime names holidays in the SYSTEM language and prints dates in the system format —
    // the preview has to read the same, whatever language the admin page itself is shown in.
    const systemLanguage = (typeof sys?.language === "string" ? sys.language : "") || "en";
    const dateFormat = typeof sys?.dateFormat === "string" ? sys.dateFormat : "";
    return (
      <HolidayPanel
        data={this.props.data as Record<string, unknown>}
        systemCountry={systemCountry}
        systemLanguage={systemLanguage}
        dateFormat={dateFormat}
        onChange={this.handleChange}
        onChangeMany={this.handleChangeMany}
      />
    );
  }
}
