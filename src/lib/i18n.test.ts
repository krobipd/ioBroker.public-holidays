import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import { getSystemConfig, resolveCountryCode, resolveLanguages, SUPPORTED_LANGS, tName } from "./i18n";
import { BRIDGE_DAY_NAMES } from "./holiday-engine";

describe("tName", () => {
  it("delegates to I18n.getTranslatedObject", () => {
    const result = tName("today");
    expect(result).toEqual({ en: "today", de: "today_de" });
  });
});

describe("i18n completeness", () => {
  const i18nDir = join(__dirname, "../../admin/i18n");
  const files = readdirSync(i18nDir).filter(f => f.endsWith(".json"));
  const keysets = files.map(f => ({
    lang: f.replace(".json", ""),
    keys: Object.keys(JSON.parse(readFileSync(join(i18nDir, f), "utf8"))),
  }));
  const enKeys = keysets.find(k => k.lang === "en")!.keys;
  const enKeysSorted = [...enKeys].sort();

  it("all 11 languages present", () => {
    expect(files).toHaveLength(11);
  });

  it("all languages have identical keysets", () => {
    for (const { lang, keys } of keysets) {
      expect([...keys].sort(), `${lang} keyset mismatch`).toEqual(enKeysSorted);
    }
  });

  it("no empty values", () => {
    for (const { lang } of keysets) {
      const data = JSON.parse(readFileSync(join(i18nDir, `${lang}.json`), "utf8"));
      for (const [key, val] of Object.entries(data)) {
        expect(val, `${lang}.${key} is empty`).not.toBe("");
      }
    }
  });
});

describe("resolveLanguages", () => {
  it("returns [de, en] for German system with DE country", () => {
    const langs = resolveLanguages("de", "DE");
    expect(langs).toEqual(["de", "en"]);
  });

  it("returns [en] for English system", () => {
    const langs = resolveLanguages("en", "DE");
    expect(langs).toEqual(["en"]);
  });

  it("returns [en] for unsupported language", () => {
    const langs = resolveLanguages("ja", "JP");
    expect(langs).toEqual(["en"]);
  });

  it("handles language with region code (de-AT)", () => {
    const langs = resolveLanguages("de-AT", "AT");
    expect(langs).toEqual(["de", "en"]);
  });

  it("returns [fr, en] for French system with FR country", () => {
    const langs = resolveLanguages("fr", "FR");
    expect(langs).toEqual(["fr", "en"]);
  });

  it("returns [it, en] for Italian system with IT country", () => {
    const langs = resolveLanguages("it", "IT");
    expect(langs).toEqual(["it", "en"]);
  });

  it("returns [es, en] for Spanish system with ES country", () => {
    const langs = resolveLanguages("es", "ES");
    expect(langs).toEqual(["es", "en"]);
  });

  it("handles empty language string", () => {
    const langs = resolveLanguages("", "DE");
    expect(langs).toEqual(["en"]);
  });

  it("handles uppercase language", () => {
    const langs = resolveLanguages("DE", "DE");
    expect(langs).toEqual(["de", "en"]);
  });

  it("returns [en] when country doesn't support requested language", () => {
    // Chinese for a country that might not have zh translations
    const langs = resolveLanguages("zh", "DE");
    // date-holidays for DE only has de+en
    expect(langs).toEqual(["en"]);
  });

  it("returns [en] as fallback for unknown language code", () => {
    const langs = resolveLanguages("xx", "DE");
    expect(langs).toEqual(["en"]);
  });

  it("pt supported for PT country", () => {
    const langs = resolveLanguages("pt", "PT");
    expect(langs[0]).toBe("pt");
  });

  it("nl supported for NL country", () => {
    const langs = resolveLanguages("nl", "NL");
    expect(langs[0]).toBe("nl");
  });

  it("pl supported for PL country", () => {
    const langs = resolveLanguages("pl", "PL");
    expect(langs[0]).toBe("pl");
  });

  it("ru supported for RU country", () => {
    const langs = resolveLanguages("ru", "RU");
    expect(langs[0]).toBe("ru");
  });
});

describe("resolveCountryCode", () => {
  // ioBroker.admin stores the country NAME (ISO-3166) in system.config.common.country.
  it.each([
    ["Austria", "AT"],
    ["Germany", "DE"],
    ["Italy", "IT"],
    ["United States", "US"],
    ["Korea, Republic of", "KR"],
    ["Viet Nam", "VN"],
    ["Russian Federation", "RU"],
  ])("maps name %s -> %s", (name, code) => {
    expect(resolveCountryCode(name)).toBe(code);
  });

  it("accepts an already-valid alpha-2 code (uppercase)", () => {
    expect(resolveCountryCode("DE")).toBe("DE");
  });

  it("accepts a lowercase alpha-2 code", () => {
    expect(resolveCountryCode("de")).toBe("DE");
  });

  it("matches names case-insensitively", () => {
    expect(resolveCountryCode("austria")).toBe("AT");
  });

  it("returns '' for empty / whitespace", () => {
    expect(resolveCountryCode("")).toBe("");
    expect(resolveCountryCode("   ")).toBe("");
  });

  it("returns '' for an unknown name", () => {
    expect(resolveCountryCode("Definitely Not A Country")).toBe("");
  });

  it("returns '' for a name mapped to a code date-holidays does not support (fail-safe)", () => {
    // Antarctica is in the admin country list (AQ) but date-holidays has no data for it.
    expect(resolveCountryCode("Antarctica")).toBe("");
  });
});

describe("getSystemConfig", () => {
  function makeAdapter(common: unknown, reject = false): ioBroker.Adapter {
    return {
      getForeignObjectAsync: vi.fn(async () => {
        if (reject) {
          throw new Error("boom");
        }
        return common === undefined ? null : { common };
      }),
    } as unknown as ioBroker.Adapter;
  }

  it("reads country and language", async () => {
    const res = await getSystemConfig(makeAdapter({ country: "Austria", language: "de" }));
    expect(res).toEqual({ country: "Austria", language: "de" });
  });

  it("defaults language to en when missing", async () => {
    const res = await getSystemConfig(makeAdapter({ country: "DE" }));
    expect(res.language).toBe("en");
  });

  it("returns defaults when system.config is missing", async () => {
    const res = await getSystemConfig(makeAdapter(undefined));
    expect(res).toEqual({ country: "", language: "en" });
  });

  it("treats a non-string country as empty", async () => {
    const res = await getSystemConfig(makeAdapter({ country: 123, language: "fr" }));
    expect(res.country).toBe("");
    expect(res.language).toBe("fr");
  });

  it("returns defaults on read error", async () => {
    const res = await getSystemConfig(makeAdapter({}, true));
    expect(res).toEqual({ country: "", language: "en" });
  });
});

// Guard against repochecker E5611: every inline i18n object in the generated
// jsonConfig (e.g. dropdown placeholder labels) must cover all 11 admin languages.
describe("jsonConfig i18n completeness (E5611 guard)", () => {
  const i18nDir2 = join(__dirname, "../../admin/i18n");
  const langs = readdirSync(i18nDir2)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(".json", ""))
    .sort();
  const cfg = JSON.parse(readFileSync(join(__dirname, "../../admin/jsonConfig.json"), "utf8"));

  function collect(node: unknown, path: string, out: { path: string; keys: string[] }[]): void {
    if (Array.isArray(node)) {
      node.forEach((v, i) => collect(v, `${path}[${i}]`, out));
    } else if (node && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      if (typeof rec.en === "string") {
        out.push({ path, keys: Object.keys(rec).sort() });
        return;
      }
      for (const [k, v] of Object.entries(rec)) collect(v, `${path}/${k}`, out);
    }
  }

  it("every inline i18n object covers all 11 admin languages", () => {
    const objs: { path: string; keys: string[] }[] = [];
    collect(cfg, "", objs);
    expect(objs.length).toBeGreaterThan(0);
    for (const { path, keys } of objs) {
      expect(keys, `jsonConfig i18n object at ${path} is incomplete`).toEqual(langs);
    }
  });
});

// Guard against drift between the two language sets that must stay in sync:
// the date-holidays language list (SUPPORTED_LANGS) and the bridge-day translations.
describe("language set consistency (drift guard)", () => {
  it("BRIDGE_DAY_NAMES keys match SUPPORTED_LANGS", () => {
    expect(Object.keys(BRIDGE_DAY_NAMES).sort()).toEqual([...SUPPORTED_LANGS].sort());
  });
});
