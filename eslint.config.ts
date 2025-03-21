import {defineConfig, type Config} from '@bfra.me/eslint-config'

const config: ReturnType<typeof defineConfig> = defineConfig({
  name: '@fro-bot/.github',
  packageJson: true,
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
})

export default config as Config
