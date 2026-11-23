import { describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({ I18n: { getTranslatedObject: (key: string) => ({ en: key }) } }));

import { calendarFolders, reconcileCalendarTree } from "./calendar-tree";
import { KnownObjects } from "./known-objects";

const NS = "public-holidays.0";

/**
 * A tree as the database holds it, read once like the run reads it.
 *
 * @param objects relative id → object
 * @returns the loaded store and the ids the database deleted
 */
async function tree(objects: Record<string, unknown>): Promise<{ known: KnownObjects; deleted: string[] }> {
  const db = new Map(Object.entries(objects).map(([id, o]) => [`${NS}.${id}`, structuredClone(o)]));
  const deleted: string[] = [];
  const adapter = {
    namespace: NS,
    config: { deleteRecordedStates: true, deleteRecordedHistory: false },
    log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
    getObjectListAsync: (p: { startkey: string; endkey: string }) =>
      Promise.resolve({
        rows: [...db.entries()]
          .filter(([id]) => id >= p.startkey && id <= p.endkey)
          .map(([id, value]) => ({ id, value: structuredClone(value) })),
      }),
    delObjectAsync: (id: string, options?: { recursive?: boolean }) => {
      const full = id.startsWith(`${NS}.`) ? id : `${NS}.${id}`;
      for (const key of [...db.keys()]) {
        if (key === full || (options?.recursive && key.startsWith(`${full}.`))) {
          db.delete(key);
          deleted.push(key.slice(NS.length + 1));
        }
      }
      return Promise.resolve();
    },
    sendToAsync: () => Promise.reject(new Error("no recording instance")),
    // no report timer — what the removal keeps is not this suite's question (as in the master's own tests)
    setTimeout: () => undefined,
    clearTimeout: () => undefined,
    extendObject: () => Promise.resolve(),
    setForeignObject: () => Promise.resolve(),
  };
  const known = new KnownObjects(adapter);
  await known.load();
  return { known, deleted };
}

const folder = (uid?: string): Record<string, unknown> => ({
  type: "folder",
  common: { name: "x" },
  native: uid === undefined ? {} : { uid },
});

describe("calendarFolders", () => {
  it("lists the folders directly below the instance that carry a calendar uid", async () => {
    const { known } = await tree({
      "de-public": folder("c1"),
      "de-public.today": { type: "channel" },
      mine: folder(),
      "deep.down": folder("c7"),
      broken: { type: "folder", native: { uid: 5 } },
    });
    expect([...calendarFolders(known, NS).entries()].sort()).toEqual([
      ["broken", ""],
      ["de-public", "c1"],
    ]);
  });
});

describe("reconcileCalendarTree", () => {
  const calendars = [
    { id: "de-by-public", uid: "c1", name: "A" },
    { id: "at-bank", uid: "c2", name: "B" },
  ];

  it("removes the folder of a deleted calendar with everything below it", async () => {
    const { known, deleted } = await tree({
      "de-by-public": folder("c1"),
      gone: folder("c9"),
      "gone.next": { type: "channel" },
      "gone.next.date": { type: "state" },
    });
    const changes = await reconcileCalendarTree(known, NS, calendars);
    expect(changes).toEqual({ pendingMoves: [], removed: ["gone"] });
    expect(deleted.sort()).toEqual(["gone", "gone.next", "gone.next.date"]);
  });

  it("leaves a folder whose calendar got a new id for the move master, and names it", async () => {
    const { known, deleted } = await tree({ "de-public": folder("c1") });
    const changes = await reconcileCalendarTree(known, NS, calendars);
    expect(changes).toEqual({ pendingMoves: [["de-public", "de-by-public"]], removed: [] });
    expect(deleted).toEqual([]);
  });

  it("never touches a folder without a calendar uid, a current folder or the tree of 0.20.x", async () => {
    const { known, deleted } = await tree({
      mine: folder(),
      "at-bank": folder("c2"),
      today: { type: "channel" },
      "today.name": { type: "state" },
    });
    const changes = await reconcileCalendarTree(known, NS, calendars);
    expect(changes).toEqual({ pendingMoves: [], removed: [] });
    expect(deleted).toEqual([]);
  });

  it("a folder whose uid is empty belongs to no calendar and goes", async () => {
    const { known } = await tree({ odd: { type: "folder", native: { uid: "" } } });
    expect((await reconcileCalendarTree(known, NS, calendars)).removed).toEqual(["odd"]);
  });
});
