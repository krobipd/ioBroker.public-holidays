import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts", "test/standards/*.test.ts"],
    watch: false,
    // vitest 5 dropped the per-pool option blocks: the old `forks: { singleFork: false }`
    // said "run the test files in parallel", which is now the default (`fileParallelism`),
    // so the option is gone rather than renamed. `pool` stays spelled out for clarity.
    pool: "forks",
    coverage: {
      // Honest coverage: count ALL source files, not only the ones imported
      // by tests (v8 default would silently hide untested files like main.ts).
      // src-admin's PURE modules belong in the count too — they are the admin card's
      // logic and are tested from here. Under vitest 4 they slipped in as imported
      // files; vitest 5 honours `include` strictly, so they are named explicitly.
      // The .tsx components stay out: they are verified by the admin render gate.
      include: ["src/**/*.ts", "src-admin/src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    },
  },
});
