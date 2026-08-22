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
      manifest: {
        id: '/',
        name: 'FileVault - Cloud File Manager',
        short_name: 'FileVault',
        description: 'Offline-first cloud file manager and storage system',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        shortcuts: [
          { name: 'Upload File', url: '/?action=upload', description: 'Upload a new file' },
          { name: 'New Folder', url: '/?action=new-folder', description: 'Create a new folder' }
        ]
      },
      workbox: {
        // App-shell precache: JS/CSS/HTML/fonts/icons produced by the build.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
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
