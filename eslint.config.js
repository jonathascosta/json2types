// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // TypeScript checks the JavaScript files too (checkJs), so ESLint's own undefined-name rule
    // only gets in the way: it doesn't know Node's globals.
    files: ['**/*.{js,mjs}'],
    rules: { 'no-undef': 'off' },
  },
);
