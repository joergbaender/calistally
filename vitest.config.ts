import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so the tests never load the PWA plugin.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
