import { describe, expect, it } from 'vitest';
import { ESLint, type ESLint as ESLintType } from 'eslint';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/**
 * Seam: the ESLint config's import-boundary rule.
 *
 * The spec's central architectural constraint is a one-way dependency:
 * logic imports nothing of ours; input and renderer may import logic.
 * These tests lint representative snippets *as if* they lived at real
 * paths in `src/`, using ESLint's `filePath` option, and assert the rule
 * mechanically catches a violation and allows the legitimate direction.
 */
function createLinter(): ESLintType {
  return new ESLint({
    overrideConfigFile: path.resolve(repoRoot, 'eslint.config.js'),
    cwd: repoRoot,
  });
}

async function lintAsFile(eslint: ESLintType, filePath: string, code: string): Promise<ESLintType.LintResult> {
  const results = await eslint.lintText(code, { filePath });
  const result = results[0];
  if (!result) {
    throw new Error(`ESLint produced no result for ${filePath}`);
  }
  return result;
}

describe('import boundary between src/logic and the other layers', () => {
  it('flags src/logic importing from src/input', async () => {
    const eslint = createLinter();
    const result = await lintAsFile(
      eslint,
      path.resolve(repoRoot, 'src/logic/violation.ts'),
      "import { inputPlaceholder } from '../input';\nexport const x = inputPlaceholder;\n",
    );

    expect(result.messages.some((m) => m.ruleId === 'import/no-restricted-paths')).toBe(true);
  });

  it('flags src/logic importing from src/renderer', async () => {
    const eslint = createLinter();
    const result = await lintAsFile(
      eslint,
      path.resolve(repoRoot, 'src/logic/violation2.ts'),
      "import { rendererPlaceholder } from '../renderer';\nexport const x = rendererPlaceholder;\n",
    );

    expect(result.messages.some((m) => m.ruleId === 'import/no-restricted-paths')).toBe(true);
  });

  it('flags src/logic importing from src/persistence', async () => {
    const eslint = createLinter();
    const result = await lintAsFile(
      eslint,
      path.resolve(repoRoot, 'src/logic/violation3.ts'),
      "import { persistencePlaceholder } from '../persistence';\nexport const x = persistencePlaceholder;\n",
    );

    expect(result.messages.some((m) => m.ruleId === 'import/no-restricted-paths')).toBe(true);
  });

  it('allows src/input importing from src/logic', async () => {
    const eslint = createLinter();
    const result = await lintAsFile(
      eslint,
      path.resolve(repoRoot, 'src/input/ok.ts'),
      "import { logicPlaceholder } from '../logic';\nexport const x = logicPlaceholder;\n",
    );

    expect(result.messages.some((m) => m.ruleId === 'import/no-restricted-paths')).toBe(false);
  });

  it('allows src/renderer importing from src/logic', async () => {
    const eslint = createLinter();
    const result = await lintAsFile(
      eslint,
      path.resolve(repoRoot, 'src/renderer/ok.ts'),
      "import { logicPlaceholder } from '../logic';\nexport const x = logicPlaceholder;\n",
    );

    expect(result.messages.some((m) => m.ruleId === 'import/no-restricted-paths')).toBe(false);
  });
});

describe('src/logic stays free of the DOM, Math.random and the clock', () => {
  it('flags a reference to Math.random', async () => {
    const eslint = createLinter();
    const result = await lintAsFile(
      eslint,
      path.resolve(repoRoot, 'src/logic/random-violation.ts'),
      'export const x = Math.random();\n',
    );

    expect(result.messages.some((m) => m.ruleId === 'no-restricted-properties')).toBe(true);
  });

  it('flags a reference to the global document', async () => {
    const eslint = createLinter();
    const result = await lintAsFile(
      eslint,
      path.resolve(repoRoot, 'src/logic/dom-violation.ts'),
      'export const x = document.title;\n',
    );

    expect(result.messages.some((m) => m.ruleId === 'no-restricted-globals')).toBe(true);
  });

  it('flags a reference to Date.now', async () => {
    const eslint = createLinter();
    const result = await lintAsFile(
      eslint,
      path.resolve(repoRoot, 'src/logic/clock-violation.ts'),
      'export const x = Date.now();\n',
    );

    expect(result.messages.some((m) => m.ruleId === 'no-restricted-properties')).toBe(true);
  });
});
