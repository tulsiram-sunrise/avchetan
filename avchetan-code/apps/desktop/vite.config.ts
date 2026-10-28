import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Tauri expects a fixed dev port and serves the built files from `dist/`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'es2023',
    rolldownOptions: {
      input: {
        dock: fileURLToPath(new URL('dock.html', import.meta.url)),
        main: fileURLToPath(new URL('main.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
