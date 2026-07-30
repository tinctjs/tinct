/**
 * API contract type tests. These assert the public surface: inference,
 * chainability, option unions, and the absence of `any`.
 */
import { describe, expectTypeOf, test } from 'vitest'
import { tinct, defineFilter, TinctImage } from '../src/index'
import type { ExportOptions, PixelData, SerializedHistory, Unsubscribe } from '../src/index'
import { grayscale, blur, duotone, sepia } from '../src/filters/index'

declare const image: TinctImage

describe('tinct.load', () => {
  test('accepts every documented source type', () => {
    expectTypeOf(tinct.load).toBeCallableWith(new Blob())
    expectTypeOf(tinct.load).toBeCallableWith('https://example.com/a.png')
    expectTypeOf(tinct.load).toBeCallableWith(new URL('https://example.com/a.png'))
    expectTypeOf(tinct.load).parameter(0).not.toBeAny()
    expectTypeOf(tinct.load).returns.resolves.toEqualTypeOf<TinctImage>()
  })
})

describe('chainable operations', () => {
  test('every operation returns a new TinctImage', () => {
    expectTypeOf(image.crop({ aspect: '16:9' })).toEqualTypeOf<TinctImage>()
    expectTypeOf(image.resize({ width: 1280 })).toEqualTypeOf<TinctImage>()
    expectTypeOf(image.rotate(90)).toEqualTypeOf<TinctImage>()
    expectTypeOf(image.flip('horizontal')).toEqualTypeOf<TinctImage>()
    expectTypeOf(image.adjust({ brightness: 0.1 })).toEqualTypeOf<TinctImage>()
    expectTypeOf(image.apply(grayscale())).toEqualTypeOf<TinctImage>()
    expectTypeOf(image.pipe([])).toEqualTypeOf<TinctImage>()
  })

  test('the target chain from the README typechecks end to end', () => {
    const result = image
      .crop({ aspect: '16:9', gravity: 'center' })
      .resize({ width: 1280 })
      .rotate(90)
      .adjust({ brightness: 0.1, contrast: 0.05, saturation: -0.2 })
      .apply(grayscale())
      .apply(blur({ radius: 4 }))
      .toBlob({ format: 'webp', quality: 0.85 })
    expectTypeOf(result).toEqualTypeOf<Promise<Blob>>()
  })

  test('crop accepts region (px or %) and aspect forms only', () => {
    expectTypeOf(image.crop).toBeCallableWith({ x: 0, y: 0, width: 100, height: 100 })
    expectTypeOf(image.crop).toBeCallableWith({ x: '10%', y: '10%', width: '80%', height: '80%' })
    expectTypeOf(image.crop).toBeCallableWith({ aspect: 16 / 9 })
    expectTypeOf(image.crop).toBeCallableWith({ aspect: '4:3', gravity: 'north-west' })
    // @ts-expect-error - not a percentage string
    image.crop({ x: '10px', y: 0, width: 100, height: 100 })
  })

  test('resize requires at least one dimension', () => {
    expectTypeOf(image.resize).toBeCallableWith({ width: 100 })
    expectTypeOf(image.resize).toBeCallableWith({ height: 100 })
    expectTypeOf(image.resize).toBeCallableWith({ width: 100, height: 100, fit: 'cover' })
    // @ts-expect-error - width or height is required
    image.resize({ fit: 'cover' })
    // @ts-expect-error - unknown kernel
    image.resize({ width: 100, kernel: 'bicubic' })
  })

  test('adjust only accepts known adjustments', () => {
    // @ts-expect-error - vibrance is not a v0.1 adjustment
    image.adjust({ vibrance: 1 })
  })
})

describe('filters', () => {
  test('optional-options filters are callable without arguments', () => {
    expectTypeOf(grayscale).toBeCallableWith()
    expectTypeOf(sepia).toBeCallableWith({ amount: 0.5 })
    expectTypeOf(blur).toBeCallableWith({ radius: 10 })
  })

  test('duotone requires its two colors', () => {
    expectTypeOf(duotone).toBeCallableWith({ shadows: '#000', highlights: '#fff' })
    // @ts-expect-error - options are required
    duotone()
    // @ts-expect-error - highlights is required
    duotone({ shadows: '#000' })
  })

  test('defineFilter infers option types through to the factory', () => {
    const swirl = defineFilter<{ angle: number }>({
      name: 'swirl',
      fallback: (pixels, options) => {
        expectTypeOf(pixels).toEqualTypeOf<PixelData>()
        expectTypeOf<ImageData>().toExtend<PixelData>()
        expectTypeOf(options.angle).toBeNumber()
        return undefined
      },
    })
    expectTypeOf(swirl).toBeCallableWith({ angle: 90 })
    // @ts-expect-error - angle is required
    swirl()
    expectTypeOf(swirl({ angle: 90 }).options.angle).toBeNumber()
  })
})

describe('introspection and events', () => {
  test('history returns serialized ops and pipe accepts them', () => {
    const history = image.history()
    expectTypeOf(history).toEqualTypeOf<SerializedHistory>()
    expectTypeOf(image.pipe).toBeCallableWith(history)
    expectTypeOf(image.pipe).toBeCallableWith(history.ops)
  })

  test('on() is typed per event and returns an unsubscribe', () => {
    const off = image.on('progress', (e) => {
      expectTypeOf(e.pct).toBeNumber()
    })
    expectTypeOf(off).toEqualTypeOf<Unsubscribe>()
    // @ts-expect-error - unknown event name
    image.on('finished', () => undefined)
  })

  test('outputs are typed', () => {
    expectTypeOf(image.toBlob).parameter(0).toEqualTypeOf<ExportOptions | undefined>()
    expectTypeOf(image.toDataURL()).toEqualTypeOf<Promise<string>>()
    expectTypeOf(image.toImageData()).toEqualTypeOf<Promise<ImageData>>()
    expectTypeOf(image.toCanvas()).toEqualTypeOf<Promise<HTMLCanvasElement>>()
    // @ts-expect-error - unknown format
    void image.toBlob({ format: 'gif' })
  })
})
