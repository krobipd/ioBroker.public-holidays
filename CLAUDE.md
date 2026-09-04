# CLAUDE.md — ioBroker.public-holidays

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.

## Projekt

**ioBroker Public Holidays** — Offline-Feiertagserkennung für 206 Länder mit Brückentag-Support. Schedule-Mode (`allowInit: true`): berechnet einmalig bei Start/Config-Änderung, js-controller triggert täglich um Mitternacht per Cron.

- **Version + Changelog:** current version in `io-package.json`; full internal dev history moved to `.claude/dev-history.md` (local, not auto-loaded). User-facing changelog: `README.md` + `io-package.json` news.
- **GitHub:** https://github.com/krobipd/ioBroker.public-holidays
- **npm:** `iobroker.public-holidays` — Zugang erhalten 2026-05-24
- **Runtime-Deps:** `@iobroker/adapter-core`, `date-holidays` (^3.30.2, ISC + CC-BY-SA-3.0; im Release-Workflow auf npm-latest gehalten — Currency+Parität-Gate `check-date-holidays.mjs`, das auch die src-admin-Karten-Kopie auf dieselbe Version pinnt)
- **Test-Setup:** Tests unter `src/**/*.test.ts` via **vitest**. `test/package.js` + `test/integration.js` bleiben mocha.
- **`@types/node` an `engines.node`-Min gekoppelt:** `^22` weil `engines.node: ">=22"`

## Architektur

```
src/main.ts                        → Adapter (onReady → resolve country → compute → publish → terminate)
src/lib/
├── holiday-engine.ts              → date-holidays Wrapper, Type-Filter, Brückentag-Algo (alle 3 Jahre), createHolidaysInstance (injizierbar); getFilteredHolidays prüft verwaiste Excludes gegen collectCountryWideIds (alle Land-Scopes, nicht nur Schmal-Scope)
├── state-publisher.ts             → ComputedHolidays → ioBroker States; ensureObjects frischt alle 17 Manifest-Objekte mit LITERALEN IDs per extendObject auf (Gate audit_instanceobjects_reach liest den Quelltext) und OHNE preserve (die Namen gehören dem Adapter — mit preserve erreicht eine Umbenennung nur Neuinstallationen). Nie setObject: common.custom (History) darf nicht wegfallen. Lokaler Wächter: instance-objects-reach.test.ts
├── i18n.ts                        → tName-Wrapper + getSystemConfig (1 Read, typed: country/language/dateFormat) + resolveLanguages + resolveCountryCode (Name→ISO via country-codes) + formatDateForDisplay (Log-Datum im System-Datumsformat, v0.14.0 — der next.date-STATE bleibt ISO)
├── country-codes.ts              → ISO-3166 Name→alpha-2 Map (aus admin countries.json; Auto-Detect resolver)
├── types.ts                       → AdapterConfig, DayInfo, NextHoliday, ComputedHolidays
└── error-utils.ts                 → errText + oneLine (Log/Sentry-Newline-Hygiene)
docs/<en|de>/README.md              → Nutzer-Dokumentation fürs ioBroker-Doku-Portal (verlinkt in io-package common.docs; erster Eintrag je Sprache ist die Hauptseite, dort setzt das Portal Changelog/Logo/Abzeichen ein)
admin/
├── jsonConfig.json                → statischer Mini-Wrapper: EIN type:custom-Element (_holidayCard, guiApi:2) = die geführte Karte, darunter der Flotten-Spenden-Block (header + staticText + 2 staticLink). Von 145 KB (206 Länder × Select-Panels) auf ~15 Zeilen — die Kaskade läuft jetzt client-seitig
├── custom/                        → gebaute MF-Komponente (customComponents.js + assets + mf-manifest + i18n); seit 0.12.0 GIT-GETRACKT (nötig für GitHub-Installationen; npm-Verteilung läuft seit 2026-08-21 wieder regulär — der CI-Versions-Wächter erlaubt `admin` voraus)
├── i18n/<lang>.json               → State-Namen-Translations (9 Keys) für tName + io-package-Sync UND die 4 jsonConfig-Labels des Spenden-Blocks (supportHeader/aboutInfo/donateKofi/donatePaypal — Admin löst jsonConfig-`label`/`text` NUR von hier auf, nicht aus der Komponente); die Karten-Labels liegen in src-admin/src/i18n
├── public-holidays.svg            → Icon (SVG 256×256, transparent)
src-admin/                          → Custom-Admin-Komponente (Module-Federation/Vite Remote, eigenes package.json + vite.config.ts)
├── src/HolidayConfig.tsx          → dünner ConfigGeneric-Mount (govee ConnectionConfig-Muster): reicht props.data an das Panel, schreibt jedes Feld via this.onChange(attr,val) — besitzt ALLE native-Felder, keine Migration (gleiche Feldnamen)
├── src/HolidayPanel.tsx           → plain React (kein ConfigGeneric, jsdom-freundlich): die geführte Stufen-Karte (Standort/Typen/Brückentage/Ausschluss/Live-Vorschau). Kein Draft-Puffer (nur diskrete Selects/Checkboxen/Chips). Leert state/region REAKTIV beim Landwechsel (sonst stale hinter altem Scope)
├── src/scope-options.ts           → PURE Logik: getCountry/State/RegionOptions (Kaskade, client-seitig date-holidays) + buildPreviewHolidays (spiegelt getFilteredHolidays) + detectPreviewBridgeDays (spiegelt detectBridgeDays). Nutzt toHolidayId/TYPE_FLAGS aus exclude-options (.js-Import wegen root-tsc node16). Von vitest aus src/ testbar
├── src/exclude-options.ts         → PURE Logik: buildExcludeOptions (scope-exakt, dedupe+MM-DD-Sort), computeOrphanIds, enabledTypes (defaultOn = validateConfig), toHolidayId. Drift-Guards: holiday-id-parity, exclude-type-flags-parity, scope-options-bridge-parity
├── src/i18n/<lang>.json           → Karten-Übersetzungen (23 Keys × 11 Sprachen: ph_hc_* + ph_exclude*)
├── package.json                   → Gen-2/Admin-8-Stack: gui-components ^10 + json-config ^9 + React 19 + MUI 9 + Vite 8 + @module-federation/vite 1.19.1 (guiApi:2, kein bundlerType). date-holidays exakt-gepinnt = root-installierte Version (Wächter: date-holidays-version-parity.test.ts)
tasks.js                            → Komponenten-Build (@iobroker/build-tools: clean→npmInstall→buildReact→copyFiles → admin/custom); läuft als Master-Release-Schritt `npm run --if-present build:admin` (W0095-Umbau 2026-09-01: KEIN prepublishOnly mehr; Hand-Publish nur via `publish:manual`) + CI-Job admin-component
scripts/check-date-holidays.mjs     → Release-Gate: date-holidays-Currency (npm-latest) UND pinnt src-admin auf die Runtime-Version (die client-seitige Kaskade muss dieselbe Library sehen wie der Adapter)
../scripts/sync-iopackage-from-i18n.py → regeneriert io-package.json:instanceObjects.common.name aus admin/i18n/ (zentral, source: admin-i18n; läuft seit 2026-08-22 in pre-release.py Schritt 2b, NICHT mehr als before_commit-Hook — .releaseconfig.json enthält kein Python mehr)
```

## Design-Entscheidungen

1. **Schedule-Mode mit `allowInit: true`** — js-controller triggert per Cron (`0 0 * * *`) und einmalig bei Config-Änderung/Start. Adapter berechnet, publiziert, ruft `this.stop?.()` und beendet sich. Kein Daemon, kein Timer, kein Speicherverbrauch zwischen Runs.
2. **date-holidays als einzige Engine** — 206 Länder, offline, stabile API seit 5+ Jahren, ISC-Lizenz (Daten CC-BY-SA-3.0 laut LICENSE-Datei; die package.json-SPDX `(ISC AND CC-BY-3.0)` understatet das ShareAlike — wir geben es korrekt an, ein Auto-SPDX-Check darf das nicht „korrigieren")
3. **Geführte Admin-8-Karte auf einer Seite** (Admin-8-Karten-Umbau) — EINE React-Stufen-Karte (`src-admin/HolidayConfig` + `HolidayPanel`, govee-Muster) statt 2 Tabs + generierter 145-KB-jsonConfig: Land→Bundesland→Region-Kaskade, Typen, Brückentage, Ausschluss + Live-Vorschau der erkannten Feiertage — alles client-seitig aus der gebündelten date-holidays. Die per-Country-Select-Panels + `generate-country-data.ts` entfielen; die Vorschau spiegelt die Runtime-Filterung (Typ/Exclude/Dedupe/Brückentage), verhaltens-parity-getestet gegen die Engine
4. **Individuelle Type-Booleans in native** statt `holidayTypes: string[]` — sauberes jsonConfig-Mapping (5 Checkboxen)
5. **referenceDate-Parameter** in computeHolidays — deterministische Tests ohne Mocking
6. **Brückentag Do→Fr, Di→Mo, plus Mi zwischen Di+Do-Feiertag** — Mi→Wochenende braucht 2 Fehltage (kein Brückentag); ein Mi, der beidseitig von einem Di- und einem Do-Feiertag eingeklemmt ist, wird gebrückt (v0.8.0)
7. **Leere Typ-Auswahl heißt ÜBERALL „keine Feiertage"** — die Runtime filtert mit `holidayTypes.includes(type)`, eine leere Liste wirft also alles weg. Karte (`buildPreviewHolidays`/`buildExcludeOptions`) spiegelt das seit dem Audit 2026-09-04 (vorher galt dort „leer = kein Filter", die Vorschau zeigte ein volles Jahr für eine Konfiguration, die nichts publiziert), und `onReady` warnt einmal pro Lauf. NICHT umgekehrt lösen (leer = alle): das weitete das Verhalten für jeden still auf, der bewusst alles abgewählt hat.
8. **Instanz-Objekt-Reparatur in EINEM Schreibvorgang, danach Abbruch (v0.13.2)** — `repairInstanceObject()` bündelt die daemon→schedule-Migration und das Abschalten eines übriggebliebenen `common.supportedMessages.stopInstance`; jede Änderung am eigenen Instanz-Objekt löst einen Neustart aus, deshalb EIN Patch (ein Neustart, nicht zwei) und danach `stop()` + `return` statt weiterzurechnen. Der Schlüssel wird dabei GELÖSCHT (`supportedMessages: null`), ausgelöst davon, dass er überhaupt existiert — `supportedMessages` ist eine Positivliste: ein zurückgeschriebenes `{stopInstance:false}` lässt ein Objekt stehen und schaltet die Nachrichtenbox still ab, und ein Wächter auf `stopInstance` träfe seinen eigenen geschriebenen Zustand nie wieder. Im selben Schreibvorgang fällt auch das Altfeld `native.excludePublic` (vor 0.9.0). **`stopInstance` darf nie zurück ins Manifest:** der Host killt den Prozess damit 1 s nach der Stopp-Nachricht — mitten in einem Lauf — und dieser Adapter hat gar keinen Nachrichten-Handler, der antworten könnte. Ein Update entfernt den Eintrag NICHT aus dem Instanz-Objekt, daher die Selbstkorrektur. **`onUnload` bleibt bewusst leer:** kein Verbindungs-Marker, kein Timer, kein Gerät — es gibt nichts, worauf vor dem `callback()` gewartet werden müsste; die drei Flotten-Summen (`…Total`/`…Online`/`…AllOnline`) haben hier ebenfalls keinen Gegenstand.

## State Tree

4 Day-Channels × 2 Fields + next × 4 Fields = 12 States total. Day-Channels (today, yesterday, tomorrow, dayAfterTomorrow): name, isHoliday. Next: name, isHoliday, date, daysUntil. (Der Flag-State hieß bis v0.10.0 `boolean` — in v0.11.0 zu `isHoliday` umbenannt, alte `*.boolean` per `cleanupDeprecatedStates` migriert.)

## Tests (282 vitest + 69 package)

Karten-Umbau ergänzte: `scope-options.test.ts` (Kaskade getCountry/State/RegionOptions + buildPreviewHolidays inkl. Brückentage), `scope-options-bridge-parity.test.ts` (Verhaltens-Parity detectPreviewBridgeDays vs. Runtime detectBridgeDays, 5 Länder × 4 Jahre), `date-holidays-version-parity.test.ts` (src-admin-Pin == root-installierte Version). Frühere Guards bleiben: `exclude-options.test.ts`, `exclude-type-flags-parity.test.ts`, `holiday-id-parity.test.ts` (liest `exclude-options.ts`). Der jsonConfig-E5611-Guard entfiel mit der statischen jsonConfig.

Die pure Logik (Kaskade/Vorschau/Exclude/Engine) ist vitest-getestet; die React-Karte wird NICHT unit-getestet (kein @testing-library/react — jede src-admin-devDep landet dauerhaft unter dependabot-`ignore`), sondern über den turnkey Admin-8-`render-check` im echten Wegwerf-Admin verifiziert.
