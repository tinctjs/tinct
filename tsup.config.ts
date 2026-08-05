import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'filters/index': 'src/filters/index.ts',
    'effects/index': 'src/effects/index.ts',
    'face/index': 'src/face/index.ts',
    'batch/index': 'src/batch/index.ts',
    'hash/index': 'src/hash/index.ts',
    'layers/index': 'src/layers/index.ts',
    'live/index': 'src/live/index.ts',
    'palette/index': 'src/palette/index.ts',
    // Emitted next to index.js so `new URL('./render-worker.js', import.meta.url)`
    // resolves both when served raw and through bundlers' worker handling.
    'render-worker': 'src/core/render-worker.ts',
  },
  format: ['esm'],
  target: 'es2022',
  dts: {
    // tsup injects `baseUrl` into the dts build; TS 6 deprecates it.
    compilerOptions: { ignoreDeprecations: '6.0' },
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
})
