import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['eval/playground/fixtures/__test__/**/*.test.ts'],
  },
})
