import { describe, it, expect } from "vitest";
import Holidays from "date-holidays";
import {
  getCountryOptions,
  getStateOptions,
  getRegionOptions,
  buildPreviewHolidays,
  type PreviewScope,
} from "../../src-admin/src/scope-options";

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

// A date-holidays stand-in for the preview: canned holidays per year + records scope routing.
interface FakePreviewHoliday {
  name: string;
  rule?: string;
  type: string;
  date: string;
}
function makeFakeScope(byYear: Record<number, FakePreviewHoliday[]>): {
  make: (country: string, state?: string, region?: string) => Holidays;
  calls: Array<[string, string?, string?]>;
} {
  const calls: Array<[string, string?, string?]> = [];
  const make = (country: string, state?: string, region?: string): Holidays => {
    calls.push([country, state, region]);
    return {
      setLanguages: () => undefined,
      getHolidays: (y: number) => byYear[y] ?? [],
    } as unknown as Holidays;
  };
  return { make, calls };
}

const pscope = (over: Partial<PreviewScope> = {}): PreviewScope => ({
  country: "DE",
  state: "",
  region: "",
  types: [],
  excludeHolidays: [],
  ...over,
});

describe("buildPreviewHolidays", () => {
  it("returns [] without a country", () => {
    const { make } = makeFakeScope({});
    expect(buildPreviewHolidays(pscope({ country: "" }), false, "en", 2026, make)).toEqual([]);
  });

  it("routes state+region into the constructor", () => {
    const { make, calls } = makeFakeScope({ 2026: [] });
    buildPreviewHolidays(pscope({ state: "BY", region: "A" }), false, "en", 2026, make);
    expect(calls[0]).toEqual(["DE", "BY", "A"]);
  });

  it("keeps only enabled types and drops excluded ids", () => {
    const { make } = makeFakeScope({
      2026: [
        { name: "Public Day", rule: "pubrule", type: "public", date: "2026-05-01" },
        { name: "Bank Day", rule: "bankrule", type: "bank", date: "2026-06-01" },
        { name: "Excluded", rule: "excrule", type: "public", date: "2026-07-01" },
      ],
    });
    const res = buildPreviewHolidays(
      pscope({ types: ["public"], excludeHolidays: ["excrule"] }),
      false,
      "en",
      2026,
      make,
    );
    expect(res.map(h => h.name)).toEqual(["Public Day"]);
  });

  it("dedupes a same-date collision by type priority (public wins over bank)", () => {
    const { make } = makeFakeScope({
      2026: [
        { name: "Bank Version", rule: "bankrule", type: "bank", date: "2026-05-01" },
        { name: "Public Version", rule: "pubrule", type: "public", date: "2026-05-01" },
      ],
    });
    const res = buildPreviewHolidays(pscope(), false, "en", 2026, make);
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe("Public Version");
  });

  it("sorts the surviving holidays by date", () => {
    const { make } = makeFakeScope({
      2026: [
        { name: "Dec", rule: "decrule", type: "public", date: "2026-12-25" },
        { name: "Jan", rule: "janrule", type: "public", date: "2026-01-01" },
      ],
    });
    const res = buildPreviewHolidays(pscope(), false, "en", 2026, make);
    expect(res.map(h => h.name)).toEqual(["Jan", "Dec"]);
  });

  // 2026-05-14 (Thu) = Ascension, 05-12 = Tue, 05-13 = Wed, 05-11 = Mon, 05-15 = Fri (verified).
  it("adds a Friday bridge after a Thursday holiday when includeBridgeDays is on", () => {
    const { make } = makeFakeScope({
      2026: [{ name: "Ascension", rule: "ascension", type: "public", date: "2026-05-14" }],
    });
    const res = buildPreviewHolidays(pscope(), true, "en", 2026, make);
    expect(res.filter(h => h.type === "bridge").map(h => h.date)).toEqual(["2026-05-15"]);
  });

  it("adds no bridges when includeBridgeDays is off", () => {
    const { make } = makeFakeScope({
      2026: [{ name: "Ascension", rule: "ascension", type: "public", date: "2026-05-14" }],
    });
    const res = buildPreviewHolidays(pscope(), false, "en", 2026, make);
    expect(res.some(h => h.type === "bridge")).toBe(false);
  });

  it("bridges the Monday before a Tuesday holiday and a Wednesday bracketed by Tue+Thu", () => {
    const { make } = makeFakeScope({
      2026: [
        { name: "Tue Holiday", rule: "tuerule", type: "public", date: "2026-05-12" },
        { name: "Thu Holiday", rule: "thurule", type: "public", date: "2026-05-14" },
      ],
    });
    const res = buildPreviewHolidays(pscope(), true, "en", 2026, make);
    const bridges = res
      .filter(h => h.type === "bridge")
      .map(h => h.date)
      .sort();
    expect(bridges).toEqual(["2026-05-11", "2026-05-13", "2026-05-15"]);
  });
});
