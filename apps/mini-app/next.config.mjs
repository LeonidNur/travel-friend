const backendApiOrigin = process.env.BACKEND_API_ORIGIN?.replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    if (!backendApiOrigin) {
      return [];
    }

    return [
      {
        source: '/api/backend/:path*',
        destination: `${backendApiOrigin}/:path*`
      }
    ];
  }
};

export default nextConfig;
