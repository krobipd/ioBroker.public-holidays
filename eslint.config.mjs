import config from "@iobroker/eslint-config";

export default [
  ...config,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["*.mjs", "vitest.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/no-blank-blocks": "off",
    },
  },
  {
    ignores: [
      ".dev-server/",
      ".vscode/",
      "**/*.test.ts",
      "*.test.js",
      "test/**",
      "*.config.mjs",
      "build",
      "admin",
      "coverage",
      "node_modules",
      "scripts",
      "**/adapter-config.d.ts",
    ],
  },
];
