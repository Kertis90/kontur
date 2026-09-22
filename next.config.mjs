/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingExcludes: { "/*": ["./.recording-test-*/**", "./scripts/*.test.mjs"] },
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["yjs", "bullmq", "ioredis", "minio", "mysql2", "ldapts", "nodemailer"],
};

export default nextConfig;
