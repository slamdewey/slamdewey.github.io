import { defineConfig } from "eslint/config";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import angular from "angular-eslint";
import prettier from "eslint-config-prettier";
import unusedImports from 'eslint-plugin-unused-imports';

export default defineConfig([
  {
    ignores: ["dist/", "node_modules/"]
  },
  {
    files: ["src/**/*.ts"],
    extends: [
      eslint.configs.recommended,
      prettier,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    plugins: {
      "unused-imports": unusedImports
    },
    rules: {
      "no-case-declarations": "off", // what's the point of this rule? to put functions everywhere?
      "@typescript-eslint/no-empty-function": "off", // required for virtual functions
      "@typescript-eslint/no-explicit-any": "off", // required for complex marshalling
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: "x", style: "camelCase" },
      ],
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: "x", style: "kebab-case" },
      ],
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          "vars": "all",
          "varsIgnorePattern": "^_",
          "args": "after-used",
          "argsIgnorePattern": "^_"
        }
      ]
    },
    processor: angular.processInlineTemplates,
  },
  {
    files: ["src/**/*.html"],
    extends: [
      eslint.configs.recommended,
      prettier,
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {},
  },
]);