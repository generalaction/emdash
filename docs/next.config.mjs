import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  async rewrites() {
    // Serve *.md URLs from generated markdown in public/md-src
    return [{ source: '/:path*.md', destination: '/md-src/:path*.md' }];
  },
};

const withMDX = createMDX();

export default withMDX(config);
