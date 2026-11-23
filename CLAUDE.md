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
  (kein Dependabot-Ignore), Wächter `date-holidays-currency.test.ts` (Boden + Karten-Pin), Fix:
  `npm run update:date-holidays`.
- **Test-Setup:** vitest unter `src/**/*.test.ts`; mocha nur `test/package.js`, `test/integration.js`,
  `test/inventory.js`. Karten-Suite in `src-admin/` (Flottenform, s. Tests). Gemeinsame Testhilfe `test/helpers.ts`
  (nicht unter `src/` — dort zählte sie als Produktivcode). `npm run test:inventory` BAUT NICHT — `npm run build` davor.
- **`@types/node` an `engines.node`-Min gekoppelt** (`^22`).

## Architektur

```
src/main.ts                   → onReady: Übersetzungen → Einstellungs-Migration (die Schlüssel von 0.20.x als erster
                                Kalender) → Instanz-Reparatur → eigenen Baum lesen (KnownObjects) → Kalenderliste lesen →
                                Ordner abgleichen → je Kalender rechnen, Ordner auffrischen, States publizieren → EINE
                                Zusammenfassung → stop(); nur Ablauf, die Texte liefert run-messages
src/lib/holiday-shared.ts     → EINZIGE Quelle für alles, was Runtime UND Karte gleich sehen müssen: native-Leser (Trim),
                                Typen, Scope-Code-Regeln (sameCode, isLoadableScopeKey), toHolidayId, beats, Brückentag-
                                Namen, Sprachregel, Tagesliste über das Drei-Jahres-Fenster (buildScopeDays → buildDayMap →
                                addBridgeDays), Kalenderschlüssel, Datumsformate, Kalenderliste (Leser, Kennungs-Slug,
                                Standard-Kennung und -Name). IMPORT-FREI (landet in zwei Bündeln); Wächter single-source.test.ts
src/lib/calendars.ts          → die Einstellungen von 0.20.x als erster Kalender, Kalender-Scope, Ordnername, gültige
                                Kalender (ungültige oder doppelte Kennung → übersprungen und gewarnt)
src/lib/calendar-tree.ts      → Kalenderordner (folder mit native.uid) gegen die Liste: Ordner ohne Kalender → Flotten-
                                Löschung; Ordner mit neuer Kennung und der 0.20.x-Baum an der Wurzel bleiben bis zum
                                Flotten-Umzugs-Master liegen
src/lib/holiday-engine.ts     → date-holidays-Wrapper: Instanz, Ergebnis today/next, Stale-Exclude-Prüfung (teure
                                Länder-Aggregation nur bei fehlendem Scope-Treffer), Scope-Diagnose, Debug-Liste
src/lib/run-messages.ts       → alle Logtexte eines Laufs als reine Funktionen (Systemland, Scope, Zeitzone, Zusammenfassung)
src/lib/country-codes.ts      → Admin-Ländernamen beider Listen → Code, resolveCountryName mit Grund (IMPORT-FREI)
src/lib/country.ts            → resolveCountry gegen die installierten date-holidays-Daten
src/lib/config.ts             → rohes native → AdapterConfig
src/lib/system-config.ts      → system.config (Land, Sprache, Datumsformat) mit Rückfall und Warnung
src/lib/state-publisher.ts    → je Kalender Ordner + 17 Objekte (Tabelle CALENDAR_OBJECTS) schreiben, nur wenn der gelesene
                                Baum sie nicht schon trägt; Altbestand räumen; 12 States je Kalender gegen EIN Sammel-Lesen
                                vergleichen und nur Änderungen schreiben
src/lib/err-text.ts · known-objects.ts · native-key-migration.ts · object-removal.ts · enum-carry.ts (+ Tests)
                              → Flotten-Master byte-gleich, nie hier ändern
src/lib/log-text.ts           → oneLine / errLine (Fehlertext auf einer Logzeile)
src/lib/i18n.ts · types.ts
src-admin/                    → Admin-8-Karte (Module-Federation-Remote, guiApi 2), zwei Mounts: CalendarsConfig.tsx
                                (ConfigGeneric-Mount der Liste, EINE Ganzschreibung, eine leere oder doppelte Kennung
                                einer handbearbeiteten Liste sperrt Speichern) + TreeChanges.tsx (roter Kasten über
                                Speichern: was umzieht, was gelöscht wird); CalendarList.tsx (Akkordeon je Kalender:
                                Name, Ordner nur zum Lesen, Umzugshinweis, „Kennung neu bilden“, Knöpfe) +
                                calendar-list.ts (pure Listenlogik, treeChanges wie der Lauf) + HolidayPanel.tsx (die Karte
                                eines Kalenders) + Tiers.tsx (die fünf Stufen) + scope-options.ts / exclude-options.ts (pure
                                Logik auf holiday-shared) + scoped-holidays.ts (eine Gebiets-Konstruktion)
admin/custom/                 → gebauter Karten-Bau, git-getrackt (`npm run build:admin`)
scripts/check-date-holidays.mjs → Entwickler-Werkzeug `npm run update:date-holidays` (Wurzel + Karten-Pin + Test + Neubau)
```

## Design-Entscheidungen

1. **Schedule-Mode statt Daemon** — ein Lauf je Tag braucht keinen Prozess dazwischen.
2. **date-holidays ist die einzige Engine, offline** — die Daten-Lizenz ist CC-BY-SA-3.0, auch wenn die SPDX-Angabe des Pakets es untertreibt.
3. **Runtime und Karte lesen die Einstellungen und bauen die Tagesliste mit denselben Funktionen aus `holiday-shared.ts` (`buildScopeDays`, Leser, Scope-Code-Regeln)** — die Vorschau zeigt, was publiziert wird, und kann nicht auseinanderlaufen.
4. **Mehrtägige Feiertage zählen an jedem Tag, an dessen Mittag (Ortszeit) sie noch laufen; der Vorabend zählt nicht** — date-holidays führt sie als EINEN Eintrag mit Dauer.
5. **`next` zeigt den nächsten Feiertagstag nach heute; läuft ein mehrtägiger Feiertag, ist das sein nächster Tag (Tag 2, Tag 3 …), nichts wird übersprungen** — krobi 2026-10-02 (Register K5); der heutige Tag selbst steht in `today`.
6. **Brückentag = einzelner Arbeitstag zwischen zwei freien Tagen, mindestens einer davon ein Feiertag des Saatjahres** — Wochenende je Land (date-holidays-Daten vor CLDR), Auslöser nur ganztägige public/bank.
7. **Ein Exclude trifft seine Ersatztage mit; ein Ersatztag wird nur eindeutig oder über den Namen zugeordnet** — eine falsche Zuordnung risse fremde Tage mit.
8. **Kollision auf einem Datum: Typ-Priorität, dann echter Feiertag vor Ersatztag, dann kleinere ID** — alle drei total, der Name hängt nie an der Lieferreihenfolge.
9. **Leere Typ-Auswahl heißt überall „keine Feiertage"** — nie still „alle".
10. **Landeserkennung kennt beide Admin-Namenslisten und nennt den Grund, wenn sie scheitert** — der Einrichtungsassistent bis Admin 8.0.14 speichert eigene Namen.
11. **`I18n.init` zuerst, dann räumt der Flotten-Helfer `migrateNativeKeys` obsolete Einstellungsschlüssel, `repairInstanceObject` nur noch `mode` + `supportedMessages` (auf `null`)** — jede Instanz-Schreibung ist ein Neustart, danach `stop()` + return.
12. **`supportedMessages.stopInstance` nie ins Manifest** — der Host tötet sonst den laufenden Durchgang; `onUnload` bleibt leer, es gibt nichts abzuwarten.
13. **Die Objekte jedes Kalenderordners schreibt der Lauf selbst (Manifest ohne `instanceObjects`), und nur wenn der einmal gelesene Baum (`KnownObjects`) sie nicht schon trägt** — die Ordner hängen an den Einstellungen.
14. **Die Karte schreibt die ganze Kalenderliste in EINER Ganzschreibung (`writeList`)** — `ConfigGeneric.onChange` kopiert `props.data` je Aufruf.
15. **Ein beim Öffnen verwaister Wert wird gezeigt, nie automatisch geschrieben** — sonst bewaffnet das bloße Öffnen den Speichern-Knopf.
16. **Die Tage folgen der Host-Uhr; eine abweichende Host-Zeitzone steht nur im Debug-Log** — Rechnen in der Landeszeit wäre bei einem UTC-Container falscher.
17. **Nicht ladbare Mischschreibungs-Gebiete (12, date-holidays-Defekt) werden gewarnt und in der Karte markiert** — die Bibliothek fällt dort still auf das Elterngebiet zurück.
18. **Neue Instanzen starten deaktiviert (`common.enabled: false`)** — Paket-Check `instance-enabled`; bestehende Instanzen behalten ihre Einstellung.
19. **Die zwölf States je Kalender sind schreibgeschützt und werden im Speicher gegen EIN Sammel-Lesen verglichen** — `setStateChangedAsync` liest jeden State einzeln (Ressourcen-Prüfung des Inventars).
20. **Mehrere Kalender je Instanz, auch mehrere desselben Landes; jeder rechnet für sich und schreibt in seinen Ordner `<Kennung>`, die uid in `native` bindet Ordner und Kalender** — krobi 2026-11-20 22:43 (Konzept abgenommen), Bau 22:59.
21. **Die Kennung bildet immer der Adapter aus Standort und Arten (`<land|system>[-<gebiet>][-<region>]-<arten>`, ein reiner Zahlen-Code wird zum Gebietsnamen, Gleichstand `-2`) und nur, wenn sich Land, Bundesland, Region oder Arten ändern; der Name ist frei, leer heißt automatisch: nur Land · Bundesland · Region** — Konzept 22:43, Karte krobi 2026-11-21 02:32–02:47.
22. **Ein Ordner ohne Kalender geht über die Flotten-Löschung mit den zwei Löschoptionen; ein Ordner mit neuer Kennung und der Baum von 0.20.x an der Wurzel ziehen nur mit dem Flotten-Umzugs-Master um, nie mit eigenem Code** — Werkbank Antwort 99eb2a0a9bce, krobi 23:08.
23. **Die Einstellungen von 0.20.x werden beim ersten Start zum ersten Kalender (`migrateNativeKeys`, eine Schreibung, Neustart); das Update warnt per `common.messages`** — krobi 22:5x „aktuelle datenbäume werde beim update auf ihre settings umgezogen dazu gibs dann auch eine warnung beim update“.
24. **Eine unlesbare Kalenderliste ändert nichts am Baum (Warnung, `stop()`), eine ungültige oder doppelte Kennung überspringt nur ihren Kalender** — sonst löschte ein kaputter Eintrag fremde Ordner.

<!-- core-decisions:begin (generated from the sealed register — change only through the Werkbank) -->

## Core decisions (sealed)

krobi's decisions for this adapter. The register with his verbatim words lives in the locked Werkbank tool tree; a change is a request to the Werkbank, never an edit here. Each guarded rule has a test under `src/decisions/`.

- **P-01** Every release checks date-holidays and always ships its newest version, so that an existing installation gets it too.
- **P-02** Every datapoint is always there; no setting creates or omits single datapoints.
- **P-03** The log line names the next holiday's date in the system's date format; the datapoint `next.date` stays machine-readable (ISO).
- **P-04** Every run writes one summary with the next holiday to the log, at level info.
- **P-05** public-holidays is a purely offline holiday adapter (date-holidays) with no online calendar, school holidays or ICS subscriptions; it connects nowhere and therefore has no connection datapoint.
- **K1** One run a day (schedule mode), no long-running process.
- **K2** date-holidays is the only data source, offline.
- **K3** The admin card and the adapter compute with the same functions; the preview shows exactly what is published.
- **K4** A holiday counts on every calendar day it covers, even when it starts in the afternoon; a multi-day holiday counts on each of its days; a start on the evening before does not make that day a holiday.
- **K5** `next` shows the next holiday day; while a multi-day holiday runs, that is its next day too (day 2, day 3, …), nothing is skipped.
- **K6** A bridge day is a single working day between two days off, at least one of them a holiday; the weekend follows the country.
- **K7** An excluded holiday takes its substitute days with it; a substitute is matched only when unambiguous or by name.
- **K8** When two holidays fall on one date, the type rank decides, then a real holiday before a substitute day, then the id.
- **K9** No holiday type selected means no holidays, never silently all.
- **K10** Country detection knows both admin name lists and names the reason when it fails.
- **K11** Start order: translations, cleanup of old settings, instance repair; every repair means a restart.
- **K14** The card writes several fields in one write.
- **K15** A value orphaned on opening is shown, never saved automatically.
- **K16** The days follow the server clock; a different time zone shows only in the debug log.
- **K17** The twelve areas date-holidays cannot load are warned about and marked in the card.

<!-- core-decisions:end -->

## State Tree

Je Kalender ein Ordner `<Kennung>` (`folder`, Name = Kalendername, `native.uid`) mit 4 Tages-Kanälen × (name, isHoliday)
und next × (name, isHoliday, date, daysUntil `unit: d`) = 12 States, 17 Objekte. Das Manifest trägt keine `instanceObjects`.

## Tests

Zahlen nie hier festhalten — `npx vitest run` (Wurzel), `npm run test:package`, `npm --prefix src-admin run test`
sagen sie; der Stand steht in der dev-history.

- **Wurzel-Suite** (`vitest.config.mts`, Flotten-Master): Engine, geteilte Logik gegen echte Daten (`holiday-days`,
  `bridge-days-real-data`, `holiday-shared`), Logtexte (`run-messages`), Landesnamen beider Admin-Listen
  (`country-resolution`), Orchestrierung über einen Stub mit Datenbank-Semantik (`main.test.ts`: die Tests lösen
  `ready`/`unload` über die registrierten Handler aus; JSON-Merge, Kopien, Schreibzähler), Wächter (`single-source`,
  `instance-objects-reach`, `country-count`, `date-holidays-currency`).
- **Karten-Suite** (`src-admin/vitest.config.ts`, Flotten-Master, jsdom, gegen die echte `ConfigGeneric`):
  `CalendarsConfig.test.tsx` (Liste, Ordneranzeige, „Kennung neu bilden“, Umzugs- und Löschhinweise) plus die
  Logik-Tests der Karte (`calendar-list`, `scope-options`, `exclude-options`, `card-parity` = Vorschau gegen
  Runtime Tag für Tag) — sie liegen neben der Karte, der Nadel-Harness schickt Karten-Nadeln an
  diese Suite. `npm run test:admin` = `check:admin` (typprüft die Tests mit) + Lint + Suite; braucht `build:admin` davor.
- **Objekt-Inventar** (`test/inventory.js`, Flotten-Vorlage): ein Kalender DE/BY (`de-by-public`); `waitForAdapterWork`
  wartet auf `de-by-public.next.daysUntil > 0`, den Wert, den nur ein vollständiger Lauf mit Land schreibt; `MOVES`
  nennt den Umzug der zwölf States.
- **Mutationen:** `Ressourcen/iobroker-entwicklung/mutation-testing/mutations_publicholidays.py` ist HANDGEPFLEGT
  (der Plan ist veraltet, nie `build_mutations.py`); Nadeln auf Flotten-Mastern liegen in `mutations_tooling.py`.
- **`format:check`** klammert `admin/custom/**` aus (erzeugter Bau), keine `.prettierignore` (W0084/W5048).
