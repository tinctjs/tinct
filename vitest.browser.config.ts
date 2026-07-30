import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

/**
 * Real-browser test project: runs `tests-browser/` in headless Chromium so
 * the WebGL2 path executes on an actual GL implementation and can be
 * compared against the CPU reference. Kept separate from the main config so
 * `npm test` needs no Playwright install.
 */
export default defineConfig({
  test: {
    include: ['tests-browser/**/*.test.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: 'chromium' }],
    },
  },
})
