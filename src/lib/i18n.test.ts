import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** The eleven languages ioBroker translates into ("zh-cn" as the file name). */
const IOBROKER_LANGUAGES = ["de", "en", "es", "fr", "it", "nl", "pl", "pt", "ru", "uk", "zh-cn"];

// Two dictionaries, two consumers: `admin/i18n` feeds the runtime (state names/descriptions via
// adapter-core's I18n) and the jsonConfig labels; `src-admin/src/i18n` is the card's own dictionary
// (loaded by admin's ConfigCustom). A key missing in one language renders as the raw key there —
// nothing else in the toolchain notices, so both folders are held to the same rules.
describe.each([
  ["admin/i18n", join(__dirname, "../../admin/i18n")],
  ["src-admin/src/i18n", join(__dirname, "../../src-admin/src/i18n")],
])("i18n completeness: %s", (_label, i18nDir) => {
  const files = readdirSync(i18nDir).filter(f => f.endsWith(".json"));
  const dictionaries = files.map(f => ({
    lang: f.replace(".json", ""),
    data: JSON.parse(readFileSync(join(i18nDir, f), "utf8")) as Record<string, string>,
  }));
  const en = dictionaries.find(d => d.lang === "en")!.data;
  const enKeysSorted = Object.keys(en).sort();
  const placeholders = (text: string): number => (text.match(/%s/g) ?? []).length;

  it("every ioBroker language is present", () => {
    expect(files.map(f => f.replace(".json", "")).sort()).toEqual([...IOBROKER_LANGUAGES].sort());
  });

  it("all languages have identical keysets", () => {
    for (const { lang, data } of dictionaries) {
      expect(Object.keys(data).sort(), `${lang} keyset mismatch`).toEqual(enKeysSorted);
    }
  });

  it("no empty values", () => {
    for (const { lang, data } of dictionaries) {
      for (const [key, val] of Object.entries(data)) {
        expect(val, `${lang}.${key} is empty`).not.toBe("");
      }
    }
  });

  it("every translation carries the same %s placeholders as English", () => {
    // `I18n.t(key, ...args)` fills placeholders positionally — a translation with one fewer
    // `%s` silently drops an argument, one more shows a literal "%s".
    for (const { lang, data } of dictionaries) {
      for (const [key, val] of Object.entries(data)) {
        expect(placeholders(val), `${lang}.${key} placeholder count`).toBe(placeholders(en[key]));
      }
    }
  });
});
