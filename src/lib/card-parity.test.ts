import Holidays from "date-holidays";
import { describe, expect, it } from "vitest";
import {
  buildExcludeOptions,
  computeInactiveIds,
  computeOrphanIds,
  HOLIDAY_TYPES,
} from "../../src-admin/src/exclude-options";
import {
  buildPreviewHolidays,
  getCountryOptions,
  getRegionOptions,
  getStateOptions,
} from "../../src-admin/src/scope-options";
import { computeHolidays, createHolidaysInstance } from "./holiday-engine";
import { pickHolidayLanguages } from "./holiday-shared";
import type { AdapterConfig } from "./types";

// The card's preview claims to show what the adapter will publish. Until 0.17.0 that held for
// English and within the year only (audit K1/K2): the card asked date-holidays for the ADMIN
// language alone and computed a single year. These tests hold the card against the RUNTIME, day by
// day, with real data — the card builds its list with the same shared functions, so what is
// measured here is the plumbing around them: window, language, filters.

const ALL_TYPES = HOLIDAY_TYPES.map(t => t.key);

function config(country: string, state = "", types = ALL_TYPES, includeBridgeDays = true): AdapterConfig {
  return { country, state, region: "", holidayTypes: types, excludeHolidays: [], includeBridgeDays };
}

/** What the runtime publishes as `today` on every day of `year`, as date → name|type-ish key. */
function runtimeYear(cfg: AdapterConfig, systemLanguage: string, year: number): Map<string, string> {
  const hd = createHolidaysInstance(cfg);
  const languages = pickHolidayLanguages(systemLanguage, hd.getLanguages());
  hd.setLanguages(languages);
  const out = new Map<string, string>();
  for (let d = new Date(year, 0, 1, 0, 0, 30); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const today = computeHolidays(cfg, languages, { referenceDate: new Date(d), systemLanguage, instance: hd }).today;
    if (today.isHoliday) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.set(key, today.name);
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
        const cfg = config(country, state);
        const preview = buildPreviewHolidays(
          { country, state, region: "", types: ALL_TYPES, excludeHolidays: [] },
          true,
          lang,
          year,
        );
        const runtime = runtimeYear(cfg, lang, year);
        expect(preview.map(p => p.date)).toEqual([...runtime.keys()].sort());
        for (const p of preview) {
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
    const preview = buildPreviewHolidays(
      { country: "AT", state: "", region: "", types: ALL_TYPES, excludeHolidays: [] },
      true,
      "de",
      2026,
    );
    expect(preview.every(p => p.date.startsWith("2026"))).toBe(true);
    expect(preview.some(p => p.type === "bridge" && p.date.endsWith("-01-01"))).toBe(false);
  });
});

describe("names in the system language, like the runtime (audit K1)", () => {
  it("a Russian system and Andorra (no Russian data): English names, not Catalan/Spanish", () => {
    const preview = buildPreviewHolidays(
      { country: "AD", state: "", region: "", types: ["public"], excludeHolidays: [] },
      false,
      "ru",
      2026,
    );
    expect(preview.map(p => p.name)).toContain("Epiphany");
  });

  it("zh-cn reaches the Chinese names where the data has them (CN), English where not (SG)", () => {
    const scope = { state: "", region: "", types: ["public"], excludeHolidays: [] };
    const cn = buildPreviewHolidays({ country: "CN", ...scope }, false, "zh-cn", 2026);
    expect(cn.find(p => p.date === "2026-01-01")?.name).toBe("元旦");
    // SG's data carries English only — the runtime publishes English there, so does the card.
    const sg = buildPreviewHolidays({ country: "SG", ...scope }, false, "zh-cn", 2026);
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
    const opts = buildExcludeOptions({ country: "GB", state: "", region: "", types: ["public"] }, "en", 2026);
    expect(opts.some(o => o.id === "12-26")).toBe(true);
    expect(opts.some(o => o.label.includes("substitute"))).toBe(false);
  });

  it("names holidays in the system language like the runtime (Russian system, Andorra: English)", () => {
    const opts = buildExcludeOptions({ country: "AD", state: "", region: "", types: ["public"] }, "ru", 2026);
    expect(opts.map(o => o.label)).toContain("Epiphany (06.01.)");
  });

  it("the label follows the system date format", () => {
    const [first] = buildExcludeOptions(
      { country: "DE", state: "", region: "", types: ["public"] },
      "en",
      2026,
      undefined,
      "MM/DD/YYYY",
    );
    expect(first.label).toBe("New Year's Day (01/01)");
  });

  it("an exclude of a switched-off type is inactive, not an orphan", () => {
    const scope = { country: "DE", state: "BY", region: "" };
    const enabled = buildExcludeOptions({ ...scope, types: ["public"] }, "en", 2026);
    const all = buildExcludeOptions({ ...scope, types: ALL_TYPES }, "en", 2026);
    const observance = all.find(o => !enabled.some(e => e.id === o.id));
    expect(observance).toBeDefined();
    const stored = [observance!.id, "gone_forever"];
    expect(computeInactiveIds(stored, enabled, all)).toEqual([observance!.id]);
    expect(computeOrphanIds(stored, all)).toEqual(["gone_forever"]);
  });

  it("the default maker builds real scopes (no fake)", () => {
    expect(new Holidays("GB").getHolidays(2026).length).toBeGreaterThan(0);
  });
});
