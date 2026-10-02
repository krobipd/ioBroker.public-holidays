import React from "react";

import { Box, Divider } from "@mui/material";
import { I18n } from "@iobroker/gui-components";

import Holidays from "date-holidays";
import { buildPreviewHolidays, getCountryOptions, getRegionOptions, getStateOptions } from "./scope-options";
import { buildExcludeOptions, computeInactiveIds, computeOrphanIds } from "./exclude-options";
import {
  enabledTypeKeys,
  HOLIDAY_TYPES,
  readStringArray,
  readTrimmed,
  sameCode,
} from "../../src/lib/holiday-shared.js";
// The same resolution of the stored system country the runtime applies (both admin lists).
import { resolveCountryName } from "../../src/lib/country-codes.js";
import { BridgeTier, ExcludeTier, LocationTier, PreviewTier, TypesTier } from "./Tiers";

/**
 * Props for the guided holiday-config card. It owns the flat `native.*` fields directly — the thin
 * {@link HolidayConfig} mount passes `props.data` in and persists each change through
 * `ConfigGeneric.onChange`. No draft buffer: every input here is a discrete select / checkbox /
 * chip (no free typing), so the async `props.data` echo can't fight a cursor.
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

/** The codes the card's date-holidays has data for — the set country resolution checks against. */
const SUPPORTED_COUNTRIES = new Set(Object.keys(new Holidays().getCountries()));

/** Every holiday type — the exclude list validated against all of them. */
const ALL_TYPES = HOLIDAY_TYPES.map(ht => ht.key);

/**
 * The guided "set up holidays" card: one page, tiers from top to bottom — country (with a system
 * auto-detect hint) → state / region (shown only where they exist) → holiday types → bridge days →
 * excluded holidays → a live preview of what the runtime would detect. This component reads the
 * stored fields the way the runtime does (holiday-shared readers) and derives what the tiers show;
 * the tiers (Tiers.tsx) render and write.
 *
 * @param props card data, detected system country and the change callbacks
 */
export function HolidayPanel(props: HolidayPanelProps): React.JSX.Element {
  const { data, systemCountry, systemLanguage, dateFormat, onChange, onChangeMany } = props;
  const lang = I18n.getLanguage();
  const t = (key: string, ...args: (string | number)[]): string => I18n.t(key, ...args);
  const year = new Date().getFullYear();

  const storedCountry = readTrimmed(data, "country");
  const storedState = readTrimmed(data, "state");
  const region = readTrimmed(data, "region");
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
  const stateOption = storedState ? stateOptions.find(o => sameCode(o.value, storedState)) : undefined;
  const state = stateOption?.value ?? storedState;
  const regionOptions = React.useMemo(() => getRegionOptions(scopeCountry, state, lang), [scopeCountry, state, lang]);
  const regionOption = region ? regionOptions.find(o => sameCode(o.value, region)) : undefined;

  // A stored state/region that no longer belongs to the chosen scope is NOT cleared here: the
  // narrower scope is cleared in the very write that changes the wider one (see the pickers), so a
  // value that was already stale when the page opened — a date-holidays update dropped the code — is
  // never written on its own. Writing it would arm the Save button without anybody touching anything
  // (audit finding F13); instead it is surfaced — visibly, for the user to resolve. No
  // `…Options.length` guard: a stale state must stay visible even when the new country has no states.
  const staleState = storedState && !stateOption ? storedState : "";
  const staleRegion = region && !regionOption ? region : "";

  const enabledKey = enabled.join(",");
  const listOptions = { systemLanguage, referenceYear: year, dateFormat };
  const excludeOptions = React.useMemo(
    () => buildExcludeOptions({ country: scopeCountry, state, region, types: enabled }, listOptions),
    // enabledKey stands in for the `enabled` array identity, the three option values for the object
    [scopeCountry, state, region, enabledKey, systemLanguage, year, dateFormat],
  );
  // Validation against ALL types: an exclude of a type that is only switched off is kept and shown
  // apart, never offered for deletion as an orphan.
  const allTypeOptions = React.useMemo(
    () => buildExcludeOptions({ country: scopeCountry, state, region, types: ALL_TYPES }, listOptions),
    [scopeCountry, state, region, systemLanguage, year, dateFormat],
  );

  const excludeKey = excludeHolidays.join(",");
  const preview = React.useMemo(
    () =>
      buildPreviewHolidays(
        { country: scopeCountry, state, region, types: enabled, excludeHolidays, includeBridgeDays },
        { systemLanguage, referenceYear: year },
      ),
    [scopeCountry, state, region, enabledKey, excludeKey, includeBridgeDays, systemLanguage, year],
  );

  return (
    <Box sx={{ maxWidth: 720 }}>
      <LocationTier
        t={t}
        countryOptions={countryOptions}
        stateOptions={stateOptions}
        regionOptions={regionOptions}
        countryOption={countryOptions.find(o => o.value === country) ?? null}
        stateOption={stateOption ?? null}
        regionOption={regionOption ?? null}
        staleState={staleState}
        staleRegion={staleRegion}
        unloadable={!!(stateOption?.unloadable || regionOption?.unloadable)}
        detected={detected}
        systemCountry={systemCountry}
        onChangeMany={onChangeMany}
      />
      <Divider />
      <TypesTier
        t={t}
        enabled={enabled}
        onChange={onChange}
      />
      <Divider />
      <BridgeTier
        t={t}
        checked={includeBridgeDays}
        onChange={onChange}
      />
      <Divider />
      <ExcludeTier
        t={t}
        options={excludeOptions}
        allOptions={allTypeOptions}
        excludeHolidays={excludeHolidays}
        inactiveIds={computeInactiveIds(excludeHolidays, excludeOptions, allTypeOptions)}
        orphanIds={computeOrphanIds(excludeHolidays, allTypeOptions)}
        hasCountry={!!scopeCountry}
        onChange={onChange}
      />
      <Divider />
      <PreviewTier
        t={t}
        preview={preview}
        year={year}
        hasCountry={!!scopeCountry}
        systemLanguage={systemLanguage}
        dateFormat={dateFormat}
      />
    </Box>
  );
}
