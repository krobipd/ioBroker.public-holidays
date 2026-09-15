import { defineConfig } from "vitest/config";

// The admin card against the REAL @iobroker/json-config ConfigGeneric in jsdom (`npm run test:admin`).
// Kept apart from vitest.config.mts on purpose: these tests import React, MUI and json-config from
// src-admin/node_modules, which only exist after `npm run build:admin` — the root test matrix never
// installs them. The CI job `admin-component` runs this right after the build. The root config
// (and with it the release gate that counts the unit suite) does not see these files.
export default defineConfig({
  root: "src-admin",
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    watch: false,
    globals: false,
  },
});
