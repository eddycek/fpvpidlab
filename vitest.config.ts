import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    testTimeout: 15000,
    setupFiles: ['./src/renderer/test/setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'release', 'e2e', 'infrastructure', '.claude/worktrees'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
      exclude: [
        'node_modules/',
        'src/renderer/test/',
        '**/*.config.ts',
        '**/*.d.ts',
        '**/types/',
        'dist/',
        'release/',
        'src/main/window.ts',
        'src/preload/index.ts',
        'src/main/utils/logger.ts',
        'src/main/msp/commands.ts',
        'src/main/msp/types.ts',
      ]
    }
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@renderer': path.resolve(__dirname, './src/renderer')
    }
  }
});
