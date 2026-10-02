// K10 — country detection knows both admin name lists and names the reason when it fails.
import { describe, expect, it } from "vitest";
import { resolveCountryName } from "../lib/country-codes";
import { systemCountryProblemText } from "../lib/run-messages";

const SUPPORTED = new Set(["AT", "DE", "KR", "VN", "RS", "ME"]);

describe("K10 country detection", () => {
  it("K10: the system settings list (countries.json) resolves", () => {
    expect(resolveCountryName("Viet Nam", SUPPORTED)).toEqual({ code: "VN" });
    expect(resolveCountryName("Korea, Republic of", SUPPORTED)).toEqual({ code: "KR" });
    expect(resolveCountryName("Austria", SUPPORTED)).toEqual({ code: "AT" });
  });

  it("K10: the setup wizard's own list resolves too", () => {
    expect(resolveCountryName("Vietnam", SUPPORTED)).toEqual({ code: "VN" });
    expect(resolveCountryName("Korea", SUPPORTED)).toEqual({ code: "KR" });
  });

  it("K10: a failed detection says why", () => {
    const unknown = resolveCountryName("Atlantis", SUPPORTED);
    expect(unknown).toEqual({ code: "", reason: "unknown" });
    expect(systemCountryProblemText(unknown.reason, "Atlantis")).toContain("not recognized");

    const noData = resolveCountryName("FR", SUPPORTED);
    expect(noData).toEqual({ code: "", reason: "no-data" });
    expect(systemCountryProblemText(noData.reason, "FR")).toContain("no holiday data");

    const ambiguous = resolveCountryName("CS", SUPPORTED);
    expect(ambiguous).toEqual({ code: "", reason: "ambiguous" });
    expect(systemCountryProblemText(ambiguous.reason, "CS")).toContain("several countries");
  });
});
