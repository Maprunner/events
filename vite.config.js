import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "public",
  base: "/events/",
  build: {
    outDir: "./dist",
    emptyOutDir: true,
    manifest: true,
    sourcemap: true,
  },
  server: {
    origin: "http://localhost",
    port: 5173,
    // needed for vite and Cypress to work together
    // see https://stackoverflow.com/questions/72324704/cypress-cant-load-assets-from-vites-devserver
    host: "127.0.0.1",
    strictPort: true,
    hot: true,
    hmr: {
      port: 5174,
      host: "127.0.0.1",
    },
    // redirects API calls to XAMPP server in development environment
    proxy: {
      "/api": {
        target: "http://localhost/events",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
})
