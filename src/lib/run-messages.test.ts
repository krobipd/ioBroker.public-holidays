import { describe, expect, it } from "vitest";
import { makeConfig } from "../../test/helpers";
import { emptyResult } from "./holiday-engine";
import {
  calendarSummaryLine,
  DAMAGED_LIST_TEXT,
  forCalendar,
  hostZoneNote,
  NO_CALENDAR_TEXT,
  scopeIssueText,
  skippedCalendarText,
  staleExcludesText,
  summaryLine,
  systemCountryProblemText,
} from "./run-messages";

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

describe("the texts of several calendars", () => {
  it("a line about one calendar names its folder first", () => {
    expect(forCalendar("de-by-public", "No country configured — open adapter settings")).toBe(
      "de-by-public: No country configured — open adapter settings",
    );
  });

  it("a skipped calendar says which one and why, a forged id stays on one line", () => {
    expect(skippedCalendarText({ position: 2, reason: "id", id: "" })).toBe(
      "Calendar 2 has no valid id — skipped; open the adapter settings",
    );
    expect(skippedCalendarText({ position: 2, reason: "id", id: "a\nb" })).toBe(
      "Calendar 2 has no valid id ('a b') — skipped; open the adapter settings",
    );
    expect(skippedCalendarText({ position: 3, reason: "duplicate", id: "cal" })).toBe(
      "Calendar 3 uses the id 'cal' of a calendar above it — skipped; open the adapter settings",
    );
  });

  it("the one summary line names every calendar in list order", () => {
    const line = calendarSummaryLine(
      [
        { id: "a", computed: emptyResult() },
        { id: "b", computed: emptyResult() },
      ],
      "",
    );
    expect(line).toBe(`a: ${summaryLine(emptyResult(), "")}; b: ${summaryLine(emptyResult(), "")}`);
    expect(line.split("\n")).toHaveLength(1);
  });

  it("the damaged and the empty list are named", () => {
    expect(DAMAGED_LIST_TEXT).toContain("nothing was changed");
    expect(NO_CALENDAR_TEXT).toContain("add one");
  });
});
