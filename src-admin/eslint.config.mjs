// ioBroker eslint template configuration file for js and ts files
// Please note that esm or react based modules need additional modules loaded.
import config from "@iobroker/eslint-config";

export default [
  ...config,

  {
    // specify files to exclude from linting here
    ignores: [".__mf__temp/", "admin/", "**/*.test.js", "test/**/*.js", "*.config.mjs", "build/"],
  },
  {
    // The jsdom tests (`npm run test:admin`) are excluded from the component build's tsconfig.json
    // so `tsc && vite build` never compiles them; the type-aware rules therefore read them through
    // tsconfig.test.json instead of the project service.
    files: ["src/**/*.test.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: "./tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns-description": "off",
      "jsdoc/require-returns-check": "off",
    },
  },
];
