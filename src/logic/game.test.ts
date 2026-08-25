import { describe, expect, it } from 'vitest'
import { createGame, step, type GameConfig, type GameState, type Rng } from './game'

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

const baseConfig: GameConfig = { gridWidth: 28, gridHeight: 28 }

function freshGame(config: GameConfig = baseConfig, seed = 42): GameState {
  return createGame(config, createSeededRng(seed))
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
    const head = state.snake[0]
    const next = step(state)
    expect(next.status).toBe('running')
    expect(next.snake[0]).toEqual({ x: head.x + 1, y: head.y })
    expect(next.snake.length).toBe(state.snake.length)
  })

  it('keeps moving forward, one cell per tick, without changing length', () => {
    let state = step(freshGame())
    const firstHead = state.snake[0]
    state = step(state)
    expect(state.snake[0]).toEqual({ x: firstHead.x + 1, y: firstHead.y })
    expect(state.snake.length).toBe(3)
  })
})

describe('step: turning', () => {
  it('applies a valid perpendicular turn on the next tick', () => {
    const state = step(freshGame())
    const head = state.snake[0]
    const turned = step(state, { type: 'direction', direction: 'up' })
    expect(turned.direction).toBe('right')
    const moved = step(turned)
    expect(moved.direction).toBe('up')
    expect(moved.snake[0]).toEqual({ x: head.x, y: head.y - 1 })
  })

  it('ignores a direct 180-degree reversal and keeps the previous direction', () => {
    const state = step(freshGame())
    const head = state.snake[0]
    const reversed = step(state, { type: 'direction', direction: 'left' })
    const moved = step(reversed)
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
    const state = step(freshGame())
    const head = state.snake[0]
    const queuedUp = step(state, { type: 'direction', direction: 'up' })
    const queuedLeft = step(queuedUp, { type: 'direction', direction: 'left' })
    const moved = step(queuedLeft)
    expect(moved.direction).toBe('right')
    expect(moved.snake[0]).toEqual({ x: head.x + 1, y: head.y })
    expect(moved.status).toBe('running')
  })

  it('registering a direction does not move the snake by itself', () => {
    const state = step(freshGame())
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
    state = step(state)
    state = step(state)
    const beforeCollision = state
    state = step(state)
    expect(state.status).toBe('over')
    expect(state.snake).toEqual(beforeCollision.snake)
  })

  it('ends the game on self-collision when the snake loops into its own body', () => {
    const config: GameConfig = { gridWidth: 28, gridHeight: 28, initialSnakeLength: 5 }
    let state = freshGame(config, 11)
    state = step(state) // continue right
    state = step(state, { type: 'direction', direction: 'down' })
    state = step(state, { type: 'direction', direction: 'left' })
    const beforeCollision = state
    state = step(state, { type: 'direction', direction: 'up' })
    expect(state.status).toBe('over')
    expect(state.snake).toEqual(beforeCollision.snake)
  })
})

describe('step: pause and resume', () => {
  it('halts movement while paused and resumes without an extra move', () => {
    let state = step(freshGame())
    const runningHead = state.snake[0]
    const paused = step(state, { type: 'pause' })
    expect(paused.status).toBe('paused')

    const stillPaused = step(paused)
    expect(stillPaused.status).toBe('paused')
    expect(stillPaused.snake[0]).toEqual(runningHead)

    const resumed = step(stillPaused, { type: 'resume' })
    expect(resumed.status).toBe('running')
    expect(resumed.snake[0]).toEqual(runningHead)

    const movedAgain = step(resumed)
    expect(movedAgain.snake[0]).toEqual({ x: runningHead.x + 1, y: runningHead.y })
  })
})

describe('step: restart', () => {
  it('resets a running game back to its initial snapshot', () => {
    const initial = freshGame()
    let state = step(initial, { type: 'direction', direction: 'down' })
    state = step(state)
    state = step(state)

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
    let state = step(initial)
    state = step(state)
    state = step(state)
    expect(state.status).toBe('over')

    const restarted = step(state, { type: 'restart' })
    expect(restarted.status).toBe('ready')
    expect(restarted.snake).toEqual(initial.snake)
  })
})

describe('step: food is inert in this slice', () => {
  it('does nothing special when the head reaches the food cell', () => {
    // Force the food to sit directly in the snake's forward path, then walk
    // the head onto it: score and snake length must stay unchanged.
    const config: GameConfig = { gridWidth: 28, gridHeight: 28 }
    const state = freshGame(config, 9)
    const head = state.snake[0]
    const foodAhead: GameState = { ...state, food: { x: head.x + 1, y: head.y } }

    const onFood = step(foodAhead)

    expect(onFood.snake[0]).toEqual({ x: head.x + 1, y: head.y })
    expect(onFood.snake.length).toBe(state.snake.length)
    expect(onFood.score).toBe(0)
    expect(onFood.food).toEqual({ x: head.x + 1, y: head.y })
  })
})
