/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "20mb" },
    serverComponentsExternalPackages: ["better-sqlite3"],
  },
};
export default nextConfig;
