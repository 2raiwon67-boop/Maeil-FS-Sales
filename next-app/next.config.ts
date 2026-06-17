import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'hcqbmilmldeeuydtrayx.supabase.co',
      },
    ],
  },
};

export default nextConfig;
