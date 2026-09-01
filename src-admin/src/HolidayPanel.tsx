import React from "react";

import {
  Autocomplete,
  Box,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  FormGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { I18n } from "@iobroker/gui-components";

import { buildPreviewHolidays, getCountryOptions, getRegionOptions, getStateOptions } from "./scope-options";
import { buildExcludeOptions, computeOrphanIds, enabledTypes, TYPE_FLAGS } from "./exclude-options";

/**
 * Props for the guided holiday-config card. It owns the flat `native.*` fields directly — the thin
 * {@link HolidayConfig} mount passes `props.data` in and persists each change through
 * `ConfigGeneric.onChange`. No draft buffer: every input here is a discrete select / checkbox /
 * chip (no free typing), so the async `props.data` echo can't fight a cursor — unlike govee's
 * credential text fields.
 */
export interface HolidayPanelProps {
  /** The jsonConfig `native` record (flat fields). */
  data: Record<string, unknown>;
  /** `system.config.common.country` — the ISO clear-name shown as the auto-detect hint. */
  systemCountry: string;
  /** Persist one native attribute (wires the admin Save button). Must be referentially stable. */
  onChange: (attr: string, value: unknown) => void;
}

function readString(data: Record<string, unknown>, attr: string): string {
  const v = data[attr];
  return typeof v === "string" ? v : "";
}
function readStringArray(data: Record<string, unknown>, attr: string): string[] {
  const v = data[attr];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

// "2026-05-14" → "14.05." for the preview chips (mirrors the exclude-option label style).
function formatDay(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return month && day ? `${day}.${month}.` : dateKey;
}

/** One vertical tier of the card: a small heading plus its controls. */
function Stage({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Box sx={{ py: 1.5 }}>
      <Typography
        variant="subtitle2"
        sx={{ mb: 1 }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/**
 * The guided "set up holidays" card: one page, tiers from top to bottom — country (with a system
 * auto-detect hint) → state / region (shown only where they exist) → holiday types → bridge days →
 * excluded holidays → a live preview of what the runtime would detect. The whole country/state/
 * region taxonomy, the exclude list and the preview are computed client-side from the card's own
 * bundled date-holidays (held equal to the runtime's, see date-holidays-version-parity.test.ts).
 */
export function HolidayPanel(props: HolidayPanelProps): React.JSX.Element {
  const { data, systemCountry, onChange } = props;
  const lang = I18n.getLanguage();
  const t = (key: string, ...args: (string | number)[]): string => I18n.t(key, ...args);
  const year = new Date().getFullYear();

  const country = readString(data, "country");
  const state = readString(data, "state");
  const region = readString(data, "region");
  const excludeHolidays = readStringArray(data, "excludeHolidays");
  const includeBridgeDays = data.includeBridgeDays === true;
  const enabled = enabledTypes(flag => data[flag]);

  const countryOptions = React.useMemo(() => getCountryOptions(lang), [lang]);
  const stateOptions = React.useMemo(() => getStateOptions(country, lang), [country, lang]);
  const regionOptions = React.useMemo(() => getRegionOptions(country, state, lang), [country, state, lang]);

  // Clear a stored state/region the moment it no longer belongs to the chosen scope (e.g. after a
  // country change). Otherwise it lingers as a native value the runtime feeds to date-holidays,
  // which then silently falls back to the broader scope. Reactive (not done inside the country
  // onChange handler) so each write is a single, race-free onChange call.
  React.useEffect(() => {
    if (state && !stateOptions.some(o => o.value === state)) {
      onChange("state", "");
    }
  }, [state, stateOptions, onChange]);
  React.useEffect(() => {
    if (region && !regionOptions.some(o => o.value === region)) {
      onChange("region", "");
    }
  }, [region, regionOptions, onChange]);

  const enabledKey = enabled.join(",");
  const excludeOptions = React.useMemo(
    () => buildExcludeOptions({ country, state, region, types: enabled }, lang, year),
    // enabledKey stands in for the `enabled` array identity
    [country, state, region, enabledKey, lang, year],
  );
  const orphanIds = computeOrphanIds(excludeHolidays, excludeOptions);
  const selectedExclude = excludeOptions.filter(o => excludeHolidays.includes(o.id));

  const excludeKey = excludeHolidays.join(",");
  const preview = React.useMemo(
    () => buildPreviewHolidays({ country, state, region, types: enabled, excludeHolidays }, includeBridgeDays, lang, year),
    [country, state, region, enabledKey, excludeKey, includeBridgeDays, lang, year],
  );

  return (
    <Box sx={{ maxWidth: 720 }}>
      {/* Tier 1 — location: country, plus state / region where they exist */}
      <Stage title={t("ph_hc_location_title")}>
        <Stack spacing={1.5}>
          <Autocomplete
            fullWidth
            size="small"
            options={countryOptions}
            value={countryOptions.find(o => o.value === country) ?? null}
            getOptionLabel={o => o.label}
            isOptionEqualToValue={(o, v) => o.value === v.value}
            onChange={(_e, v) => onChange("country", v?.value ?? "")}
            renderInput={p => (
              <TextField
                {...p}
                variant="standard"
                label={t("ph_hc_country_label")}
                placeholder={t("ph_hc_country_ph")}
              />
            )}
          />
          {stateOptions.length ? (
            <Autocomplete
              fullWidth
              size="small"
              options={stateOptions}
              value={stateOptions.find(o => o.value === state) ?? null}
              getOptionLabel={o => o.label}
              isOptionEqualToValue={(o, v) => o.value === v.value}
              onChange={(_e, v) => onChange("state", v?.value ?? "")}
              renderInput={p => (
                <TextField
                  {...p}
                  variant="standard"
                  label={t("ph_hc_state_label")}
                />
              )}
            />
          ) : null}
          {stateOptions.length && regionOptions.length ? (
            <Autocomplete
              fullWidth
              size="small"
              options={regionOptions}
              value={regionOptions.find(o => o.value === region) ?? null}
              getOptionLabel={o => o.label}
              isOptionEqualToValue={(o, v) => o.value === v.value}
              onChange={(_e, v) => onChange("region", v?.value ?? "")}
              renderInput={p => (
                <TextField
                  {...p}
                  variant="standard"
                  label={t("ph_hc_region_label")}
                />
              )}
            />
          ) : null}
          {!country && systemCountry ? (
            <Typography
              variant="body2"
              color="text.secondary"
            >
              {t("ph_hc_autodetect", systemCountry)}
            </Typography>
          ) : null}
        </Stack>
      </Stage>

      <Divider />

      {/* Tier 2 — holiday types */}
      <Stage title={t("ph_hc_types_title")}>
        <FormGroup row>
          {TYPE_FLAGS.map(tf => (
            <FormControlLabel
              key={tf.flag}
              control={
                <Checkbox
                  size="small"
                  checked={typeof data[tf.flag] === "boolean" ? (data[tf.flag] as boolean) : tf.defaultOn}
                  onChange={e => onChange(tf.flag, e.target.checked)}
                />
              }
              label={t(`ph_hc_type_${tf.type}`)}
            />
          ))}
        </FormGroup>
      </Stage>

      <Divider />

      {/* Tier 3 — bridge days */}
      <Stage title={t("ph_hc_bridge_title")}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={includeBridgeDays}
              onChange={e => onChange("includeBridgeDays", e.target.checked)}
            />
          }
          label={t("ph_hc_bridge_label")}
        />
        <Typography
          variant="body2"
          color="text.secondary"
        >
          {t("ph_hc_bridge_desc")}
        </Typography>
      </Stage>

      <Divider />

      {/* Tier 4 — excluded holidays (the former ExcludeSelector, now a tier) */}
      <Stage title={t("ph_hc_exclude_title")}>
        <Autocomplete
          multiple
          fullWidth
          size="small"
          options={excludeOptions}
          value={selectedExclude}
          getOptionLabel={o => o.label}
          isOptionEqualToValue={(o, v) => o.id === v.id}
          onChange={(_e, v) => onChange("excludeHolidays", [...v.map(o => o.id), ...orphanIds])}
          renderInput={p => (
            <TextField
              {...p}
              variant="standard"
              label={t("ph_excludeLabel")}
              placeholder={excludeOptions.length ? "" : t("ph_excludeSelectCountry")}
            />
          )}
        />
        {orphanIds.length ? (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ fontSize: 12, opacity: 0.7, mb: 0.5 }}>{t("ph_excludeOrphans")}</Box>
            {orphanIds.map(id => (
              <Chip
                key={id}
                label={id}
                size="small"
                onDelete={() =>
                  onChange(
                    "excludeHolidays",
                    excludeHolidays.filter(v => v !== id),
                  )
                }
                sx={{ mr: 0.5, mb: 0.5 }}
              />
            ))}
          </Box>
        ) : null}
      </Stage>

      <Divider />

      {/* Tier 5 — live preview of what the runtime would detect */}
      <Stage title={t("ph_hc_preview_title")}>
        {country ? (
          <>
            <Typography
              variant="body2"
              sx={{ mb: 0.5 }}
            >
              {t("ph_hc_preview_count", preview.length, year)}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, maxHeight: 168, overflowY: "auto" }}>
              {preview.map(h => (
                <Chip
                  key={h.date}
                  size="small"
                  variant={h.type === "bridge" ? "outlined" : "filled"}
                  label={`${formatDay(h.date)} ${h.type === "bridge" ? t("ph_hc_bridge_day") : h.name}`}
                />
              ))}
            </Box>
          </>
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
          >
            {t("ph_hc_preview_none")}
          </Typography>
        )}
      </Stage>
    </Box>
  );
}
