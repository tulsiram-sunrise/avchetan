import { defineConfig } from 'vitest/config';

// Each test opens a fresh database and migrates it. The first PGlite start compiles its
// WebAssembly, which took longer than the 10 s default on CI runners.
export default defineConfig({
  test: { hookTimeout: 60_000, testTimeout: 30_000 },
});
