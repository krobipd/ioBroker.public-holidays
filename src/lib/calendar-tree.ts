import type { KnownObjects } from "./known-objects";
import type { CalendarFolder } from "./state-publisher";

/*
 * The calendar folders follow the settings: the folder of a calendar that was deleted goes, with
 * everything below it, through the fleet removal — the user's deletion options decide about a
 * recorded datapoint (object-removal.ts).
 *
 * A folder that has to MOVE — the tree of 0.20.x into the first calendar's folder, a folder whose
 * calendar got a new id — is never deleted here: the move is the fleet's move master (Werkbank,
 * answer 99eb2a0a9bce), which carries values, recordings, rooms, functions and aliases. Until it
 * runs, such a folder stays where it is.
 */

/** What a pass did — a removal makes the run wait for the removal's report line. */
export interface TreeChanges {
  /** Folders whose calendar has a new id — the move master's work, old id → new id. */
  pendingMoves: Array<[string, string]>;
  /** Calendar folders removed with their calendar. */
  removed: string[];
}

/** The minimum of an object the pass reads. */
interface StoredObject {
  type?: unknown;
  native?: { uid?: unknown };
}

/**
 * The calendar folders in the tree: the folders directly below the instance that carry a calendar
 * uid in `native` (a folder the user made himself carries none and is never touched).
 *
 * @param known the own object tree, loaded
 * @param namespace the instance namespace
 * @returns folder id → its uid
 */
export function calendarFolders(known: KnownObjects, namespace: string): Map<string, string> {
  const folders = new Map<string, string>();
  for (const full of known.ids()) {
    const id = full.slice(namespace.length + 1);
    const obj = known.get(full) as StoredObject | undefined;
    if (!id.includes(".") && obj?.type === "folder" && obj.native && "uid" in obj.native) {
      folders.set(id, typeof obj.native.uid === "string" ? obj.native.uid : "");
    }
  }
  return folders;
}

/**
 * Bring the tree in line with the calendar list before the run publishes: a folder whose calendar
 * is gone is removed with everything below it; a folder whose calendar got a new id is left for
 * the move master and reported back.
 *
 * @param known the own object tree, loaded
 * @param namespace the instance namespace
 * @param calendars the calendars of the run with their folders, in list order
 * @returns the pending moves and what was removed
 */
export async function reconcileCalendarTree(
  known: KnownObjects,
  namespace: string,
  calendars: readonly CalendarFolder[],
): Promise<TreeChanges> {
  const changes: TreeChanges = { pendingMoves: [], removed: [] };
  const ids = new Set(calendars.map(c => c.id));
  for (const [id, uid] of calendarFolders(known, namespace)) {
    if (ids.has(id)) {
      continue;
    }
    const target = uid ? calendars.find(c => c.uid === uid) : undefined;
    if (target) {
      changes.pendingMoves.push([id, target.id]);
    } else {
      await known.remove(id, { recursive: true });
      changes.removed.push(id);
    }
  }
  return changes;
}
