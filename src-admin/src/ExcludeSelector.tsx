import React from "react";

import { Autocomplete, Box, Chip, TextField } from "@mui/material";

import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from "@iobroker/json-config";
import { I18n } from "@iobroker/adapter-react-v5";

import { buildExcludeOptions, computeOrphanIds, enabledTypes, type ExcludeOption } from "./exclude-options";

export default class ExcludeSelector extends ConfigGeneric<ConfigGenericProps, ConfigGenericState> {
  // Cache the computed option list; buildExcludeOptions constructs a date-holidays instance and
  // scans two years, so rebuild only when the scope/type/language inputs actually change instead
  // of on every render (audit finding L4).
  private optionsCacheKey = "";
  private cachedOptions: ExcludeOption[] = [];

  private buildOptions(): ExcludeOption[] {
    const data = this.props.data;
    const country = (ConfigGeneric.getValue(data, "country") as string) || "";
    const state = (ConfigGeneric.getValue(data, "state") as string) || "";
    const region = (ConfigGeneric.getValue(data, "region") as string) || "";
    const types = enabledTypes(flag => ConfigGeneric.getValue(data, flag));
    const lang = I18n.getLanguage();

    const key = JSON.stringify([country, state, region, types, lang]);
    if (key !== this.optionsCacheKey) {
      this.optionsCacheKey = key;
      this.cachedOptions = buildExcludeOptions({ country, state, region, types }, lang, new Date().getFullYear());
    }
    return this.cachedOptions;
  }

  renderItem(_error: string, disabled: boolean): React.JSX.Element {
    const options = this.buildOptions();
    const value = (ConfigGeneric.getValue(this.props.data, this.props.attr!) as string[]) || [];
    const selected = options.filter(o => value.includes(o.id));
    const orphanIds = computeOrphanIds(value, options);

    return (
      <Box sx={{ width: "100%" }}>
        <Autocomplete
          multiple
          fullWidth
          disabled={disabled}
          options={options}
          value={selected}
          getOptionLabel={o => o.label}
          isOptionEqualToValue={(o, v) => o.id === v.id}
          onChange={(_e, newValue) => {
            const ids = newValue.map(o => o.id);
            void this.onChange(this.props.attr!, [...ids, ...orphanIds]);
          }}
          renderInput={params => (
            <TextField
              {...params}
              variant="standard"
              label={I18n.t("ph_excludeLabel")}
              placeholder={options.length ? "" : I18n.t("ph_excludeSelectCountry")}
            />
          )}
        />
        {orphanIds.length ? (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ fontSize: 12, opacity: 0.7, mb: 0.5 }}>{I18n.t("ph_excludeOrphans")}</Box>
            {orphanIds.map(id => (
              <Chip
                key={id}
                label={id}
                size="small"
                onDelete={() =>
                  void this.onChange(
                    this.props.attr!,
                    value.filter(v => v !== id),
                  )
                }
                sx={{ mr: 0.5, mb: 0.5 }}
              />
            ))}
          </Box>
        ) : null}
      </Box>
    );
  }
}
