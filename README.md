# ioBroker.public-holidays

[![npm version](https://img.shields.io/npm/v/iobroker.public-holidays)](https://www.npmjs.com/package/iobroker.public-holidays)
![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm downloads](https://img.shields.io/npm/dt/iobroker.public-holidays)](https://www.npmjs.com/package/iobroker.public-holidays)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi)](https://ko-fi.com/krobipd)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://paypal.me/krobipd)

<img src="admin/public-holidays.svg" width="100" />

Detects public holidays for 206 countries. Runs completely offline — no cloud, no API calls. Updates daily at midnight.

Holiday data provided by [date-holidays](https://github.com/commenthol/date-holidays) (ISC + CC-BY-SA-3.0).

---

## Features

- **206 countries** with state/province and region support
- **Fully offline** — all holiday data is bundled, no internet required
- **5 holiday types** — public, bank, school, optional, observance (configurable)
- **Bridge day detection** — detects working days between holidays and weekends
- **Exclude individual holidays** — select holidays to exclude via dropdown
- **Localized holiday names** — follows system language with English fallback
- **Schedule mode** — computes once at startup and daily at midnight, no memory usage between runs

## Requirements

- ioBroker js-controller >= 7.0.7
- Admin >= 7.8.23
- Node.js >= 22

## Configuration

### Tab 1 — Region

| Setting          | Description                                                       |
| ---------------- | ----------------------------------------------------------------- |
| Country          | Select from 206 countries                                         |
| State / Province | Dropdown — only shown for countries with states (e.g. DE, CH, US) |
| Region           | Dropdown — only shown when the selected state has regions         |

> If **Country** is left empty, it is auto-detected from your ioBroker system settings (System settings → Country). Selecting it explicitly is recommended.

### Tab 2 — Holidays

| Setting            | Description                                     |
| ------------------ | ----------------------------------------------- |
| Public holidays    | Official public/national holidays (default: on) |
| Bank holidays      | Bank holidays                                   |
| School holidays    | School holidays                                 |
| Optional holidays  | Optional/discretionary holidays                 |
| Observance days    | Observance/memorial days                        |
| Detect bridge days | Adds bridge days between holidays and weekends  |
| Excluded holidays  | Select holidays to exclude from detection       |

## State Tree

```
public-holidays.0.
├── today.
│   ├── name         string    "Karfreitag" / "Good Friday"
│   └── boolean      boolean   true / false
├── yesterday.
│   ├── name         string
│   └── boolean      boolean
├── tomorrow.
│   ├── name         string
│   └── boolean      boolean
├── dayAfterTomorrow.
│   ├── name         string
│   └── boolean      boolean
└── next.
    ├── name         string    next holiday name (localized)
    ├── boolean      boolean   true when an upcoming holiday exists
    ├── date         string    "2026-12-25" (ISO date)
    └── daysUntil    number    days until holiday
```

When no holiday applies (e.g. today is not a holiday), the channel states are empty strings / false / 0.

## Bridge Day Algorithm

A bridge day is a working day (Monday–Friday) between a holiday and a weekend:

- Holiday on **Thursday** → Friday is a bridge day
- Holiday on **Tuesday** → Monday is a bridge day
- Holiday on **Wednesday** → no bridge day (two days missing)

Bridge days appear in the state tree with the localized name matching the system language.

## Troubleshooting

**No states after first start** — Open adapter settings and select a country.

**Wrong holidays / missing regional holidays** — Check that the correct state/province is selected. Set log level to debug to see all detected holidays.

**Holiday not detected** — Some holidays are classified as `observance` rather than `public`. Enable the observance type in the holiday settings if needed.

## Changelog
### 0.6.0 (2026-05-31)

- Country auto-detection now works reliably: if the country field is left empty, the country is taken from your ioBroker system settings. Previously this could leave all states empty.
- Bridge days are now also detected across the year boundary (for example a bridge day in early January).

### 0.5.2 (2026-05-30)

- Admin settings: country, state and region dropdown placeholders now appear in all 11 supported languages instead of only English and German

### 0.5.1 (2026-05-25)

- Removed legacy changelog entries for versions never published under this package name (repochecker E2004)

### 0.5.0 (2026-05-25)

- Schedule mode restored — adapter no longer runs as daemon (v0.4.0 regression)
- Fixed timezone issue causing wrong holiday dates for non-European countries
- Renamed `next.duration` to `next.daysUntil` for clarity (breaking: update scripts that read this state)

### 0.4.0 (2026-05-24)

- Bridge day names now shown in system language (11 languages)
- Fixed adapter not restarting when settings changed in admin

Older entries are in [CHANGELOG_OLD.md](CHANGELOG_OLD.md).

## Credits

npm package originally registered by [Jey Cee](https://github.com/Jey-Cee). This adapter is a complete rewrite with no shared code.

## Support

- [GitHub Issues](https://github.com/krobipd/ioBroker.public-holidays/issues) — bug reports, feature requests
- [ioBroker Forum](https://forum.iobroker.net/) — general questions

### Support Development

This adapter is free and open source. If you find it useful, consider buying me a coffee:

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?style=for-the-badge&logo=ko-fi)](https://ko-fi.com/krobipd)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=for-the-badge)](https://paypal.me/krobipd)

---

## License

MIT License

Copyright (c) 2026 krobi <krobi@power-dreams.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

_Developed with assistance from Claude.ai_
