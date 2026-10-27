import type { NextConfig } from 'next';

/** Where the Node API listens. In production a reverse proxy usually serves /api directly. */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@voltix/protocol'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiTarget}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
