import { defineConfig } from "vitest/config";

// The card's own suite (fleet form, CLAUDE_ADMIN_UI.md § Komponenten-Suite): the card against the
// REAL @iobroker/json-config ConfigGeneric in jsdom. It lives in src-admin/ so the mutation harness
// sends a needle in a .tsx file here instead of to the root suite, which reads no .tsx. It needs
// src-admin/node_modules, which only exist after `npm run build:admin` — the root test matrix never
// installs them; the CI job `admin-component` runs `npm run test:admin` right after the build.
export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    watch: false,
    globals: false,
  },
});
