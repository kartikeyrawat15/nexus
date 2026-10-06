/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  experimental: { appDir: true },
  redirects: async () => [
    { source: "/project", destination: "/project/overview", permanent: true },
    { source: "/", destination: "/project/overview", permanent: true },
  ],
};
export default config;
