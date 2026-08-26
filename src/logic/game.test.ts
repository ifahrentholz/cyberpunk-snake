import { describe, expect, it } from 'vitest'
import {
  createGame,
  step,
  type GameAction,
  type GameConfig,
  type GameState,
  type Position,
  type Rng,
} from './game'

/**
 * Deterministic linear-congruential generator. No `Math.random`, no
 * external entropy — same seed always yields the same sequence, so tests
 * stay reproducible without touching banned globals.
 */
function createSeededRng(seed: number): Rng {
  let state = seed % 2147483647
  if (state <= 0) {
    state += 2147483646
  }
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

function headOf(state: GameState): Position {
  const head = state.snake[0]
  if (!head) {
    throw new Error('Snake has no segments')
  }
  return head
}

const baseConfig: GameConfig = { gridWidth: 28, gridHeight: 28 }

function freshGame(config: GameConfig = baseConfig, seed = 42): GameState {
  return createGame(config, createSeededRng(seed))
}

// Shared rng for ticks that are not expected to eat food: it is never
// consulted unless the head lands on food, so its exact sequence is
// irrelevant for those tests. Tests that specifically exercise food
// respawn use their own dedicated, documented rng instead.
const inertTickRng: Rng = createSeededRng(1)

function tick(rng: Rng = inertTickRng): GameAction {
  return { type: 'tick', rng }
}

describe('createGame', () => {
  it('starts in the ready status with score 0 and no queued direction', () => {
    const state = freshGame()
    expect(state.status).toBe('ready')
    expect(state.score).toBe(0)
    expect(state.queuedDirection).toBeNull()
    expect(state.direction).toBe('right')
  })

  it('places the snake and food inside the configured grid, not overlapping', () => {
    const state = freshGame()
    for (const cell of state.snake) {
      expect(cell.x).toBeGreaterThanOrEqual(0)
      expect(cell.x).toBeLessThan(baseConfig.gridWidth)
      expect(cell.y).toBeGreaterThanOrEqual(0)
      expect(cell.y).toBeLessThan(baseConfig.gridHeight)
    }
    expect(state.food.x).toBeGreaterThanOrEqual(0)
    expect(state.food.x).toBeLessThan(baseConfig.gridWidth)
    const onSnake = state.snake.some(
      (cell) => cell.x === state.food.x && cell.y === state.food.y,
    )
    expect(onSnake).toBe(false)
  })

  it('is deterministic: the same rng sequence yields the same food position', () => {
    const a = createGame(baseConfig, createSeededRng(7))
    const b = createGame(baseConfig, createSeededRng(7))
    expect(a.food).toEqual(b.food)
    expect(a.snake).toEqual(b.snake)
  })

  it('produces state that survives a JSON round trip unchanged', () => {
    const state = freshGame()
    const roundTripped = JSON.parse(JSON.stringify(state))
    expect(roundTripped).toEqual(state)
  })
})

describe('step: starting and moving', () => {
  it('transitions from ready to running on the first tick and moves the head', () => {
    const state = freshGame()
    const head = headOf(state)
    const next = step(state, tick())
    expect(next.status).toBe('running')
    expect(next.snake[0]).toEqual({ x: head.x + 1, y: head.y })
    expect(next.snake.length).toBe(state.snake.length)
  })

  it('keeps moving forward, one cell per tick, without changing length', () => {
    let state = step(freshGame(), tick())
    const firstHead = headOf(state)
    state = step(state, tick())
    expect(state.snake[0]).toEqual({ x: firstHead.x + 1, y: firstHead.y })
    expect(state.snake.length).toBe(3)
  })
})

describe('step: moves in every direction (AC3)', () => {
  it('moves right by default', () => {
    const state = step(freshGame(), tick())
    const head = headOf(state)
    const moved = step(state, tick())
    expect(moved.direction).toBe('right')
    expect(moved.snake[0]).toEqual({ x: head.x + 1, y: head.y })
  })

  it('moves up after a valid turn', () => {
    let state = step(freshGame(), tick())
    state = step(state, { type: 'direction', direction: 'up' })
    state = step(state, tick())
    const head = headOf(state)
    const moved = step(state, tick())
    expect(moved.direction).toBe('up')
    expect(moved.snake[0]).toEqual({ x: head.x, y: head.y - 1 })
  })

  it('moves down after a valid turn', () => {
    let state = step(freshGame(), tick())
    state = step(state, { type: 'direction', direction: 'down' })
    state = step(state, tick())
    const head = headOf(state)
    const moved = step(state, tick())
    expect(moved.direction).toBe('down')
    expect(moved.snake[0]).toEqual({ x: head.x, y: head.y + 1 })
  })

  it('moves left after two valid turns', () => {
    // 'right' cannot turn directly into 'left' (180-degree reversal), so
    // reach it via an intermediate perpendicular turn, same as a player would.
    let state = step(freshGame(), tick())
    state = step(state, { type: 'direction', direction: 'down' })
    state = step(state, tick())
    state = step(state, { type: 'direction', direction: 'left' })
    state = step(state, tick())
    const head = headOf(state)
    const moved = step(state, tick())
    expect(moved.direction).toBe('left')
    expect(moved.snake[0]).toEqual({ x: head.x - 1, y: head.y })
  })
})

describe('step: turning', () => {
  it('applies a valid perpendicular turn on the next tick', () => {
    const state = step(freshGame(), tick())
    const head = headOf(state)
    const turned = step(state, { type: 'direction', direction: 'up' })
    expect(turned.direction).toBe('right')
    const moved = step(turned, tick())
    expect(moved.direction).toBe('up')
    expect(moved.snake[0]).toEqual({ x: head.x, y: head.y - 1 })
  })

  it('ignores a direct 180-degree reversal and keeps the previous direction', () => {
    const state = step(freshGame(), tick())
    const head = headOf(state)
    const reversed = step(state, { type: 'direction', direction: 'left' })
    const moved = step(reversed, tick())
    expect(moved.direction).toBe('right')
    expect(moved.snake[0]).toEqual({ x: head.x + 1, y: head.y })
    expect(moved.status).toBe('running')
  })

  it('checks the queued direction against the last EXECUTED direction, not the last queued one', () => {
    // Moving right. Queue 'up' then overwrite with 'left' before any tick
    // happens. A buggy implementation that checks the new input against the
    // previously *queued* value ('up') would accept 'left'. The correct
    // implementation checks against the last *executed* direction ('right')
    // and must reject it, or the snake would reverse into itself.
    const state = step(freshGame(), tick())
    const head = headOf(state)
    const queuedUp = step(state, { type: 'direction', direction: 'up' })
    const queuedLeft = step(queuedUp, { type: 'direction', direction: 'left' })
    const moved = step(queuedLeft, tick())
    expect(moved.direction).toBe('right')
    expect(moved.snake[0]).toEqual({ x: head.x + 1, y: head.y })
    expect(moved.status).toBe('running')
  })

  it('registering a direction does not move the snake by itself', () => {
    const state = step(freshGame(), tick())
    const queued = step(state, { type: 'direction', direction: 'up' })
    expect(queued.snake).toEqual(state.snake)
    expect(queued.queuedDirection).toBe('up')
  })
})

describe('step: collisions', () => {
  it('ends the game on wall collision and freezes the snake', () => {
    const tinyConfig: GameConfig = { gridWidth: 5, gridHeight: 5 }
    let state = freshGame(tinyConfig, 3)
    // Head starts at x=2 in a width-5 grid; three ticks reach the wall.
    state = step(state, tick())
    state = step(state, tick())
    const beforeCollision = state
    state = step(state, tick())
    expect(state.status).toBe('over')
    expect(state.snake).toEqual(beforeCollision.snake)
  })

  it('ends the game on self-collision when the snake loops into its own body', () => {
    const config: GameConfig = { gridWidth: 28, gridHeight: 28, initialSnakeLength: 5 }
    let state = freshGame(config, 11)
    state = step(state, tick()) // tick: continue right
    state = step(state, { type: 'direction', direction: 'down' })
    state = step(state, tick()) // tick: turn down
    state = step(state, { type: 'direction', direction: 'left' })
    state = step(state, tick()) // tick: turn left
    const beforeCollision = state
    state = step(state, { type: 'direction', direction: 'up' })
    state = step(state, tick()) // tick: attempt up -> loops into own body
    expect(state.status).toBe('over')
    expect(state.snake).toEqual(beforeCollision.snake)
  })
})

describe('step: game over is final (AC9)', () => {
  it('ignores direction, pause and resume once the game is over, only restart works', () => {
    const tinyConfig: GameConfig = { gridWidth: 5, gridHeight: 5 }
    let state = freshGame(tinyConfig, 3)
    state = step(state, tick())
    state = step(state, tick())
    state = step(state, tick())
    expect(state.status).toBe('over')

    const afterDirection = step(state, { type: 'direction', direction: 'up' })
    expect(afterDirection).toEqual(state)

    const afterPause = step(state, { type: 'pause' })
    expect(afterPause).toEqual(state)

    const afterResume = step(state, { type: 'resume' })
    expect(afterResume).toEqual(state)

    const restarted = step(state, { type: 'restart' })
    expect(restarted.status).toBe('ready')
  })
})

describe('step: pause and resume', () => {
  it('halts movement while paused and resumes without an extra move', () => {
    const state = step(freshGame(), tick())
    const runningHead = headOf(state)
    const paused = step(state, { type: 'pause' })
    expect(paused.status).toBe('paused')

    const stillPaused = step(paused, tick())
    expect(stillPaused.status).toBe('paused')
    expect(stillPaused.snake[0]).toEqual(runningHead)

    const resumed = step(stillPaused, { type: 'resume' })
    expect(resumed.status).toBe('running')
    expect(resumed.snake[0]).toEqual(runningHead)

    const movedAgain = step(resumed, tick())
    expect(movedAgain.snake[0]).toEqual({ x: runningHead.x + 1, y: runningHead.y })
  })

  it('ignores a direction input that arrives while paused (AC11)', () => {
    const running = step(freshGame(), tick())
    const paused = step(running, { type: 'pause' })
    expect(paused.queuedDirection).toBeNull()

    const ignored = step(paused, { type: 'direction', direction: 'down' })
    expect(ignored.status).toBe('paused')
    expect(ignored.queuedDirection).toBeNull()

    const resumed = step(ignored, { type: 'resume' })
    const head = headOf(resumed)
    const moved = step(resumed, tick())
    expect(moved.direction).toBe('right')
    expect(moved.snake[0]).toEqual({ x: head.x + 1, y: head.y })
  })

  it('keeps a direction queued before pausing valid after resume (no over-correction)', () => {
    const running = step(freshGame(), tick())
    const queued = step(running, { type: 'direction', direction: 'down' })
    const paused = step(queued, { type: 'pause' })
    expect(paused.queuedDirection).toBe('down')

    const resumed = step(paused, { type: 'resume' })
    expect(resumed.queuedDirection).toBe('down')
    const head = headOf(resumed)
    const moved = step(resumed, tick())
    expect(moved.direction).toBe('down')
    expect(moved.snake[0]).toEqual({ x: head.x, y: head.y + 1 })
  })
})

describe('step: restart', () => {
  it('resets a running game back to its initial snapshot', () => {
    const initial = freshGame()
    let state = step(initial, { type: 'direction', direction: 'down' })
    state = step(state, tick())
    state = step(state, tick())

    const restarted = step(state, { type: 'restart' })
    expect(restarted.status).toBe('ready')
    expect(restarted.snake).toEqual(initial.snake)
    expect(restarted.direction).toEqual(initial.direction)
    expect(restarted.food).toEqual(initial.food)
    expect(restarted.score).toBe(0)
    expect(restarted.queuedDirection).toBeNull()
  })

  it('resets a game over back to its initial snapshot', () => {
    const tinyConfig: GameConfig = { gridWidth: 5, gridHeight: 5 }
    const initial = freshGame(tinyConfig, 3)
    let state = step(initial, tick())
    state = step(state, tick())
    state = step(state, tick())
    expect(state.status).toBe('over')

    const restarted = step(state, { type: 'restart' })
    expect(restarted.status).toBe('ready')
    expect(restarted.snake).toEqual(initial.snake)
  })

  it('resets score to 0 even after food was eaten', () => {
    const config: GameConfig = { gridWidth: 28, gridHeight: 28 }
    const initial = freshGame(config, 9)
    const head = headOf(initial)
    const foodAhead: GameState = { ...initial, food: { x: head.x + 1, y: head.y } }

    const afterEating = step(foodAhead, tick(createSeededRng(21)))
    expect(afterEating.score).toBe(1)

    const restarted = step(afterEating, { type: 'restart' })
    expect(restarted.status).toBe('ready')
    expect(restarted.score).toBe(0)
    expect(restarted.snake).toEqual(initial.snake)
    expect(restarted.food).toEqual(initial.food)
  })
})

describe('step: food placement (AC1, AC2, AC3)', () => {
  it('never places food on a cell occupied by the snake, across many draws', () => {
    // Stage-6 finding: a sparse grid (few occupied cells among many free
    // ones) does not reliably catch a broken/removed occupied-cell filter,
    // because most seeds land on a free cell anyway even without it. This
    // grid leaves exactly ONE free cell, so a food draw is forced to be
    // that cell EVERY time the filter is actually applied. If the filter
    // were removed, `pickFoodPosition` would draw from all 3 cells
    // uniformly, and 2 of the 3 are on the snake — across 30 fixed seeds
    // the odds of every single draw coincidentally landing on the one
    // legal cell are (1/3)^30, i.e. this reliably goes red on that
    // mutation (verified: see the PR report for the probe).
    const config: GameConfig = { gridWidth: 3, gridHeight: 1, initialSnakeLength: 2 }
    for (let seed = 1; seed <= 30; seed += 1) {
      const state = freshGame(config, seed)
      const onSnake = state.snake.some((cell) => cell.x === state.food.x && cell.y === state.food.y)
      expect(onSnake).toBe(false)
      // Only (2, 0) is free; with the filter in place the draw has no
      // other legal choice, regardless of the seed.
      expect(state.food).toEqual({ x: 2, y: 0 })
    }
  })

  it('terminates immediately even when only one free cell remains', () => {
    // Fill the grid down to exactly one free cell so the enumeration-based
    // placement (not rejection sampling) is the only thing that can find it.
    const config: GameConfig = { gridWidth: 3, gridHeight: 1 }
    const snake: readonly Position[] = [
      { x: 1, y: 0 }, // head
      { x: 0, y: 0 }, // tail
    ]
    const state: GameState = {
      status: 'running',
      config,
      snake,
      direction: 'right',
      queuedDirection: null,
      food: { x: 2, y: 0 },
      score: 0,
      initial: { snake, direction: 'right', food: { x: 2, y: 0 } },
    }
    // Head eats the only remaining free cell (2, 0); the grid is then
    // entirely covered by the grown snake with no free cell left for the
    // respawn draw. `pickFoodPosition` throws in that situation (see the
    // report: this is a known, unhandled, spec-silent edge case, not
    // invented behaviour).
    expect(() => step(state, tick(createSeededRng(5)))).toThrow(
      'No empty cell available for food placement',
    )
  })
})

describe('step: eating food (AC4, AC5, AC6, AC7)', () => {
  it('increases score by exactly one and snake length by exactly one segment', () => {
    const config: GameConfig = { gridWidth: 28, gridHeight: 28 }
    const state = freshGame(config, 9)
    const head = headOf(state)
    const foodAhead: GameState = { ...state, food: { x: head.x + 1, y: head.y } }

    const onFood = step(foodAhead, tick(createSeededRng(3)))

    expect(onFood.snake[0]).toEqual({ x: head.x + 1, y: head.y })
    expect(onFood.snake.length).toBe(state.snake.length + 1)
    expect(onFood.score).toBe(1)
    // The tail is retained (not dropped) on the tick that eats: the whole
    // pre-move snake is still present behind the new head.
    expect(onFood.snake.slice(1)).toEqual(state.snake)
  })

  it('places new food on a free cell immediately after eating, never on the grown snake', () => {
    // Same stage-6 finding, for the respawn-after-eating call site: growing
    // this snake by one segment leaves exactly ONE free cell in the grid,
    // so with the occupied-cell filter in place the respawn draw has no
    // other legal choice, for any seed. Without the filter, the draw would
    // pick uniformly among all 4 cells, 3 of which are on the grown snake —
    // across 30 fixed seeds that is essentially certain to be caught
    // (verified: see the PR report for the probe).
    const config: GameConfig = { gridWidth: 4, gridHeight: 1 }
    const snake: readonly Position[] = [
      { x: 1, y: 0 }, // head
      { x: 0, y: 0 }, // tail
    ]
    for (let seed = 1; seed <= 30; seed += 1) {
      const state: GameState = {
        status: 'running',
        config,
        snake,
        direction: 'right',
        queuedDirection: null,
        food: { x: 2, y: 0 }, // directly ahead of the head: this tick eats
        score: 0,
        initial: { snake, direction: 'right', food: { x: 2, y: 0 } },
      }

      const onFood = step(state, tick(createSeededRng(seed)))

      expect(onFood.snake).toEqual([{ x: 2, y: 0 }, ...snake])
      const onSnake = onFood.snake.some(
        (cell) => cell.x === onFood.food.x && cell.y === onFood.food.y,
      )
      expect(onSnake).toBe(false)
      // Only (3, 0) is free after growth; the draw has no other legal
      // choice, regardless of the seed.
      expect(onFood.food).toEqual({ x: 3, y: 0 })
    }
  })

  it('removes the tail and leaves length and score unchanged when no food is eaten', () => {
    const config: GameConfig = { gridWidth: 28, gridHeight: 28 }
    const state = freshGame(config, 9)
    const head = headOf(state)
    // Food is far from the snake's path this tick.
    const foodElsewhere: GameState = {
      ...state,
      food: { x: head.x + 10, y: head.y + 10 },
    }

    const moved = step(foodElsewhere, tick())

    expect(moved.snake.length).toBe(state.snake.length)
    expect(moved.score).toBe(0)
    expect(moved.food).toEqual(foodElsewhere.food)
  })

  it('evaluates self collision before the food check, using the pre-growth body (AC7 order)', () => {
    // Construct a state where the next head would land on a cell that is
    // both (a) part of the snake's own trimmed body (a real collision) and
    // (b) the food's cell — collision must win: the game ends, it does not
    // eat.
    const config: GameConfig = { gridWidth: 10, gridHeight: 10 }
    const snake: readonly Position[] = [
      { x: 3, y: 3 }, // head
      { x: 3, y: 4 }, // non-tail body segment the head is about to hit
      { x: 4, y: 4 },
      { x: 4, y: 3 }, // tail
    ]
    const state: GameState = {
      status: 'running',
      config,
      snake,
      direction: 'down',
      queuedDirection: null,
      food: { x: 3, y: 4 },
      score: 0,
      initial: { snake, direction: 'down', food: { x: 3, y: 4 } },
    }

    const result = step(state, tick())

    expect(result.status).toBe('over')
    expect(result.score).toBe(0)
    expect(result.snake).toEqual(snake)
  })

  it('lands on the current tail cell without ending the game, and grows with an overlap if that cell also holds food', () => {
    // The edge case called out in the ticket: the new head lands exactly on
    // the CURRENT tail cell (which a normal move would vacate, so it is not
    // a self collision per AC7's order — the check runs against the body
    // with the tail already excluded). This state is constructed directly:
    // reachable only by hand, never through normal play, because food
    // placement always avoids the full snake (including the tail) at the
    // moment it is placed, and the head necessarily revisits any cell
    // before the tail can lag its way back onto it.
    const config: GameConfig = { gridWidth: 10, gridHeight: 10 }
    const snake: readonly Position[] = [
      { x: 3, y: 3 }, // head
      { x: 4, y: 3 },
      { x: 4, y: 4 },
      { x: 3, y: 4 }, // tail — about to be the next head's cell
    ]
    const state: GameState = {
      status: 'running',
      config,
      snake,
      direction: 'down',
      queuedDirection: null,
      // Forced onto the current tail's cell to exercise the edge case;
      // unreachable via createGame/normal respawn (see report).
      food: { x: 3, y: 4 },
      score: 0,
      initial: { snake, direction: 'down', food: { x: 3, y: 4 } },
    }

    const result = step(state, tick(createSeededRng(2)))

    expect(result.status).toBe('running')
    expect(result.score).toBe(1)
    expect(result.snake[0]).toEqual({ x: 3, y: 4 })
    // Growth retains the entire pre-move snake behind the new head, so the
    // old tail cell (3, 4) is still present too: the new head and the last
    // segment share a cell for this one snapshot. It self-corrects on the
    // very next non-eating tick, which drops that last segment again.
    expect(result.snake).toEqual([{ x: 3, y: 4 }, ...snake])
    const occurrences = result.snake.filter(
      (cell) => cell.x === 3 && cell.y === 4,
    ).length
    expect(occurrences).toBe(2)
  })
})
