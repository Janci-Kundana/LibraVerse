/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app with an offline shell (FR-24, TC-12). API calls are never
    // cached: payment and loan data must always be live.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'LibraVerse',
        short_name: 'LibraVerse',
        description: 'Your library, fully digital: card, books, fines and payments.',
        theme_color: '#05070f',
        background_color: '#05070f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        importScripts: ['/push-sw.js'],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 5173,
    // Listen on the local network too, so a phone on the same Wi-Fi can open it.
    host: true,
    // Same-origin in development, so httpOnly auth cookies just work.
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
