/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@brindle/ui", "@brindle/core"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};
export default nextConfig;
