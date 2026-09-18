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
  // Keep all `ol` package code in one async chunk so CorsMap does not race
  // a dozen `_app-pages-browser_node_modules_ol_*` loads.
  webpack: (config) => {
    config.output = {
      ...config.output,
      chunkLoadTimeout: 300_000,
    };
    const split = config.optimization?.splitChunks;
    if (split && typeof split === "object") {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          ...split,
          cacheGroups: {
            ...(typeof split.cacheGroups === "object" ? split.cacheGroups : {}),
            openlayers: {
              test: /[\\/]node_modules[\\/]ol[\\/]/,
              name: "openlayers",
              chunks: "all",
              priority: 40,
              enforce: true,
              reuseExistingChunk: true,
            },
          },
        },
      };
    }
    return config;
  },
};

export default nextConfig;
