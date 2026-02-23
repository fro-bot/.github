import {defineConfig} from '@bfra.me/eslint-config'

export default defineConfig({
  name: '@fro-bot/.github',
  ignores: ['.ai/', '.github/copilot-instructions.md', '**/AGENTS.md'],
  packageJson: true,
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
})
