import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Only public catalogue images are retained for a short offline visit.
            // API responses, sessions and orders are intentionally never cached.
            urlPattern: /^https:\/\/[^/]+\.supabase\.co\/storage\/v1\/object\/public\/morfi-catalog\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'morfi-public-catalog-images',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: 'MORFI',
        short_name: 'MORFI',
        lang: 'es-AR',
        start_url: '/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#F07821',
        icons: [
          {
            src: '/morfi-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any'
          }
        ]
      }
    })
  ]
});
