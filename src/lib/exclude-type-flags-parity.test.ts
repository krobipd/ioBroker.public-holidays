import { describe, it, expect } from "vitest";
import { HOLIDAY_TYPES } from "./types";
import { TYPE_FLAGS } from "../../src-admin/src/exclude-options";

// The admin exclude component (isolated Module-Federation bundle) keeps its own copy of the
// holiday type ↔ native flag ↔ default mapping because it cannot import from src/. Unlike
// toHolidayId (compared textually in holiday-id-parity.test.ts) this is plain data, so we import
// both and compare them structurally. If they ever drift — a type added, renamed, or a default
// flipped — the admin option list would filter by the wrong flags (audit finding L1) and this
// guard fails CI instead of shipping a silent mismatch.
describe("type-flag parity (runtime HOLIDAY_TYPES vs admin TYPE_FLAGS)", () => {
  it("both define the same type/flag/defaultOn set in the same order", () => {
    expect(TYPE_FLAGS.map(t => ({ type: t.type, flag: t.flag, defaultOn: t.defaultOn }))).toEqual(
      HOLIDAY_TYPES.map(t => ({ type: t.key, flag: t.flag, defaultOn: t.defaultOn })),
    );
  });
});
