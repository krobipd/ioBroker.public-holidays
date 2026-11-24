import React from "react";

import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from "@iobroker/json-config";

import { TreeChangesBox } from "./CalendarList";
import { namespaceOf, systemSettingsOf } from "./CalendarsConfig";

/**
 * jsonConfig `type: custom` mount at the end of the page, right above the Save button: what saving
 * changes in the object tree. Owns no field and writes nothing.
 */
export default class TreeChanges extends ConfigGeneric<ConfigGenericProps, ConfigGenericState> {
  /** @returns the red box, or an empty mount while saving changes nothing in the tree */
  public renderItem(): React.JSX.Element {
    const sys = systemSettingsOf(this.props);
    return (
      <TreeChangesBox
        data={this.props.data as Record<string, unknown>}
        originalData={(this.props.originalData ?? {}) as Record<string, unknown>}
        namespace={namespaceOf(this.props)}
        systemCountry={sys.country}
        systemLanguage={sys.language}
      />
    );
  }
}
