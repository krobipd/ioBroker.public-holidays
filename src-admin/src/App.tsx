// this file used only for simulation and not used in end build
import React from "react";
import { ThemeProvider, StyledEngineProvider } from "@mui/material/styles";

import { Box } from "@mui/material";

import {
  GenericApp,
  I18n,
  type IobTheme,
  Loader,
  type GenericAppProps,
  type GenericAppState,
} from "@iobroker/gui-components";

import HolidayConfig from "./HolidayConfig";

import enLocal from "./i18n/en.json";
import deLocal from "./i18n/de.json";
import ruLocal from "./i18n/ru.json";
import ptLocal from "./i18n/pt.json";
import nlLocal from "./i18n/nl.json";
import frLocal from "./i18n/fr.json";
import itLocal from "./i18n/it.json";
import esLocal from "./i18n/es.json";
import plLocal from "./i18n/pl.json";
import ukLocal from "./i18n/uk.json";
import zhCNLocal from "./i18n/zh-cn.json";

const styles: Record<string, any> = {
  app: (theme: IobTheme): React.CSSProperties => ({
    backgroundColor: theme.palette.background.default,
    color: theme.palette.text.primary,
    height: "100%",
  }),
  item: {
    padding: 40,
    maxWidth: 760,
  },
};

// A realistic scope so the whole guided card (cascade + exclude list + preview) has data to show.
const DEMO_DATA = {
  country: "DE",
  state: "BY",
  region: "",
  typePublic: true,
  includeBridgeDays: true,
  excludeHolidays: [] as string[],
};

interface AppState extends GenericAppState {
  data: Record<string, any>;
  originalData: Record<string, any>;
}

class App extends GenericApp<GenericAppProps, AppState> {
  constructor(props: GenericAppProps) {
    const extendedProps = { ...props };
    super(props, extendedProps);

    this.state = {
      ...this.state,
      data: { ...DEMO_DATA },
      originalData: { ...DEMO_DATA },
      theme: this.createTheme(),
    };
    const translations = {
      en: enLocal,
      de: deLocal,
      ru: ruLocal,
      pt: ptLocal,
      nl: nlLocal,
      fr: frLocal,
      it: itLocal,
      es: esLocal,
      pl: plLocal,
      uk: ukLocal,
      "zh-cn": zhCNLocal,
    };

    // setTranslations is deprecated and no longer registers anything; extendTranslations takes a
    // FLAT dictionary plus the language it belongs to, so feed it one language at a time.
    for (const [lang, dict] of Object.entries(translations)) {
      I18n.extendTranslations(dict, lang as ioBroker.Languages);
    }
    // @ts-expect-error userLanguage could exist
    const browserLang = (navigator.language || navigator.userLanguage || "en").toLowerCase();
    // Chinese translations live under the full "zh-cn" key; every other language under its
    // 2-letter code — so don't blindly truncate "zh-cn" to "zh".
    I18n.setLanguage(browserLang.startsWith("zh") ? "zh-cn" : browserLang.substring(0, 2));
  }

  render(): React.JSX.Element {
    if (!this.state.loaded) {
      return (
        <StyledEngineProvider injectFirst>
          <ThemeProvider theme={this.state.theme}>
            <Loader themeType={this.state.themeType} />
          </ThemeProvider>
        </StyledEngineProvider>
      );
    }

    return (
      <StyledEngineProvider injectFirst>
        <ThemeProvider theme={this.state.theme}>
          <Box sx={styles.app}>
            <div style={styles.item}>
              <HolidayConfig
                oContext={{
                  adapterName: "public-holidays",
                  socket: this.socket,
                  instance: 0,
                  themeType: this.state.theme.palette.mode,
                  isFloatComma: true,
                  dateFormat: "",
                  forceUpdate: () => {},
                  systemConfig: { country: "Germany", language: "de" } as ioBroker.SystemConfigCommon,
                  theme: this.state.theme,
                  _themeName: this.state.themeName,
                  onCommandRunning: (_commandRunning: boolean): void => {},
                }}
                alive
                changed={JSON.stringify(this.state.originalData) !== JSON.stringify(this.state.data)}
                themeName={this.state.theme.palette.mode}
                common={{} as ioBroker.InstanceCommon}
                attr="_holidayCard"
                data={this.state.data}
                originalData={this.state.originalData}
                onError={() => {}}
                schema={{
                  url: "custom/customComponents.js",
                  i18n: true,
                  name: "PublicHolidaysComponentSet/Components/HolidayConfig",
                  type: "custom",
                }}
                onChange={data => this.setState({ data: data as Record<string, any> })}
              />
            </div>
          </Box>
        </ThemeProvider>
      </StyledEngineProvider>
    );
  }
}

export default App;
