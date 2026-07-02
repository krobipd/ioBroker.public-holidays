import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The exclude ids stored by the admin component (src-admin/src/ExcludeSelector.tsx)
// are matched verbatim against the ids the runtime computes (src/lib/holiday-engine.ts).
// Both files carry their own copy of toHolidayId() because src-admin is an isolated
// Module-Federation/Vite bundle that cannot import from src/ without risking the MF build.
// If the two copies ever diverge, every saved exclude silently stops matching. This guard
// extracts both function bodies and asserts they are identical (whitespace-insensitive) so
// any drift fails CI instead of shipping a silent break.

function extractToHolidayId(source: string): string {
  const marker = "function toHolidayId(";
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error("toHolidayId() not found — did the function get renamed?");
  }
  const braceStart = source.indexOf("{", start);
  if (braceStart === -1) {
    throw new Error("toHolidayId() body not found");
  }
  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end++) {
    if (source[end] === "{") {
      depth++;
    } else if (source[end] === "}") {
      depth--;
      if (depth === 0) {
        end++;
        break;
      }
    }
  }
  if (depth !== 0) {
    throw new Error("toHolidayId() has unbalanced braces");
  }
  // Strip a leading `export ` (the only intentional difference) and collapse whitespace so
  // indentation/formatting differences don't count as drift — only the logic does.
  return source.slice(start, end).replace(/\s+/g, " ").trim();
}

describe("toHolidayId parity (runtime engine vs admin bundle)", () => {
  it("holiday-engine.ts and ExcludeSelector.tsx define an identical toHolidayId", () => {
    const engine = readFileSync(join(__dirname, "holiday-engine.ts"), "utf8");
    const admin = readFileSync(join(__dirname, "../../src-admin/src/ExcludeSelector.tsx"), "utf8");
    expect(extractToHolidayId(admin)).toBe(extractToHolidayId(engine));
  });
});
