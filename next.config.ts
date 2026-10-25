import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: process.env.DEV_TUNNEL_HOST ? [process.env.DEV_TUNNEL_HOST] : [],
  serverExternalPackages: ["sharp", "node:sqlite"],
  poweredByHeader: false,
  outputFileTracingIncludes: { "/*": ["./supabase/certs/prod-ca-2021.crt"] },
  outputFileTracingExcludes: {
    "/*": ["./.data/**", "./archive/**", "./output/**"],
  },
  async headers() {
    return [
      {
        source: "/models/vision/:file([a-z0-9-]+\\.onnx)",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(self)",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default nextConfig;
