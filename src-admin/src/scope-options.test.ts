import { describe, it, expect } from "vitest";
import type Holidays from "date-holidays";
import { ALL_TYPES, makeFakeHolidays } from "../../test/helpers";
import {
  getCountryOptions,
  getStateOptions,
  getRegionOptions,
  buildPreviewHolidays,
  type PreviewScope,
} from "./scope-options";

// A stand-in for a date-holidays instance exposing only the taxonomy lookups the cascade uses.
// getStates/getRegions return `undefined` for an unknown scope (verified against 3.33.0), which
// the option builders must treat as "no children" rather than crashing.
function makeFakeHd(data: {
  countries?: Record<string, string>;
  states?: Record<string, Record<string, string>>;
  regions?: Record<string, Record<string, string>>;
}): Holidays {
  return {
    getCountries: () => data.countries ?? {},
    getStates: (c: string) => data.states?.[c],
    getRegions: (c: string, s: string) => data.regions?.[`${c}/${s}`],
  } as unknown as Holidays;
}

describe("getCountryOptions", () => {
  it("maps countries to 'Name (CODE)' sorted by localized name", () => {
    const hd = makeFakeHd({ countries: { DE: "Germany", AT: "Austria", CH: "Switzerland" } });
    expect(getCountryOptions("en", () => hd)).toEqual([
      { value: "AT", label: "Austria (AT)" },
      { value: "DE", label: "Germany (DE)" },
      { value: "CH", label: "Switzerland (CH)" },
    ]);
  });
});

describe("getStateOptions", () => {
  it("returns [] when the country has no states (getStates undefined)", () => {
    const hd = makeFakeHd({ states: {} });
    expect(getStateOptions("ZZ", "en", () => hd)).toEqual([]);
  });

  it("maps states to 'Name (CODE)' sorted by name", () => {
    const hd = makeFakeHd({ states: { DE: { BY: "Bavaria", BE: "Berlin" } } });
    expect(getStateOptions("DE", "en", () => hd)).toEqual([
      { value: "BY", label: "Bavaria (BY)" },
      { value: "BE", label: "Berlin (BE)" },
    ]);
  });

  it("marks a mixed-case key date-holidays cannot load", () => {
    const hd = makeFakeHd({ states: { CK: { Aitutaki: "Aitutaki", RAR: "Rarotonga" } } });
    expect(getStateOptions("CK", "en", () => hd)).toEqual([
      { value: "Aitutaki", label: "Aitutaki (Aitutaki)", unloadable: true },
      { value: "RAR", label: "Rarotonga (RAR)" },
    ]);
  });
});

describe("getRegionOptions", () => {
  it("returns [] when the state has no regions (getRegions undefined)", () => {
    const hd = makeFakeHd({ regions: {} });
    expect(getRegionOptions("DE", "ZZ", "en", () => hd)).toEqual([]);
  });

  it("maps regions to 'Name (CODE)' sorted by name", () => {
    const hd = makeFakeHd({ regions: { "DE/BY": { A: "Augsburg", KATH: "Catholic" } } });
    expect(getRegionOptions("DE", "BY", "en", () => hd)).toEqual([
      { value: "A", label: "Augsburg (A)" },
      { value: "KATH", label: "Catholic (KATH)" },
    ]);
  });
});

const pscope = (over: Partial<PreviewScope> = {}): PreviewScope => ({
  country: "DE",
  state: "",
  region: "",
  types: ALL_TYPES,
  excludeHolidays: [],
  includeBridgeDays: false,
  ...over,
});

const at2026 = (
  makeHolidays?: (c: string, s: string, r: string) => Holidays,
): Parameters<typeof buildPreviewHolidays>[1] => ({
  systemLanguage: "en",
  referenceYear: 2026,
  makeHolidays,
});

describe("buildPreviewHolidays", () => {
  it("previews nothing without a country, without an enabled type, or when the scope cannot be built", () => {
    const { make } = makeFakeHolidays({
      2026: [{ name: "Public Day", rule: "pubrule", type: "public", date: "2026-05-01" }],
    });
    expect(buildPreviewHolidays(pscope({ country: "" }), at2026(make))).toEqual([]);
    // The runtime's type filter drops every holiday when the list is empty — a full year here
    // would promise states the adapter never writes.
    expect(buildPreviewHolidays(pscope({ types: [] }), at2026(make))).toEqual([]);
    const failing = (): Holidays => {
      throw new Error("no data for this scope");
    };
    expect(buildPreviewHolidays(pscope(), at2026(failing))).toEqual([]);
  });

  it("routes the scope into the constructor", () => {
    const { make, calls } = makeFakeHolidays({});
    buildPreviewHolidays(pscope({ state: "BY", region: "A" }), at2026(make));
    expect(calls).toEqual([["DE", "BY", "A"]]);
  });

  it("keeps the enabled types, drops excluded ids, sorts by date", () => {
    const { make } = makeFakeHolidays({
      2026: [
        { name: "Dec", rule: "decrule", type: "public", date: "2026-12-25 00:00:00" },
        { name: "Bank Day", rule: "bankrule", type: "bank", date: "2026-06-01 00:00:00" },
        { name: "Excluded", rule: "excrule", type: "public", date: "2026-07-01 00:00:00" },
        { name: "Jan", rule: "janrule", type: "public", date: "2026-01-01 00:00:00" },
      ],
    });
    const res = buildPreviewHolidays(pscope({ types: ["public"], excludeHolidays: ["excrule"] }), at2026(make));
    expect(res).toEqual([
      { date: "2026-01-01", name: "Jan", type: "public" },
      { date: "2026-12-25", name: "Dec", type: "public" },
    ]);
  });

  it("adds the bridge days only when they are switched on — the rule is the runtime's", () => {
    // 2026-05-14 (Thu) = Ascension → Fri 05-15.
    const { make } = makeFakeHolidays({
      2026: [{ name: "Ascension", rule: "ascension", type: "public", date: "2026-05-14 00:00:00" }],
    });
    expect(buildPreviewHolidays(pscope(), at2026(make)).some(h => h.type === "bridge")).toBe(false);
    expect(
      buildPreviewHolidays(pscope({ includeBridgeDays: true }), at2026(make))
        .filter(h => h.type === "bridge")
        .map(h => h.date),
    ).toEqual(["2026-05-15"]);
  });
});

// ─── the DEFAULT makers (audit finding F10) ─────────────────────────────────
//
// The constructors the card actually runs, through the real library.
describe("the cascade and the preview with the real date-holidays constructor", () => {
  it("getCountryOptions lists the countries date-holidays supports", () => {
    const options = getCountryOptions("en");
    expect(options.find(o => o.value === "DE")?.label).toBe("Germany (DE)");
    expect(options.find(o => o.value === "JP")?.label).toBe("Japan (JP)");
  });

  it("getStateOptions/getRegionOptions walk down the real taxonomy", () => {
    expect(getStateOptions("DE", "en").some(o => o.value === "BY")).toBe(true);
    expect(getRegionOptions("DE", "BY", "en").some(o => o.value === "A")).toBe(true);
    expect(getRegionOptions("DE", "", "en")).toEqual([]);
  });

  it("passes country/state/region to the constructor in that order", () => {
    const real = (over: Partial<PreviewScope>): ReturnType<typeof buildPreviewHolidays> =>
      buildPreviewHolidays(pscope({ types: ["public"], ...over }), at2026());
    const country = real({});
    const state = real({ state: "BY" });
    const region = real({ state: "BY", region: "A" });
    expect(state.length).toBeGreaterThan(country.length);
    expect(region.length).toBeGreaterThan(state.length);
    expect(region.some(h => h.date === "2026-08-08")).toBe(true);
  });
});
