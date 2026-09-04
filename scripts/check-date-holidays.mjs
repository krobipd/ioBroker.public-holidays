#!/usr/bin/env node
// Release gate: keep the bundled `date-holidays` current AND keep the admin card's bundled copy
// in lockstep with the runtime's. Wired into the release flow via .releaseconfig.json:before_commit.
//
// date-holidays ships holiday DATA (new countries, changed dates) in patch/minor releases. The
// root dependency is a caret range kept current by pre-release's `npm update` (in-range).
//
// Currency (non-blocking): installed < latest only happens for a new MAJOR (in-range gaps are
// closed by npm update). A major is an API change that needs a deliberate migration, so it is
// surfaced loudly but must not auto-block an unrelated hotfix release.
//
// Parity (the reason this gate touches src-admin): the admin card (src-admin) bundles its OWN
// date-holidays at build time and computes the country/state/region cascade + live preview from
// it, while the runtime uses the root-installed copy. src-admin is exact-pinned and ignored by
// dependabot, so it never moves on its own — if the two drift the card can offer a scope the
// runtime doesn't compute. This gate pins src-admin to the version the runtime actually resolves
// and installs it, so the shipped card always sees the same holiday data. The independent guard
// src/lib/date-holidays-version-parity.test.ts fails CI if this ever drifts.
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const requireFrom = createRequire(import.meta.url);
const installed = requireFrom("date-holidays/package.json").version;

// --- 1. currency check against npm (non-blocking) ---
let latest = null;
try {
  latest = execSync("npm view date-holidays version", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch (e) {
  console.warn(`⚠️  Could not query npm for the latest date-holidays version (${e.message}). Skipping currency check.`);
}
if (latest && installed !== latest) {
  console.warn(
    `⚠️  date-holidays is behind: installed ${installed}, latest ${latest}.\n` +
      `   In-range updates are applied automatically; a remaining gap means a new MAJOR is\n` +
      `   available. Review it deliberately (not blocking this release):\n` +
      `     npm install date-holidays@latest   (then re-run the tests)`,
  );
} else if (latest) {
  console.log(`✓ date-holidays is up to date (${installed}).`);
}

// --- 2. raise the DECLARED floor in package.json to the installed version ---
// This is the half that actually reaches users. Our package-lock.json governs this repo and CI
// only — an ioBroker installation runs `npm install` into the shared /opt/iobroker tree, where
// nothing but the declared RANGE decides. A floor left at an old version is therefore satisfied
// by whatever ancient copy already sits in that tree, and no release ever moves it: measured
// 2026-09-04 on krobi's server, which still ran 3.30.2 while this repo was six data releases
// ahead — with the visible consequence that a day classified as a public holiday back then was
// still reported as one. Raising the floor on every release is what forces the update.
const adapterRoot = fileURLToPath(new URL("..", import.meta.url));
const rootPkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
const rootSrc = readFileSync(rootPkgPath, "utf8");
const floorRe = /("date-holidays":\s*")([^"]+)(")/;
const declaredFloor = rootSrc.match(floorRe)?.[2];
if (declaredFloor === undefined) {
  console.error("✗ Could not find the date-holidays dependency in package.json.");
  process.exit(1);
}
const wantedFloor = `^${installed}`;
if (declaredFloor !== wantedFloor) {
  console.log(`↻ Raising the declared date-holidays floor ${declaredFloor} → ${wantedFloor} (reaches installations).`);
  writeFileSync(rootPkgPath, rootSrc.replace(floorRe, `$1${wantedFloor}$3`));
  console.log(`✓ package.json floor raised to ${wantedFloor} — 'git add package.json' before commit.`);
} else {
  console.log(`✓ declared date-holidays floor is current (${wantedFloor}).`);
}

// --- 3. pin the admin card's bundled date-holidays to the runtime's version ---
const adminPkgPath = fileURLToPath(new URL("../src-admin/package.json", import.meta.url));
const adminSrc = readFileSync(adminPkgPath, "utf8");
const pinRe = /("date-holidays":\s*")([^"]+)(")/;
const adminPinned = adminSrc.match(pinRe)?.[2];
if (adminPinned === undefined) {
  console.error("✗ Could not find the date-holidays pin in src-admin/package.json.");
  process.exit(1);
}
if (adminPinned !== installed) {
  console.log(`↻ Syncing src-admin date-holidays ${adminPinned} → ${installed} (must match the runtime).`);
  writeFileSync(adminPkgPath, adminSrc.replace(pinRe, `$1${installed}$3`));
  execSync("npm install", { cwd: `${adapterRoot}src-admin`, stdio: "inherit" });
  console.log(`✓ src-admin date-holidays synced to ${installed} — 'git add src-admin/package.json' before commit.`);
} else {
  console.log(`✓ src-admin date-holidays matches the runtime (${installed}).`);
}
