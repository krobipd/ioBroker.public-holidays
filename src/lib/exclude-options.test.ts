import { describe, it, expect } from "vitest";
import type Holidays from "date-holidays";
import {
  buildExcludeOptions,
  computeOrphanIds,
  enabledTypeKeys,
  type ScopeSelection,
} from "../../src-admin/src/exclude-options";

// A stand-in for a date-holidays instance: returns canned holidays per year and records the
// constructor args so scope routing (country / state / region) can be asserted without the real
// library. Shape matches what buildExcludeOptions consumes (setLanguages + getHolidays).
interface FakeHoliday {
  name: string;
  rule?: string;
  type: string;
  date: string;
}
function makeFake(byYear: Record<number, FakeHoliday[]>): {
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

// Default scope has every type enabled: an EMPTY type list means "no holidays at all" (the
// runtime's semantics), so it is a case of its own rather than a neutral default.
const ALL_TYPES = ["public", "bank", "school", "optional", "observance"];

const scope = (over: Partial<ScopeSelection> = {}): ScopeSelection => ({
  country: "DE",
  state: "",
  region: "",
  types: ALL_TYPES,
  ...over,
});

describe("enabledTypeKeys (defaultOn semantics, shared with the runtime config)", () => {
  it("a fresh config enables only public (defaultOn)", () => {
    expect(enabledTypeKeys(() => undefined)).toEqual(["public"]);
  });

  it("public explicitly off + bank on → only bank (the L1 divergence, now aligned)", () => {
    const flags: Record<string, unknown> = { typePublic: false, typeBank: true };
    expect(enabledTypeKeys((f: string) => flags[f])).toEqual(["bank"]);
  });

  it("all flags true → all five types", () => {
    expect(enabledTypeKeys(() => true)).toEqual(["public", "bank", "school", "optional", "observance"]);
  });
});

describe("buildExcludeOptions", () => {
  it("returns [] without a country", () => {
    const { make } = makeFake({});
    expect(buildExcludeOptions(scope({ country: "" }), "en", 2026, make)).toEqual([]);
  });

  it("sorts by month/day and formats the label as 'Name (DD.MM.)'", () => {
    const { make } = makeFake({
      2026: [
        { name: "Christmas", rule: "12-25", type: "public", date: "2026-12-25" },
        { name: "New Year", rule: "01-01", type: "public", date: "2026-01-01" },
      ],
      2027: [],
    });
    const opts = buildExcludeOptions(scope(), "en", 2026, make);
    expect(opts.map(o => o.label)).toEqual(["New Year (01.01.)", "Christmas (25.12.)"]);
  });

  it("dedupes by id across this year and next — the earlier year wins", () => {
    const { make } = makeFake({
      2026: [{ name: "Easter 2026", rule: "easter", type: "public", date: "2026-04-05" }],
      2027: [{ name: "Easter 2027", rule: "easter", type: "public", date: "2027-03-28" }],
    });
    const opts = buildExcludeOptions(scope(), "en", 2026, make);
    expect(opts).toHaveLength(1);
    expect(opts[0].label).toBe("Easter 2026 (05.04.)");
  });

  it("applies the type filter when types are given", () => {
    const { make } = makeFake({
      2026: [
        { name: "Public Day", rule: "pub", type: "public", date: "2026-05-01" },
        { name: "Bank Day", rule: "bank", type: "bank", date: "2026-06-01" },
      ],
      2027: [],
    });
    const opts = buildExcludeOptions(scope({ types: ["public"] }), "en", 2026, make);
    expect(opts.map(o => o.label)).toEqual(["Public Day (01.05.)"]);
  });

  it("offers nothing when no type is enabled — the runtime would report nothing either", () => {
    // The runtime keeps only holidays whose type is in the list, so an empty list drops
    // everything. Offering holidays to exclude that the adapter never reports would be a lie.
    const { make } = makeFake({
      2026: [
        { name: "Public Day", rule: "pub", type: "public", date: "2026-05-01" },
        { name: "Bank Day", rule: "bank", type: "bank", date: "2026-06-01" },
      ],
      2027: [],
    });
    expect(buildExcludeOptions(scope({ types: [] }), "en", 2026, make)).toEqual([]);
  });

  it("routes state+region into the constructor", () => {
    const { make, calls } = makeFake({ 2026: [], 2027: [] });
    buildExcludeOptions(scope({ state: "BY", region: "A" }), "en", 2026, make);
    expect(calls[0]).toEqual(["DE", "BY", "A"]);
  });

  it("returns [] when the scope constructor throws (invalid selection)", () => {
    const make = (): Holidays => {
      throw new Error("unknown country");
    };
    expect(buildExcludeOptions(scope({ country: "ZZ" }), "en", 2026, make)).toEqual([]);
  });
});

describe("computeOrphanIds", () => {
  const options = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ];
  it("returns stored ids that the current scope no longer offers", () => {
    expect(computeOrphanIds(["a", "gone"], options)).toEqual(["gone"]);
  });
  it("returns [] when every stored id is still offered", () => {
    expect(computeOrphanIds(["a", "b"], options)).toEqual([]);
  });
});

// ─── the DEFAULT maker (audit finding F10) ──────────────────────────────────
//
// Every test above injects a fake constructor, so until v0.16.0 the maker the admin card actually
// runs — `new Holidays(country, state, region)` — was executed by no test at all (measured: lines
// 75-81 uncovered). The card is not unit-tested and the render gate only checks that it renders,
// so a swapped argument would have shipped green while breaking the cascade, the exclude list and
// the preview at once. These three cases go through the real library.
describe("buildExcludeOptions with the real date-holidays constructor", () => {
  it("country level: offers the nationwide public holidays", () => {
    const ids = buildExcludeOptions({ country: "DE", state: "", region: "", types: ["public"] }, "en", 2026).map(
      o => o.id,
    );
    expect(ids).toContain("01-01");
    expect(ids).not.toContain("01-06");
  });

  it("state reaches the SECOND constructor argument: Bavaria adds its own days", () => {
    const ids = buildExcludeOptions({ country: "DE", state: "BY", region: "", types: ["public"] }, "en", 2026).map(
      o => o.id,
    );
    // Epiphany, Corpus Christi and All Saints exist in Bavaria but not nationwide.
    expect(ids).toEqual(expect.arrayContaining(["01-06", "easter_60", "11-01"]));
  });

  it("region reaches the THIRD constructor argument: Augsburg adds its peace festival", () => {
    const ids = buildExcludeOptions({ country: "DE", state: "BY", region: "A", types: ["public"] }, "en", 2026).map(
      o => o.id,
    );
    expect(ids).toContain("08-08");
  });

  it("localizes the labels with the language it was given", () => {
    const [de] = buildExcludeOptions({ country: "DE", state: "", region: "", types: ["public"] }, "de", 2026);
    const [en] = buildExcludeOptions({ country: "DE", state: "", region: "", types: ["public"] }, "en", 2026);
    expect(de.id).toBe(en.id);
    expect(de.label).not.toBe(en.label);
  });
});
