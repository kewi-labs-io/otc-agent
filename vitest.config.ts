import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 180000, // 3 minutes per test
    hookTimeout: 180000, // 3 minutes for setup/teardown
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.next', 'src/**'],
    reporters: ['verbose'],
    sequence: {
      hooks: 'stack',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@elizaos/core': path.resolve(__dirname, './node_modules/@elizaos/core'),
    },
  },
});
