/**
 * Worker offloading decisions and graceful fallback. Node has no Web
 * Workers; a stubbed `Worker` global exercises the failure paths and the
 * decision logic. The happy path runs in browsers (playground).
 */
/* eslint-disable @typescript-eslint/no-extraneous-class -- bare stub classes stand in for Worker */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { shouldUseWorker } from '../src/core/worker-client'
import { TinctImage } from '../src/core/editor'
import type { OpNode } from '../src/core/executor'
import { solid, gradientH } from './helpers'

const bigSource = (): ReturnType<typeof solid> => solid(1024, 512, [50, 100, 150, 255])

const flipOp: OpNode = { op: 'flip', params: { axis: 'horizontal' } }
const builtinFilterOp: OpNode = { op: 'filter', params: { name: 'grayscale', options: {} } }
const customFilterOp: OpNode = { op: 'filter', params: { name: 'my-custom', options: {} } }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shouldUseWorker', () => {
  test('false when Worker is unavailable (Node)', () => {
    expect(shouldUseWorker([flipOp], bigSource())).toBe(false)
  })

  test('true for big, worker-safe pipelines when Worker exists', () => {
    vi.stubGlobal('Worker', class {})
    expect(shouldUseWorker([flipOp, builtinFilterOp], bigSource())).toBe(true)
  })

  test('false for small images — offloading would cost more than it saves', () => {
    vi.stubGlobal('Worker', class {})
    expect(shouldUseWorker([flipOp], solid(64, 64, [0, 0, 0, 255]))).toBe(false)
  })

  test('false for empty pipelines', () => {
    vi.stubGlobal('Worker', class {})
    expect(shouldUseWorker([], bigSource())).toBe(false)
  })

  test('false when a custom filter is present (functions cannot cross threads)', () => {
    vi.stubGlobal('Worker', class {})
    expect(shouldUseWorker([builtinFilterOp, customFilterOp], bigSource())).toBe(false)
  })
})

describe('worker fallback', () => {
  test('a Worker that cannot be constructed falls back to main-thread render', async () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('module workers unsupported')
        }
      },
    )

    const image = TinctImage._create(gradientH(1024, 512)).flip('horizontal')
    const out = await image._render()

    // Correct result despite the broken worker: leftmost gradient value 255.
    expect(out.data[0]).toBe(255)
    expect([out.width, out.height]).toEqual([1024, 512])
  })
})
