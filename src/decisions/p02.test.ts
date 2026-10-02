// P-02 — every datapoint is always there; no setting creates or omits single datapoints.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@iobroker/adapter-core", () => ({
  I18n: { getTranslatedObject: (key: string) => ({ en: key }) },
}));

import { emptyResult } from "../lib/holiday-engine";
import { KnownObjects } from "../lib/known-objects";
import { ensureObjects, publishStates } from "../lib/state-publisher";
import type { ComputedHolidays } from "../lib/types";

interface ManifestObject {
  _id: string;
  type: string;
}

const MANIFEST = (
  JSON.parse(readFileSync(join(process.cwd(), "io-package.json"), "utf8")) as { instanceObjects: ManifestObject[] }
).instanceObjects;

function fakeAdapter(): { objects: string[]; states: string[]; adapter: Parameters<typeof publishStates>[0] } {
  const objects: string[] = [];
  const states: string[] = [];
  const adapter = {
    namespace: "public-holidays.0",
    log: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    getObjectListAsync: () => Promise.resolve({ rows: [] }),
    extendObject: (id: string) => {
      objects.push(id);
      return Promise.resolve();
    },
    getStatesAsync: () => Promise.resolve({}),
    setState: (id: string) => {
      states.push(id);
      return Promise.resolve();
    },
  };
  return { objects, states, adapter: adapter as unknown as Parameters<typeof publishStates>[0] };
}

const FULL: ComputedHolidays = {
  yesterday: { name: "A", isHoliday: true },
  today: { name: "B", isHoliday: true },
  tomorrow: { name: "C", isHoliday: true },
  dayAfterTomorrow: { name: "D", isHoliday: true },
  next: { name: "E", isHoliday: true, date: "2026-10-26", daysUntil: 3 },
  unmatchedExcludes: [],
};

describe("P-02 every datapoint is always there", () => {
  it("P-02: every object of the manifest is created on every run", async () => {
    const { objects, adapter } = fakeAdapter();
    const known = new KnownObjects(adapter);
    await known.load();
    await ensureObjects(adapter, known);
    expect([...objects].sort()).toEqual(MANIFEST.map(o => o._id).sort());
  });

  it("P-02: every state of the manifest is written, whether the run found holidays or none", async () => {
    const stateIds = MANIFEST.filter(o => o.type === "state")
      .map(o => o._id)
      .sort();
    for (const computed of [FULL, emptyResult()]) {
      const { states, adapter } = fakeAdapter();
      await publishStates(adapter, computed);
      expect([...states].sort()).toEqual(stateIds);
    }
  });
});
