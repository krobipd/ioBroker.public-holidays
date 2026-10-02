import { describe, expect, it } from "vitest";
import { ALL_TYPES, makeConfig } from "../../test/helpers";
import { buildExcludeOptions, computeInactiveIds, computeOrphanIds } from "./exclude-options";
import {
  buildPreviewHolidays,
  getCountryOptions,
  getRegionOptions,
  getStateOptions,
  type PreviewScope,
} from "./scope-options";
import { computeHolidays, createHolidaysInstance } from "../../src/lib/holiday-engine.js";
import { pickHolidayLanguages, toDateKey } from "../../src/lib/holiday-shared.js";
import type { AdapterConfig } from "../../src/lib/types.js";

// The card's preview claims to show what the adapter will publish. Until 0.17.0 that held for
// English and within the year only (audit K1/K2): the card asked date-holidays for the ADMIN
// language alone and computed a single year. These tests hold the card against the RUNTIME, day by
// day, with real data — the card builds its list with the same shared functions, so what is
// measured here is the plumbing around them: window, language, filters.

/**
 * A preview scope: all types, no excludes, no bridge days — overridden as given.
 *
 * @param over the fields that differ
 */
const scope = (over: Partial<PreviewScope>): PreviewScope => ({
  country: "DE",
  state: "",
  region: "",
  types: ALL_TYPES,
  excludeHolidays: [],
  includeBridgeDays: false,
  ...over,
});

/**
 * The card's preview of a scope in a year, in a system language.
 *
 * @param over the scope fields that differ
 * @param systemLanguage the ioBroker system language
 * @param referenceYear the year shown
 */
const preview = (
  over: Partial<PreviewScope>,
  systemLanguage: string,
  referenceYear = 2026,
): ReturnType<typeof buildPreviewHolidays> => buildPreviewHolidays(scope(over), { systemLanguage, referenceYear });

/**
 * The card's exclude list of a scope in 2026.
 *
 * @param over the scope fields that differ
 * @param systemLanguage the ioBroker system language
 * @param dateFormat the system date format
 */
const excludes = (
  over: Partial<PreviewScope>,
  systemLanguage = "en",
  dateFormat = "DD.MM.YYYY",
): ReturnType<typeof buildExcludeOptions> =>
  buildExcludeOptions(scope(over), { systemLanguage, referenceYear: 2026, dateFormat });

/**
 * What the runtime publishes as `today` on every day of `year`, as date → name|type-ish key.
 *
 * @param cfg the scope
 * @param systemLanguage the ioBroker system language
 * @param year the year to walk
 */
function runtimeYear(cfg: AdapterConfig, systemLanguage: string, year: number): Map<string, string> {
  const hd = createHolidaysInstance(cfg);
  const languages = pickHolidayLanguages(systemLanguage, hd.getLanguages());
  hd.setLanguages(languages);
  const out = new Map<string, string>();
  for (let d = new Date(year, 0, 1, 0, 0, 30); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const today = computeHolidays(hd, cfg, { referenceDate: new Date(d), systemLanguage }).today;
    if (today.isHoliday) {
      out.set(toDateKey(d), today.name);
    }
  }
  return out;
}

describe("the card's preview is what the runtime publishes, day by day", () => {
  for (const [country, state, lang, year] of [
    ["DE", "BY", "de", 2026],
    ["AT", "", "ru", 2026],
    ["RU", "", "ru", 2026],
    ["SA", "", "en", 2027],
  ] as const) {
    // 365 runtime runs per case: well within a second locally, but slow CI runners (Windows) and a
    // coverage run can take several — the default 5 s would make the check flaky, not stricter.
    it(
      `${country}${state ? `/${state}` : ""} ${year}, system language ${lang}, all types, bridge days`,
      { timeout: 30000 },
      () => {
        const cfg = makeConfig({ country, state, holidayTypes: ALL_TYPES, includeBridgeDays: true });
        const card = preview({ country, state, includeBridgeDays: true }, lang, year);
        const runtime = runtimeYear(cfg, lang, year);
        expect(card.map(p => p.date)).toEqual([...runtime.keys()].sort());
        for (const p of card) {
          if (p.type !== "bridge") {
            expect(p.name, p.date).toBe(runtime.get(p.date));
          }
        }
      },
    );
  }
});

describe("preview window and year boundary (audit K2)", () => {
  it("AT 2026, all types: nothing outside 2026, no bridge day on New Year's Day 2027", () => {
    const card = preview({ country: "AT", includeBridgeDays: true }, "de");
    expect(card.every(p => p.date.startsWith("2026"))).toBe(true);
    expect(card.some(p => p.type === "bridge" && p.date.endsWith("-01-01"))).toBe(false);
  });
});

describe("names in the system language, like the runtime (audit K1)", () => {
  it("a Russian system and Andorra (no Russian data): English names, not Catalan/Spanish", () => {
    expect(preview({ country: "AD", types: ["public"] }, "ru").map(p => p.name)).toContain("Epiphany");
  });

  it("zh-cn reaches the Chinese names where the data has them (CN), English where not (SG)", () => {
    const cn = preview({ country: "CN", types: ["public"] }, "zh-cn");
    expect(cn.find(p => p.date === "2026-01-01")?.name).toBe("元旦");
    // SG's data carries English only — the runtime publishes English there, so does the card.
    const sg = preview({ country: "SG", types: ["public"] }, "zh-cn");
    expect(sg.find(p => p.date === "2026-01-01")?.name).toBe("New Year's Day");
  });
});

describe("country names in the admin language (audit K3)", () => {
  it("German labels for countries date-holidays only names in their own language", () => {
    const labels = getCountryOptions("de").map(o => o.label);
    expect(labels).toContain("Japan (JP)");
    expect(labels).toContain("Griechenland (GR)");
  });
});

describe("scopes date-holidays cannot load are marked", () => {
  it("NZ/CAN Timaru and the Cook Islands' islands carry `unloadable`", () => {
    expect(getRegionOptions("NZ", "CAN", "en").find(o => o.value === "Timaru")?.unloadable).toBe(true);
    expect(getStateOptions("CK", "en").every(o => o.unloadable)).toBe(true);
    expect(getStateOptions("DE", "en").some(o => o.unloadable)).toBe(false);
  });
});

describe("exclude list: substitutes go with their holiday, switched-off types are kept", () => {
  it("GB 2026 offers Boxing Day, not its substitute day", () => {
    const opts = excludes({ country: "GB", types: ["public"] });
    expect(opts.some(o => o.id === "12-26")).toBe(true);
    expect(opts.some(o => o.label.includes("substitute"))).toBe(false);
  });

  it("names holidays in the system language like the runtime (Russian system, Andorra: English)", () => {
    expect(excludes({ country: "AD", types: ["public"] }, "ru").map(o => o.label)).toContain("Epiphany (06.01.)");
  });

  it("the label follows the system date format", () => {
    const [first] = excludes({ types: ["public"] }, "en", "MM/DD/YYYY");
    expect(first.label).toBe("New Year's Day (01/01)");
  });

  it("an exclude of a switched-off type is inactive, not an orphan", () => {
    const enabled = excludes({ state: "BY", types: ["public"] });
    const all = excludes({ state: "BY" });
    const observance = all.find(o => !enabled.some(e => e.id === o.id));
    expect(observance).toBeDefined();
    const stored = [observance!.id, "gone_forever"];
    expect(computeInactiveIds(stored, enabled, all)).toEqual([observance!.id]);
    expect(computeOrphanIds(stored, all)).toEqual(["gone_forever"]);
  });
});
