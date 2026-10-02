import { describe, expect, it, vi } from "vitest";
import { getSystemConfig } from "./system-config";

/**
 * An adapter whose system.config read returns `common` (as a copy) or fails, with its own warning log.
 *
 * @param common the stored common, undefined for no object
 * @param reject whether the read fails
 */
function makeAdapter(common: unknown, reject = false): { adapter: ioBroker.Adapter; warnings: string[] } {
  const warnings: string[] = [];
  const adapter = {
    log: { warn: (msg: string) => warnings.push(msg), debug: () => undefined },
    getForeignObjectAsync: vi.fn(() =>
      reject
        ? Promise.reject(new Error("boom"))
        : Promise.resolve(common === undefined ? null : { common: structuredClone(common) }),
    ),
  } as unknown as ioBroker.Adapter;
  return { adapter, warnings };
}

describe("getSystemConfig", () => {
  it("reads country, language and date format", async () => {
    const { adapter, warnings } = makeAdapter({ country: "Austria", language: "de", dateFormat: "DD.MM.YYYY" });
    expect(await getSystemConfig(adapter)).toEqual({ country: "Austria", language: "de", dateFormat: "DD.MM.YYYY" });
    expect(warnings).toEqual([]);
  });

  it("defaults what is missing or not a string", async () => {
    expect(await getSystemConfig(makeAdapter({ country: 123 }).adapter)).toEqual({
      country: "",
      language: "en",
      dateFormat: "",
    });
    expect(await getSystemConfig(makeAdapter(undefined).adapter)).toEqual({
      country: "",
      language: "en",
      dateFormat: "",
    });
  });

  // audit finding F8 — three user-visible things change at once, so the log has to say why
  it("falls back on a read error and says WHY instead of degrading silently", async () => {
    const { adapter, warnings } = makeAdapter({}, true);
    expect(await getSystemConfig(adapter)).toEqual({ country: "", language: "en", dateFormat: "" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("boom");
    expect(warnings[0]).toContain("auto-detection");
  });
});
