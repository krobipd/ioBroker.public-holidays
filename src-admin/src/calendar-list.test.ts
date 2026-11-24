import { describe, expect, it } from "vitest";
import Holidays from "date-holidays";

import {
  addCalendar,
  copyCalendar,
  displayName,
  idProblem,
  moveCalendar,
  type NamingContext,
  nextUid,
  patchCalendar,
  rebuildCalendarId,
  removeCalendar,
  setCalendarName,
  treeChanges,
} from "./calendar-list";

const hd = new Holidays();
const ctx: NamingContext = {
  systemCountry: "DE",
  language: "en",
  source: hd,
  supported: new Set(Object.keys(hd.getCountries())),
};

const auto = (extra: Record<string, unknown>): Record<string, unknown> => ({
  uid: "c1",
  name: "",
  nameAuto: true,
  id: "",
  country: "",
  state: "",
  region: "",
  typePublic: true,
  ...extra,
});

describe("automatic name and id", () => {
  it("the id follows location and types, the name follows while automatic", () => {
    const [cal] = patchCalendar(
      [auto({ id: "system-public" })],
      0,
      { country: "AT", typePublic: false, typeBank: true },
      [],
      ctx,
    );
    expect(cal).toMatchObject({ id: "at-bank", name: "Austria", nameAuto: true });
  });

  it("the id takes the next free number when another calendar holds the standard id", () => {
    const list = [auto({ uid: "c1", id: "at-bank" }), auto({ uid: "c2", id: "system-public" })];
    expect(patchCalendar(list, 1, { country: "AT", typePublic: false, typeBank: true }, [], ctx)[1].id).toBe(
      "at-bank-2",
    );
  });

  it("a name the user gave stays, the id still follows the location", () => {
    const [cal] = patchCalendar([auto({ name: "Mine", nameAuto: false, id: "mine" })], 0, { country: "AT" }, [], ctx);
    expect(cal).toMatchObject({ name: "Mine", id: "at-public" });
  });

  it("bridge days, excludes and the name never move the folder — a -2 stays when its twin is gone", () => {
    const list = [auto({ uid: "c2", id: "de-by-public-2", country: "DE", state: "BY" })];
    expect(patchCalendar(list, 0, { includeBridgeDays: true }, list, ctx)[0].id).toBe("de-by-public-2");
    expect(patchCalendar(list, 0, { excludeHolidays: ["x"] }, list, ctx)[0].id).toBe("de-by-public-2");
    expect(setCalendarName(list, 0, "Heinz")[0].id).toBe("de-by-public-2");
  });

  it("an edit undone gives the saved id back and moves nothing", () => {
    const saved = [auto({ uid: "c2", id: "de-by-public-2", country: "DE", state: "BY" })];
    const changed = patchCalendar(saved, 0, { typeBank: true }, saved, ctx);
    expect(changed[0].id).toBe("de-by-public-bank");
    const undone = patchCalendar(changed, 0, { typeBank: false }, saved, ctx);
    expect(undone[0].id).toBe("de-by-public-2");
    expect(treeChanges(saved, undone)).toEqual({ moves: [], removals: [] });
  });

  it("a stored name is the display name, an empty one the standard name — the location only", () => {
    expect(displayName(auto({ name: "Mine" }), ctx)).toBe("Mine");
    expect(displayName(auto({ country: "DE", state: "BY", includeBridgeDays: true }), ctx)).toBe("Germany · Bayern");
  });
});

describe("the typed name and an id that cannot be saved", () => {
  it("a typed name is the user's from then on", () => {
    expect(setCalendarName([auto({})], 0, "Heinz")[0]).toMatchObject({ name: "Heinz", nameAuto: false });
  });

  it("an empty, invalid or twice held id cannot be saved", () => {
    expect(idProblem([auto({ id: "" })], 0)).toBe("missing");
    expect(idProblem([auto({ id: "a-" })], 0)).toBe("missing");
    expect(idProblem([auto({ id: "a" }), auto({ uid: "c2", id: "a" })], 1)).toBe("taken");
    expect(idProblem([auto({ id: "a" }), auto({ uid: "c2", id: "b" })], 1)).toBeNull();
  });

  it("the button builds the standard id, with the next free number when it is held", () => {
    expect(rebuildCalendarId([auto({ id: "", country: "DE", state: "BY" })], 0, ctx)[0].id).toBe("de-by-public");
    const twice = [
      auto({ uid: "c1", id: "de-by-public", country: "DE", state: "BY" }),
      auto({ uid: "c2", id: "de-by-public", country: "DE", state: "BY" }),
    ];
    expect(rebuildCalendarId(twice, 1, ctx).map(c => c.id)).toEqual(["de-by-public", "de-by-public-2"]);
  });

  it("an id that cannot be saved changes only by the button or a new location — bridge days leave it", () => {
    const list = [auto({ id: "", country: "DE", state: "BY" })];
    expect(patchCalendar(list, 0, { includeBridgeDays: true }, list, ctx)[0].id).toBe("");
    expect(patchCalendar([auto({ id: "a-", country: "DE" })], 0, { excludeHolidays: ["x"] }, [], ctx)[0].id).toBe("a-");
    expect(patchCalendar(list, 0, { state: "BE" }, list, ctx)[0].id).toBe("de-be-public");
  });
});

describe("list operations", () => {
  const list = [auto({ uid: "c1", id: "one", name: "One" }), auto({ uid: "c2", id: "two", name: "Two" })];

  it("a new uid is above every uid of the list and of the saved list", () => {
    expect(nextUid(list, [])).toBe("c3");
    expect(nextUid([list[0]], [...list, auto({ uid: "c7" })])).toBe("c8");
    expect(nextUid([], [])).toBe("c1");
  });

  it("a new calendar starts as the single-calendar card did, with standard name and id", () => {
    const next = addCalendar(list, [], ctx);
    expect(next).toHaveLength(3);
    expect(next[2]).toMatchObject({
      uid: "c3",
      country: "",
      typePublic: true,
      id: "system-public",
      name: "System country",
      nameAuto: true,
    });
  });

  it("a copy sits below its source with every setting, its own uid, name and the standard id", () => {
    const next = copyCalendar(list, 0, [], "One (copy)", ctx);
    expect(next.map(c => c.id)).toEqual(["one", "system-public", "two"]);
    expect(next[1]).toMatchObject({ uid: "c3", name: "One (copy)", nameAuto: false, typePublic: true });
  });

  it("a copy of a -2 takes the next free number of the standard id, never -2-2", () => {
    const twins = [
      auto({ uid: "c1", id: "de-by-public", country: "DE", state: "BY" }),
      auto({ uid: "c2", id: "de-by-public-2", country: "DE", state: "BY" }),
    ];
    expect(copyCalendar(twins, 1, [], "x", ctx).map(c => c.id)).toEqual([
      "de-by-public",
      "de-by-public-2",
      "de-by-public-3",
    ]);
  });

  it("remove and move change only the list", () => {
    expect(removeCalendar(list, 0).map(c => c.uid)).toEqual(["c2"]);
    expect(moveCalendar(list, 1, -1).map(c => c.uid)).toEqual(["c2", "c1"]);
    expect(moveCalendar(list, 0, -1).map(c => c.uid)).toEqual(["c1", "c2"]);
    expect(moveCalendar(list, 1, 1).map(c => c.uid)).toEqual(["c1", "c2"]);
  });

  it("no operation changes the list it was given", () => {
    const before = JSON.stringify(list);
    patchCalendar(list, 0, { country: "AT" }, list, ctx);
    copyCalendar(list, 0, [], "x", ctx);
    removeCalendar(list, 0);
    moveCalendar(list, 0, 1);
    rebuildCalendarId(list, 0, ctx);
    setCalendarName(list, 0, "x");
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe("treeChanges — what saving changes in the object tree", () => {
  const saved = [auto({ uid: "c1", id: "one", name: "One" }), auto({ uid: "c2", id: "two", name: "Two" })];

  it("a calendar with a new id moves its folder", () => {
    const edited = [auto({ uid: "c1", id: "uno" }), saved[1]];
    expect(treeChanges(saved, edited)).toEqual({ moves: [{ uid: "c1", from: "one", to: "uno" }], removals: [] });
  });

  it("a deleted calendar takes its folder with it", () => {
    expect(treeChanges(saved, [saved[0]])).toEqual({ moves: [], removals: [{ id: "two", name: "Two" }] });
  });

  it("a folder whose id another calendar keeps stays — as the run decides it", () => {
    // c2 deleted, a new calendar takes the id "two": the run reuses the folder, nothing goes
    expect(treeChanges(saved, [saved[0], auto({ uid: "c3", id: "two" })])).toEqual({ moves: [], removals: [] });
  });

  it("an id that cannot be saved moves nothing yet", () => {
    expect(treeChanges(saved, [auto({ uid: "c1", id: "" }), saved[1]]).moves).toEqual([]);
  });

  it("nothing changed, nothing listed", () => {
    expect(treeChanges(saved, saved)).toEqual({ moves: [], removals: [] });
  });
});
