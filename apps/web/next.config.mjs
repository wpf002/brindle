/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@brindle/ui", "@brindle/core", "@brindle/genetics"],
  webpack: (config) => {
    // Workspace packages use NodeNext ".js" import specifiers that resolve to
    // ".ts" sources; teach webpack the same mapping tsc uses.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};
export default nextConfig;
