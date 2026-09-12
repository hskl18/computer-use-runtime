import path from "node:path";
import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `http://127.0.0.1:${process.env.WORKER_PORT ?? "3101"}/api/:path*`,
      },
    ];
  },
};
export default config;
