import { describe, expect, it, vi } from "vitest";

// `config.ts` reaches `resolveCountryCode` in i18n.ts, which imports @iobroker/adapter-core —
// and that module calls process.exit(10) outside a real js-controller install. Only the I18n
// helper is touched here, so stub it the way i18n.test.ts does.
vi.mock("@iobroker/adapter-core", () => ({
  I18n: { getTranslatedObject: vi.fn((key: string) => ({ en: key })) },
}));

import { configuredCountry, parseConfig } from "./config";

// The config matrix used to live on the adapter class (`validateConfig`), so every case here had
// to build an adapter stub to reach it. It reads nothing but its argument, so it belongs in lib/
// next to the types it produces (audit finding F15) — these are the same cases, without the stub.

describe("parseConfig", () => {
  it("returns null without a country (no fallback)", () => {
    expect(parseConfig({})).toBeNull();
  });

  it("uses the fallback country when the config has none", () => {
    expect(parseConfig({}, "AT")?.country).toBe("AT");
  });

  it("trims the configured country and prefers it over the fallback", () => {
    expect(parseConfig({ country: "  DE  " }, "AT")?.country).toBe("DE");
  });

  it("defaults to public holidays only (typePublic unset)", () => {
    expect(parseConfig({ country: "DE" })?.holidayTypes).toEqual(["public"]);
  });

  it("typePublic=false removes public; explicit true flags add their types", () => {
    const cfg = parseConfig({
      country: "DE",
      typePublic: false,
      typeBank: true,
      typeSchool: true,
      typeOptional: true,
      typeObservance: true,
    });
    expect(cfg?.holidayTypes).toEqual(["bank", "school", "optional", "observance"]);
  });

  it("non-boolean type flags are NOT treated as enabled (strict === true)", () => {
    expect(parseConfig({ country: "DE", typeBank: "true", typeSchool: 1 })?.holidayTypes).toEqual(["public"]);
  });

  it("takes excludeHolidays only (legacy per-type exclude keys are ignored) and drops non-strings", () => {
    const cfg = parseConfig({
      country: "DE",
      // Legacy keys from the pre-0.9.0 per-type exclude UI — no admin field writes these
      // anymore; parseConfig must NOT merge them back in.
      excludePublic: ["legacy_ignored"],
      excludeBank: ["legacy_ignored_too"],
      excludeHolidays: ["a", 42, "b", null],
    });
    expect(cfg?.excludeHolidays).toEqual(["a", "b"]);
  });

  it("state/region default to empty strings and get trimmed", () => {
    const cfg = parseConfig({ country: "DE", state: " BY ", region: 7 })!;
    expect(cfg.state).toBe("BY");
    expect(cfg.region).toBe("");
  });

  it("includeBridgeDays only on strict boolean true", () => {
    expect(parseConfig({ country: "DE", includeBridgeDays: true })?.includeBridgeDays).toBe(true);
    expect(parseConfig({ country: "DE", includeBridgeDays: "true" })?.includeBridgeDays).toBe(false);
  });

  // audit finding F11 — the configured country goes through the same resolver as the detected one
  describe("country resolution (same path for configured and detected)", () => {
    it("resolves a stored ISO clear-name to the code date-holidays needs", () => {
      expect(parseConfig({ country: "Austria" })?.country).toBe("AT");
    });

    it("is case-insensitive about the name", () => {
      expect(parseConfig({ country: "germany" })?.country).toBe("DE");
    });

    it("leaves an already-valid code alone", () => {
      expect(parseConfig({ country: "DE" })?.country).toBe("DE");
    });

    it("keeps an unresolvable value verbatim so the scope warning can name it", () => {
      // Degrading to "" here would report "no country configured" instead of
      // "Country 'Utopia' is not recognized" — the wrong of the two messages.
      expect(parseConfig({ country: "Utopia" })?.country).toBe("Utopia");
    });
  });
});

describe("configuredCountry", () => {
  it("reports the stored value untranslated — only an EMPTY one hands over to the system country", () => {
    expect(configuredCountry({ country: "  Austria  " })).toBe("Austria");
    expect(configuredCountry({ country: "   " })).toBe("");
    expect(configuredCountry({ country: 42 })).toBe("");
    expect(configuredCountry({})).toBe("");
  });
});
