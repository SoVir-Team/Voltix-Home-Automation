import type { NextConfig } from 'next';

/** Where the Node API listens. In production a reverse proxy usually serves /api directly. */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

const dev = process.env.NODE_ENV !== 'production';
const wsOrigin = process.env.NEXT_PUBLIC_WS_URL ? new URL(process.env.NEXT_PUBLIC_WS_URL).origin : '';

// shortcut: 'unsafe-inline' scripts because Next's bootstrap scripts are inline; nonces would make every
// page dynamic. Still blocks third-party scripts, framing, plugins and off-site form posts.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${wsOrigin}`.trim(),
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  ...(dev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
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
