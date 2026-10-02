import { describe, expect, it } from "vitest";
import { adapterFile } from "../../test/helpers";

// Two guards over the one date-holidays the adapter ships — fix either with `npm run update:date-holidays`.
//
// The FLOOR: the declared dependency range is the only thing that reaches an installation.
// `package-lock.json` governs this repo and CI; ioBroker installs the adapter with `npm install` into
// the shared /opt/iobroker tree, where an old copy that still satisfies the range is simply kept. A
// floor left behind therefore freezes the holiday DATA on every existing installation, release after
// release, while every gate here stays green — measured 2026-09-04: a server running 3.30.2 against a
// repo six data releases ahead, reporting a day as a public holiday that newer data classifies as an
// observance. The release run's npm update raises the floor; this guard makes the drift visible in
// between.
//
// The PARITY: the admin card bundles its OWN date-holidays at build time and computes the cascade and
// the live preview from it, while the runtime uses the root-installed one. src-admin is exact-pinned
// and ignored by dependabot, so the two only stay aligned if something forces it — a drift would let
// the card offer a country/state/region the runtime does not compute.

const version = (rel: string): string | undefined => (JSON.parse(adapterFile(rel)) as { version?: string }).version;
const dependency = (rel: string): string | undefined =>
  (JSON.parse(adapterFile(rel)) as { dependencies?: Record<string, string> }).dependencies?.["date-holidays"];

describe("date-holidays currency", () => {
  const installed = version("node_modules/date-holidays/package.json");

  it("package.json declares the installed version as its floor (what an installation actually gets)", () => {
    expect(dependency("package.json")).toBe(`^${installed}`);
  });

  it("src-admin pins exactly the date-holidays version the runtime resolves", () => {
    expect(dependency("src-admin/package.json")).toBe(installed);
  });
});
