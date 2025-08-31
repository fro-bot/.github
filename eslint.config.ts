import {defineConfig, type Config} from '@bfra.me/eslint-config'

const config: ReturnType<typeof defineConfig> = defineConfig({
  name: '@fro-bot/.github',
  ignores: ['.ai/', '.github/copilot-instructions.md'],
  packageJson: true,
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
})

export default config as Config
