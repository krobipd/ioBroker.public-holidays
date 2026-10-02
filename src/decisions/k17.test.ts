// K17 — the areas date-holidays cannot load are warned about and marked in the card.
// The adapter half: a state or region whose key the library cannot load is reported, with a warning text.
import { describe, expect, it } from "vitest";
import { detectScopeIssue } from "../lib/holiday-engine";
import { isLoadableScopeKey } from "../lib/holiday-shared";
import { scopeIssueText } from "../lib/run-messages";

/** A country with one loadable region and one whose key is written in mixed case, as in the library's data. */
const HD = {
  getHolidays: () => [{ date: "2026-01-01 00:00:00", name: "New Year", type: "public" }],
  getStates: () => ({ CAN: "Canterbury" }),
  getRegions: () => ({ CHC: "Christchurch", Timaru: "Timaru" }),
};

function issueFor(region: string): ReturnType<typeof detectScopeIssue> {
  return detectScopeIssue(
    HD as unknown as Parameters<typeof detectScopeIssue>[0],
    { country: "NZ", state: "CAN", region, holidayTypes: ["public"], excludeHolidays: [], includeBridgeDays: false },
    new Date(2026, 0, 1, 12),
  );
}

describe("K17 areas the library cannot load", () => {
  it("K17: a mixed-case key is not loadable, an upper-case one is", () => {
    expect(isLoadableScopeKey("Timaru")).toBe(false);
    expect(isLoadableScopeKey("CHC")).toBe(true);
  });

  it("K17: a configured area the library cannot load is reported, with a warning text", () => {
    const issue = issueFor("timaru");
    expect(issue).toEqual({ kind: "unloadable" });
    expect(
      scopeIssueText(issue!, {
        country: "NZ",
        state: "CAN",
        region: "timaru",
        holidayTypes: ["public"],
        excludeHolidays: [],
        includeBridgeDays: false,
      }),
    ).toContain("cannot load 'timaru'");
  });

  it("K17: a loadable area is no issue", () => {
    expect(issueFor("CHC")).toBeNull();
  });
});
