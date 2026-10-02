// K8 — when two holidays fall on one date, the type rank decides, then a real holiday before a substitute day, then the id.
import { describe, expect, it } from "vitest";
import { buildDayMap } from "../lib/holiday-shared";

interface Raw {
  date: string;
  name: string;
  type: string;
  rule: string;
  substitute?: boolean;
}

const TYPES = ["public", "bank", "school", "optional", "observance"];

/**
 * The name published for 2026-05-01 — fed in both orders, so the input order cannot decide.
 *
 * @param a one holiday
 * @param b the other holiday
 * @returns the winner for each order
 */
function winner(a: Raw, b: Raw): string[] {
  return [
    [a, b],
    [b, a],
  ].map(raws => buildDayMap(raws, { types: TYPES, excludes: [] }).get("2026-05-01")?.name ?? "");
}

const day = (name: string, type: string, rule: string, substitute?: boolean): Raw => ({
  date: "2026-05-01 00:00:00",
  name,
  type,
  rule,
  substitute,
});

describe("K8 two holidays on one date", () => {
  it("K8: the higher type wins", () => {
    expect(winner(day("Observed", "observance", "05-01"), day("Public", "public", "05-01 #2"))).toEqual([
      "Public",
      "Public",
    ]);
    expect(winner(day("Bank", "bank", "05-01"), day("School", "school", "05-01 #2"))).toEqual(["Bank", "Bank"]);
  });

  it("K8: on the same type, the real holiday wins over a substitute day", () => {
    expect(
      winner(
        day("Moved", "public", "substitutes 04-30 if thursday then next friday", true),
        day("Real", "public", "05-01 #9"),
      ),
    ).toEqual(["Real", "Real"]);
  });

  it("K8: otherwise the smaller id wins", () => {
    expect(winner(day("Second", "public", "05-01 bbbb"), day("First", "public", "05-01 aaaa"))).toEqual([
      "First",
      "First",
    ]);
  });
});
