import { describe, expect, it } from "vitest";
import { makeConfig } from "../../test/helpers";
import { emptyResult } from "./holiday-engine";
import { hostZoneNote, scopeIssueText, staleExcludesText, summaryLine, systemCountryProblemText } from "./run-messages";

describe("systemCountryProblemText", () => {
  it.each([
    ["ambiguous", "covers several countries — choose the country"],
    ["no-data", "has no holiday data — choose a country"],
    ["unknown", "is not recognized — choose a country"],
    ["empty", "is not recognized — choose a country"],
  ] as const)("names the reason %s", (reason, text) => {
    expect(systemCountryProblemText(reason, "Serbia and Montenegro")).toBe(
      `System country 'Serbia and Montenegro' ${text} in the adapter settings`,
    );
  });

  it("keeps a stored name with a line break on one log line", () => {
    expect(systemCountryProblemText("unknown", "Atlan\ntis")).toContain("'Atlan tis'");
  });
});

describe("scopeIssueText", () => {
  it("names the unknown country, state and region", () => {
    expect(scopeIssueText({ kind: "country" }, makeConfig({ country: "XX" }))).toBe(
      "Country 'XX' is not recognized — check the country setting",
    );
    expect(scopeIssueText({ kind: "state" }, makeConfig({ state: "ZZ" }))).toBe(
      "State 'ZZ' is unknown for DE — using country-level holidays",
    );
    expect(scopeIssueText({ kind: "region" }, makeConfig({ state: "BY", region: "ZZ" }))).toBe(
      "Region 'ZZ' is unknown for DE/BY — using broader holidays",
    );
  });

  it("a region without a state: no stray slash", () => {
    expect(scopeIssueText({ kind: "region" }, makeConfig({ region: "ZZ" }))).toBe(
      "Region 'ZZ' is unknown for DE — using broader holidays",
    );
  });

  it("names the key date-holidays cannot load — the region, else the state", () => {
    expect(scopeIssueText({ kind: "unloadable" }, makeConfig({ country: "NZ", state: "CAN", region: "Timaru" }))).toBe(
      "date-holidays cannot load 'Timaru' (library defect) — using the broader scope's holidays",
    );
    expect(scopeIssueText({ kind: "unloadable" }, makeConfig({ country: "CK", state: "Aitutaki" }))).toContain(
      "'Aitutaki'",
    );
  });
});

describe("hostZoneNote", () => {
  it("says nothing while the host is in one of the country's zones, or the data names none", () => {
    expect(hostZoneNote("Europe/Berlin", "DE", ["Europe/Berlin"])).toBe("");
    expect(hostZoneNote("UTC", "DE", [])).toBe("");
  });

  it("names the host zone and the country's zones otherwise", () => {
    expect(hostZoneNote("UTC", "DE", ["Europe/Berlin", "Europe/Busingen"])).toBe(
      "Host time zone UTC is not one of DE's (Europe/Berlin, Europe/Busingen) — days follow the host clock",
    );
  });
});

describe("staleExcludesText", () => {
  it("lists the ids on one line", () => {
    expect(staleExcludesText(["gone\n1", "gone_2"])).toMatch(/: gone 1, gone_2$/);
  });
});

describe("summaryLine", () => {
  it("today and the next holiday, the date in the system format, one day in the singular", () => {
    const computed = emptyResult();
    computed.today = { name: "Neujahr", isHoliday: true };
    computed.next = { name: "Heilige Drei Könige", isHoliday: true, date: "2027-01-06", daysUntil: 1 };
    expect(summaryLine(computed, "DD.MM.YYYY")).toBe(
      "Today: Neujahr, next holiday: Heilige Drei Könige on 06.01.2027 (in 1 day)",
    );
    computed.next.daysUntil = 5;
    expect(summaryLine(computed, "")).toBe(
      "Today: Neujahr, next holiday: Heilige Drei Könige on 2027-01-06 (in 5 days)",
    );
  });

  it("says so when there is no holiday today and none ahead", () => {
    expect(summaryLine(emptyResult(), "DD.MM.YYYY")).toBe("Today: no holiday, next holiday: no upcoming holiday");
  });
});
