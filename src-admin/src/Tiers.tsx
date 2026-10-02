import React from "react";

import {
  Autocomplete,
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

import type { CountryResolution } from "../../src/lib/country-codes.js";
import { bridgeDayName, formatDayMonth, HOLIDAY_TYPES } from "../../src/lib/holiday-shared.js";
import type { ExcludeOption } from "./exclude-options";
import type { PreviewHoliday, ScopeOption } from "./scope-options";

/** Translates a card i18n key, with `%s` arguments. */
export type Translate = (key: string, ...args: (string | number)[]) => string;

/**
 * One vertical tier of the card: a small heading plus its controls.
 *
 * @param root0 the tier's props
 * @param root0.title the small heading above the controls
 * @param root0.children the controls themselves
 */
export function Stage({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
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
 * One country/state/region picker.
 *
 * @param root0 the picker's props
 * @param root0.label the field label
 * @param root0.placeholder the placeholder while nothing is chosen
 * @param root0.options the options
 * @param root0.value the chosen option, null for none
 * @param root0.onPick called with the picked code ("" when cleared)
 */
function ScopePicker({
  label,
  placeholder,
  options,
  value,
  onPick,
}: {
  label: string;
  placeholder?: string;
  options: ScopeOption[];
  value: ScopeOption | null;
  onPick: (code: string) => void;
}): React.JSX.Element {
  return (
    <Autocomplete
      fullWidth
      size="small"
      options={options}
      value={value}
      getOptionLabel={o => o.label}
      isOptionEqualToValue={(o, v) => o.value === v.value}
      onChange={(_e, v) => onPick(v?.value ?? "")}
      renderInput={p => (
        <TextField
          {...p}
          variant="standard"
          label={label}
          placeholder={placeholder}
        />
      )}
    />
  );
}

/**
 * A warning or hint line of a tier.
 *
 * @param root0 the line's props
 * @param root0.warning whether it is a warning (else a hint)
 * @param root0.children the text
 */
function Note({ warning, children }: { warning?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <Typography
      variant="body2"
      color={warning ? "warning.main" : "text.secondary"}
    >
      {children}
    </Typography>
  );
}

/** What the location tier shows and writes. */
export interface LocationTierProps {
  /** Card translation. */
  t: Translate;
  /** Country options in the admin language. */
  countryOptions: ScopeOption[];
  /** State options of the scope's country. */
  stateOptions: ScopeOption[];
  /** Region options of the chosen state. */
  regionOptions: ScopeOption[];
  /** The chosen country option (resolved from the stored value), null for none. */
  countryOption: ScopeOption | null;
  /** The chosen state option, null for none. */
  stateOption: ScopeOption | null;
  /** The chosen region option, null for none. */
  regionOption: ScopeOption | null;
  /** A stored state the scope does not offer, "" for none. */
  staleState: string;
  /** A stored region the scope does not offer, "" for none. */
  staleRegion: string;
  /** The chosen state or region is one date-holidays cannot load. */
  unloadable: boolean;
  /** The resolution of the system country while no country is stored, null otherwise. */
  detected: CountryResolution | null;
  /** The system country as stored. */
  systemCountry: string;
  /** Persists several fields in one write. */
  onChangeMany: (patch: Record<string, unknown>) => void;
}

/**
 * Tier 1 — location: country, plus state / region where they exist, the stale-value chips and the
 * system-country hint.
 *
 * @param props the tier's props
 */
export function LocationTier(props: LocationTierProps): React.JSX.Element {
  const { t, detected, staleState, staleRegion, onChangeMany } = props;
  const staleScope = [staleState, staleRegion].filter(Boolean);
  const countryLabel = (code: string): string => props.countryOptions.find(o => o.value === code)?.label ?? code;
  return (
    <Stage title={t("ph_hc_location_title")}>
      <Stack spacing={1.5}>
        <ScopePicker
          label={t("ph_hc_country_label")}
          placeholder={t("ph_hc_country_ph")}
          options={props.countryOptions}
          value={props.countryOption}
          // The narrower scope goes with the wider one, in the same write: a state code left
          // standing is valid in 12 other countries (NL/ZH → CH/ZH publishes Zurich's holidays
          // without a word) — audit finding B1.
          onPick={country => onChangeMany({ country, state: "", region: "" })}
        />
        {props.stateOptions.length ? (
          <ScopePicker
            label={t("ph_hc_state_label")}
            options={props.stateOptions}
            value={props.stateOption}
            onPick={state => onChangeMany({ state, region: "" })}
          />
        ) : null}
        {props.regionOptions.length ? (
          <ScopePicker
            label={t("ph_hc_region_label")}
            options={props.regionOptions}
            value={props.regionOption}
            onPick={region => onChangeMany({ region })}
          />
        ) : null}
        {staleScope.length ? (
          <Box>
            <Note warning>{t("ph_hc_scope_stale", staleScope.join(", "))}</Note>
            {/* A stale value may sit where no picker is shown (the country has no states), so it
                gets its own delete — one write that clears the stale tier and everything below. */}
            {staleState ? (
              <Chip
                label={staleState}
                size="small"
                onDelete={() => onChangeMany({ state: "", region: "" })}
                sx={{ mr: 0.5, mt: 0.5 }}
              />
            ) : null}
            {staleRegion ? (
              <Chip
                label={staleRegion}
                size="small"
                onDelete={() => onChangeMany({ region: "" })}
                sx={{ mr: 0.5, mt: 0.5 }}
              />
            ) : null}
          </Box>
        ) : null}
        {props.unloadable ? <Note warning>{t("ph_hc_scope_unloadable")}</Note> : null}
        {detected?.code ? <Note>{t("ph_hc_autodetect", countryLabel(detected.code))}</Note> : null}
        {detected && !detected.code ? (
          <Note warning>
            {t(
              detected.reason === "ambiguous" ? "ph_hc_autodetect_ambiguous" : "ph_hc_autodetect_nodata",
              props.systemCountry,
            )}
          </Note>
        ) : null}
      </Stack>
    </Stage>
  );
}

/**
 * Tier 2 — holiday types.
 *
 * @param root0 the tier's props
 * @param root0.t card translation
 * @param root0.enabled the enabled type keys
 * @param root0.onChange persists one field
 */
export function TypesTier({
  t,
  enabled,
  onChange,
}: {
  t: Translate;
  enabled: string[];
  onChange: (attr: string, value: unknown) => void;
}): React.JSX.Element {
  return (
    <Stage title={t("ph_hc_types_title")}>
      <FormGroup row>
        {HOLIDAY_TYPES.map(tf => (
          <FormControlLabel
            key={tf.flag}
            control={
              <Checkbox
                size="small"
                checked={enabled.includes(tf.key)}
                onChange={e => onChange(tf.flag, e.target.checked)}
              />
            }
            label={t(`ph_hc_type_${tf.key}`)}
          />
        ))}
      </FormGroup>
      {/* With no type checked the runtime filters every holiday away and publishes empty
          states — one click on "public holidays" is enough to get there, so say it here. */}
      {enabled.length === 0 ? <Note warning>{t("ph_hc_types_none")}</Note> : null}
    </Stage>
  );
}

/**
 * Tier 3 — bridge days.
 *
 * @param root0 the tier's props
 * @param root0.t card translation
 * @param root0.checked whether bridge days are reported
 * @param root0.onChange persists one field
 */
export function BridgeTier({
  t,
  checked,
  onChange,
}: {
  t: Translate;
  checked: boolean;
  onChange: (attr: string, value: unknown) => void;
}): React.JSX.Element {
  return (
    <Stage title={t("ph_hc_bridge_title")}>
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={checked}
            onChange={e => onChange("includeBridgeDays", e.target.checked)}
          />
        }
        label={t("ph_hc_bridge_label")}
      />
      <Note>{t("ph_hc_bridge_desc")}</Note>
    </Stage>
  );
}

/**
 * A titled row of removable exclude chips.
 *
 * @param root0 the row's props
 * @param root0.title the small heading
 * @param root0.ids the ids shown
 * @param root0.label the chip label of an id
 * @param root0.outlined outlined chips (inactive) instead of filled ones (orphans)
 * @param root0.onDelete removes one id
 */
function ExcludeChips({
  title,
  ids,
  label,
  outlined,
  onDelete,
}: {
  title: string;
  ids: string[];
  label: (id: string) => string;
  outlined?: boolean;
  onDelete: (id: string) => void;
}): React.JSX.Element | null {
  if (ids.length === 0) {
    return null;
  }
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ fontSize: 12, opacity: 0.7, mb: 0.5 }}>{title}</Box>
      {ids.map(id => (
        <Chip
          key={id}
          label={label(id)}
          size="small"
          variant={outlined ? "outlined" : "filled"}
          onDelete={() => onDelete(id)}
          sx={{ mr: 0.5, mb: 0.5 }}
        />
      ))}
    </Box>
  );
}

/** What the exclude tier shows and writes. */
export interface ExcludeTierProps {
  /** Card translation. */
  t: Translate;
  /** The options of the enabled types. */
  options: ExcludeOption[];
  /** The options of all types (labels of inactive excludes). */
  allOptions: ExcludeOption[];
  /** The stored exclude ids. */
  excludeHolidays: string[];
  /** Stored ids of switched-off types. */
  inactiveIds: string[];
  /** Stored ids no option carries. */
  orphanIds: string[];
  /** Whether a scope country is known (the empty-list hint). */
  hasCountry: boolean;
  /** Persists one field. */
  onChange: (attr: string, value: unknown) => void;
}

/**
 * Tier 4 — excluded holidays.
 *
 * @param props the tier's props
 */
export function ExcludeTier(props: ExcludeTierProps): React.JSX.Element {
  const { t, options, excludeHolidays, inactiveIds, orphanIds, onChange } = props;
  const remove = (id: string): void =>
    onChange(
      "excludeHolidays",
      excludeHolidays.filter(v => v !== id),
    );
  return (
    <Stage title={t("ph_hc_exclude_title")}>
      <Autocomplete
        multiple
        fullWidth
        size="small"
        options={options}
        value={options.filter(o => excludeHolidays.includes(o.id))}
        getOptionLabel={o => o.label}
        isOptionEqualToValue={(o, v) => o.id === v.id}
        // Orphans and excludes of switched-off types are not in `v` — they are carried along, not dropped.
        onChange={(_e, v) => onChange("excludeHolidays", [...v.map(o => o.id), ...orphanIds, ...inactiveIds])}
        renderInput={p => (
          <TextField
            {...p}
            variant="standard"
            label={t("ph_excludeLabel")}
            // An empty list has two causes: no country yet, or no holiday type enabled. Only the
            // first one is fixed by picking a country — the second is explained above.
            placeholder={options.length || props.hasCountry ? "" : t("ph_excludeSelectCountry")}
          />
        )}
      />
      <ExcludeChips
        title={t("ph_excludeInactive")}
        ids={inactiveIds}
        label={id => props.allOptions.find(o => o.id === id)?.label ?? id}
        outlined
        onDelete={remove}
      />
      <ExcludeChips
        title={t("ph_excludeOrphans")}
        ids={orphanIds}
        label={id => id}
        onDelete={remove}
      />
    </Stage>
  );
}

/**
 * Tier 5 — live preview of what the runtime would detect.
 *
 * @param root0 the tier's props
 * @param root0.t card translation
 * @param root0.preview the days of the year shown
 * @param root0.year the year shown
 * @param root0.hasCountry whether a scope country is known
 * @param root0.systemLanguage the ioBroker system language (bridge-day name)
 * @param root0.dateFormat the system date format (chip dates)
 */
export function PreviewTier({
  t,
  preview,
  year,
  hasCountry,
  systemLanguage,
  dateFormat,
}: {
  t: Translate;
  preview: PreviewHoliday[];
  year: number;
  hasCountry: boolean;
  systemLanguage: string;
  dateFormat: string;
}): React.JSX.Element {
  if (!hasCountry) {
    return (
      <Stage title={t("ph_hc_preview_title")}>
        <Note>{t("ph_hc_preview_none")}</Note>
      </Stage>
    );
  }
  const bridgeCount = preview.filter(h => h.type === "bridge").length;
  const holidayCount = preview.length - bridgeCount;
  return (
    <Stage title={t("ph_hc_preview_title")}>
      <Typography
        variant="body2"
        sx={{ mb: 0.5 }}
      >
        {bridgeCount
          ? t("ph_hc_preview_count_bridges", holidayCount, bridgeCount, year)
          : t("ph_hc_preview_count", holidayCount, year)}
      </Typography>
      <Box
        role="list"
        aria-label={t("ph_hc_preview_title")}
        tabIndex={0}
        sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, maxHeight: 168, overflowY: "auto" }}
      >
        {preview.map(h => (
          <Chip
            key={h.date}
            role="listitem"
            size="small"
            variant={h.type === "bridge" ? "outlined" : "filled"}
            label={`${formatDayMonth(h.date, dateFormat)} ${h.type === "bridge" ? bridgeDayName(systemLanguage) : h.name}`}
          />
        ))}
      </Box>
    </Stage>
  );
}
