# Public Holidays

Public Holidays turns the calendar into data points: whether today is a holiday, what it is called,
what is coming next and how many days away it is. Everything is calculated **offline** on your own
system — there is no account, no API key and no internet connection involved.

## How it works

The adapter runs in **schedule mode**. It calculates once when it is started or when you save the
settings, and after that once a day at midnight, triggered by the ioBroker controller. Each run
writes its results and the process ends again — it does not stay in memory between runs.

The holiday data comes from the `date-holidays` library, which is shipped with the adapter and
covers 207 countries including their states, provinces and regions.

## Setup

1. Install the adapter from the ioBroker repository (stable or latest) and create an instance.
   Installing from a GitHub URL is not supported.
2. Open the instance settings. All settings live on one guided card, worked through from top to
   bottom.
3. Save. The adapter calculates immediately and writes its data points.

### Location

Pick your country. States/provinces and regions only appear for countries that have them — for
example Germany has states, Italy has numeric province codes.

If you leave the country empty, the adapter takes the country from your **ioBroker system settings**
(System settings → Main settings → Country). Both lists ioBroker stores a country from are
recognised — the system settings and the first-run wizard (up to Admin 8.0.14 the wizard spells
names differently, e.g. "Vietnam" instead of "Viet Nam") — and the card previews the detected
country. When that country has no holiday data (e.g. Qatar) or stands for several countries
("Serbia and Montenegro", "Netherlands Antilles"), the log says so and the adapter publishes an
empty result until you pick a country. Seven countries of the holiday data have no name in
ioBroker's list at all — Saint Barthélemy, Caribbean Netherlands, Curaçao, the Canary Islands,
Saint Martin, South Sudan and Sint Maarten: choose them on the card.

### Holiday types

Five types can be enabled independently:

| Type       | Meaning                                                                              |
| ---------- | ------------------------------------------------------------------------------------ |
| Public     | Statutory public holidays. Enabled by default.                                       |
| Bank       | Days on which banks and public offices are closed but which are not public holidays. |
| School     | School holidays.                                                                     |
| Optional   | Days that are a holiday only for parts of the population.                            |
| Observance | Commemorative days that are not days off — e.g. Mother's Day.                        |

If two holidays fall on the same day, three rules decide which name is reported, in this order:

1. the higher-ranking type wins, in the order of the table above,
2. a holiday that genuinely belongs on that day beats one that was only moved there off a weekend,
3. and if that still ties, a fixed internal ordering decides.

All three are unambiguous, so the name stays the same across data updates. Until version 0.15.1 a
tie was settled by whichever holiday the data happened to list first, which could change silently
with a data update — in 42 countries, among them Norway, Poland, Romania, Serbia and Taiwan.

> If you switch **all** types off, the adapter reports no holidays at all — the settings card and
> the log both say so.

### Holidays that last several days

Some holidays last several days — the New Year holidays in Russia, Chuseok in Korea, Tết in
Vietnam, Eid in many countries. Every one of those days counts: `today.isHoliday` is true on each of
them. `next` shows the next holiday after the one running today, not the second day of the same
holiday. A holiday that begins on the evening before (Jewish and Islamic days begin at dusk) counts
from its first full day.

### Bridge days

A bridge day is a single working day squeezed between two days off, at least one of them a holiday
— taking it off bridges the gap to the weekend or to the next holiday. With the option enabled the
adapter adds them as holidays in their own right, named "Bridge day" in your ioBroker system
language. With a Saturday + Sunday weekend:

- a holiday on **Thursday** → the **Friday** becomes a bridge day,
- a holiday on **Tuesday** → the **Monday** becomes a bridge day,
- a weekday framed by two holidays becomes a bridge day — a Wednesday between Tuesday and
  Thursday, a Tuesday between Monday and Wednesday (e.g. 2 May in Poland).

The weekend is your country's own: where it falls on Friday and Saturday (Israel, Saudi Arabia,
Egypt, Bangladesh …) a Wednesday holiday bridges the Thursday, and a Friday is never a bridge day.
Only public and bank holidays that last the whole day start a bridge day — observances, school and
optional holidays and part-day entries such as Christmas Eve from 14:00 do not. A Wednesday holiday
alone creates none with a Saturday + Sunday weekend: reaching the weekend would need two days off. A
bridge day never overwrites a real holiday, and it never creates further bridge days; a day that
carries only a holiday of a type you switched off counts as a working day.

### Excluded holidays

Some holidays are irrelevant for a given household — you can exclude individual entries. The list
offers exactly the holidays of your selected location and enabled types, so what you can exclude is
what the adapter would otherwise report.

Excluding a holiday also excludes its substitute days — the day a holiday is moved to when it falls
on a weekend (Boxing Day to the Monday, for example); the list therefore offers the holiday only. An
exclusion of a holiday type you switched off is kept and shown apart: it acts again as soon as the
type is back on.

An exclusion is stored by an internal id derived from the holiday's calculation rule. If a later
data update renames or removes that rule — or a one-off date has passed — the exclusion no longer
matches anything: the adapter then writes a warning naming the stale entry, and the settings card
shows it as a removable chip under the selection list.

Exclusions are applied **before** bridge days are worked out, so excluding a Thursday holiday also
removes the Friday bridge day that came with it.

### Detected holidays

The bottom of the card previews the holidays the adapter will detect for the current year with your
current settings — including bridge days and minus your exclusions. It is built by the same functions
the adapter uses and names holidays in the ioBroker system language like the data points, so what
you see is what you get. With no country chosen it shows the detected system country.

## Data points

| Data point                                             | Type             | Meaning                                                                        |
| ------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------ |
| `today.name`                                           | string           | Name of today's holiday, empty on a normal day                                 |
| `today.isHoliday`                                      | boolean          | Whether today is a holiday                                                     |
| `yesterday.name` / `yesterday.isHoliday`               | string / boolean | Same for yesterday                                                             |
| `tomorrow.name` / `tomorrow.isHoliday`                 | string / boolean | Same for tomorrow                                                              |
| `dayAfterTomorrow.name` / `dayAfterTomorrow.isHoliday` | string / boolean | Same for the day after tomorrow                                                |
| `next.name`                                            | string           | Name of the next upcoming holiday                                              |
| `next.isHoliday`                                       | boolean          | Whether an upcoming holiday was found at all                                   |
| `next.date`                                            | string           | Its date as `YYYY-MM-DD` — machine-readable, unaffected by your display format |
| `next.daysUntil`                                       | number           | Days until that holiday                                                        |

All data points are read-only, and each one carries a short explanation in your language that you
can read in the object tree. `next` looks strictly ahead: a holiday that is today appears in
`today`, not in `next` — and so do the remaining days of a holiday that is running today.

The names of the channels and data points follow your ioBroker system language and are refreshed on
every run — including on installations that were updated rather than newly installed. If you rename
one of these data points by hand, the adapter will overwrite it again.

## Language

Holiday names are shown in your ioBroker system language when the holiday data provides that
language, otherwise in English — on the data points and in the card's preview alike. Eleven
languages are supported: German, English, Spanish, French, Italian, Dutch, Polish, Portuguese,
Russian, Ukrainian and Chinese. Country names in the card follow the language of the admin page.

## Troubleshooting

**No holidays are reported at all.**
Check the log. "No country configured" means neither the adapter nor the ioBroker system settings
provide a country. "System country '…' has no holiday data" / "… covers several countries" / "… is
not recognized" names the system country the adapter could not use — pick a country on the card.
"No holiday type is enabled" means every type checkbox is off.

**The state or region I configured seems to be ignored.**
An unknown state or region silently falls back to the broader level. The adapter detects this and
warns: "State 'XX' is unknown for YY — using country-level holidays". Pick the entry from the
dropdown rather than typing it. If a data update removed the entry you had stored, the settings
card points it out above the dropdown and leaves your configuration untouched until you pick a new
one. Twelve areas cannot be loaded by the holiday library at all (a known defect — ten islands of the
Cook Islands, Timaru and Buller in New Zealand): the adapter uses the broader area's holidays and
says so in the log and on the card.

**The day changes a few hours early or late.**
The days follow the clock of the ioBroker host. A Docker container without a time zone runs on UTC
— set `TZ` for the container. With debug logging the adapter names a host time zone that is not one
of the country's.

**On the day daylight saving time starts, the values stay on the previous day.**
In a few time zones the clock skips midnight when daylight saving time starts (Chile, Cuba, Egypt,
Lebanon, the Azores). The midnight run does not happen that day; the values of the previous day stay
until the next run.

**A holiday is missing or appears unexpectedly.**
Enable the matching holiday type — some days count as observances rather than public holidays, and
this can change with a data update. Also check your exclusion list.

**An exclusion stopped working after an update.**
The holiday's calculation rule was renamed in the data. The adapter warns about stale exclusions on
every run; remove the chip in the settings and pick the holiday again.

**The log shows `Connection is closed.` around midnight.**
This comes from the ioBroker controller shutting the adapter down, not from the adapter itself. It
is harmless; the run has already written its data points at that point.

## Privacy

The holidays are calculated offline on your own system — the adapter makes no network request for
them.

Error reporting via Sentry is active by default; what it sends and how to switch it off is described in the [Sentry section of the main README](../../README.md#sentry--error-reporting).
