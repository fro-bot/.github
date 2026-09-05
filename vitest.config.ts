import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['scripts/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['.stryker-tmp/**', 'reports/**'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['scripts/**/*.ts', 'packages/**/*.ts'],
      exclude: ['scripts/**/*.test.ts', '.stryker-tmp/**', 'reports/**'],
    },
  },
})
