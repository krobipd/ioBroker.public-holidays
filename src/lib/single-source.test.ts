import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Until v0.15.1 the runtime and the admin card each carried their own copy of the holiday id, the
// type list, the collision rule and the bridge-day algorithm — plus, unguarded, their own
// translation table for the bridge-day NAME. Four parity tests policed four of the five copies;
// the fifth had nothing.
//
// The stated reason ("importing from src/ would risk the MF build") was an assertion. Measured
// 2026-09-06: `src-admin` type-checks and bundles a relative import from `src/lib/` without
// complaint, so all five copies collapsed into holiday-shared.ts and the parity tests went with
// them. This guard replaces all four: it fails when a SECOND definition of any of these
// reappears anywhere in the source tree — which is how the drift would start again.

const adapterDir = join(__dirname, "..", "..");
const ROOTS = [join(adapterDir, "src"), join(adapterDir, "src-admin", "src")];
const SHARED = join(adapterDir, "src", "lib", "holiday-shared.ts");

/**
 * Every .ts/.tsx source file. Tests are excluded (a test may legitimately spell a rule out), and so
 * are `.d.ts` files: `vite build` in src-admin/ drops a generated declaration next to every src/
 * module the card imports, and a mirror of the shared file is not a second definition of it.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      out.push(...sourceFiles(p));
    } else if (
      /\.tsx?$/.test(entry) &&
      !entry.endsWith(".d.ts") &&
      !entry.endsWith(".test.ts") &&
      !entry.endsWith(".test.tsx")
    ) {
      out.push(p);
    }
  }
  return out;
}

/**
 * A path with forward slashes, whatever the platform uses. The first version of this file compared
 * against literal "/src/lib/" and passed on macOS/Linux while failing on the Windows CI leg.
 *
 * @param p an absolute path
 * @returns the same path with "/" separators
 */
function posix(p: string): string {
  return p.split(sep).join("/");
}

const COUNTRY_CODES = join(adapterDir, "src", "lib", "country-codes.ts");

/**
 * Markers that must occur in ONE file and nowhere else (holiday-shared.ts unless named). Matched on
 * the BODY, not the name: a copy pasted back under another name would otherwise walk straight past
 * the guard (measured twice — the first toHolidayId marker, and in the 0.17.0 audit an arrow-function
 * copy of `beats`, `typeRank` and the Thursday rule that the name markers let through).
 */
const SINGLE_SOURCE: Array<{ what: string; marker: RegExp; home?: string }> = [
  { what: "the exclude id (toHolidayId)", marker: /normalize\("NFD"\)/ },
  { what: "the exclude id's rule cleaning", marker: /\[\^a-zA-Z0-9_-\]/ },
  { what: "the holiday type list", marker: /flag:\s*"typePublic"/ },
  { what: "the collision rule's type step (beats)", marker: /rank\s*!==\s*0/ },
  { what: "the collision rule's substitute step (beats)", marker: /IsSubstitute\s*!==\s*\w+IsSubstitute/ },
  { what: "the type ranking (typeRank)", marker: /\.indexOf\(type\)/ },
  { what: "the bridge-day rule", marker: /isOff\(shiftKey\(\w+,\s*-1\)\)/ },
  { what: "the bridge-day trigger types", marker: /\["public",\s*"bank"\]/ },
  { what: "the weekend table", marker: /BD:\s*\[5,\s*6\]/ },
  { what: "the multi-day expansion (noon rule)", marker: /\+\s*NOON_MS\s*</ },
  { what: "the exclude key of a substitute", marker: /_\(\?:if\|not_on\|and\)_/ },
  { what: "the substitute attribution", marker: /h\.name\.startsWith\(/ },
  { what: "the holiday occurrence of a day", marker: /`\$\{id\}@\$\{keys\[0\]\}`/ },
  { what: "the holiday-name language rule", marker: /available\.includes\(lang\)/ },
  { what: "the bridge-day names", marker: /BRIDGE_DAY_NAMES\s*[:=]\s*(Record|\{)/ },
  { what: "the admin wizard's country names", marker: /"Ivory Coast":\s*"CI"/, home: COUNTRY_CODES },
  { what: "the country resolution", marker: /reason:\s*"ambiguous"|"ambiguous"\s*:\s*"no-data"/, home: COUNTRY_CODES },
];

describe("one definition, not two (src/ and src-admin/ share holiday-shared.ts)", () => {
  const files = ROOTS.flatMap(sourceFiles);

  it("finds source files on both sides", () => {
    expect(files.some(f => posix(f).includes("/src/lib/"))).toBe(true);
    expect(files.some(f => posix(f).includes("/src-admin/src/"))).toBe(true);
  });

  for (const { what, marker, home } of SINGLE_SOURCE) {
    const expected = home ?? SHARED;
    it(`${what} is defined only in ${expected.split(sep).pop()}`, () => {
      const defining = files.filter(f => marker.test(readFileSync(f, "utf8"))).map(posix);
      expect(defining).toEqual([posix(expected)]);
    });
  }

  it("country-codes.ts stays import-free (the admin card bundles it too)", () => {
    expect(readFileSync(COUNTRY_CODES, "utf8")).not.toMatch(/^\s*import\s/m);
  });

  it("holiday-shared.ts stays import-free (it is bundled into two independent builds)", () => {
    const shared = readFileSync(SHARED, "utf8");
    expect(shared).not.toMatch(/^\s*import\s/m);
  });

  it("the admin card imports the shared module rather than copying from it", () => {
    for (const rel of ["exclude-options.ts", "scope-options.ts", "HolidayPanel.tsx"]) {
      const text = readFileSync(join(adapterDir, "src-admin", "src", rel), "utf8");
      expect(text, `${rel} does not import holiday-shared`).toContain("../../src/lib/holiday-shared.js");
    }
  });
});
