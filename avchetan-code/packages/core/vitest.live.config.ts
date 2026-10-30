import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.live.ts'], testTimeout: 60_000 },
});
