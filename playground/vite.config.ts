import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// The playground exercises the public package surface (`tinctjs`,
// `tinctjs/filters`) — the aliases just resolve those entry points to the
// local source so `npm run dev` needs no build step.
export default defineConfig({
  base: './',
  server: {
    fs: {
      // The library source (and its render worker) live one level up.
      allow: ['..'],
    },
  },
  resolve: {
    alias: {
      'tinctjs/filters': fileURLToPath(new URL('../src/filters/index.ts', import.meta.url)),
      tinctjs: fileURLToPath(new URL('../src/index.ts', import.meta.url)),
    },
  },
})
