import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import Holidays from "date-holidays";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: {
    getTranslatedObject: vi.fn((key: string) => ({ en: key, de: `${key}_de` })),
  },
}));

import {
  getSystemConfig,
  resolveCountryCode,
  resolveLanguages,
  SUPPORTED_LANGS,
  tName,
  formatDateForDisplay,
} from "./i18n";
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
    const langs = resolveLanguages("de", new Holidays("DE"));
    expect(langs).toEqual(["de", "en"]);
  });

  it("returns [en] for English system", () => {
    const langs = resolveLanguages("en", new Holidays("DE"));
    expect(langs).toEqual(["en"]);
  });

  it("returns [en] for unsupported language", () => {
    const langs = resolveLanguages("ja", new Holidays("JP"));
    expect(langs).toEqual(["en"]);
  });

  it("returns [en] for a language date-holidays knows but this adapter does not", () => {
    // Swedish: the library offers "sv" for SE, but the adapter has no Swedish
    // state names. Passing it through would produce a half-translated tree —
    // holiday names in Swedish, everything else in English.
    expect(resolveLanguages("sv", new Holidays("SE"))).toEqual(["en"]);
  });

  it("handles language with region code (de-AT)", () => {
    const langs = resolveLanguages("de-AT", new Holidays("AT"));
    expect(langs).toEqual(["de", "en"]);
  });

  it("returns [fr, en] for French system with FR country", () => {
    const langs = resolveLanguages("fr", new Holidays("FR"));
    expect(langs).toEqual(["fr", "en"]);
  });

  it("returns [it, en] for Italian system with IT country", () => {
    const langs = resolveLanguages("it", new Holidays("IT"));
    expect(langs).toEqual(["it", "en"]);
  });

  it("returns [es, en] for Spanish system with ES country", () => {
    const langs = resolveLanguages("es", new Holidays("ES"));
    expect(langs).toEqual(["es", "en"]);
  });

  it("handles empty language string", () => {
    const langs = resolveLanguages("", new Holidays("DE"));
    expect(langs).toEqual(["en"]);
  });

  it("handles uppercase language", () => {
    const langs = resolveLanguages("DE", new Holidays("DE"));
    expect(langs).toEqual(["de", "en"]);
  });

  it("returns [en] when country doesn't support requested language", () => {
    // Chinese for a country that might not have zh translations
    const langs = resolveLanguages("zh", new Holidays("DE"));
    // date-holidays for DE only has de+en
    expect(langs).toEqual(["en"]);
  });

  it("returns [en] as fallback for unknown language code", () => {
    const langs = resolveLanguages("xx", new Holidays("DE"));
    expect(langs).toEqual(["en"]);
  });

  it("pt supported for PT country", () => {
    const langs = resolveLanguages("pt", new Holidays("PT"));
    expect(langs[0]).toBe("pt");
  });

  it("nl supported for NL country", () => {
    const langs = resolveLanguages("nl", new Holidays("NL"));
    expect(langs[0]).toBe("nl");
  });

  it("pl supported for PL country", () => {
    const langs = resolveLanguages("pl", new Holidays("PL"));
    expect(langs[0]).toBe("pl");
  });

  it("ru supported for RU country", () => {
    const langs = resolveLanguages("ru", new Holidays("RU"));
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

describe("resolveCountryCode — rejects what is not a country", () => {
  it("does not accept an arbitrary two-letter string as a country code", () => {
    // Two letters alone are not a country. Passing "XX" through gives
    // date-holidays a code it does not know: it returns no holidays at all and
    // the adapter publishes an empty year without saying why.
    for (const bogus of ["XX", "ZZ", "QQ"]) {
      expect(resolveCountryCode(bogus), bogus).toBe("");
    }
    // A real code still works.
    expect(resolveCountryCode("de")).toBe("DE");
  });
});

describe("getSystemConfig", () => {
  function makeAdapter(common: unknown, reject = false): ioBroker.Adapter {
    return {
      getForeignObjectAsync: vi.fn(() => {
        if (reject) {
          return Promise.reject(new Error("boom"));
        }
        return Promise.resolve(common === undefined ? null : { common });
      }),
    } as unknown as ioBroker.Adapter;
  }

  it("reads country and language", async () => {
    const res = await getSystemConfig(makeAdapter({ country: "Austria", language: "de", dateFormat: "DD.MM.YYYY" }));
    expect(res).toEqual({ country: "Austria", language: "de", dateFormat: "DD.MM.YYYY" });
  });

  it("defaults language to en when missing", async () => {
    const res = await getSystemConfig(makeAdapter({ country: "DE" }));
    expect(res.language).toBe("en");
  });

  it("returns defaults when system.config is missing", async () => {
    const res = await getSystemConfig(makeAdapter(undefined));
    expect(res).toEqual({ country: "", language: "en", dateFormat: "" });
  });

  it("treats a non-string country as empty", async () => {
    const res = await getSystemConfig(makeAdapter({ country: 123, language: "fr" }));
    expect(res.country).toBe("");
    expect(res.language).toBe("fr");
  });

  it("returns defaults on read error", async () => {
    const res = await getSystemConfig(makeAdapter({}, true));
    expect(res).toEqual({ country: "", language: "en", dateFormat: "" });
  });
});

describe("formatDateForDisplay", () => {
  it("renders the ISO key in the system date format", () => {
    expect(formatDateForDisplay("2026-10-26", "DD.MM.YYYY")).toBe("26.10.2026");
    expect(formatDateForDisplay("2026-10-26", "MM/DD/YYYY")).toBe("10/26/2026");
    expect(formatDateForDisplay("2026-10-26", "YYYY.MM.DD")).toBe("2026.10.26");
  });

  it("supports two-digit years", () => {
    expect(formatDateForDisplay("2026-10-26", "DD.MM.YY")).toBe("26.10.26");
  });

  it("returns the key unchanged for an empty or unrecognized format", () => {
    expect(formatDateForDisplay("2026-10-26", "")).toBe("2026-10-26");
    expect(formatDateForDisplay("2026-10-26", "garbage")).toBe("2026-10-26");
  });

  it("returns a malformed key unchanged", () => {
    expect(formatDateForDisplay("", "DD.MM.YYYY")).toBe("");
    expect(formatDateForDisplay("26.10.2026", "DD.MM.YYYY")).toBe("26.10.2026");
  });
});

// Guard against drift between the two language sets that must stay in sync:
// the date-holidays language list (SUPPORTED_LANGS) and the bridge-day translations.
describe("language set consistency (drift guard)", () => {
  it("BRIDGE_DAY_NAMES keys match SUPPORTED_LANGS", () => {
    expect(Object.keys(BRIDGE_DAY_NAMES).sort()).toEqual([...SUPPORTED_LANGS].sort());
  });
});
