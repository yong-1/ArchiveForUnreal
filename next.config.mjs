/** @type {import('next').NextConfig} */
const nextConfig = {
  // images: {
  //   domains: ['upload.wikimedia.org'],
  // },
  images: {
    remotePatterns: [
      {
        hostname: 'upload.wikimedia.org',
      },
    ],
  },
  serverExternalPackages: ['@prisma/client', 'archiver', 'sharp', 'ffmpeg-static', 'ffprobe-static'],
  // distDir: 'build',
};

export default nextConfig;
