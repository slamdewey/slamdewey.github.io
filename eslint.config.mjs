import globals from 'globals';
import pluginJs from '@eslint/js';
import pluginTs from 'typescript-eslint';
import { includeIgnoreFile } from '@eslint/compat';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'eslint-config-prettier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const gitignorePath = path.resolve(__dirname, '.gitignore');

export default [
  includeIgnoreFile(gitignorePath),
  {
    languageOptions: { globals: globals.browser },
  },
  {
    ...pluginJs.configs.recommended,
    files: ['**/*.{js,mjs}'],
    ignores: ['imageJsonBuilder.js'],
  },
  {
    ...pluginTs.configs.recommended,
    files: ['**/*.{ts}'],
  },
  {
    ignores: ['dist/*'],
  },
  prettier,
];