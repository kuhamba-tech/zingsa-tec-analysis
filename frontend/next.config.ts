import type { NextConfig } from "next";
import path from "path";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // Static export for Vercel; keep a real Next server in `next dev` so we can
  // proxy /backend → FastAPI (needed when only the frontend port is forwarded).
  ...(isDev ? {} : { output: "export" as const }),
  trailingSlash: true,
  // Keep `/backend/...` paths without forced trailing slashes so the FastAPI
  // proxy hits `/space-weather/current` (200) instead of `/.../current/` (404).
  skipTrailingSlashRedirect: true,
  images: {
    unoptimized: true,
  },
  // Next 16 blocks disallowed hosts for /_next/* in development, which can
  // prevent hydration and leave Live Metric stuck on "Connecting".
  // Allow local + Cursor/cloud preview hostnames used to open the forwarded port.
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "*.cursor.sh",
    "*.cursorapi.com",
    "*.cursorusercontent.com",
    "*.ngrok-free.app",
    "*.ngrok.io",
  ],
  async rewrites() {
    if (!isDev) return [];
    return [
      {
        source: "/backend/:path*",
        destination: "http://127.0.0.1:8000/:path*",
      },
    ];
  },
  turbopack: {
    root: path.resolve(__dirname, ".."),
  },
  // OpenLayers modules are large; default webpack chunkLoadTimeout (120s) can
  // still fire under slow HMR / parallel chunk pressure in cloud VMs.
  // Keep all `ol` package code in one async chunk so CorsMap does not race
  // a dozen `_app-pages-browser_node_modules_ol_*` loads.
  webpack: (config, { dev }) => {
    config.output = {
      ...config.output,
      // Dev HMR can stall chunk fetches; give the browser more headroom.
      chunkLoadTimeout: dev ? 600_000 : 300_000,
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
