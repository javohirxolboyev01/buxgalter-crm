import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Testlar bitta test bazasini ishlatadi: fayllar ketma-ket
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
