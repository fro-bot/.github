import {defineConfig} from '@bfra.me/eslint-config'

export default defineConfig({
  name: '@fro-bot/.github',
  ignores: [
    '.agents/skills/',
    '.ai/',
    '.github/copilot-instructions.md',
    '**/AGENTS.md',
    'coverage/',
    'docs/archive/',
    'docs/brainstorms/',
    'docs/plans/',
    'docs/solutions/',
    'knowledge/',
  ],
  packageJson: true,
  typescript: {
    tsconfigPath: './tsconfig.json',
    // Enforce Node 24 strip-only TypeScript compatibility: rejects parameter properties,
    // enums, namespaces, and import aliases at lint time, before they surface as
    // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at runtime. Pairs with the Test Scripts Load
    // CI job that catches any incompatibility that slips past the linter.
    erasableSyntaxOnly: true,
  },
})
