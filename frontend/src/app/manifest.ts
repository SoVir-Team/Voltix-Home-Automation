import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Voltix Smart Home',
    short_name: 'Voltix',
    description: 'Control every light, fan and sensor in your home from anywhere.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f8fd',
    theme_color: '#f5f8fd',
    icons: [
      { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
