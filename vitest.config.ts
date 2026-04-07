import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'apps/desktop',
      'packages/server-runtime',
      'packages/server-shared',
      'packages/ui',
    ],
  },
})
