# CLAUDE.md — ioBroker.public-holidays

> Gemeinsame ioBroker-Wissensbasis: `../CLAUDE.md` (lokal, nicht im Git). Standards dort, Projekt-Spezifisches hier.
> Belege, Messungen und Verlauf jeder Entscheidung: `.claude/dev-history.md` (lokal, gitignored).

## Projekt

**ioBroker Public Holidays** — Offline-Feiertagserkennung für alle Länder der Bibliothek `date-holidays` (die Zahl
bewacht `country-count.test.ts`) mit Brückentagen. Schedule-Mode (`allowInit: true`): rechnet bei Start und
Config-Änderung, js-controller triggert täglich um Mitternacht per Cron, danach `this.stop()`.

- **Version + Changelog:** `io-package.json`; Nutzer-Changelog `README.md` + news (Entwurf in
  `Entwicklung/.cache/news-next/public-holidays.json`, nie `news.NEXT` im Commit).
- **GitHub:** https://github.com/krobipd/ioBroker.public-holidays · **npm:** `iobroker.public-holidays` (Zugang
  2026-05-24; Jey-Cee 0.0.x, krobi ab 0.1.0).
- **Runtime-Deps:** `@iobroker/adapter-core`, `date-holidays` (ISC + CC-BY-SA-3.0). Der deklarierte **Boden** ist das
  Einzige, was eine Installation erreicht; der Release-Lauf hebt date-holidays in Phase C wie jede Abhängigkeit
  (kein Dependabot-Ignore), Wächter `date-holidays-floor.test.ts` + `date-holidays-version-parity.test.ts`, Fix
  beider: `npm run update:date-holidays`.
- **Test-Setup:** vitest unter `src/**/*.test.ts`; mocha nur `test/package.js`, `test/integration.js`,
  `test/inventory.js`. Karten-Suite in `src-admin/` (Flottenform, s. Tests). `npm run test:inventory` BAUT NICHT —
  `npm run build` davor.
- **`@types/node` an `engines.node`-Min gekoppelt** (`^22`).

## Architektur

```
src/main.ts                   → onReady: Einstellungs-Migration → Instanz-Reparatur → Land auflösen → rechnen →
                                Objekte auffrischen → States publizieren → Zusammenfassung → stop()
src/lib/holiday-shared.ts     → EINZIGE Quelle für alles, was Runtime UND Karte gleich sehen müssen: Typen, toHolidayId,
                                beats, Brückentag-Namen, Sprachregel, Tagesliste (buildDayMap: Typfilter → Exclude inkl.
                                Ersatztage → mehrtägige Tage → beats), Brückentage (Wochenende je Land, Auslöser),
                                Datumsformate. IMPORT-FREI (landet in zwei Bündeln); Wächter single-source.test.ts
src/lib/holiday-engine.ts     → date-holidays-Wrapper: Instanz, drei-Jahres-Fenster, Stale-Exclude-Prüfung (teure
                                Länder-Aggregation nur bei fehlendem Scope-Treffer), Scope-Diagnose, today/next
src/lib/country-codes.ts      → Admin-Ländernamen beider Listen → Code, resolveCountryName mit Grund (IMPORT-FREI)
src/lib/config.ts             → rohes native → AdapterConfig
src/lib/state-publisher.ts    → 17 Objekte mit literalen IDs auffrischen (nur bei Abweichung), Altbestand räumen, publizieren
src/lib/native-key-migration.ts (+ .test.ts) → Flotten-Master byte-gleich, nie hier ändern
src/lib/i18n.ts · error-utils.ts · types.ts
src-admin/                    → Admin-8-Karte (Module-Federation-Remote, guiApi 2): HolidayConfig.tsx (ConfigGeneric-Mount,
                                reicht Systemland/-sprache/-datumsformat durch) + HolidayPanel.tsx (Stufen) + scope-options.ts /
                                exclude-options.ts (pure Logik auf holiday-shared)
admin/custom/                 → gebauter Karten-Bau, git-getrackt (`npm run build:admin`)
scripts/check-date-holidays.mjs → Entwickler-Werkzeug `npm run update:date-holidays` (Wurzel + Karten-Pin + Test + Neubau)
```

## Design-Entscheidungen

1. **Schedule-Mode statt Daemon** — ein Lauf je Tag braucht keinen Prozess dazwischen.
2. **date-holidays ist die einzige Engine, offline** — die Daten-Lizenz ist CC-BY-SA-3.0, auch wenn die SPDX-Angabe des Pakets es untertreibt.
3. **Runtime und Karte bauen die Tagesliste mit denselben Funktionen aus `holiday-shared.ts`** — die Vorschau zeigt, was publiziert wird, und kann nicht auseinanderlaufen.
4. **Mehrtägige Feiertage zählen an jedem Tag, an dessen Mittag (Ortszeit) sie noch laufen; der Vorabend zählt nicht** — date-holidays führt sie als EINEN Eintrag mit Dauer.
5. **`next` überspringt die restlichen Tage des heute laufenden Feiertags** — ein Feiertag, der heute läuft, steht in `today`.
6. **Brückentag = einzelner Arbeitstag zwischen zwei freien Tagen, mindestens einer davon ein Feiertag des Saatjahres** — Wochenende je Land (date-holidays-Daten vor CLDR), Auslöser nur ganztägige public/bank.
7. **Ein Exclude trifft seine Ersatztage mit; ein Ersatztag wird nur eindeutig oder über den Namen zugeordnet** — eine falsche Zuordnung risse fremde Tage mit.
8. **Kollision auf einem Datum: Typ-Priorität, dann echter Feiertag vor Ersatztag, dann kleinere ID** — alle drei total, der Name hängt nie an der Lieferreihenfolge.
9. **Leere Typ-Auswahl heißt überall „keine Feiertage"** — nie still „alle".
10. **Landeserkennung kennt beide Admin-Namenslisten und nennt den Grund, wenn sie scheitert** — der Einrichtungsassistent bis Admin 8.0.14 speichert eigene Namen.
11. **Obsolete Einstellungsschlüssel räumt der Flotten-Helfer `migrateNativeKeys` (zuerst), `repairInstanceObject` nur noch `mode` + `supportedMessages` (auf `null`)** — jede Instanz-Schreibung ist ein Neustart, danach `stop()` + return.
12. **`supportedMessages.stopInstance` nie ins Manifest** — der Host tötet sonst den laufenden Durchgang; `onUnload` bleibt leer, es gibt nichts abzuwarten.
13. **Objekt-Refresh schreibt nur name + desc, und nur bei Abweichung** — js-controller wendet das Manifest bei jedem Start an und friert nur `common.name` ein.
14. **Die Karte schreibt mehrere Felder in EINER Ganzschreibung (`handleChangeMany`)** — `ConfigGeneric.onChange` kopiert `props.data` je Aufruf.
15. **Ein beim Öffnen verwaister Wert wird gezeigt, nie automatisch geschrieben** — sonst bewaffnet das bloße Öffnen den Speichern-Knopf.
16. **Die Tage folgen der Host-Uhr; eine abweichende Host-Zeitzone steht nur im Debug-Log** — Rechnen in der Landeszeit wäre bei einem UTC-Container falscher.
17. **Nicht ladbare Mischschreibungs-Gebiete (12, date-holidays-Defekt) werden gewarnt und in der Karte markiert** — die Bibliothek fällt dort still auf das Elterngebiet zurück.

## State Tree

4 Tages-Kanäle × (name, isHoliday) + next × (name, isHoliday, date, daysUntil `unit: d`) = 12 States, 17 Objekte.

## Tests

Zahlen nie hier festhalten — `npx vitest run` (Wurzel), `npm run test:package`, `npm --prefix src-admin run test`
sagen sie; der Stand am 2026-09-25 steht in der dev-history.

- **Wurzel-Suite** (`vitest.config.mts`): Engine, geteilte Logik gegen echte Daten (`holiday-days`,
  `bridge-days-real-data`, `card-parity` = Vorschau gegen Runtime Tag für Tag), Landesnamen beider Admin-Listen
  (`country-resolution`), Orchestrierung über einen Stub mit Datenbank-Semantik (`main.test.ts`: JSON-Merge,
  Kopien, setStateChanged, Schreibzähler), Wächter (`single-source`, `instance-objects-reach`, `country-count`,
  `date-holidays-floor`, `date-holidays-version-parity`).
- **Karten-Suite** (`src-admin/vitest.config.ts`, jsdom, gegen die echte `ConfigGeneric`): `HolidayConfig.test.tsx`
  plus die drei Wurzel-Suiten der Karten-Logik — der Nadel-Harness schickt eine Nadel in `src-admin/src/*.ts` an
  diese Suite. `npm run test:admin` = `check:admin` + Test-Typprüfung + Lint + Suite; braucht `build:admin` davor.
- **Objekt-Inventar** (`test/inventory.js`, Flotten-Vorlage): wartet auf `next.daysUntil > 0`, den Wert, den nur ein
  vollständiger Lauf mit Land schreibt (die Objekte legt js-controller vor `ready` an).
- **Mutationen:** `Ressourcen/iobroker-entwicklung/mutation-testing/mutations_publicholidays.py` ist seit 0.18.0
  HANDGEPFLEGT (der Plan ist veraltet, nie `build_mutations.py`).
- **`format:check`** klammert `admin/custom/**` aus (erzeugter Bau), keine `.prettierignore` (W0084/W5048).
