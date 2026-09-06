import {defaultExclude, defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/**/*.test.ts', 'packages/**/*.test.ts'],
    // `exclude` replaces Vitest's defaults rather than merging with them; spread them back in
    // so `**/node_modules/**` stays excluded from test discovery.
    exclude: [...defaultExclude, '.stryker-tmp/**', 'reports/**'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['scripts/**/*.ts', 'packages/**/*.ts'],
      exclude: ['scripts/**/*.test.ts', '.stryker-tmp/**', 'reports/**'],
    },
  },
})
