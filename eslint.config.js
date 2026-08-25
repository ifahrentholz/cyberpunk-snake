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
    files: ['**/*.{ts,mts,cts}'],
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
      // imports nothing of ours. Structural, not enumerated: anything
      // outside src/logic is off limits, rather than a list of today's
      // sibling directories. A future src/shared (or any other addition)
      // can't silently open an indirect route into input/renderer, because
      // it's covered by "everything outside src/logic" from the start.
      'import/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/logic',
              from: './src',
              except: ['./logic'],
              message:
                'src/logic is the pure game-logic layer and must not import anything outside src/logic (see issue #1).',
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
    //
    // WHY THIS IS AN ALLOW-LIST, NOT A DENY-LIST: a deny-list has to be
    // extended every time someone invents a new route to impurity (a new
    // Web API, a new Node built-in, a new indirection trick) — it only
    // protects against routes someone already thought of. An allow-list
    // fails closed: anything not explicitly granted is an error, including
    // anything invented later. That property is the entire point of this
    // guard and is why it's built this way rather than as a longer
    // no-restricted-globals/no-restricted-properties list. See the history
    // of this block (two prior review rounds) for what a deny-list missed:
    // window/document escapes, Math.random, then new Date().getTime(),
    // crypto.getRandomValues, globalThis.Math.random(), setTimeout,
    // localStorage, then Node built-in imports (node:crypto, node:perf_hooks,
    // bare 'crypto') and .mts/.cts files. Each round closed a category, not
    // one example — that's the allow-list model working as intended.
    //
    // `no-undef` is off project-wide via typescript-eslint's recommended
    // config, so it's re-enabled here with a minimal, explicit set of
    // permitted globals. Anything not granted — crypto, localStorage,
    // sessionStorage, navigator, fetch, setTimeout, setInterval,
    // requestAnimationFrame, window, document, ... — is an error by
    // default. `globalThis` is explicitly revoked too, even though
    // `languageOptions.ecmaVersion` would otherwise grant it automatically:
    // it's a generic escape hatch back to every other global (e.g.
    // `globalThis.Math.random()`), so leaving it available would undermine
    // the allow-list itself.
    //
    // KNOWN CEILING: this is lint-based enforcement, not a sandbox. Runtime
    // reflection through `.constructor` (e.g.
    // `Array.constructor("return globalThis")()`) is not caught and is not
    // worth chasing — closing it costs more (banning `.constructor` property
    // access generally) than it buys (deliberately obfuscated code is not
    // the threat model here; a plausible contributor reaching for a Web API
    // or a Node built-in is).
    files: ['src/logic/**/*.{ts,mts,cts}'],
    languageOptions: {
      globals: {
        // Deliberately permitted pure, deterministic built-ins.
        Array: 'readonly',
        Object: 'readonly',
        Math: 'readonly',
        Number: 'readonly',
        String: 'readonly',
        Boolean: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        JSON: 'readonly',
        Symbol: 'readonly',
        undefined: 'readonly',
        NaN: 'readonly',
        Infinity: 'readonly',
        // Explicitly revoked even though ecmaVersion would otherwise grant
        // it automatically (see comment above).
        globalThis: 'off',
        // Everything else is intentionally absent and therefore flagged
        // by no-undef.
      },
    },
    rules: {
      'no-undef': 'error',
      // `Date` is also a clock and must be denied, but typescript-eslint's
      // scope manager treats it (unlike globalThis) as always resolved
      // from the TS lib types no matter what `languageOptions.globals`
      // says, so `no-undef` alone can't revoke it — hence the explicit
      // deny here. window/document get the same treatment for a clearer,
      // more specific message than the generic "not defined".
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Logic must not touch the DOM.' },
        { name: 'document', message: 'Logic must not touch the DOM.' },
        { name: 'Date', message: 'Logic must not read the clock.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Inject an rng parameter instead of reading Math.random in logic.',
        },
      ],
      // Globals alone don't cover this: `import { randomInt } from
      // 'node:crypto'` or `import crypto from 'crypto'` is a module-scoped
      // binding, not a global reference, so no-undef never sees it. Node
      // built-ins are exactly the kind of impurity a contributor reaches
      // for before internalising the injected-rng convention.
      'import/no-nodejs-modules': 'error',
    },
  },
);
