# CLAUDE.md — ioBroker.public-holidays

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Public Holidays** — Offline-Feiertagserkennung für 206 Länder mit Brückentag-Support. Schedule-Mode (`allowInit: true`): berechnet einmalig bei Start/Config-Änderung, js-controller triggert täglich um Mitternacht per Cron.

- **Version:** 0.8.0 (2026-06-25) — Audit-Welle 3 (Code + Security, minor): Diagnostik-Warns (unbekanntes Bundesland/Region + verwaister Exclude, gegen ungefilterte Liste → kein False-Positive bei abgeschaltetem Typ), Typ-Prioritäts-Dedupe bei Datums-Kollision (public vor bank/…), Mi-Brücke (Di+Do), `oneLine`-Log/Sentry-Hygiene, tote dow-Guards raus, 4 Test-Macken gefixt → **200 vitest**; **kein Wurzel-Fix für Exclude-Stabilität möglich** (date-holidays bietet keine stabile Feiertags-ID, rule churnt) → die Warn ist die einzige Absicherung. Deps adapter-core 3.4.1 / vitest 4.1.9 / @iobroker/types 7.2.2. **Vorgänger 0.7.1** (2026-06-13) — Audit-Welle 2 (Patch, rein intern). **Test-Welle (+23 → 187 vitest):** neue `src/main.test.ts` (22 Orchestrierungs-Tests via adapter-core-Stub, Engine/Publisher laufen ECHT inkl. date-holidays — onReady happy-path mit `vi.setSystemTime` auf Neujahr, daemon→schedule-Migration, komplette Country-Detect-Kette [explizit > System-Name via resolveCountryCode > Abbruch-Warn], A3-0-Feiertage-Warn, Fehler-Pfad mit stop()-Garantie, Deprecated-Cleanup, validateConfig-Matrix [Type-Flag-Defaults, 6-Quellen-Exclude-Merge, strict-Boolean-Checks]); **Test-Namen-Drift gefixt:** „region config works (IT/BZ)" setzte nur state — ehrlich umbenannt + ECHTER Region-Test (DE/BY/A, Augsburger Friedensfest 8.8. nur in Region A) deckt jetzt den 3-Arg-Holidays-Konstruktor (einziger ungetesteter lib-Zweig). **Coverage ehrlich 73,4 % (main.ts 0) → 98,7 %** (main 95,2, lib 100) via `coverage.include`. **Typ-Hygiene:** `RawHoliday` exportiert (test-only annotiert) — 5 `as any`-Maps in den detectBridgeDays-Tests raus (hatten Phantasie-Felder start/end); **KISS:** `rawConfig()`/`configuredCountry()`-Helper (Doppel-Cast in onReady+validateConfig weg), eslint `coverage`-ignore. Klasse exportiert für den Harness. Alle Gates grün (lint 0/0, tsc, build, 187 vitest + 57 package, state-role-gate 16/16, repochecker clean [E1025 = verifizierter Icon-CDN-FP, HTTP 200]).
- **Vorgänger 0.7.0** (optional Sentry → power-dreams; Vorgänger 0.6.0) (released 2026-05-31 — In-Depth-Audit #2 (minor): **A1** Country-Auto-Detect repariert (admin speichert ISO-Klarname in `system.config.common.country` → via gebündelter `country-codes.ts`-Map nach ISO-Code aufgelöst; date-holidays lieferte für den Namen vorher still `[]`), **A2** Brückentage über die Jahresgrenze, **A3** Warn bei nicht-erkanntem Land. date-holidays **3.30.2** + Release-Currency-Gate (`scripts/check-date-holidays.mjs`, warn) + `npm run generate` im before_commit (`.releaseconfig`-EXCEPTION im Consistency-Audit). KISS/DRY, dead-code, `coerce.ts`→`error-utils.ts`, 164 vitest). Vorgänger **0.5.2** (released 2026-05-30 — In-Depth-Audit: E5611-Fix jsonConfig-Platzhalter-i18n→11 Sprachen im Generator, KISS/DRY-Härtung, 2 Guard-Tests, devDeps; dev-server-verifiziert, GitHub-repochecker „NO errors"). Vorgänger **0.5.1** (released 2026-05-25 — Repochecker E2004 fix: removed legacy news entries for versions not published under this package name). Vorgänger **0.5.0** (released 2026-05-25) Schedule-Mode restored, Timezone-Fix, `next.duration→next.daysUntil` Rename, Mode-Migration v0.4.0→v0.5.0, Jey-Cee Credits. **0.4.0** Bridge-Day-Lokalisierung 11 Sprachen. **0.3.0** ID-States entfernt 17→12 States, Logging info→debug. **0.2.0** UX overhaul: dropdown selects, country auto-detect, 27→17 States. **0.1.5** changelog user-centric rewrite. **0.1.4** Repochecker compliance. **0.1.3** i18n migration. **0.1.2** Preserve user-modified state names. npm-Zugang erhalten 2026-05-24. **Latest-PR:** #6026 (eingereicht 2026-05-25).
- **GitHub:** https://github.com/krobipd/ioBroker.public-holidays
- **npm:** `iobroker.public-holidays` — Zugang erhalten 2026-05-24
- **Runtime-Deps:** `@iobroker/adapter-core`, `date-holidays` (^3.30.2, ISC + CC-BY-SA-3.0; im Release-Workflow auf npm-latest gehalten — Currency-Gate + `npm run generate`)
- **Test-Setup:** Tests unter `src/**/*.test.ts` via **vitest**. `test/package.js` + `test/integration.js` bleiben mocha.
- **`@types/node` an `engines.node`-Min gekoppelt:** `^22` weil `engines.node: ">=22"`

## Architektur

```
src/main.ts                        → Adapter (onReady → resolve country → compute → publish → terminate)
src/lib/
├── holiday-engine.ts              → date-holidays Wrapper, Type-Filter, Brückentag-Algo (alle 3 Jahre), createHolidaysInstance (injizierbar)
├── state-publisher.ts             → ComputedHolidays → ioBroker States
├── i18n.ts                        → tName-Wrapper + getSystemConfig (1 Read, typed) + resolveLanguages + resolveCountryCode (Name→ISO via country-codes)
├── country-codes.ts              → ISO-3166 Name→alpha-2 Map (aus admin countries.json; Auto-Detect resolver)
├── types.ts                       → AdapterConfig, DayInfo, NextHoliday, ComputedHolidays
└── error-utils.ts                 → errText
admin/
├── jsonConfig.json                → 2 Tabs (Region + Holidays), generiert durch generate-country-data.ts
├── i18n/<lang>.json               → Single-Source-of-Truth für UI- + State-Translations (31 Keys × 11 Sprachen)
├── public-holidays.svg            → Icon (SVG 256×256, transparent)
scripts/
├── generate-country-data.ts       → Regeneriert jsonConfig: 206 Countries, 35 State-Panels, 29 Region-Panels, 206 Exclude-Panels
../scripts/sync-iopackage-from-i18n.py → regeneriert io-package.json:instanceObjects.common.name aus admin/i18n/ (zentral, source: admin-i18n)
```

## Design-Entscheidungen

1. **Schedule-Mode mit `allowInit: true`** — js-controller triggert per Cron (`0 0 * * *`) und einmalig bei Config-Änderung/Start. Adapter berechnet, publiziert, ruft `this.stop?.()` und beendet sich. Kein Daemon, kein Timer, kein Speicherverbrauch zwischen Runs.
2. **date-holidays als einzige Engine** — 206 Länder, offline, stabile API seit 5+ Jahren, ISC-Lizenz (Daten CC-BY-SA-3.0 laut LICENSE-Datei; die package.json-SPDX `(ISC AND CC-BY-3.0)` understatet das ShareAlike — wir geben es korrekt an, ein Auto-SPDX-Check darf das nicht „korrigieren")
3. **Panel-per-Country Dropdowns** — Country/State/Region/Exclude als statische Selects, per-Country Panels mit hidden-Condition
4. **Individuelle Type-Booleans in native** statt `holidayTypes: string[]` — sauberes jsonConfig-Mapping (5 Checkboxen)
5. **referenceDate-Parameter** in computeHolidays — deterministische Tests ohne Mocking
6. **Brückentag Do→Fr, Di→Mo, plus Mi zwischen Di+Do-Feiertag** — Mi→Wochenende braucht 2 Fehltage (kein Brückentag); ein Mi, der beidseitig von einem Di- und einem Do-Feiertag eingeklemmt ist, wird gebrückt (v0.8.0)

## State Tree

4 Day-Channels × 2 Fields + next × 4 Fields = 12 States total. Day-Channels (today, yesterday, tomorrow, dayAfterTomorrow): name, boolean. Next: name, boolean, date, daysUntil.

## Tests (187 vitest + 57 package = 244)

Test-Breakdown: holiday-engine 100, i18n 39, state-publisher 23, error-utils 3, main 22 = 187 vitest. Ehrliche Coverage (`coverage.include`): 98,7 %.

```
src/main.test.ts                  → 22: onReady-Orchestrierung (v0.7.1, adapter-core-Stub + echte Engine): Migration, Country-Detect-Kette, A3-Warn, Fehler-Pfad, validateConfig-Matrix
src/lib/holiday-engine.test.ts    → 100: config diversity, type filter, exclude, bridge days (incl 11 locale via it.each + year-boundary), relative days, next holiday, localization, edge cases, toHolidayId, toDateKey, 20-country crash tests, logAvailableHolidays, echter Region-Test DE/BY/A
src/lib/i18n.test.ts              → 39: tName + i18n completeness (11 langs) + resolveLanguages + resolveCountryCode (name→code + fail-safe) + getSystemConfig + jsonConfig E5611 guard + lang-set drift guard
src/lib/state-publisher.test.ts   → 23: ensureObjects, cleanupDeprecated, publishStates, preserve, io-package↔FIELD_SPECS drift guard (mock adapter)
src/lib/error-utils.test.ts       → 3: errText branches
test/package.js                   → 57: @iobroker/testing packageFiles
test/integration.js               → @iobroker/testing integration (CI only)
```

## Versionshistorie

| Version | Highlights                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.8.0 | **Audit-Welle 3 (Code + Security, minor).** Diagnostik-Warns: unbekanntes Bundesland/Region (date-holidays fällt sonst still auf gröbere Ebene zurück) + verwaister Exclude (gegen UNgefilterte Feiertagsliste geprüft → kein False-Positive bei abgeschaltetem Typ). Engine: Typ-Prioritäts-Dedupe bei Datums-Kollision (public vor bank/…), Mi-Brücke zwischen Di+Do-Feiertag, tote dow-Guards raus. `oneLine`-Log/Sentry-Hygiene. 4 Test-Macken gefixt (ungültiger IT/BZ-Code → IT/32 Alto Adige, US/CA César Chávez, CH/BE-Kontrast, AT-Detect echt statt Datums-Regex). **187→200 vitest.** Wurzel-Fix für Exclude-Stabilität verifiziert NICHT möglich (date-holidays bietet keine stabile Feiertags-ID; rule churnt über Versionen) → Warn ist die einzige Absicherung. Deps: adapter-core 3.4.1, vitest 4.1.9, @iobroker/types 7.2.2. |
| 0.7.1 | **Audit-Welle 2 (Patch, intern).** Test-Welle +23 → 187 vitest: main.test.ts (22 Orchestrierungs-Tests via Stub + echter Engine — Migration, Country-Detect-Kette, validateConfig-Matrix, Fehler-Pfad mit stop()-Garantie). Test-Namen-Drift gefixt (IT/BZ-„region"-Test war state-only) + echter Region-Test DE/BY/A → 3-Arg-Konstruktor-Zweig gedeckt. Coverage ehrlich 73,4→98,7 % via coverage.include. RawHoliday exportiert (5 as-any-Maps raus), rawConfig/configuredCountry-DRY, eslint coverage-ignore. |
| 0.7.0 | Optional Sentry error reporting (`common.plugins.sentry` → eigener power-dreams-Sentry; README-Badge + `## Sentry`-Abschnitt). |
| 0.6.0   | **In-Depth-Audit #2 (minor, repochecker 5.17.4 / KISS-DRY / integration).** A1: Auto-Detect aus `system.config.common.country` repariert — admin speichert den ISO-Klarnamen (`MainSettingsDialog.tsx:value={elem.name}`), date-holidays braucht den Code → neue `country-codes.ts`-Map (243, aus admin countries.json) + `resolveCountryCode` (Name→Code, fail-safe), `getSystemConfig` (1 typed Read). A2: Brückentage über alle 3 Jahre (Jahresgrenze). A3: Warn bei 0 Roh-Feiertagen. date-holidays **3.30.2**; Release-Workflow hält es aktuell (`check-date-holidays.mjs`-Gate + `npm run generate` im before_commit, `.releaseconfig`-EXCEPTION). C1/C3 Instanz-Injektion, C2/RawHoliday/dead-guard, `coerce.ts`→`error-utils.ts`. **139→164 vitest.** integration-verifiziert. |
| 0.5.2   | **In-Depth-Audit (repochecker 5.17.3 / KISS-DRY / dev-server).** E5611-Fix: jsonConfig-Platzhalter (country/state/region, 65 Selects) auf 11-Sprachen-i18n im Generator. `publishStates` iteriert Feld-Arrays, Prozess-Handler raus (try/catch reicht), keine `this.config`-Mutation, `toStringArray`-Element-Check, 2 neue Guard-Tests (io-package↔FIELD_SPECS + jsonConfig-i18n-Vollständigkeit). devDeps. 139 vitest. dev-server-verifiziert (Admin 857KB-Config 15ms). |
| 0.5.1   | **Repochecker E2004 fix.** Removed legacy news entries (0.1.3-0.1.5) for versions not published under this package name. README E6015 fix. Latest-PR #6026 eingereicht. |
| 0.5.0   | **Schedule-Revert + Rename.** Schedule-Mode restored (v0.4.0 Daemon-Regression). Timezone-Fix. `next.duration→next.daysUntil`. Mode-Migration v0.4.0→v0.5.0. Lesotho-Backslash-Fix. Tests 73→96. Jey-Cee Credits. |
| 0.4.0   | **Bridge-Day i18n.** Brückentag-Namen in 11 Sprachen. |
| 0.3.0   | **Slim State Tree + Stability.** ID-States entfernt (17→12 States). Logging info→debug. Process-Handler, setStateChangedAsync.                                                                                                  |
| 0.2.0   | **UX Overhaul.** Dropdown-Selects für State/Region/Exclude (per-type), Country auto-detect, State Tree 27→17 States. Panel-per-Country Pattern. 32 i18n Keys.                                                                  |
| 0.1.5   | Changelog user-centric rewrite (README + io-package.json news audited against Hard-Negativ-Liste).                                                                                                                              |
| 0.1.4   | Repochecker compliance: admin checkbox responsive sizes (E5507), next.date role (W1132), node: imports (S5043).                                                                                                                 |
| 0.1.3   | **i18n-Migration auf adapter-core.** Private `i18n-states.ts` durch `I18n.getTranslatedObject()` ersetzt, admin/i18n von Unterordner-Pattern auf flat `<lang>.json` migriert (32 Keys = 20 UI + 12 State-Names). Tests 109→113. |
| 0.1.2   | Preserve user-modified state names on restart (mcm1957 feedback).                                                                                                                                                               |
| 0.1.1   | Community-standard event handler pattern (.bind + try/catch).                                                                                                                                                                   |
| 0.1.0   | Initial release: 206 countries, bridge days, exclude by ID, 11-language admin.                                                                                                                                                  |

## Befehle

```bash
npm run build         # Production (esbuild)
npm test              # vitest + @iobroker/testing packageFiles
npm run coverage      # vitest run --coverage
npm run lint          # ESLint
npm run format:check  # Prettier --check
npm run check         # tsc --noEmit
```
