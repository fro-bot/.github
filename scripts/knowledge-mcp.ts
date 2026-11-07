// No static import: nothing may load before the two OpenCode variables are gone. `Test Scripts Load` imports
// every scripts/*.ts, so the work sits under Node's main-module check, as in scripts/check-mutation-guards.ts.
// `process` is the runtime global here because an `import process from 'node:process'` would be a static import.
/* eslint-disable node/prefer-global/process */
if (import.meta.main) {
  delete process.env.OPENCODE_PASSWORD
  delete process.env.OPENCODE_CONFIG_CONTENT
  const {serve} = await import('@fro-bot/wiki-ops/knowledge-mcp')
  await serve()
}
/* eslint-enable node/prefer-global/process */
