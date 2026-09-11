import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/platform-react/src/', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/unit/setup.js'],
    include: [
      './tests/unit/**/*.spec.js',
      './apps/platform-react/src/**/*.test.ts',
      './apps/platform-react/src/**/*.test.tsx',
    ],
    clearMocks: true,
    restoreMocks: true,
  },
});
