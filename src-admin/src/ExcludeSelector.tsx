import React from "react";

import { Autocomplete, Box, Chip, TextField } from "@mui/material";

import { ConfigGeneric, type ConfigGenericProps, type ConfigGenericState } from "@iobroker/json-config";
import { I18n } from "@iobroker/adapter-react-v5";
import Holidays from "date-holidays";

// MUST stay in sync with toHolidayId() in src/lib/holiday-engine.ts — the ids written here
// are matched verbatim against the runtime's computed ids. Every date-holidays entry carries
// a rule, so the id is rule-based and language-independent; the name branch is only a fallback.
function toHolidayId(name: string, rule?: string): string {
  if (rule) {
    const clean = rule
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .toLowerCase();
    if (clean.length > 3) {
      return clean;
    }
  }
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

const TYPE_FLAGS: { type: string; flag: string }[] = [
  { type: "public", flag: "typePublic" },
  { type: "bank", flag: "typeBank" },
  { type: "school", flag: "typeSchool" },
  { type: "optional", flag: "typeOptional" },
  { type: "observance", flag: "typeObservance" },
];

interface ExcludeOption {
  id: string;
  label: string;
}

export default class ExcludeSelector extends ConfigGeneric<ConfigGenericProps, ConfigGenericState> {
  // Holidays of exactly the selected scope (country/state/region), localized to the admin
  // language, restricted to the enabled types. Computed fresh on every render so it always
  // mirrors the current selection — no pre-baked per-scope lists.
  private buildOptions(): ExcludeOption[] {
    const data = this.props.data;
    const country = ConfigGeneric.getValue(data, "country") as string;
    if (!country) {
      return [];
    }
    const state = (ConfigGeneric.getValue(data, "state") as string) || "";
    const region = (ConfigGeneric.getValue(data, "region") as string) || "";
    const enabledTypes = TYPE_FLAGS.filter(t => ConfigGeneric.getValue(data, t.flag)).map(t => t.type);

    let hd: Holidays;
    try {
      if (state && region) {
        hd = new Holidays(country, state, region);
      } else if (state) {
        hd = new Holidays(country, state);
      } else {
        hd = new Holidays(country);
      }
    } catch {
      return [];
    }
    hd.setLanguages([I18n.getLanguage()]);

    const year = new Date().getFullYear();
    const seen = new Map<string, { name: string; date: string }>();
    for (const h of hd.getHolidays(year) || []) {
      if (enabledTypes.length && !enabledTypes.includes(h.type)) {
        continue;
      }
      const id = toHolidayId(h.name, h.rule);
      if (!seen.has(id)) {
        seen.set(id, { name: h.name, date: (h.date || "").substring(0, 10) });
      }
    }
    // Chronological order (date within the year) — far less confusing than alphabetical,
    // which e.g. starts with "2. Weihnachtstag". The date is shown in the label too.
    return Array.from(seen.entries())
      .sort((a, b) => a[1].date.localeCompare(b[1].date))
      .map(([id, v]) => {
        const [, month, day] = v.date.split("-");
        const dateLabel = month && day ? `${day}.${month}.` : "";
        return { id, label: dateLabel ? `${v.name} (${dateLabel})` : v.name };
      });
  }

  renderItem(_error: string, disabled: boolean): React.JSX.Element {
    const options = this.buildOptions();
    const value = (ConfigGeneric.getValue(this.props.data, this.props.attr!) as string[]) || [];
    const selected = options.filter(o => value.includes(o.id));
    // Stored ids that are not offered by the current scope (a leftover from a wider region
    // or an older version). Surfaced as removable chips so they are neither hidden nor
    // silently dropped when the user edits the selection.
    const orphanIds = value.filter(id => !options.some(o => o.id === id));

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
