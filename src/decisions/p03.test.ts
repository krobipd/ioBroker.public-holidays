// P-03 — the log line names the next holiday's date in the system's date format; next.date stays ISO.
import { describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: { getTranslatedObject: (key: string) => ({ en: key }) },
}));

import { summaryLine } from "../lib/run-messages";
import { publishStates } from "../lib/state-publisher";
import type { ComputedHolidays } from "../lib/types";

const COMPUTED: ComputedHolidays = {
  yesterday: { name: "", isHoliday: false },
  today: { name: "", isHoliday: false },
  tomorrow: { name: "", isHoliday: false },
  dayAfterTomorrow: { name: "", isHoliday: false },
  next: { name: "National Day", isHoliday: true, date: "2026-10-26", daysUntil: 6 },
  unmatchedExcludes: [],
};

describe("P-03 date in the log, ISO in the datapoint", () => {
  it("P-03: the log line shows the date in the system format", () => {
    expect(summaryLine(COMPUTED, "DD.MM.YYYY")).toContain("National Day on 26.10.2026 (in 6 days)");
    expect(summaryLine(COMPUTED, "MM/DD/YYYY")).toContain("National Day on 10/26/2026 (in 6 days)");
    expect(summaryLine(COMPUTED, "DD.MM.YYYY")).not.toContain("2026-10-26");
  });

  it("P-03: the next.date datapoint keeps the ISO date", async () => {
    const written = new Map<string, unknown>();
    const adapter = {
      namespace: "public-holidays.0",
      getStatesAsync: () => Promise.resolve({}),
      setState: (id: string, state: { val: unknown }) => {
        written.set(id, state.val);
        return Promise.resolve();
      },
    };
    await publishStates(adapter as unknown as Parameters<typeof publishStates>[0], COMPUTED);
    expect(written.get("next.date")).toBe("2026-10-26");
  });
});
