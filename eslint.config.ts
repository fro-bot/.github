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
  },
})
