#!/usr/bin/env npx tsx
import Holidays from "date-holidays";
import * as fs from "node:fs";
import * as path from "node:path";

interface SelectOption {
  label: string | Record<string, string>;
  value: string;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Items = Record<string, JsonValue>;

// Placeholder (first / "none") option labels as full 11-language i18n objects.
// repochecker E5611 requires inline i18n objects in jsonConfig to be complete; an
// explicit object is also guaranteed to render translated in every admin language.
const PLACEHOLDER_COUNTRY: Record<string, string> = {
  en: "— Select country —",
  de: "— Land wählen —",
  es: "— Seleccionar país —",
  fr: "— Sélectionner le pays —",
  it: "— Seleziona paese —",
  nl: "— Land selecteren —",
  pl: "— Wybierz kraj —",
  pt: "— Selecionar país —",
  ru: "— Выберите страну —",
  uk: "— Виберіть країну —",
  "zh-cn": "— 选择国家 —",
};
const PLACEHOLDER_STATE: Record<string, string> = {
  en: "— (none) —",
  de: "— (keines) —",
  es: "— (ninguno) —",
  fr: "— (aucun) —",
  it: "— (nessuno) —",
  nl: "— (geen) —",
  pl: "— (brak) —",
  pt: "— (nenhum) —",
  ru: "— (нет) —",
  uk: "— (немає) —",
  "zh-cn": "— (无) —",
};
const PLACEHOLDER_REGION: Record<string, string> = {
  en: "— (none) —",
  de: "— (keine) —",
  es: "— (ninguna) —",
  fr: "— (aucune) —",
  it: "— (nessuna) —",
  nl: "— (geen) —",
  pl: "— (brak) —",
  pt: "— (nenhuma) —",
  ru: "— (нет) —",
  uk: "— (немає) —",
  "zh-cn": "— (无) —",
};

const hd = new Holidays();
const countries = hd.getCountries();

const countryOptions: SelectOption[] = [{ label: PLACEHOLDER_COUNTRY, value: "" }];
for (const [code, name] of Object.entries(countries).sort((a, b) => a[1].localeCompare(b[1]))) {
  countryOptions.push({ label: `${(name as string).replace(/\\/g, "")} (${code})`, value: code });
}

const statePanels: Items = {};
const regionPanels: Items = {};

for (const cc of Object.keys(countries)) {
  const states = hd.getStates(cc);
  if (!states || Object.keys(states).length === 0) continue;

  const stateOptions: SelectOption[] = [{ label: PLACEHOLDER_STATE, value: "" }];

  for (const [code, name] of Object.entries(states).sort((a, b) => (a[1] as string).localeCompare(b[1] as string))) {
    stateOptions.push({ label: `${(name as string).replace(/\\/g, "")} (${code})`, value: code });

    const regions = hd.getRegions(cc, code);
    if (regions && Object.keys(regions).length > 0) {
      const regionOptions: SelectOption[] = [{ label: PLACEHOLDER_REGION, value: "" }];
      for (const [rc, rn] of Object.entries(regions).sort((a, b) => (a[1] as string).localeCompare(b[1] as string))) {
        regionOptions.push({ label: `${(rn as string).replace(/\\/g, "")} (${rc})`, value: rc });
      }
      regionPanels[`_regionPanel_${cc}_${code}`] = {
        type: "panel",
        hidden: `data.country !== '${cc}' || data.state !== '${code}'`,
        xs: 12,
        sm: 12,
        md: 6,
        lg: 4,
        xl: 4,
        items: {
          region: {
            type: "select",
            label: "label_region",
            options: regionOptions,
            xs: 12,
            sm: 12,
            md: 12,
            lg: 12,
            xl: 12,
          },
        },
      };
    }
  }

  statePanels[`_statePanel_${cc}`] = {
    type: "panel",
    hidden: `data.country !== '${cc}'`,
    xs: 12,
    sm: 12,
    md: 6,
    lg: 4,
    xl: 4,
    items: {
      state: {
        type: "select",
        label: "label_state",
        options: stateOptions,
        xs: 12,
        sm: 12,
        md: 12,
        lg: 12,
        xl: 12,
      },
    },
  };
}

const jsonConfig = {
  i18n: true,
  type: "tabs",
  items: {
    tab_region: {
      type: "panel",
      label: "tab_region",
      items: {
        country: {
          type: "select",
          label: "label_country",
          help: "help_country",
          options: countryOptions,
          xs: 12,
          sm: 12,
          md: 6,
          lg: 4,
          xl: 4,
        },
        ...statePanels,
        ...regionPanels,
      },
    },
    tab_holidays: {
      type: "panel",
      label: "tab_holidays",
      items: {
        _headerTypes: {
          type: "header",
          size: 5,
          text: "header_types",
          xs: 12,
          sm: 12,
          md: 12,
          lg: 12,
          xl: 12,
        },
        typePublic: {
          type: "checkbox",
          label: "label_typePublic",
          xs: 12,
          sm: 6,
          md: 4,
          lg: 2,
          xl: 2,
        },
        typeBank: {
          type: "checkbox",
          label: "label_typeBank",
          xs: 12,
          sm: 6,
          md: 4,
          lg: 2,
          xl: 2,
        },
        typeSchool: {
          type: "checkbox",
          label: "label_typeSchool",
          xs: 12,
          sm: 6,
          md: 4,
          lg: 2,
          xl: 2,
        },
        typeOptional: {
          type: "checkbox",
          label: "label_typeOptional",
          xs: 12,
          sm: 6,
          md: 4,
          lg: 2,
          xl: 2,
        },
        typeObservance: {
          type: "checkbox",
          label: "label_typeObservance",
          xs: 12,
          sm: 6,
          md: 4,
          lg: 2,
          xl: 2,
        },
        _headerBridge: {
          type: "header",
          size: 5,
          text: "header_bridge",
          newLine: true,
          xs: 12,
          sm: 12,
          md: 12,
          lg: 12,
          xl: 12,
        },
        includeBridgeDays: {
          type: "checkbox",
          label: "label_includeBridgeDays",
          help: "help_includeBridgeDays",
          xs: 12,
          sm: 12,
          md: 6,
          lg: 6,
          xl: 6,
        },
        _headerExclude: {
          type: "header",
          size: 5,
          text: "header_exclude",
          newLine: true,
          xs: 12,
          sm: 12,
          md: 12,
          lg: 12,
          xl: 12,
        },
        _helpExclude: {
          type: "staticText",
          text: "help_exclude",
          xs: 12,
          sm: 12,
          md: 12,
          lg: 12,
          xl: 12,
        },
        excludeHolidays: {
          type: "custom",
          i18n: true,
          url: "custom/customComponents.js",
          name: "PublicHolidaysComponentSet/Components/ExcludeSelector",
          bundlerType: "module",
          xs: 12,
          sm: 12,
          md: 12,
          lg: 12,
          xl: 12,
        },
      },
    },
  },
};

const jsonConfigPath = path.join(__dirname, "..", "admin", "jsonConfig.json");
fs.writeFileSync(jsonConfigPath, JSON.stringify(jsonConfig, null, 2) + "\n");

const stats = {
  countries: countryOptions.length - 1,
  statePanels: Object.keys(statePanels).length,
  regionPanels: Object.keys(regionPanels).length,
};
console.log(
  `Updated jsonConfig.json: ${stats.countries} countries, ` +
    `${stats.statePanels} state panels, ${stats.regionPanels} region panels ` +
    `(exclude list served by the custom admin component)`,
);
