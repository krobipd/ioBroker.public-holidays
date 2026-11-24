import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({ I18n: { getTranslatedObject: (key: string) => ({ en: key }) } }));

import { CALENDAR_OBJECTS } from "./state-publisher";

// js-controller applies the manifest's `instanceObjects` on every start, but with
// `preserve: { common: ["name"] }` — so a renamed object of the manifest reaches FRESH installs only.
// Since the calendar list (0.21.0) no object lives at a fixed id any more: every calendar has its
// own folder, named by the settings, and the runtime writes the folder and its 17 objects with
// their whole shape (`ensureCalendarObjects`, through the fleet store `KnownObjects`). The manifest
// therefore declares none — a copy there would be a second source of the shape, at ids no calendar
// uses. What this guard holds: the manifest stays empty, no name is preserved, and every name and
// explanation comes from a key that exists in every language.

const adapterDir = join(__dirname, "..", "..");
/** The languages the adapter translates into — one admin/i18n file each. */
const LANGUAGES = readdirSync(join(adapterDir, "admin", "i18n"))
  .map(f => f.replace(".json", ""))
  .sort();
const dictionaries = Object.fromEntries(
  LANGUAGES.map(lang => [
    lang,
    JSON.parse(readFileSync(join(adapterDir, "admin", "i18n", `${lang}.json`), "utf8")) as Record<string, string>,
  ]),
);
const source = readFileSync(join(__dirname, "state-publisher.ts"), "utf8");

describe("the calendar objects reach existing installations", () => {
  it("the manifest declares no instance object — the runtime is the only source of the tree", () => {
    const iopack = JSON.parse(readFileSync(join(adapterDir, "io-package.json"), "utf8")) as {
      instanceObjects?: unknown[];
    };
    expect(iopack.instanceObjects ?? []).toEqual([]);
  });

  it("no name is preserved — preserving would freeze the old text on existing installs", () => {
    // Comments talk ABOUT preserve; only the code must not use it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("preserve");
  });

  it("a calendar holds the 17 objects of the tree: five channels, twelve states", () => {
    expect(CALENDAR_OBJECTS).toHaveLength(17);
    expect(CALENDAR_OBJECTS.filter(o => o.type === "channel")).toHaveLength(5);
  });

  for (const o of CALENDAR_OBJECTS) {
    it(`${o.rel}: name and explanation come from keys every language has`, () => {
      // An i18n key adapter-core cannot resolve silently becomes `{ en: "<key>" }` — and with no
      // `preserve` that placeholder would overwrite the translated name on every installation.
      for (const key of [o.name, ...(o.desc ? [o.desc] : [])]) {
        for (const lang of LANGUAGES) {
          expect(dictionaries[lang][key], `admin/i18n/${lang}.json has no key "${key}"`).toBeTruthy();
        }
      }
    });
  }
});
