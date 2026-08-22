import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'icons/icon-192.png', 'icons/icon-512.png'],
      // manifest: false — index.html links /manifest.json (public/manifest.json)
      // directly, and that's the file we hand-maintain with every PWABuilder-
      // recommended field (screenshots, file_handlers, share_target, etc).
      // Previously this option was left as an object, which made vite-plugin-pwa
      // ALSO generate its own dist/manifest.webmanifest and silently inject a
      // second <link rel="manifest"> tag into index.html at build time. Two
      // manifest links on one page is invalid and was very likely why
      // PWABuilder's manifest/service-worker checks looked inconsistent with
      // what's in the repo. Setting this to false stops that second file/link
      // from ever being generated again.
      manifest: false,
      workbox: {
        // sw-extra.js adds push, notificationclick, sync, and periodicsync
        // event listeners that Workbox's own generator doesn't provide -
        // see that file for details.
        importScripts: ['/sw-extra.js'],
        // App-shell precache: JS/CSS/HTML/fonts/icons produced by the build.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
        // Never let the SW intercept Supabase Auth/API/Storage/Realtime calls -
        // those must always hit the network (or fail explicitly) so we don't
        // serve stale auth/session data.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Supabase Storage file downloads: cache-first so previously
            // opened files can be re-opened offline.
            urlPattern: ({ url }) => url.pathname.includes('/storage/v1/object'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'supabase-storage-files',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            // Supabase REST metadata calls: network-first, falling back to
            // cache when offline (IndexedDB is still the source of truth for
            // writes; this just smooths over brief network blips on reads).
            urlPattern: ({ url }) => url.pathname.includes('/rest/v1/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest-metadata',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 }
            }
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'images',
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 30 }
            }
          },
          {
            urlPattern: ({ request }) =>
              ['script', 'style', 'font'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'static-resources' }
          }
        ]
      },
      devOptions: {
        enabled: true,
        type: 'module'
      }
    })
  ],
  server: {
    port: 5173
  },
  build: {
    sourcemap: false,
    target: 'es2020'
  }
});
