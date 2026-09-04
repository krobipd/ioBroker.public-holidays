# Public Holidays

Public Holidays turns the calendar into data points: whether today is a holiday, what it is called,
what is coming next and how many days away it is. Everything is calculated **offline** on your own
system — there is no account, no API key and no internet connection involved.

## How it works

The adapter runs in **schedule mode**. It calculates once when it is started or when you save the
settings, and after that once a day at midnight, triggered by the ioBroker controller. Each run
writes its results and the process ends again — it does not stay in memory between runs.

The holiday data comes from the `date-holidays` library, which is shipped with the adapter and
covers 206 countries including their states, provinces and regions.

## Setup

1. Install the adapter and create an instance.
2. Open the instance settings. All settings live on one guided card, worked through from top to
   bottom.
3. Save. The adapter calculates immediately and writes its data points.

### Location

Pick your country. States/provinces and regions only appear for countries that have them — for
example Germany has states, Italy has numeric province codes.

If you leave the country empty, the adapter takes the country from your **ioBroker system settings**
(System settings → Main settings → Country) and writes a line to the log saying which country it
used. If that country cannot be matched, the adapter says "No country configured" and stops.

### Holiday types

Five types can be enabled independently:

| Type | Meaning |
| --- | --- |
| Public | Statutory public holidays. Enabled by default. |
| Bank | Days on which banks and public offices are closed but which are not public holidays. |
| School | School holidays. |
| Optional | Days that are a holiday only for parts of the population. |
| Observance | Commemorative days that are not days off — e.g. Mother's Day. |

If a day is covered by several enabled types, the highest-ranking one wins, in the order of the
table above. This keeps the reported name stable instead of depending on the order the data
happens to arrive in.

> If you switch **all** types off, the adapter reports no holidays at all — the settings card and
> the log both say so.

### Bridge days

A bridge day is a working day squeezed between a holiday and the weekend. With the option enabled
the adapter adds them as holidays in their own right, named "Bridge day" in your language:

- a holiday on **Thursday** → the **Friday** becomes a bridge day,
- a holiday on **Tuesday** → the **Monday** becomes a bridge day,
- a **Wednesday** framed by a holiday on Tuesday *and* Thursday becomes a bridge day.

A Wednesday holiday alone creates none: reaching the weekend from there would need two days off.
A bridge day never overwrites a real holiday, and it never creates further bridge days.

### Excluded holidays

Some holidays are irrelevant for a given household — you can exclude individual entries. The list
offers exactly the holidays of your selected location and enabled types, so what you can exclude is
what the adapter would otherwise report.

An exclusion is stored by an internal id derived from the holiday's calculation rule. If a later
data update renames or removes that rule, the exclusion no longer matches anything — the adapter
then writes a warning naming the stale entry, and the settings card shows it as a removable chip
under the selection list.

Exclusions are applied **before** bridge days are worked out, so excluding a Thursday holiday also
removes the Friday bridge day that came with it.

### Detected holidays

The bottom of the card previews the holidays the adapter will detect for the current year with your
current settings — including bridge days and minus your exclusions. It is calculated the same way
the adapter calculates, so what you see is what you get.

## Data points

| Data point | Type | Meaning |
| --- | --- | --- |
| `today.name` | string | Name of today's holiday, empty on a normal day |
| `today.isHoliday` | boolean | Whether today is a holiday |
| `yesterday.name` / `yesterday.isHoliday` | string / boolean | Same for yesterday |
| `tomorrow.name` / `tomorrow.isHoliday` | string / boolean | Same for tomorrow |
| `dayAfterTomorrow.name` / `dayAfterTomorrow.isHoliday` | string / boolean | Same for the day after tomorrow |
| `next.name` | string | Name of the next upcoming holiday |
| `next.isHoliday` | boolean | Whether an upcoming holiday was found at all |
| `next.date` | string | Its date as `YYYY-MM-DD` — machine-readable, unaffected by your display format |
| `next.daysUntil` | number | Days until that holiday |

All data points are read-only. `next` looks strictly ahead: a holiday that is today appears in
`today`, not in `next`.

The names of the channels and data points follow your ioBroker system language and are refreshed on
every run — including on installations that were updated rather than newly installed. If you rename
one of these data points by hand, the adapter will overwrite it again.

## Language

Holiday names are shown in your ioBroker system language when the holiday data provides that
language, otherwise in English. Eleven languages are supported: German, English, Spanish, French,
Italian, Dutch, Polish, Portuguese, Russian, Ukrainian and Chinese.

## Troubleshooting

**No holidays are reported at all.**
Check the log. "No country configured" means neither the adapter nor the ioBroker system settings
provide a usable country. "No holiday type is enabled" means every type checkbox is off.

**The state or region I configured seems to be ignored.**
An unknown state or region silently falls back to the broader level. The adapter detects this and
warns: "State 'XX' is unknown for YY — using country-level holidays". Pick the entry from the
dropdown rather than typing it.

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

The adapter works entirely offline: no data leaves your system. Optional error reporting via Sentry
can be switched off in the ioBroker settings — see the Sentry plugin documentation linked in the
main README.
