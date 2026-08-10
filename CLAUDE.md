# CLAUDE.md — ioBroker.public-holidays

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Public Holidays** — Offline-Feiertagserkennung für 206 Länder mit Brückentag-Support. Schedule-Mode (`allowInit: true`): berechnet einmalig bei Start/Config-Änderung, js-controller triggert täglich um Mitternacht per Cron.

- **Version + Changelog:** current version in `io-package.json`; full internal dev history moved to `.claude/dev-history.md` (local, not auto-loaded). User-facing changelog: `README.md` + `io-package.json` news.
- **GitHub:** https://github.com/krobipd/ioBroker.public-holidays
- **npm:** `iobroker.public-holidays` — Zugang erhalten 2026-05-24
- **Runtime-Deps:** `@iobroker/adapter-core`, `date-holidays` (^3.30.2, ISC + CC-BY-SA-3.0; im Release-Workflow auf npm-latest gehalten — Currency-Gate + `npm run generate`)
- **Test-Setup:** Tests unter `src/**/*.test.ts` via **vitest**. `test/package.js` + `test/integration.js` bleiben mocha.
- **`@types/node` an `engines.node`-Min gekoppelt:** `^22` weil `engines.node: ">=22"`

## Architektur

```
src/main.ts                        → Adapter (onReady → resolve country → compute → publish → terminate)
src/lib/
├── holiday-engine.ts              → date-holidays Wrapper, Type-Filter, Brückentag-Algo (alle 3 Jahre), createHolidaysInstance (injizierbar); getFilteredHolidays prüft verwaiste Excludes gegen collectCountryWideIds (alle Land-Scopes, nicht nur Schmal-Scope)
├── state-publisher.ts             → ComputedHolidays → ioBroker States
├── i18n.ts                        → tName-Wrapper + getSystemConfig (1 Read, typed) + resolveLanguages + resolveCountryCode (Name→ISO via country-codes)
├── country-codes.ts              → ISO-3166 Name→alpha-2 Map (aus admin countries.json; Auto-Detect resolver)
├── types.ts                       → AdapterConfig, DayInfo, NextHoliday, ComputedHolidays
└── error-utils.ts                 → errText + oneLine (Log/Sentry-Newline-Hygiene)
admin/
├── jsonConfig.json                → 2 Tabs (Region + Holidays); Exclude-Feld = Custom-Komponente (type:custom), generiert durch generate-country-data.ts
├── custom/                        → generierte MF-Komponente (customComponents.js + assets + mf-manifest + i18n); seit 0.12.0 GIT-GETRACKT (admin-8-only, Verteilung per GitHub-URL bis Admin 8 stable)
├── i18n/<lang>.json               → Single-Source-of-Truth für UI- + State-Translations (31 Keys × 11 Sprachen)
├── public-holidays.svg            → Icon (SVG 256×256, transparent)
src-admin/                          → Custom-Admin-Komponente (Module-Federation/Vite Remote, eigenes package.json + vite.config.ts)
├── src/ExcludeSelector.tsx        → dünner ConfigGeneric-Wrapper: liest Scope aus props.data, memoisiert die Optionsliste per Scope/Typ/Sprache, rendert Autocomplete + Orphan-Chips
├── src/exclude-options.ts         → PURE Logik (kein React/MUI): buildExcludeOptions (scope-exakt, date-holidays client-seitig, dedupe+MM-DD-Sort), computeOrphanIds, enabledTypes (defaultOn-Semantik = validateConfig), toHolidayId. Von vitest aus src/ importierbar → echte Unit-Tests (exclude-options.test.ts) + Drift-Guards (holiday-id-parity, exclude-type-flags-parity)
├── src/i18n/<lang>.json           → Komponenten-Übersetzungen (11 Sprachen)
├── package.json                   → Gen-2/Admin-8-Stack (Migration 2026-08-10): @iobroker/gui-components ^10 + json-config ^9 + React 19 + MUI 9 + Vite 8 + @module-federation/vite 1.19.1 (guiApi:2, kein bundlerType)
scripts/
├── generate-country-data.ts       → Regeneriert jsonConfig: 206 Countries, 35 State-Panels, 29 Region-Panels + 1 Exclude-Custom-Komponente
tasks.js                            → Komponenten-Build (@iobroker/build-tools: clean→npmInstall→buildReact→copyFiles → admin/custom); prepublishOnly + before_commit + CI-Job admin-component
../scripts/sync-iopackage-from-i18n.py → regeneriert io-package.json:instanceObjects.common.name aus admin/i18n/ (zentral, source: admin-i18n)
```

## Design-Entscheidungen

1. **Schedule-Mode mit `allowInit: true`** — js-controller triggert per Cron (`0 0 * * *`) und einmalig bei Config-Änderung/Start. Adapter berechnet, publiziert, ruft `this.stop?.()` und beendet sich. Kein Daemon, kein Timer, kein Speicherverbrauch zwischen Runs.
2. **date-holidays als einzige Engine** — 206 Länder, offline, stabile API seit 5+ Jahren, ISC-Lizenz (Daten CC-BY-SA-3.0 laut LICENSE-Datei; die package.json-SPDX `(ISC AND CC-BY-3.0)` understatet das ShareAlike — wir geben es korrekt an, ein Auto-SPDX-Check darf das nicht „korrigieren")
3. **Panel-per-Country Dropdowns + Custom-Exclude** — Country/State/Region als statische per-Country Selects (hidden-Condition); Exclude seit 0.9.0 als Custom-Komponente (`src-admin/ExcludeSelector`, scope-exakt, client-seitig date-holidays) statt 206 per-Country-Exclude-Panels
4. **Individuelle Type-Booleans in native** statt `holidayTypes: string[]` — sauberes jsonConfig-Mapping (5 Checkboxen)
5. **referenceDate-Parameter** in computeHolidays — deterministische Tests ohne Mocking
6. **Brückentag Do→Fr, Di→Mo, plus Mi zwischen Di+Do-Feiertag** — Mi→Wochenende braucht 2 Fehltage (kein Brückentag); ein Mi, der beidseitig von einem Di- und einem Do-Feiertag eingeklemmt ist, wird gebrückt (v0.8.0)

## State Tree

4 Day-Channels × 2 Fields + next × 4 Fields = 12 States total. Day-Channels (today, yesterday, tomorrow, dayAfterTomorrow): name, isHoliday. Next: name, isHoliday, date, daysUntil. (Der Flag-State hieß bis v0.10.0 `boolean` — in v0.11.0 zu `isHoliday` umbenannt, alte `*.boolean` per `cleanupDeprecatedStates` migriert.)

## Tests (227 vitest + 69 package)

Seit v0.11.0 zusätzlich: `exclude-options.test.ts` (pure ExcludeSelector-Logik: buildExcludeOptions/computeOrphanIds/enabledTypes, 12 Tests) + `exclude-type-flags-parity.test.ts` (Drift-Guard TYPE_FLAGS↔HOLIDAY_TYPES). `holiday-id-parity.test.ts` liest jetzt `exclude-options.ts` statt `ExcludeSelector.tsx`.

Test-Breakdown: holiday-engine 110, i18n 39, main 25, state-publisher 23, error-utils 7 = 204 vitest. Ehrliche Coverage (`coverage.include`): 98,7 %.

## Versionshistorie

Aktuelle Version: `io-package.json`. **User-facing Changelog:** `README.md` + `io-package.json:common.news` (11 Sprachen, handgeschrieben). **Interne Entwicklungs-Historie** (Findings, Root-Causes, verworfene Wege): `.claude/dev-history.md` — lokal, nicht git-getrackt, bewusst aus dieser Datei ausgelagert um sie schlank zu halten.

## Befehle

```bash
npm run build         # Production (esbuild)
npm test              # vitest + @iobroker/testing packageFiles
npm run coverage      # vitest run --coverage
npm run lint          # ESLint
npm run format:check  # Prettier --check
npm run check         # tsc --noEmit
```
