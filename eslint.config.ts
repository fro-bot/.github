import {defineConfig} from '@bfra.me/eslint-config'

export default defineConfig({
  name: '@fro-bot/.github',
  ignores: [
    '.ai/',
    '.github/copilot-instructions.md',
    '**/AGENTS.md',
    'docs/archive/',
    'docs/brainstorms/',
    'docs/plans/',
    'docs/solutions/',
  ],
  packageJson: true,
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
})
