import { defineConfig } from "vitest/config";

// The card's own suite (fleet form, CLAUDE_ADMIN_UI.md § Komponenten-Suite): the card against the
// REAL @iobroker/json-config ConfigGeneric in jsdom. It lives in src-admin/ so the mutation harness
// sends a needle in a .tsx file here instead of to the root suite, which reads no .tsx. It needs
// src-admin/node_modules, which only exist after `npm run build:admin` — the root test matrix never
// installs them; the CI job `admin-component` runs `npm run test:admin` right after the build.
export default defineConfig({
  // The three suites above live outside this root — Vite serves only what `fs.allow` names.
  server: { fs: { allow: [".."] } },
  test: {
    environment: "jsdom",
    // The card's pure logic (scope-options, exclude-options) is tested from src/ — those suites also
    // run in the root matrix. They are listed here as well because the mutation harness sends a
    // needle in src-admin/src/*.ts to THIS suite (project_root_for): without them every such needle
    // would read as survived although a test catches it.
    include: [
      "src/**/*.test.{ts,tsx}",
      "../src/lib/scope-options.test.ts",
      "../src/lib/exclude-options.test.ts",
      "../src/lib/card-parity.test.ts",
    ],
    watch: false,
    globals: false,
  },
});
