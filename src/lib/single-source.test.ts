import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
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

/** Markers that must occur in holiday-shared.ts and nowhere else. */
const SINGLE_SOURCE: Array<{ what: string; marker: RegExp }> = [
  // Matched on the BODY, not the name: a copy pasted back under another name would otherwise
  // walk straight past the guard (measured — the first version of this marker did exactly that).
  { what: "the exclude id (toHolidayId)", marker: /normalize\("NFD"\)/ },
  { what: "the exclude id's rule cleaning", marker: /\[\^a-zA-Z0-9_-\]/ },
  { what: "the holiday type list", marker: /flag:\s*"typePublic"/ },
  { what: "the collision rule (beats)", marker: /function\s+beats\s*\(/ },
  { what: "the type ranking (typeRank)", marker: /function\s+typeRank\s*\(/ },
  { what: "the bridge-day algorithm", marker: /dow\s*===\s*4/ },
  { what: "the bridge-day names", marker: /BRIDGE_DAY_NAMES\s*[:=]\s*(Record|\{)/ },
];

describe("one definition, not two (src/ and src-admin/ share holiday-shared.ts)", () => {
  const files = ROOTS.flatMap(sourceFiles);

  it("finds source files on both sides", () => {
    expect(files.some(f => f.includes("/src/lib/"))).toBe(true);
    expect(files.some(f => f.includes("/src-admin/src/"))).toBe(true);
  });

  for (const { what, marker } of SINGLE_SOURCE) {
    it(`${what} is defined only in holiday-shared.ts`, () => {
      const defining = files.filter(f => marker.test(readFileSync(f, "utf8")));
      expect(defining).toEqual([SHARED]);
    });
  }

  it("holiday-shared.ts stays import-free (it is bundled into two independent builds)", () => {
    const shared = readFileSync(SHARED, "utf8");
    expect(shared).not.toMatch(/^\s*import\s/m);
  });

  it("the admin card imports the shared module rather than copying from it", () => {
    for (const rel of ["exclude-options.ts", "scope-options.ts"]) {
      const text = readFileSync(join(adapterDir, "src-admin", "src", rel), "utf8");
      expect(text, `${rel} does not import holiday-shared`).toContain("../../src/lib/holiday-shared.js");
    }
  });
});
