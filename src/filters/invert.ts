import { defineFilter, type FilterFactory } from '../core/filter'
import { cpuTodo } from './internal'

/** Options for {@link invert}. */
export type InvertOptions = Record<string, never>

/**
 * Invert every color channel (negative). Alpha is preserved.
 *
 * @example
 * ```ts
 * image.apply(invert())
 * ```
 */
export const invert: FilterFactory<InvertOptions> = /* @__PURE__ */ defineFilter<InvertOptions>({
  name: 'invert',
  fallback: cpuTodo('invert'),
})
