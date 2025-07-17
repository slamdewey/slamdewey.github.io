import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import angular from "angular-eslint";
import prettier from "eslint-config-prettier";

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  ...angular.configs.tsRecommended,
  ...prettier,
  {
    files: ["**/*.ts"],
    processor: angular.processInlineTemplates,
    rules: {
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: "x", style: "camelCase" },
      ],
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: "x", style: "kebab-case" },
      ],
    },
  },
  ...angular.configs.templateRecommended,
  ...angular.configs.templateAccessibility,
  {
    files: ["**/*.html"],
    rules: {},
  },
];