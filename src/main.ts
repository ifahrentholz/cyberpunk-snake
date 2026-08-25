/**
 * Composition entry point — the only place allowed to wire the logic,
 * input, renderer and persistence layers together. Once the real modules
 * land (issues #3, #5, #6), this is also where the fixed-tickrate
 * requestAnimationFrame loop lives (see issue #1, Implementation Decisions).
 */
import { logicPlaceholder } from './logic';
import { inputPlaceholder } from './input';
import { rendererPlaceholder } from './renderer';
import { persistencePlaceholder, readHighscorePlaceholder } from './persistence';

export interface AppComposition {
  readonly logic: typeof logicPlaceholder;
  readonly input: typeof inputPlaceholder;
  readonly renderer: typeof rendererPlaceholder;
  readonly persistence: typeof persistencePlaceholder;
  readonly highscore: number;
}

export function composeApp(): AppComposition {
  return {
    logic: logicPlaceholder,
    input: inputPlaceholder,
    renderer: rendererPlaceholder,
    persistence: persistencePlaceholder,
    highscore: readHighscorePlaceholder(),
  };
}

// Only bootstrap for real in the browser, not when this module is imported
// under the jsdom test environment.
if (typeof document !== 'undefined' && import.meta.env.MODE !== 'test') {
  console.log('Cyberpunk Snake bootstrap', composeApp());
}
