import { describe, expect, it } from "vitest";
import { resolveCountry } from "./country";

// The name tables and their rules are country-codes' (country-resolution.test.ts); what this module
// adds is the check against the countries the installed date-holidays carries.
describe("resolveCountry — against the installed holiday data", () => {
  it("resolves an admin name and a code of a country with data", () => {
    expect(resolveCountry("Austria")).toEqual({ code: "AT" });
    expect(resolveCountry("de")).toEqual({ code: "DE" });
  });

  it("says no-data for a country the admin lists but date-holidays does not carry", () => {
    // Antarctica is in the admin country list (AQ) but date-holidays has no data for it.
    expect(resolveCountry("Antarctica")).toEqual({ code: "", reason: "no-data" });
  });

  it("never passes an arbitrary two-letter string through as a country", () => {
    // Two letters alone are not a country: date-holidays would return no holidays at all and the
    // adapter would publish an empty year without saying why.
    for (const bogus of ["XX", "ZZ", "QQ"]) {
      expect(resolveCountry(bogus).code, bogus).toBe("");
    }
  });
});
