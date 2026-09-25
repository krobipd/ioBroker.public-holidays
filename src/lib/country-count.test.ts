import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import Holidays from "date-holidays";

// The country count is written into the user-facing texts as a plain number, while every release
// lifts date-holidays to npm-latest (the release run's npm update, `npm run update:date-holidays`) —
// a new country in the data would leave every one of these texts silently wrong. Precise patterns
// per place, not a bare `\b206\b`: a version or date fragment must not satisfy this.
describe("the advertised country count matches the bundled date-holidays data", () => {
  const adapterDir = join(__dirname, "..", "..");
  const count = Object.keys(new Holidays().getCountries()).length;
  const read = (rel: string): string => readFileSync(join(adapterDir, rel), "utf8");

  it("README.md (intro, feature list, settings table)", () => {
    const text = read("README.md");
    expect(text.match(new RegExp(`\\b${count} countries\\b`, "g"))).toHaveLength(2);
    expect(text).toContain(`Country (${count} available)`);
  });

  it("docs/en/README.md", () => {
    expect(read("docs/en/README.md")).toContain(`${count} countries`);
  });

  it("docs/de/README.md", () => {
    expect(read("docs/de/README.md")).toContain(`${count} Länder`);
  });

  it("io-package.json common.desc in every language", () => {
    const desc = (JSON.parse(read("io-package.json")) as { common: { desc: Record<string, string> } }).common.desc;
    expect(Object.keys(desc)).toHaveLength(11);
    for (const [lang, text] of Object.entries(desc)) {
      // The first three-digit number of each description is the country count.
      expect(text.match(/\d{3}/)?.[0], `${lang}: ${text}`).toBe(String(count));
    }
  });
});
