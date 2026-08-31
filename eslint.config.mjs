import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // React rules only apply to the web app. The hooks rules catch stale and
  // duplicated dependency arrays, and the a11y rules catch the keyboard and
  // screen-reader gaps that plain review keeps missing.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // This codebase does not run the React Compiler, so "could not preserve
      // your memoization" is not actionable feedback here. The remaining
      // compiler-era rules (purity, refs) do flag real render-time bugs and
      // stay on as errors.
      'react-hooks/preserve-manual-memoization': 'off',
      // A warning, not an error: the remaining hits are "reset local state when
      // the thing being displayed changes" (new episode, new stream source, new
      // featured item). That is a legitimate effect, but each new one is worth a
      // second look — prefer deriving during render or `useSyncedState` first.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['apps/web/src/tests/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/server/src/generated/prisma/**',
      '*.config.js',
      '*.config.mjs',
    ],
  },
];
