import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

function buildId(): string {
  let hash = 'dev';
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    // no git (e.g. a plain checkout without history): 'dev'
  }
  return `${hash} ${new Date().toISOString().slice(0, 16).replace('T', ' ')}Z`;
}

// Spec 3 §9: dev stays at http://localhost:5173/; build and preview serve at /calistally/.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/calistally/' : '/',
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: true },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CalisTally',
        short_name: 'CalisTally',
        description: 'Calisthenics training log, stored in your Dropbox',
        display: 'standalone',
        background_color: '#111827',
        theme_color: '#111827',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // Dropbox calls are never intercepted or cached (spec 3 §8): no runtimeCaching at all.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
}));
