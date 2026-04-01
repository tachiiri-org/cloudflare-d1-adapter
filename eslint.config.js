// eslint.config.js (ESLint v9+ Flat Config)
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['dist/**', '.wrangler/**', 'generated/**', 'node_modules/**'],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  eslintConfigPrettier,

  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['scripts/**/*.{ts,mjs,js}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
