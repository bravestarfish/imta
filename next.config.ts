import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "@atproto/oauth-client-node",
    "@atproto/api",
    "@atproto/identity",
    "pg-boss",
    "postgres",
    "nodemailer",
  ],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  async rewrites() {
    // Public booking pages use the familiar /@handle form; the app serves them from /u/.
    return [
      { source: "/@:handle", destination: "/u/:handle" },
      { source: "/@:handle/:slug", destination: "/u/:handle/:slug" },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
