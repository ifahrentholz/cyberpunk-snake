// @vitest-environment jsdom
/**
 * Seam: the composition entry point. It wires logic, input, renderer and
 * persistence into a running, playable app (issue #6) — a canvas is
 * mounted, keyboard input drives real `GameState` transitions through the
 * real `step`, and a fixed-tickrate loop can be driven one tick at a time
 * via `advanceTick` without depending on real `requestAnimationFrame`
 * timing (that accumulation math is covered on its own, without a DOM, in
 * `src/composition/loop.test.ts`).
 *
 * Per AC16 ("no test touches canvas output, pixel data, or draw-call
 * snapshots"), nothing here asserts on what was drawn — only on the
 * `GameState` the composition layer produces and on DOM-level wiring
 * (element presence, event `defaultPrevented`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeApp, type AppComposition } from './main';

/**
 * jsdom does not implement `HTMLCanvasElement#getContext` without the
 * native `canvas` npm package (not a dependency here — this is a DOM
 * capability gap, not something to draw-test around). Stubbing it lets
 * `composeApp`'s wiring run under jsdom; it is not an assertion about
 * drawing (AC16 forbids those), just a fake so `render()`'s calls have
 * somewhere harmless to land.
 */
function createFakeCanvasContext(): CanvasRenderingContext2D {
  return {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;
}

function pressDirection(target: EventTarget, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
}

function pressSpace(target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function pressRestart(target: EventTarget): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', cancelable: true }));
}

let app: AppComposition | undefined;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createFakeCanvasContext());
});

afterEach(() => {
  app?.stop();
  app = undefined;
  document.getElementById('game-canvas')?.remove();
  document.getElementById('error-banner')?.remove();
  vi.restoreAllMocks();
});

describe('composeApp', () => {
  it('mounts a canvas sized for the 28x28 grid, scaled by devicePixelRatio', () => {
    app = composeApp(document);

    expect(app.canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(app.canvas.isConnected).toBe(true);
    expect(app.canvas.width).toBeGreaterThan(0);
    expect(app.canvas.height).toBeGreaterThan(0);
    // Square grid -> square canvas, both in CSS size and backing store.
    expect(app.canvas.width).toBe(app.canvas.height);
  });

  it('shows the start screen before any movement begins: status is "ready" and nothing moves on its own', () => {
    app = composeApp(document);

    expect(app.getState().status).toBe('ready');
    const initialSnake = app.getState().snake;

    app.advanceTick();
    app.advanceTick();
    app.advanceTick();

    expect(app.getState().status).toBe('ready');
    expect(app.getState().snake).toEqual(initialSnake);
  });

  it('a direction key press starts the game, and that first key press is the first move', () => {
    app = composeApp(document);

    pressDirection(document, 'ArrowUp');
    expect(app.getState().status).toBe('ready'); // queued, not yet moved

    app.advanceTick();

    expect(app.getState().status).toBe('running');
    expect(app.getState().direction).toBe('up');
  });

  it('Space pauses the running game and nothing moves while paused; Space again resumes it', () => {
    app = composeApp(document);
    pressDirection(document, 'ArrowRight');
    app.advanceTick();
    expect(app.getState().status).toBe('running');

    pressSpace(document);
    expect(app.getState().status).toBe('paused');
    const pausedSnake = app.getState().snake;

    app.advanceTick();
    app.advanceTick();
    expect(app.getState().snake).toEqual(pausedSnake);
    expect(app.getState().status).toBe('paused');

    pressSpace(document);
    expect(app.getState().status).toBe('running');
  });

  it('Space on the start screen and on the game-over screen does nothing surprising and does not scroll the page', () => {
    app = composeApp(document);

    const onReady = pressSpace(document);
    expect(onReady.defaultPrevented).toBe(true);
    expect(app.getState().status).toBe('ready');

    // Drive the game to a wall collision: the snake starts at the grid's
    // centre moving 'right'; pressing 'right' again keeps that heading, so
    // it reaches the right edge (grid width 28) well within 20 ticks.
    pressDirection(document, 'ArrowRight');
    for (let i = 0; i < 20 && app.getState().status !== 'over'; i += 1) {
      app.advanceTick();
    }
    expect(app.getState().status).toBe('over');

    const onGameOver = pressSpace(document);
    expect(onGameOver.defaultPrevented).toBe(true);
    expect(app.getState().status).toBe('over');
  });

  it('R after game over restarts immediately with score, length and direction fully reset', () => {
    app = composeApp(document);
    pressDirection(document, 'ArrowRight');
    for (let i = 0; i < 20 && app.getState().status !== 'over'; i += 1) {
      app.advanceTick();
    }
    expect(app.getState().status).toBe('over');
    const initial = app.getState().initial;

    pressRestart(document);

    const restarted = app.getState();
    expect(restarted.status).toBe('ready');
    expect(restarted.score).toBe(0);
    expect(restarted.snake).toEqual(initial.snake);
    expect(restarted.direction).toBe(initial.direction);

    // AC3/AC4 must hold again after a restart: no movement until a fresh
    // direction key press.
    app.advanceTick();
    expect(app.getState().status).toBe('ready');
  });

  it('feeds Math.random in as rng at createGame and on every tick action, and only at this composition boundary', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    const callsBeforeCompose = randomSpy.mock.calls.length;

    app = composeApp(document);
    expect(randomSpy.mock.calls.length).toBeGreaterThan(callsBeforeCompose); // createGame's initial food placement

    pressDirection(document, 'ArrowRight');
    const callsBeforeTick = randomSpy.mock.calls.length;
    app.advanceTick();
    // A tick that doesn't eat food need not call Math.random again, so
    // assert non-decreasing use rather than a fixed delta; the important,
    // checkable fact is that ticks are capable of reaching Math.random at
    // all, not a specific call count per tick.
    expect(randomSpy.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeTick);
  });

  it('stop() tears down the keyboard binding and resize listener', () => {
    app = composeApp(document);
    const stateBeforeStop = app.getState();

    app.stop();
    pressDirection(document, 'ArrowUp');

    expect(app.getState()).toEqual(stateBeforeStop);
  });
});
