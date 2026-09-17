import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Cloudinary-hosted uploads - recipes/models.py's Image.url. Wildcarded
      // to any cloud name, since that is a per-deployment setting
      // (CLOUDINARY_CLOUD_NAME) rather than something fixed here.
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      // TheMealDB's own thumbnails - recipes/sources.py's imported recipes
      // link straight to the provider's photo rather than re-uploading it.
      {
        protocol: "https",
        hostname: "www.themealdb.com",
      },
    ],
  },
};

export default nextConfig;
