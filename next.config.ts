import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app is an authenticated, inherently dynamic ERP — every page needs
  // a live session and live Convex data, so there's nothing worth statically
  // prerendering. Cache Components' per-access Suspense requirement would be
  // pure boilerplate here with no caching upside.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
