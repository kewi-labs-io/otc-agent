import type { NextConfig } from 'next';
import { webpack } from 'next/dist/compiled/webpack/webpack';

const nextConfig: NextConfig = {
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  experimental: {
    inlineCss: true,
  },
  webpack: (config, { isServer }) => {
    // Ensure handlebars is bundled properly
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias,
      handlebars: require.resolve('handlebars'),
    };
    
    // For server-side, ensure proper module resolution
    if (isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        handlebars: require.resolve('handlebars'),
      };
    }
    
    // Exclude Web3 packages from server-side bundling to prevent IndexedDB errors
    if (isServer) {
      config.externals = [
        ...(config.externals || []),
        '@rainbow-me/rainbowkit',
        'wagmi',
        '@tanstack/react-query',
        'viem'
      ];
    }
    
    // Configure webpack to ignore files that shouldn't trigger rebuilds
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        '**/node_modules/**',
        '**/.next/**',
        '**/.git/**',
        '**/*.log',
        '**/*.pid',
        '**/dist/**',
        '**/contracts/artifacts/**',
        '**/contracts/cache/**',
        '**/typechain-types/**',
        '**/cypress/screenshots/**',
        '**/cypress/videos/**',
        '**/prisma/**',
        '**/*.db',
        '**/*.db-journal',
        '**/*.sqlite',
        '**/*.sqlite-journal',
        '**/data/**',
        '**/.eliza/**',
        '**/.elizadb/**',
        '**/.elizaos-cache/**',
        '**/.eliza-runtime/**',
        '**/eliza-data/**',
        '**/logs/**',
        '**/tmp/**',
        '**/.cache/**',
        '**/agent/**',
        '**/agent.js',
        '**/agent.js.map',
        '**/chunk-*.js',
        '**/chunk-*.js.map'
      ],
    };


    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^pg-native$|^cloudflare:sockets$/,
      }),
      // Ignore IndexedDB related imports on server
      ...(isServer ? [
        new webpack.DefinePlugin({
          'typeof window': JSON.stringify('undefined'),
          'typeof indexedDB': JSON.stringify('undefined')
        })
      ] : [])
    );
    // Return modified config
    return {
      ...config,
      resolve: {
        ...config.resolve,
        fallback: {
          ...config.resolve?.fallback,
          fs: false,
          net: false,
          tls: false,
          async_hooks: false,
          worker_threads: false,
        },
      },
    };
  },
  async redirects() {
    return [
      {
        source: '/start',
        destination: 'https://ai.eliza.how/eliza/',
        permanent: false,
      },
      {
        source: '/school',
        destination: 'https://www.youtube.com/playlist?list=PL0D_B_lUFHBKZSKgLlt24RvjJ8pavZNVh',
        permanent: false,
      },
      {
        source: '/discord',
        destination: 'https://discord.gg/2bkryvK9Yu',
        permanent: false,
      },
      {
        source: '/profiles',
        destination: 'https://elizaos.github.io/profiles',
        permanent: false,
      },
      {
        source: '/bounties',
        destination: 'https://elizaos.github.io/website/',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/ingest/static/:path(.*)',
        destination: 'https://us-assets.i.posthog.com/static/:path',
      },
      {
        source: '/ingest/:path(.*)',
        destination: 'https://us.i.posthog.com/:path',
      },
      {
        source: '/profiles/:path(.*)',
        destination: 'https://elizaos.github.io/profiles/:path',
      },
      {
        source: '/bounties/:path(.*)',
        destination: 'https://elizaos.github.io/website/:path',
      },
      {
        source: '/eliza/:path(.*)',
        destination: 'https://elizaos.github.io/eliza/:path',
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
