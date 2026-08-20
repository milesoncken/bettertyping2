import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "docs/**"] },
  {
    // Plain scripts are not typechecked, so `no-undef` is doing real work here
    // and needs to know what the runtime provides.
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      globals: {
        URL: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        window: "readonly",
        document: "readonly",
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "warn",
    },
  },
);
