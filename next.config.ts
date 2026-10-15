import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["exceljs", "pg"],
  experimental: {
    // Import files and evidence uploads go through route handlers; allow
    // multipart bodies past the proxy default of 10 MB (app limits still apply).
    proxyClientMaxBodySize: "25mb",
    // Fewer build workers: this tool runs on laptops with limited memory.
    cpus: 2,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
