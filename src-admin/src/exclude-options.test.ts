import { describe, it, expect } from "vitest";
import type Holidays from "date-holidays";
import { ALL_TYPES, makeFakeHolidays } from "../../test/helpers";
import { buildExcludeOptions, computeInactiveIds, computeOrphanIds } from "./exclude-options";
import type { ScopeSelection } from "./scoped-holidays";

// Default scope has every type enabled: an EMPTY type list means "no holidays at all" (the
// runtime's semantics), so it is a case of its own rather than a neutral default.
const scope = (over: Partial<ScopeSelection> = {}): ScopeSelection => ({
  country: "DE",
  state: "",
  region: "",
  types: ALL_TYPES,
  ...over,
});

const options = (
  makeHolidays?: (c: string, s: string, r: string) => Holidays,
  systemLanguage = "en",
): Parameters<typeof buildExcludeOptions>[1] => ({
  systemLanguage,
  referenceYear: 2026,
  dateFormat: "DD.MM.YYYY",
  makeHolidays,
});

describe("buildExcludeOptions", () => {
  it("returns [] without a country, without an enabled type, or when the scope cannot be built", () => {
    const { make } = makeFakeHolidays({
      2026: [{ name: "Public Day", rule: "pub", type: "public", date: "2026-05-01" }],
    });
    expect(buildExcludeOptions(scope({ country: "" }), options(make))).toEqual([]);
    // The runtime keeps only holidays whose type is in the list — offering more would be a lie.
    expect(buildExcludeOptions(scope({ types: [] }), options(make))).toEqual([]);
    const failing = (): Holidays => {
      throw new Error("unknown country");
    };
    expect(buildExcludeOptions(scope({ country: "ZZ" }), options(failing))).toEqual([]);
  });

  it("sorts by month/day and labels 'Name (DD.MM.)'", () => {
    const { make } = makeFakeHolidays({
      2026: [
        { name: "Christmas", rule: "12-25", type: "public", date: "2026-12-25" },
        { name: "New Year", rule: "01-01", type: "public", date: "2026-01-01" },
      ],
    });
    expect(buildExcludeOptions(scope(), options(make)).map(o => o.label)).toEqual([
      "New Year (01.01.)",
      "Christmas (25.12.)",
    ]);
  });

  it("dedupes by id across this year and next — the earlier year wins", () => {
    const { make } = makeFakeHolidays({
      2026: [{ name: "Easter 2026", rule: "easter", type: "public", date: "2026-04-05" }],
      2027: [{ name: "Easter 2027", rule: "easter", type: "public", date: "2027-03-28" }],
    });
    expect(buildExcludeOptions(scope(), options(make))).toEqual([{ id: "easter", label: "Easter 2026 (05.04.)" }]);
  });

  it("offers only the enabled types", () => {
    const { make } = makeFakeHolidays({
      2026: [
        { name: "Public Day", rule: "pub", type: "public", date: "2026-05-01" },
        { name: "Bank Day", rule: "bank", type: "bank", date: "2026-06-01" },
      ],
    });
    expect(buildExcludeOptions(scope({ types: ["public"] }), options(make)).map(o => o.label)).toEqual([
      "Public Day (01.05.)",
    ]);
  });

  it("routes the scope into the constructor", () => {
    const { make, calls } = makeFakeHolidays({});
    buildExcludeOptions(scope({ state: "BY", region: "A" }), options(make));
    expect(calls).toEqual([["DE", "BY", "A"]]);
  });
});

describe("computeOrphanIds and computeInactiveIds", () => {
  const all = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
  ];
  const enabled = [all[0]];

  it("an orphan is a stored id no option of any type carries", () => {
    expect(computeOrphanIds(["a", "gone"], all)).toEqual(["gone"]);
    expect(computeOrphanIds(["a", "b"], all)).toEqual([]);
  });

  it("an inactive id belongs to the scope but to a switched-off type", () => {
    expect(computeInactiveIds(["a", "b", "gone"], enabled, all)).toEqual(["b"]);
  });
});

// ─── the DEFAULT maker (audit finding F10) ──────────────────────────────────
//
// The maker the card actually runs — `new Holidays(country, state, region)` — goes through the real
// library here: a swapped argument would break the cascade, the exclude list and the preview at once.
describe("buildExcludeOptions with the real date-holidays constructor", () => {
  const ids = (over: Partial<ScopeSelection>): string[] =>
    buildExcludeOptions(scope({ types: ["public"], ...over }), options()).map(o => o.id);

  it("country level: offers the nationwide public holidays", () => {
    expect(ids({})).toContain("01-01");
    expect(ids({})).not.toContain("01-06");
  });

  it("state reaches the SECOND constructor argument: Bavaria adds its own days", () => {
    // Epiphany, Corpus Christi and All Saints exist in Bavaria but not nationwide.
    expect(ids({ state: "BY" })).toEqual(expect.arrayContaining(["01-06", "easter_60", "11-01"]));
  });

  it("region reaches the THIRD constructor argument: Augsburg adds its peace festival", () => {
    expect(ids({ state: "BY", region: "A" })).toContain("08-08");
  });

  it("labels in the system language, ids language-independent", () => {
    const [de] = buildExcludeOptions(scope({ types: ["public"] }), options(undefined, "de"));
    const [en] = buildExcludeOptions(scope({ types: ["public"] }), options(undefined, "en"));
    expect(de).toEqual({ id: "01-01", label: "Neujahr (01.01.)" });
    expect(en).toEqual({ id: "01-01", label: "New Year's Day (01.01.)" });
  });
});
