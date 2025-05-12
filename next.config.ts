import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  experimental: {
    ppr: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: 'avatar.vercel.sh',
      },
    ],
  },
  // Add script optimization
  optimizePackageImports: ['pyodide'],
  // Configure how resources are loaded
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Link',
            // Remove the preload directives or make them more specific
            value: '',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
