import type { NextConfig } from 'next';

// The browser only ever talks to this origin; /api/* is proxied to the Express API so the
// HttpOnly session cookies are same-origin (no third-party cookie or CORS issues).
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';
const isProd = process.env.NODE_ENV === 'production';
// HSTS and upgrade-insecure-requests only when the public URL is https (not for a local http build).
const https = (process.env.APP_URL ?? '').startsWith('https://');

/**
 * Content-Security-Policy. Only our own origin plus Razorpay Checkout (script + its iframe).
 * 'unsafe-inline' for scripts is required by Next's inline bootstrap without per-request nonces;
 * it is still a large reduction in attack surface (no third-party script hosts, no plugins,
 * no framing of the app, forms only to self). Dev adds 'unsafe-eval' for React Fast Refresh.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"} https://checkout.razorpay.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.razorpay.com",
  "font-src 'self' data:",
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
  // Same-origin frames: the patti/receipt print views. Razorpay's checkout runs in its own iframe.
  "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(https ? ['upgrade-insecure-requests'] : []),
].join('; ');

const config: NextConfig = {
  poweredByHeader: false,
  // Self-contained server bundle for the Docker image (node .next/standalone/frontend/server.js).
  output: 'standalone',
  transpilePackages: ['@mandimitra/shared'],
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
  async headers() {
    return [
      {
        // App pages only: the proxied /api responses keep the API's own headers (the patti print view
        // must be frameable by our own origin, which the API allows via SAMEORIGIN).
        source: '/((?!api/).*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Microphone stays available to our own origin for voice entry (Web Speech API).
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), payment=(self "https://checkout.razorpay.com")' },
          ...(https ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }] : []),
        ],
      },
    ];
  },
};

export default config;
