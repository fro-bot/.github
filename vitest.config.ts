import {defaultExclude, defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Every git a test runs, in-process or in a child that inherits `process.env`, reads no global or
    // system config. A developer's `commit.gpgsign=true` otherwise reaches fixture commits and flakes under
    // load (gpg: signing failed), and CI has no such config. `test.env` wins over an exported
    // `GIT_CONFIG_GLOBAL`, and Stryker reuses this file. Fixtures set their own `user.name`/`user.email`.
    env: {GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'},
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
