# Older changelog entries

No older entries yet.
## 0.9.0 (2026-06-28)

- The holiday exclude list now shows only your selected region's holidays, in your admin language and sorted by date — no longer every region of a country mixed alphabetically.
- The false "excluded holidays no longer match" warning at startup is fixed; it now fires only for a holiday that genuinely no longer exists.

## 0.8.0 (2026-06-25)

- A misconfigured region/state is now reported instead of silently using country-level holidays.
- A holiday exclude that no longer matches after a data update is now reported.
- On a day with two holidays, the more important one is now shown.
- Adds an optional bridge day between two midweek holidays.

## 0.7.1 (2026-06-12)

- Internal refactoring. No user-facing changes.

## 0.7.0 (2026-06-07)

- Added optional Sentry error reporting: crashes are sent to the developer so issues get fixed faster. Active only with ioBroker diagnostics enabled; anonymous.

## 0.6.0 (2026-05-31)

- Country auto-detection now works reliably: if the country field is left empty, the country is taken from your ioBroker system settings. Previously this could leave all states empty.
- Bridge days are now also detected across the year boundary (for example a bridge day in early January).

## 0.5.2 (2026-05-30)

- Admin settings: country, state and region dropdown placeholders now appear in all 11 supported languages instead of only English and German

## 0.5.1 (2026-05-25)

- Removed legacy changelog entries for versions never published under this package name (repochecker E2004)

## 0.5.0 (2026-05-25)

- Schedule mode restored — adapter no longer runs as daemon (v0.4.0 regression)
- Fixed timezone issue causing wrong holiday dates for non-European countries
- Renamed `next.duration` to `next.daysUntil` for clarity (breaking: update scripts that read this state)

## 0.4.0 (2026-05-24)

- Bridge day names now shown in system language (11 languages)
- Fixed adapter not restarting when settings changed in admin

## 0.3.0 (2026-05-24)

- Removed ID states from all channels — slimmed state tree from 17 to 12 data points
- Reduced verbose output during normal operation
- Improved adapter stability: crash protection, race condition fix, reduced unnecessary state writes

## 0.2.0 (2026-05-24)

- State and region selection via dropdown menus instead of free text input
- Exclude holidays shown per type — only visible when the corresponding type is enabled
- Country auto-detected from ioBroker system settings when not configured
- Slimmed state tree from 27 to 17 data points (removed redundant region/type fields)

## 0.1.5 (2026-05-23)

- Changelog rewritten in user-centric style.

## 0.1.4 (2026-05-23)

- Fixed admin checkbox layout on small screens

## 0.1.3 (2026-05-23)

- Internal cleanup. No user-facing changes.

## 0.1.2 (2026-05-22)

- User-modified state names are no longer overwritten on adapter restart

## 0.1.1 (2026-05-21)

- Improved error handling and stability.

## 0.1.0 (2026-05-21)

- Initial release — offline holiday detection for 206 countries with bridge day support
