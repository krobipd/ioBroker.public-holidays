#!/usr/bin/env node
// Release check: surface whether the bundled `date-holidays` library is the latest
// published version. date-holidays ships holiday DATA (new countries, changed dates)
// in patch/minor releases — those are kept current automatically by pre-release's
// `npm update` (in-range), and `npm run generate` (next before_commit hook) re-derives
// admin/jsonConfig.json from whatever version is bundled. Wired into the release flow
// via .releaseconfig.json:before_commit.
//
// Behaviour (non-blocking by design):
//   - installed == latest        -> pass quietly
//   - installed  < latest        -> WARN. In practice this only happens when a new
//                                    MAJOR is available (in-range gaps are closed by
//                                    npm update). A major is an API change that needs a
//                                    deliberate migration, so it must not auto-block an
//                                    unrelated hotfix release — it is surfaced loudly here.
//   - npm unreachable (offline)  -> warn + pass
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const installed = require("date-holidays/package.json").version;

let latest;
try {
  latest = execSync("npm view date-holidays version", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch (e) {
  console.warn(`⚠️  Could not query npm for the latest date-holidays version (${e.message}). Skipping currency check.`);
  process.exit(0);
}

if (installed !== latest) {
  console.warn(
    `⚠️  date-holidays is behind: installed ${installed}, latest ${latest}.\n` +
      `   In-range updates are applied automatically; a remaining gap means a new MAJOR is\n` +
      `   available. Review it deliberately (not blocking this release):\n` +
      `     npm install date-holidays@latest && npm run generate   (then re-run the tests)`,
  );
  process.exit(0);
}

console.log(`✓ date-holidays is up to date (${installed}).`);
