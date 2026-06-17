/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: [
    '@ai-sdk/harness',
    '@ai-sdk/harness-claude-code',
    '@ai-sdk/harness-codex',
    '@opentelemetry/api',
    'ai',
    'ws',
  ],
  webpack(config) {
    // Resolve NodeNext-style .js imports to TypeScript source files
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.js'],
    };
    return config;
  },
};

export default nextConfig;
