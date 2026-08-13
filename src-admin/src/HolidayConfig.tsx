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
  // Bound once so it is referentially stable — HolidayPanel's clear-effects depend on it and would
  // re-run on every render if this were a fresh arrow each time.
  private readonly handleChange = (attr: string, value: unknown): void => void this.onChange(attr, value);

  renderItem(): React.JSX.Element {
    const sys = this.props.oContext?.systemConfig as ioBroker.SystemConfigCommon | undefined;
    const systemCountry = typeof sys?.country === "string" ? sys.country : "";
    return (
      <HolidayPanel
        data={this.props.data as Record<string, unknown>}
        systemCountry={systemCountry}
        onChange={this.handleChange}
      />
    );
  }
}
