import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployments
  output: "standalone",

  // Set turbopack root to avoid parent directory lockfile confusion
  experimental: {
    turbo: {
      root: __dirname,
    },
  },

  // Allow external images for avatars
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "via.placeholder.com",
      },
    ],
  },

  // External packages that should not be bundled
  serverExternalPackages: ["@prisma/adapter-libsql", "@libsql/client"],

  // Disable ESLint during builds to ignore linting errors
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Webpack configuration to ignore optional crunchycone-lib cloud provider dependencies
  webpack: (config, { isServer }) => {
    // Add IgnorePlugin to ignore optional dependencies for both client and server
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { IgnorePlugin } = require("webpack");

    config.plugins = config.plugins || [];
    config.plugins.push(
      new IgnorePlugin({
        checkResource(resource: string, _context: string) {
          // Ignore optional AWS SDK packages
          if (
            resource === "@aws-sdk/client-s3" ||
            resource === "@aws-sdk/s3-request-presigner" ||
            resource === "@aws-sdk/client-ses"
          ) {
            return true;
          }
          // Ignore other optional cloud provider packages
          if (
            resource === "@azure/storage-blob" ||
            resource === "@google-cloud/storage" ||
            resource === "mailgun.js" ||
            resource === "resend"
          ) {
            return true;
          }
          return false;
        },
      })
    );

    if (isServer) {
      // Mark optional cloud provider SDKs as external for server-side
      config.externals = config.externals || [];
      config.externals.push({
        "@aws-sdk/client-ses": "commonjs @aws-sdk/client-ses",
        "@aws-sdk/client-s3": "commonjs @aws-sdk/client-s3",
        "@aws-sdk/s3-request-presigner": "commonjs @aws-sdk/s3-request-presigner",
        "@azure/storage-blob": "commonjs @azure/storage-blob",
        "@google-cloud/storage": "commonjs @google-cloud/storage",
        "mailgun.js": "commonjs mailgun.js",
        resend: "commonjs resend",
        nodemailer: "commonjs nodemailer",
      });
    }

    // Suppress webpack warnings about critical dependencies
    const originalWarnings = config.ignoreWarnings || [];
    config.ignoreWarnings = [
      ...originalWarnings,
      {
        module: /mjml-core/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
      {
        module: /crunchycone-lib/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ];

    return config;
  },
};

export default nextConfig;
