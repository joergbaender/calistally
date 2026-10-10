import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts so the tests never load the PWA plugin.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Testing Library's own auto-cleanup needs a global afterEach, which Vitest has only with globals: true.
    setupFiles: ['src/ui/test-setup.ts'],
  },
});
