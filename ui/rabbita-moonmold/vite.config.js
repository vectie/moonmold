import { defineConfig } from "vite";

export default defineConfig({
  appType: "spa",
  server: {
    port: 4194,
    proxy: {
      "/api": "http://127.0.0.1:4193",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
