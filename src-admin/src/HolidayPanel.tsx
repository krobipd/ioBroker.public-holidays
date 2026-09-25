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

import Holidays from "date-holidays";
import { buildPreviewHolidays, getCountryOptions, getRegionOptions, getStateOptions } from "./scope-options";
import {
  buildExcludeOptions,
  computeInactiveIds,
  computeOrphanIds,
  enabledTypeKeys,
  HOLIDAY_TYPES,
} from "./exclude-options";
// The bridge-day name comes from the runtime's own table, not from the card's i18n: the preview
// chip and the published `name` state must read identically, and a second translation table for
// the same sentence is exactly what drifts (audit finding F16).
import { bridgeDayName, formatDayMonth } from "../../src/lib/holiday-shared.js";
// The same resolution of the stored system country the runtime applies (both admin lists).
import { resolveCountryName } from "../../src/lib/country-codes.js";

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
  /** `system.config.common.country` — a country NAME from one of the two admin lists. */
  systemCountry: string;
  /** `system.config.common.language` — the language the runtime publishes holiday names in. */
  systemLanguage: string;
  /** `system.config.common.dateFormat` — how the runtime prints dates ("" = default). */
  dateFormat: string;
  /** Persist one native attribute (wires the admin Save button). Must be referentially stable. */
  onChange: (attr: string, value: unknown) => void;
  /**
   * Persist several native attributes in ONE write. Needed wherever a user action changes more
   * than one field at once (a country change clears state and region): two `onChange` calls in
   * the same tick each snapshot the still-unchanged record, and the second write wins over the
   * first (measured against `@iobroker/json-config` 9.0.16 — audit finding B1, v0.16.0).
   */
  onChangeMany: (patch: Record<string, unknown>) => void;
}

function readString(data: Record<string, unknown>, attr: string): string {
  const v = data[attr];
  return typeof v === "string" ? v : "";
}
function readStringArray(data: Record<string, unknown>, attr: string): string[] {
  const v = data[attr];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** The codes the card's date-holidays has data for — the set country resolution checks against. */
const SUPPORTED_COUNTRIES = new Set(Object.keys(new Holidays().getCountries()));

/**
 * The option whose value matches regardless of case — date-holidays upper-cases what it is given,
 * so a hand-written `by` IS Bavaria, and the card must not call it stale.
 *
 * @param options the options of one tier
 * @param value the stored value
 */
function findOption<T extends { value: string }>(options: T[], value: string): T | undefined {
  const upper = value.toUpperCase();
  return options.find(o => o.value.toUpperCase() === upper);
}

/**
 * One vertical tier of the card: a small heading plus its controls.
 *
 * @param root0 the tier's props
 * @param root0.title the small heading above the controls
 * @param root0.children the controls themselves
 */
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
 *
 * @param props card data, detected system country and the change callback
 */
export function HolidayPanel(props: HolidayPanelProps): React.JSX.Element {
  const { data, systemCountry, systemLanguage, dateFormat, onChange, onChangeMany } = props;
  const lang = I18n.getLanguage();
  const t = (key: string, ...args: (string | number)[]): string => I18n.t(key, ...args);
  const year = new Date().getFullYear();

  const storedCountry = readString(data, "country");
  const storedState = readString(data, "state");
  const region = readString(data, "region");
  const excludeHolidays = readStringArray(data, "excludeHolidays");
  const includeBridgeDays = data.includeBridgeDays === true;
  const enabled = enabledTypeKeys(flag => data[flag]);

  // A stored value the runtime resolves ("Germany", "de", " DE") is shown as what it resolves to —
  // and only written back when the user changes it (nothing arms the Save button on its own).
  const resolvedStored = storedCountry ? resolveCountryName(storedCountry, SUPPORTED_COUNTRIES) : null;
  const country = resolvedStored?.code || storedCountry;
  // No country chosen: the runtime uses the ioBroker system country — so does the card.
  const detected = !storedCountry && systemCountry ? resolveCountryName(systemCountry, SUPPORTED_COUNTRIES) : null;
  const scopeCountry = country || detected?.code || "";

  const countryOptions = React.useMemo(() => getCountryOptions(lang), [lang]);
  const stateOptions = React.useMemo(() => getStateOptions(scopeCountry, lang), [scopeCountry, lang]);
  const stateOption = storedState ? findOption(stateOptions, storedState) : undefined;
  const state = stateOption?.value ?? storedState;
  const regionOptions = React.useMemo(() => getRegionOptions(scopeCountry, state, lang), [scopeCountry, state, lang]);
  const regionOption = region ? findOption(regionOptions, region) : undefined;
  const unloadable = stateOption?.unloadable || regionOption?.unloadable;

  // A stored state/region that no longer belongs to the chosen scope is NOT cleared here: the
  // narrower scope is cleared in the very write that changes the wider one (see the country and
  // state pickers below), so a value that was already stale when the page opened — a date-holidays
  // update dropped the code — is never written on its own. Writing it would arm the Save button
  // without anybody touching anything (audit finding F13); instead it is surfaced the way stale
  // excludes have always been surfaced — visibly, for the user to resolve. No `…Options.length`
  // guard: a stale state must stay visible even when the new country has no states at all.
  const staleState = storedState && !stateOption ? storedState : "";
  const staleRegion = region && !regionOption ? region : "";
  const staleScope = [staleState, staleRegion].filter(Boolean);

  const enabledKey = enabled.join(",");
  const excludeOptions = React.useMemo(
    () =>
      buildExcludeOptions(
        { country: scopeCountry, state, region, types: enabled },
        systemLanguage,
        year,
        undefined,
        dateFormat,
      ),
    // enabledKey stands in for the `enabled` array identity
    [scopeCountry, state, region, enabledKey, systemLanguage, year, dateFormat],
  );
  // Validation against ALL types: an exclude of a type that is only switched off is kept and shown
  // apart, never offered for deletion as an orphan.
  const allTypeOptions = React.useMemo(
    () =>
      buildExcludeOptions(
        { country: scopeCountry, state, region, types: HOLIDAY_TYPES.map(ht => ht.key) },
        systemLanguage,
        year,
        undefined,
        dateFormat,
      ),
    [scopeCountry, state, region, systemLanguage, year, dateFormat],
  );
  const orphanIds = computeOrphanIds(excludeHolidays, allTypeOptions);
  const inactiveIds = computeInactiveIds(excludeHolidays, excludeOptions, allTypeOptions);
  const selectedExclude = excludeOptions.filter(o => excludeHolidays.includes(o.id));

  const excludeKey = excludeHolidays.join(",");
  const preview = React.useMemo(
    () =>
      buildPreviewHolidays(
        { country: scopeCountry, state, region, types: enabled, excludeHolidays },
        includeBridgeDays,
        systemLanguage,
        year,
      ),
    [scopeCountry, state, region, enabledKey, excludeKey, includeBridgeDays, systemLanguage, year],
  );
  const bridgeCount = preview.filter(h => h.type === "bridge").length;
  const holidayCount = preview.length - bridgeCount;
  const countryLabel = (code: string): string => countryOptions.find(o => o.value === code)?.label ?? code;

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
            // The narrower scope goes with the wider one, in the same write: a state code left
            // standing is valid in 12 other countries (NL/ZH → CH/ZH publishes Zurich's holidays
            // without a word) — audit finding B1.
            onChange={(_e, v) => onChangeMany({ country: v?.value ?? "", state: "", region: "" })}
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
              value={stateOption ?? null}
              getOptionLabel={o => o.label}
              isOptionEqualToValue={(o, v) => o.value === v.value}
              onChange={(_e, v) => onChangeMany({ state: v?.value ?? "", region: "" })}
              renderInput={p => (
                <TextField
                  {...p}
                  variant="standard"
                  label={t("ph_hc_state_label")}
                />
              )}
            />
          ) : null}
          {regionOptions.length ? (
            <Autocomplete
              fullWidth
              size="small"
              options={regionOptions}
              value={regionOption ?? null}
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
          {staleScope.length ? (
            <Box>
              <Typography
                variant="body2"
                color="warning.main"
              >
                {t("ph_hc_scope_stale", staleScope.join(", "))}
              </Typography>
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
                  onDelete={() => onChange("region", "")}
                  sx={{ mr: 0.5, mt: 0.5 }}
                />
              ) : null}
            </Box>
          ) : null}
          {unloadable ? (
            <Typography
              variant="body2"
              color="warning.main"
            >
              {t("ph_hc_scope_unloadable")}
            </Typography>
          ) : null}
          {detected?.code ? (
            <Typography
              variant="body2"
              color="text.secondary"
            >
              {t("ph_hc_autodetect", countryLabel(detected.code))}
            </Typography>
          ) : null}
          {detected && !detected.code ? (
            <Typography
              variant="body2"
              color="warning.main"
            >
              {t(
                detected.reason === "ambiguous" ? "ph_hc_autodetect_ambiguous" : "ph_hc_autodetect_nodata",
                systemCountry,
              )}
            </Typography>
          ) : null}
        </Stack>
      </Stage>

      <Divider />

      {/* Tier 2 — holiday types */}
      <Stage title={t("ph_hc_types_title")}>
        <FormGroup row>
          {HOLIDAY_TYPES.map(tf => (
            <FormControlLabel
              key={tf.flag}
              control={
                <Checkbox
                  size="small"
                  checked={typeof data[tf.flag] === "boolean" ? (data[tf.flag] as boolean) : tf.defaultOn}
                  onChange={e => onChange(tf.flag, e.target.checked)}
                />
              }
              label={t(`ph_hc_type_${tf.key}`)}
            />
          ))}
        </FormGroup>
        {/* With no type checked the runtime filters every holiday away and publishes empty
            states — one click on "public holidays" is enough to get there, so say it here. */}
        {enabled.length === 0 ? (
          <Typography
            variant="body2"
            color="warning.main"
          >
            {t("ph_hc_types_none")}
          </Typography>
        ) : null}
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
          // Orphans and excludes of switched-off types are not in `v` — they are carried along, not dropped.
          onChange={(_e, v) => onChange("excludeHolidays", [...v.map(o => o.id), ...orphanIds, ...inactiveIds])}
          renderInput={p => (
            <TextField
              {...p}
              variant="standard"
              label={t("ph_excludeLabel")}
              // An empty list has two causes: no country yet, or no holiday type enabled. Only the
              // first one is fixed by picking a country — the second is explained above.
              placeholder={excludeOptions.length || scopeCountry ? "" : t("ph_excludeSelectCountry")}
            />
          )}
        />
        {inactiveIds.length ? (
          <Box sx={{ mt: 1 }}>
            <Box sx={{ fontSize: 12, opacity: 0.7, mb: 0.5 }}>{t("ph_excludeInactive")}</Box>
            {inactiveIds.map(id => (
              <Chip
                key={id}
                label={allTypeOptions.find(o => o.id === id)?.label ?? id}
                size="small"
                variant="outlined"
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
        {scopeCountry ? (
          <>
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
