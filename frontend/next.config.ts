import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Next 16 blocks 127.0.0.1 ↔ localhost as cross-origin for /_next/* in
  // development, which prevents hydration and all client API fetches.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  // OpenLayers modules are large; default webpack chunkLoadTimeout (120s) can
  // still fire under slow HMR / parallel chunk pressure in cloud VMs.
  webpack: (config) => {
    config.output = {
      ...config.output,
      chunkLoadTimeout: 300_000,
    };
    return config;
  },
};

export default nextConfig;
