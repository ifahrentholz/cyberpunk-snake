// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: true,
      },
    },
    rules: {
      // The spec's central architectural constraint (issue #1): logic
      // imports nothing of ours; input and renderer may import logic.
      // Enforced mechanically rather than by convention/review only.
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/logic',
              from: ['./src/input', './src/renderer', './src/persistence', './src/main.ts'],
              message:
                'src/logic is the pure game-logic layer and must not import from input, renderer, persistence or the composition entry point (see issue #1).',
            },
          ],
        },
      ],
    },
  },
  {
    // src/logic must also stay free of the DOM, Math.random and the clock
    // (issue #1, Implementation Decisions: "Zufall wird injiziert" /
    // "Zeit wird nicht injiziert, sondern ausgeschlossen").
    files: ['src/logic/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Logic must not touch the DOM.' },
        { name: 'document', message: 'Logic must not touch the DOM.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Inject an rng parameter instead of reading Math.random in logic.',
        },
        { object: 'Date', property: 'now', message: 'Logic must not read the clock.' },
        { object: 'performance', property: 'now', message: 'Logic must not read the clock.' },
      ],
    },
  },
);
