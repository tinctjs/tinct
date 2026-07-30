/**
 * Filter model: the {@link Filter} value type, the {@link defineFilter}
 * extension point, and the internal registry used to replay serialized
 * pipelines.
 *
 * @packageDocumentation
 */

import type { PixelData } from './pixel'

/**
 * Constraint for a filter's options bag. Options must be JSON-serializable
 * for {@link TinctImage.history} to round-trip; this is validated at
 * serialization time rather than encoded in the type.
 */
export type FilterOptions = Record<string, unknown>

/** Internal access to a filter's definition. Not part of the public API. */
export const FILTER_DEFINITION: unique symbol = Symbol('tinct.filter.definition')

/**
 * An immutable, serializable description of a filter application: the filter
 * name plus the options it was created with. Produced by filter factories
 * such as `grayscale()` or by factories returned from {@link defineFilter}.
 * Consumed by {@link TinctImage.apply}.
 */
export interface Filter<TOptions extends FilterOptions = FilterOptions> {
  /** Unique filter name, e.g. `'blur'`. Used as the serialization key. */
  readonly name: string
  /** The options this filter instance was created with (defaults applied). */
  readonly options: Readonly<TOptions>
  /** @internal */
  readonly [FILTER_DEFINITION]: FilterDefinition<TOptions>
}

/**
 * A filter implementation, as passed to {@link defineFilter}.
 *
 * Every filter needs a CPU implementation (`fallback`); a WebGL2 `fragment`
 * shader is optional and used automatically when the environment supports it.
 */
export interface FilterDefinition<TOptions extends FilterOptions = FilterOptions> {
  /** Unique filter name. Used as the serialization key in histories. */
  name: string
  /**
   * CPU implementation. A pure function over pixel data: mutate `pixels`
   * in place and return nothing, or return a new buffer.
   *
   * `PixelData` is structurally compatible with `ImageData` — in the browser
   * the buffer handed to your kernel is backed by real `ImageData` bytes.
   */
  fallback: (pixels: PixelData, options: Readonly<TOptions>) => PixelData | undefined
  /**
   * Optional WebGL2 fragment shader (GLSL ES 3.00). Receives the source
   * image as `uniform sampler2D u_image`, the output size in pixels as
   * `uniform vec2 u_resolution` (always provided), and texture coordinates
   * as `in vec2 v_texCoord` (origin top-left); must write to
   * `out vec4 outColor`. Output must match `fallback` within a small
   * tolerance — the CPU kernel is the reference implementation.
   */
  fragment?: string
  /** Maps filter options to values for the shader's custom uniforms. */
  uniforms?: (options: Readonly<TOptions>) => Record<string, number | readonly number[]>
  /** Default options, merged under the options given at the call site. */
  defaults?: Partial<TOptions>
}

/**
 * A factory returned by {@link defineFilter}. If every option is optional
 * (or the filter has none), the factory can be called with no arguments.
 */
export type FilterFactory<TOptions extends FilterOptions = FilterOptions> =
  Record<string, never> extends TOptions
    ? (options?: TOptions) => Filter<TOptions>
    : (options: TOptions) => Filter<TOptions>

/**
 * Registry of filter definitions, keyed by name. Populated when a filter
 * factory is created; used by `pipe()` to replay serialized `filter` ops.
 * A filter that was tree-shaken away is not registered — replaying its op
 * throws a descriptive error instead.
 *
 * @internal
 */
export const filterRegistry = new Map<string, FilterDefinition>()

/**
 * Define a custom filter and get back a serializable filter factory.
 *
 * The CPU `fallback` is required and is the reference implementation; the
 * WebGL2 `fragment` shader is an optional acceleration with identical
 * output (within tolerance).
 *
 * @example
 * ```ts
 * const sepia = defineFilter({
 *   name: 'sepia',
 *   fragment: sepiaShader,
 *   fallback: sepiaCpu,
 * })
 *
 * image.apply(sepia())
 * ```
 */
export function defineFilter<TOptions extends FilterOptions = Record<string, never>>(
  definition: FilterDefinition<TOptions>,
): FilterFactory<TOptions> {
  filterRegistry.set(definition.name, definition as unknown as FilterDefinition)
  const factory = (options?: TOptions): Filter<TOptions> => {
    const merged = { ...definition.defaults, ...options } as TOptions
    return Object.freeze({
      name: definition.name,
      options: Object.freeze(merged),
      [FILTER_DEFINITION]: definition,
    })
  }
  return factory
}
