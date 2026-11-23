import { describe, expect, it } from "vitest";
import {
  calendarName,
  calendarScope,
  hasLegacySettings,
  LEGACY_SETTING_KEYS,
  legacyCalendar,
  legacyTakeover,
  usableCalendars,
} from "./calendars";
import { CALENDAR_LIST_KEY, HOLIDAY_TYPES, readCalendarList } from "./holiday-shared";

describe("legacyTakeover — the old keys in the fleet migration table", () => {
  it("names every settings key of 0.20.x, the five type flags among them", () => {
    expect(LEGACY_SETTING_KEYS).toEqual([
      "country",
      "state",
      "region",
      ...HOLIDAY_TYPES.map(t => t.flag),
      "excludeHolidays",
      "includeBridgeDays",
    ]);
  });

  it("renames each of them onto the calendar list with the list it is given", () => {
    const list = (): unknown => [{ uid: "c1" }];
    for (const rename of legacyTakeover(list)) {
      expect(rename.to).toBe(CALENDAR_LIST_KEY);
      expect(rename.coerce?.(undefined)).toEqual([{ uid: "c1" }]);
    }
  });
});

describe("hasLegacySettings — the takeover of 0.20.x is due", () => {
  it("while any key of the single calendar still holds a value", () => {
    expect(hasLegacySettings({ country: "DE", calendars: [] })).toBe(true);
    expect(hasLegacySettings({ typePublic: false })).toBe(true);
    expect(hasLegacySettings({ excludeHolidays: [] })).toBe(true);
  });

  it("not once every key is cleared (null) or absent", () => {
    expect(hasLegacySettings(Object.fromEntries(LEGACY_SETTING_KEYS.map(k => [k, null])))).toBe(false);
    expect(hasLegacySettings({ calendars: [], deleteRecordedStates: true })).toBe(false);
  });
});

describe("legacyCalendar — the first calendar from the settings of 0.20.x", () => {
  it("keeps every setting and gets the standard id and the automatic name", () => {
    expect(
      legacyCalendar(
        {
          country: "AT",
          state: "",
          region: "",
          typePublic: false,
          typeBank: true,
          excludeHolidays: ["12-24"],
          includeBridgeDays: true,
        },
        "DE",
      ),
    ).toEqual({
      uid: "c1",
      name: "",
      nameAuto: true,
      id: "at-bank",
      country: "AT",
      state: "",
      region: "",
      typePublic: false,
      typeBank: true,
      typeSchool: false,
      typeOptional: false,
      typeObservance: false,
      excludeHolidays: ["12-24"],
      includeBridgeDays: true,
    });
  });

  it("no country stored: the calendar follows the system country, its areas named from it", () => {
    expect(legacyCalendar({ country: "", state: "6", typePublic: true }, "AT").id).toBe("system-steiermark-public");
  });

  it("a stored country NAME resolves like the runtime resolves it", () => {
    expect(calendarScope({ country: "Austria", typeBank: true }, "").country).toBe("AT");
    expect(legacyCalendar({ country: "Austria", typePublic: true }, "").id).toBe("at-public");
  });
});

describe("calendarName", () => {
  it("the stored name wins", () => {
    expect(calendarName({ name: " Mine ", country: "DE", typePublic: true }, "", "en")).toBe("Mine");
  });

  it("an empty name is the standard name in the system language", () => {
    expect(calendarName({ name: "", country: "DE", state: "BY", typePublic: true }, "", "de")).toBe(
      "Deutschland · Bayern",
    );
  });
});

describe("readCalendarList", () => {
  it("is null when the setting holds no list — a damaged setting", () => {
    expect(readCalendarList({})).toBeNull();
    expect(readCalendarList({ calendars: "x" })).toBeNull();
  });

  it("drops entries that are no records", () => {
    expect(readCalendarList({ calendars: [{ id: "a" }, null, 3, [], { id: "b" }] })).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });
});

describe("usableCalendars", () => {
  it("runs each calendar with a valid id, the first of an id held twice", () => {
    const { calendars, skipped } = usableCalendars([
      { uid: "c1", id: "a" },
      { uid: "c2", id: "B C" },
      { uid: "c3", id: "a" },
      { uid: "c4" },
      { id: "d" },
    ]);
    expect(calendars.map(c => [c.uid, c.id])).toEqual([
      ["c1", "a"],
      ["", "d"],
    ]);
    expect(skipped).toEqual([
      { position: 2, reason: "id", id: "B C" },
      { position: 3, reason: "duplicate", id: "a" },
      { position: 4, reason: "id", id: "" },
    ]);
  });
});
