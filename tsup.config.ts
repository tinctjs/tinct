import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'filters/index': 'src/filters/index.ts',
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
