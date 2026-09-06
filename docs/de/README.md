# Feiertage

Public Holidays macht aus dem Kalender Datenpunkte: ob heute ein Feiertag ist, wie er heißt, welcher
als Nächstes kommt und in wie vielen Tagen. Alles wird **offline** auf dem eigenen System berechnet —
ohne Konto, ohne API-Schlüssel, ohne Internetverbindung.

## Wie der Adapter arbeitet

Der Adapter läuft im **Zeitplan-Betrieb**. Er rechnet einmal beim Start und beim Speichern der
Einstellungen, danach täglich um Mitternacht, ausgelöst vom ioBroker-Controller. Jeder Durchgang
schreibt sein Ergebnis, danach endet der Prozess wieder — zwischen zwei Durchgängen belegt der
Adapter keinen Speicher.

Die Feiertagsdaten stammen aus der mitgelieferten Bibliothek `date-holidays`, die 206 Länder samt
Bundesländern, Kantonen, Provinzen und Regionen abdeckt.

## Einrichtung

1. Adapter aus dem ioBroker-Repository (stable oder latest) installieren und eine Instanz anlegen.
   Eine Installation über eine GitHub-Adresse wird nicht unterstützt.
2. Die Instanz-Einstellungen öffnen. Alle Einstellungen liegen auf einer geführten Karte, die von
   oben nach unten durchgearbeitet wird.
3. Speichern. Der Adapter rechnet sofort und schreibt seine Datenpunkte.

### Standort

Land auswählen. Bundesland und Region erscheinen nur bei Ländern, die sie haben — Deutschland hat
zum Beispiel Bundesländer, Italien numerische Provinzcodes.

Bleibt das Land leer, übernimmt der Adapter das Land aus den **ioBroker-Systemeinstellungen**
(Systemeinstellungen → Basiseinstellungen → Land) und schreibt eine Logzeile, welches Land er
verwendet hat. Lässt sich dieses Land nicht zuordnen, meldet der Adapter „No country configured" und
hält an.

### Feiertagstypen

Fünf Typen lassen sich unabhängig voneinander aktivieren:

| Typ | Bedeutung |
| --- | --- |
| Gesetzliche Feiertage | Die staatlich festgelegten Feiertage. Standardmäßig aktiv. |
| Bankfeiertage | Tage, an denen Banken und Ämter schließen, die aber keine gesetzlichen Feiertage sind. |
| Schulferien | Ferientage der Schulen. |
| Optionale Feiertage | Tage, die nur für einen Teil der Bevölkerung frei sind. |
| Gedenktage | Gedenk- und Aktionstage ohne arbeitsfreie Wirkung — z. B. Muttertag. |

Fallen zwei Feiertage auf denselben Tag, entscheiden drei Regeln in dieser Reihenfolge, welcher
Name gemeldet wird:

1. der höherrangige Typ gewinnt, in der Reihenfolge der Tabelle,
2. ein Feiertag, der wirklich auf diesen Tag gehört, schlägt einen, der nur vom Wochenende hierher
   verschoben wurde,
3. und bleibt es dann noch gleich, entscheidet eine feste interne Reihenfolge.

Alle drei sind eindeutig, der Name bleibt über Datenaktualisierungen hinweg also derselbe. Bis
Version 0.15.1 gewann bei Gleichstand schlicht der zuerst gelieferte Eintrag, was sich mit einer
Datenaktualisierung still ändern konnte — in 42 Ländern, darunter Norwegen, Polen, Rumänien,
Serbien und Taiwan.

> Sind **alle** Typen abgeschaltet, meldet der Adapter überhaupt keine Feiertage — die Karte und das
> Log sagen das ausdrücklich.

### Brückentage

Ein Brückentag ist ein Arbeitstag, der zwischen einem Feiertag und dem Wochenende eingeklemmt ist.
Mit aktivierter Option nimmt der Adapter ihn als eigenen Feiertag auf, benannt als „Brückentag" in
der eingestellten Sprache:

- Feiertag am **Donnerstag** → der **Freitag** wird Brückentag,
- Feiertag am **Dienstag** → der **Montag** wird Brückentag,
- ein **Mittwoch**, der von einem Feiertag am Dienstag *und* am Donnerstag eingerahmt ist, wird
  Brückentag.

Ein einzelner Mittwochs-Feiertag erzeugt keinen: bis zum Wochenende wären zwei Fehltage nötig. Ein
Brückentag überschreibt nie einen echten Feiertag und erzeugt nie weitere Brückentage.

### Ausgeschlossene Feiertage

Manche Feiertage sind für den eigenen Haushalt ohne Bedeutung — einzelne Einträge lassen sich
ausschließen. Die Auswahlliste bietet genau die Feiertage des gewählten Standorts und der
aktivierten Typen an, also das, was der Adapter sonst melden würde.

Ein Ausschluss wird über eine interne Kennung gespeichert, die aus der Berechnungsregel des
Feiertags stammt. Wird diese Regel durch ein späteres Datenupdate umbenannt oder entfernt, trifft
der Ausschluss ins Leere — der Adapter schreibt dann eine Warnung mit dem betroffenen Eintrag, und
die Karte zeigt ihn als entfernbaren Chip unter der Auswahlliste.

Ausschlüsse greifen **vor** der Brückentagsberechnung: Wer einen Donnerstags-Feiertag ausschließt,
verliert damit auch den zugehörigen Freitags-Brückentag.

### Erkannte Feiertage

Unten auf der Karte steht eine Vorschau der Feiertage, die der Adapter mit den aktuellen
Einstellungen für dieses Jahr erkennt — inklusive Brückentage und abzüglich der Ausschlüsse. Sie
rechnet genauso wie der Adapter selbst, die Vorschau zeigt also den echten späteren Stand.

## Datenpunkte

| Datenpunkt | Typ | Bedeutung |
| --- | --- | --- |
| `today.name` | string | Name des heutigen Feiertags, an normalen Tagen leer |
| `today.isHoliday` | boolean | Ob heute ein Feiertag ist |
| `yesterday.name` / `yesterday.isHoliday` | string / boolean | Dasselbe für gestern |
| `tomorrow.name` / `tomorrow.isHoliday` | string / boolean | Dasselbe für morgen |
| `dayAfterTomorrow.name` / `dayAfterTomorrow.isHoliday` | string / boolean | Dasselbe für übermorgen |
| `next.name` | string | Name des nächsten kommenden Feiertags |
| `next.isHoliday` | boolean | Ob überhaupt ein kommender Feiertag gefunden wurde |
| `next.date` | string | Dessen Datum als `YYYY-MM-DD` — maschinenlesbar, unabhängig vom Anzeigeformat |
| `next.daysUntil` | number | Tage bis zu diesem Feiertag |

Alle Datenpunkte sind nur lesbar und tragen im Objektbaum eine kurze Erklärung in der eingestellten
Sprache. `next` schaut strikt nach vorn: Ein Feiertag, der heute ist, steht in `today`, nicht in
`next`.

Die Namen der Kanäle und Datenpunkte folgen der ioBroker-Systemsprache und werden bei jedem
Durchgang aufgefrischt — auch auf Anlagen, die aktualisiert statt neu installiert wurden. Ein von
Hand vergebener eigener Name wird dabei wieder überschrieben.

## Sprache

Feiertagsnamen erscheinen in der ioBroker-Systemsprache, sofern die Feiertagsdaten diese Sprache
führen, sonst auf Englisch. Unterstützt sind elf Sprachen: Deutsch, Englisch, Spanisch,
Französisch, Italienisch, Niederländisch, Polnisch, Portugiesisch, Russisch, Ukrainisch und
Chinesisch.

## Fehlersuche

**Es werden überhaupt keine Feiertage gemeldet.**
Ins Log sehen. „No country configured" heißt, dass weder der Adapter noch die
ioBroker-Systemeinstellungen ein verwertbares Land liefern. „No holiday type is enabled" heißt, dass
alle Typ-Häkchen aus sind.

**Das eingestellte Bundesland oder die Region wird scheinbar ignoriert.**
Ein unbekanntes Bundesland oder eine unbekannte Region fällt still auf die gröbere Ebene zurück. Der
Adapter erkennt das und warnt: „State 'XX' is unknown for YY — using country-level holidays". Den
Eintrag aus der Auswahlliste wählen, statt ihn einzutippen. Ist der gespeicherte Eintrag durch eine
Datenaktualisierung weggefallen, weist die Karte oberhalb der Auswahlliste darauf hin und lässt die
Konfiguration unangetastet, bis ein neuer Eintrag gewählt wird.

**Ein Feiertag fehlt oder taucht unerwartet auf.**
Den passenden Feiertagstyp aktivieren — manche Tage zählen als Gedenktag statt als gesetzlicher
Feiertag, und das kann sich mit einem Datenupdate ändern. Ebenso die Ausschlussliste prüfen.

**Ein Ausschluss wirkt nach einem Update nicht mehr.**
Die Berechnungsregel des Feiertags wurde in den Daten umbenannt. Der Adapter warnt bei jedem
Durchgang vor veralteten Ausschlüssen; den Chip in den Einstellungen entfernen und den Feiertag neu
auswählen.

**Im Log steht um Mitternacht `Connection is closed.`**
Das kommt vom ioBroker-Controller beim Herunterfahren des Adapters, nicht vom Adapter selbst. Es ist
folgenlos — der Durchgang hat seine Datenpunkte zu diesem Zeitpunkt bereits geschrieben.

## Datenschutz

Der Adapter arbeitet vollständig offline, es verlassen keine Daten das System. Die optionale
Fehlerberichterstattung über Sentry lässt sich in den ioBroker-Einstellungen abschalten — siehe die
in der Haupt-README verlinkte Dokumentation des Sentry-Plugins.
