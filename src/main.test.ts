import { describe, expect, it } from 'vitest';
import { composeApp } from './main';

/**
 * Seam: the composition entry point. It must wire all four layers
 * (logic, input, renderer, persistence) together — the structural
 * requirement of this ticket — without implementing any of their real
 * behaviour yet (that's issues #3, #5, #6).
 */
describe('composeApp', () => {
  it('wires the logic, input, renderer and persistence layers together', () => {
    const app = composeApp();

    expect(app.logic.note).toContain('#3');
    expect(app.input.logic).toBe(app.logic);
    expect(app.renderer.logic).toBe(app.logic);
    expect(app.persistence.note).toBeTypeOf('string');
    expect(app.highscore).toBe(0);
  });
});
