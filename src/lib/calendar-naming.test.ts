import { describe, expect, it } from "vitest";
import Holidays from "date-holidays";
import {
  areaIdPart,
  calendarSlug,
  isCalendarId,
  standardCalendarId,
  standardCalendarName,
  standardIdOf,
  standardNameOf,
  uniqueCalendarId,
} from "./holiday-shared";

// The naming of the calendar folders (concept accepted by krobi 2026-11-20 22:43): the id says
// WHERE the calendar applies and WHICH holidays it holds, never the display name; the runtime and
// the card build both with these functions.

const hd = new Holidays();

describe("calendarSlug — what is typed becomes an id", () => {
  it.each([
    ["Heinz Schule", "heinz-schule"],
    ["Österreich Banken", "oesterreich-banken"],
    ["Straße", "strasse"],
    ["Zürich", "zuerich"],
    ["Île-de-France", "ile-de-france"],
    ["  --a  b--  ", "a-b"],
    ["ÄÖÜ", "aeoeue"],
    ["日本", ""],
  ])("%s → %s", (typed, id) => {
    expect(calendarSlug(typed)).toBe(id);
  });

  it("keeps a hyphen at the end only while typing", () => {
    expect(calendarSlug("heinz ", true)).toBe("heinz-");
    expect(calendarSlug("heinz ")).toBe("heinz");
  });
});

describe("isCalendarId", () => {
  it.each(["de-by-public", "a", "at-6", "x1-2y"])("%s is an id", id => expect(isCalendarId(id)).toBe(true));
  it.each(["", "-a", "a-", "a--b", "A", "a b", "a.b", 7, null])("%s is none", id =>
    expect(isCalendarId(id)).toBe(false),
  );
});

describe("the standard id", () => {
  it.each([
    [["DE", "by", "", ["school"]], "de-by-school"],
    [["AT", "", "", ["bank"]], "at-bank"],
    [["DE", "nw", "", ["public"]], "de-nw-public"],
    [["", "", "", ["public"]], "system-public"],
    [["DE", "", "", []], "de"],
    [
      ["DE", "by", "a", ["public", "bank", "school", "optional", "observance"]],
      "de-by-a-public-bank-school-optional-observance",
    ],
  ] as const)("%j → %s", ([country, state, region, types], id) => {
    expect(standardCalendarId(country, state, region, types)).toBe(id);
  });

  it("an area code of digits only takes the area's name (the Austrian states)", () => {
    expect(areaIdPart("6", "Steiermark")).toBe("steiermark");
    expect(areaIdPart("BY", "Bayern")).toBe("BY");
    expect(areaIdPart("", "x")).toBe("");
    expect(areaIdPart("7", "")).toBe("7");
    expect(standardIdOf({ country: "AT", systemCountry: "", state: "6", region: "", types: ["public"] }, hd)).toBe(
      "at-steiermark-public",
    );
  });

  it("a calendar following the system country takes the areas of the system country", () => {
    expect(standardIdOf({ country: "", systemCountry: "AT", state: "6", region: "", types: ["public"] }, hd)).toBe(
      "system-steiermark-public",
    );
  });

  it("every area of the holiday data yields a valid id, none twice", () => {
    // The concept promised it (all areas, no id twice); a date-holidays update that breaks it shows here.
    const ids = new Map<string, string>();
    const scopes: string[] = [];
    for (const country of Object.keys(hd.getCountries() ?? {})) {
      scopes.push(country);
      for (const state of Object.keys(hd.getStates(country) ?? {})) {
        scopes.push(`${country}/${state}`);
        for (const region of Object.keys(hd.getRegions(country, state) ?? {})) {
          scopes.push(`${country}/${state}/${region}`);
        }
      }
    }
    for (const scope of scopes) {
      const [country, state = "", region = ""] = scope.split("/");
      const id = standardIdOf({ country, systemCountry: "", state, region, types: ["public"] }, hd);
      expect(isCalendarId(id), `${scope} → '${id}'`).toBe(true);
      expect(ids.get(id), `${scope} and ${ids.get(id)} both → '${id}'`).toBeUndefined();
      ids.set(id, scope);
    }
    expect(scopes.length).toBeGreaterThan(Object.keys(hd.getCountries() ?? {}).length);
  });

  it("a tie gets the next free number", () => {
    expect(uniqueCalendarId("de-public", new Set())).toBe("de-public");
    expect(uniqueCalendarId("de-public", new Set(["de-public"]))).toBe("de-public-2");
    expect(uniqueCalendarId("de-public", new Set(["de-public", "de-public-2"]))).toBe("de-public-3");
  });
});

describe("the standard name — the location only", () => {
  it("country · state · region, as far as chosen", () => {
    expect(standardCalendarName("Deutschland", ["Nordrhein-Westfalen", ""], "de")).toBe(
      "Deutschland · Nordrhein-Westfalen",
    );
    expect(standardCalendarName("Austria", [], "en")).toBe("Austria");
  });

  it("names the system country in words", () => {
    expect(standardCalendarName("", [], "de")).toBe("Systemland");
    expect(standardCalendarName("", ["Bayern"], "de")).toBe("Systemland · Bayern");
  });

  it("an unknown language falls back to English; zh-cn reads as zh", () => {
    expect(standardCalendarName("", [], "xx")).toBe("System country");
    expect(standardCalendarName("", [], "zh-cn")).toBe(standardCalendarName("", [], "zh"));
  });

  it("looks the names up in date-holidays and Intl; types and bridge days never go in", () => {
    expect(
      standardNameOf(
        { country: "DE", systemCountry: "", state: "BY", region: "", types: ["public", "school"] },
        "de",
        hd,
      ),
    ).toBe("Deutschland · Bayern");
    expect(standardNameOf({ country: "", systemCountry: "DE", state: "BY", region: "", types: [] }, "en", hd)).toBe(
      "System country · Bayern",
    );
  });
});
