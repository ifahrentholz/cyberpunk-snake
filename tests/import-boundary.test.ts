import { afterEach, describe, expect, it } from 'vitest';
import { ESLint, type ESLint as ESLintType } from 'eslint';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const eslintConfigPath = path.resolve(repoRoot, 'eslint.config.js');

/**
 * Seam: the ESLint config itself (`eslint.config.js`). These tests lint
 * representative snippets *as if* they lived at real paths in `src/`,
 * using ESLint's `filePath` option, and assert the config mechanically
 * enforces the spec's central architectural constraint (issue #1):
 * `src/logic` imports nothing of ours and never touches the DOM,
 * `Math.random` or the clock.
 */
function createLinter(): ESLintType {
  return new ESLint({ overrideConfigFile: eslintConfigPath, cwd: repoRoot });
}

async function lintAsFile(eslint: ESLintType, filePath: string, code: string): Promise<ESLintType.LintResult> {
  const results = await eslint.lintText(code, { filePath });
  const result = results[0];
  if (!result) {
    throw new Error(`ESLint produced no result for ${filePath}`);
  }
  return result;
}

function ruleIds(result: ESLintType.LintResult): (string | null)[] {
  return result.messages.map((m) => m.ruleId);
}

describe('import boundary: src/logic imports nothing of ours', () => {
  it('flags src/logic importing from src/input', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/violation.ts'),
      "import { inputPlaceholder } from '../input';\nexport const x = inputPlaceholder;\n",
    );

    expect(ruleIds(result)).toContain('import/no-restricted-paths');
  });

  it('flags src/logic importing from src/renderer', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/violation2.ts'),
      "import { rendererPlaceholder } from '../renderer';\nexport const x = rendererPlaceholder;\n",
    );

    expect(ruleIds(result)).toContain('import/no-restricted-paths');
  });

  it('flags src/logic importing from src/persistence', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/violation3.ts'),
      "import { persistencePlaceholder } from '../persistence';\nexport const x = persistencePlaceholder;\n",
    );

    expect(ruleIds(result)).toContain('import/no-restricted-paths');
  });

  it('flags src/logic importing the composition entry point', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/violation4.ts'),
      "import { composeApp } from '../main';\nexport const x = composeApp;\n",
    );

    expect(ruleIds(result)).toContain('import/no-restricted-paths');
  });

  it('flags a nested src/logic file importing from a sibling layer', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/nested/deep/violation.ts'),
      "import { rendererPlaceholder } from '../../../renderer';\nexport const x = rendererPlaceholder;\n",
    );

    expect(ruleIds(result)).toContain('import/no-restricted-paths');
  });

  it('flags a type-only import from outside src/logic', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/violation-type-only.ts'),
      "import type { InputPlaceholder } from '../input';\nexport const x: InputPlaceholder | null = null;\n",
    );

    expect(ruleIds(result)).toContain('import/no-restricted-paths');
  });

  it('allows src/logic importing from a sibling file within src/logic itself', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/ok-sibling.ts'),
      "import { logicPlaceholder } from './index';\nexport const x = logicPlaceholder;\n",
    );

    expect(ruleIds(result)).not.toContain('import/no-restricted-paths');
  });

  it('allows src/input importing from src/logic', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/input/ok.ts'),
      "import { logicPlaceholder } from '../logic';\nexport const x = logicPlaceholder;\n",
    );

    expect(ruleIds(result)).not.toContain('import/no-restricted-paths');
  });

  it('allows src/renderer importing from src/logic', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/renderer/ok.ts'),
      "import { logicPlaceholder } from '../logic';\nexport const x = logicPlaceholder;\n",
    );

    expect(ruleIds(result)).not.toContain('import/no-restricted-paths');
  });

  describe('structural coverage: a directory that does not exist yet', () => {
    // The rule must not be an enumeration of today's four sibling
    // directories — it must block ANYTHING outside src/logic, including a
    // module a later ticket adds (e.g. src/shared) that nobody has
    // enumerated. Proven against the real filesystem/tsconfig (import
    // resolution needs the target to actually resolve), then cleaned up.
    const fixtureDir = path.resolve(repoRoot, 'src/__fixture_future_module__');

    afterEach(() => {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    });

    it('flags src/logic importing from a brand-new, never-enumerated sibling directory', async () => {
      fs.mkdirSync(fixtureDir, { recursive: true });
      fs.writeFileSync(path.join(fixtureDir, 'index.ts'), 'export const helper = 1;\n');

      const result = await lintAsFile(
        createLinter(),
        path.resolve(repoRoot, 'src/logic/violation-future.ts'),
        "import { helper } from '../__fixture_future_module__';\nexport const x = helper;\n",
      );

      expect(ruleIds(result)).toContain('import/no-restricted-paths');
    });
  });
});

describe('src/logic stays free of the DOM, Math.random and the clock (allow-list)', () => {
  // The five snippets below are exactly the ones that slipped through the
  // previous deny-list. They must all be caught now that no-undef is
  // re-enabled for src/logic with a minimal explicit set of permitted
  // globals — anything not granted is an error by default.
  const bypassSnippets: Record<string, string> = {
    'clock via Date instance method': 'export const x = new Date().getTime();\n',
    'random via Web Crypto': 'export const x = crypto.getRandomValues(new Uint8Array(1));\n',
    'random via globalThis indirection': 'export const x = globalThis.Math.random();\n',
    'clock/timer via setTimeout': 'export const x = setTimeout(() => {}, 0);\n',
    'DOM-adjacent persistence via localStorage': 'export const x = localStorage.getItem("k");\n',
  };

  it.each(Object.entries(bypassSnippets))('flags %s', async (_name, code) => {
    const result = await lintAsFile(createLinter(), path.resolve(repoRoot, 'src/logic/bypass.ts'), code);

    expect(result.messages.length).toBeGreaterThan(0);
  });

  const otherUngrantedGlobals: Record<string, string> = {
    sessionStorage: 'export const x = sessionStorage.getItem("k");\n',
    navigator: 'export const x = navigator.userAgent;\n',
    fetch: 'export const x = fetch("/x");\n',
    requestAnimationFrame: 'export const x = requestAnimationFrame(() => {});\n',
    setInterval: 'export const x = setInterval(() => {}, 0);\n',
  };

  it.each(Object.entries(otherUngrantedGlobals))('flags a reference to the global %s', async (_name, code) => {
    const result = await lintAsFile(createLinter(), path.resolve(repoRoot, 'src/logic/ungranted.ts'), code);

    expect(ruleIds(result)).toContain('no-undef');
  });

  it('flags a plain reference to window and document', async () => {
    const windowResult = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/dom-window.ts'),
      'export const x = window.innerWidth;\n',
    );
    const documentResult = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/dom-document.ts'),
      'export const x = document.title;\n',
    );

    expect(ruleIds(windowResult)).toContain('no-restricted-globals');
    expect(ruleIds(documentResult)).toContain('no-restricted-globals');
  });

  it('flags Math.random specifically, even though Math itself is allowed', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/random.ts'),
      'export const x = Math.random();\n',
    );

    expect(ruleIds(result)).toContain('no-restricted-properties');
  });

  it('lints legitimate pure logic clean: injected rng, non-random Math, plain TS types', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/ok-pure-logic.ts'),
      [
        'export interface Cell {',
        '  readonly x: number;',
        '  readonly y: number;',
        '}',
        '',
        'export function pickFreeCellIndex(freeCellCount: number, rng: () => number): number {',
        '  return Math.floor(rng() * freeCellCount);',
        '}',
        '',
        'export function cellsEqual(a: Cell, b: Cell): boolean {',
        '  return a.x === b.x && a.y === b.y;',
        '}',
        '',
        'export function toKey(cells: readonly Cell[]): Record<string, Cell> {',
        '  const out: Record<string, Cell> = {};',
        '  for (const cell of cells) {',
        '    out[`${cell.x},${cell.y}`] = cell;',
        '  }',
        '  return out;',
        '}',
        '',
      ].join('\n'),
    );

    expect(result.messages).toEqual([]);
  });
});

describe('src/logic cannot reach impurity through Node.js built-in imports', () => {
  // Globals alone don't see these: `import { randomInt } from 'node:crypto'`
  // is a module-scoped binding, not a global reference, so no-undef never
  // flags it. import/no-nodejs-modules closes that route.
  const nodeBuiltinImports: Record<string, string> = {
    "'node:crypto' (named import)": "import { randomInt } from 'node:crypto';\nexport const x = randomInt;\n",
    "'node:perf_hooks' (named import)": "import { performance } from 'node:perf_hooks';\nexport const x = performance;\n",
    "bare 'crypto' (default import)": "import crypto from 'crypto';\nexport const x = crypto;\n",
  };

  it.each(Object.entries(nodeBuiltinImports))('flags an import of %s', async (_name, code) => {
    const result = await lintAsFile(createLinter(), path.resolve(repoRoot, 'src/logic/node-bypass.ts'), code);

    expect(ruleIds(result)).toContain('import/no-nodejs-modules');
  });
});

describe('the guard also applies to .mts and .cts files under src/logic', () => {
  // Confirmed gap: before widening the `files` globs, neither config block
  // matched src/logic/*.mts or *.cts, so none of the above guarantees held
  // there at all.
  it('flags the clock in a .mts file', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/bypass.mts'),
      'export const x = new Date().getTime();\n',
    );

    expect(ruleIds(result)).toContain('no-restricted-globals');
  });

  it('flags the clock in a .cts file', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/bypass.cts'),
      'export const x = new Date().getTime();\n',
    );

    expect(ruleIds(result)).toContain('no-restricted-globals');
  });

  it('flags an import-boundary violation in a nested .mts file', async () => {
    const result = await lintAsFile(
      createLinter(),
      path.resolve(repoRoot, 'src/logic/nested/bypass.mts'),
      "import { rendererPlaceholder } from '../../renderer';\nexport const x = rendererPlaceholder;\n",
    );

    expect(ruleIds(result)).toContain('import/no-restricted-paths');
  });
});

describe('guarantee: a realistic pure reducer still lints completely clean', () => {
  // This is the point of the whole allow-list: it must stay usable for the
  // real reducer that issue #3 writes next, with no eslint-disable needed.
  // If a future fix to this guard breaks this test, the fix is wrong.
  it('lints a reducer using interfaces, a union type, Set, Math.floor, throw, spread, ?? and array methods clean', async () => {
    const code = [
      "export type Direction = 'up' | 'down' | 'left' | 'right';",
      '',
      'export interface Cell {',
      '  readonly x: number;',
      '  readonly y: number;',
      '}',
      '',
      'export interface Snake {',
      '  readonly segments: readonly Cell[];',
      '  readonly direction: Direction;',
      '}',
      '',
      'const OPPOSITES: Record<Direction, Direction> = {',
      "  up: 'down',",
      "  down: 'up',",
      "  left: 'right',",
      "  right: 'left',",
      '};',
      '',
      'export function isOpposite(a: Direction, b: Direction): boolean {',
      '  return OPPOSITES[a] === b;',
      '}',
      '',
      'export function nextHead(snake: Snake): Cell {',
      '  const head = snake.segments[0];',
      '  if (!head) {',
      "    throw new Error('snake has no segments');",
      '  }',
      '  const deltas: Record<Direction, Cell> = {',
      '    up: { x: 0, y: -1 },',
      '    down: { x: 0, y: 1 },',
      '    left: { x: -1, y: 0 },',
      '    right: { x: 1, y: 0 },',
      '  };',
      '  const delta = deltas[snake.direction];',
      '  return { x: head.x + delta.x, y: head.y + delta.y };',
      '}',
      '',
      'export function occupiedCells(snake: Snake): Set<string> {',
      '  return new Set(snake.segments.map((cell) => `${cell.x},${cell.y}`));',
      '}',
      '',
      'export function pickFreeCellIndex(freeCellCount: number, rng: () => number): number {',
      '  return Math.floor(rng() * freeCellCount);',
      '}',
      '',
      'export function scoreAfterEating(score: number | undefined): number {',
      '  return (score ?? 0) + 1;',
      '}',
      '',
      'export function withGrown(snake: Snake, extra: readonly Cell[]): Snake {',
      '  return { ...snake, segments: [...snake.segments, ...extra] };',
      '}',
      '',
    ].join('\n');

    const result = await lintAsFile(createLinter(), path.resolve(repoRoot, 'src/logic/ok-realistic-reducer.ts'), code);

    expect(result.messages).toEqual([]);
  });
});
