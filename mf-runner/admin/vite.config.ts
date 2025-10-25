// /srv/musefield/mf-runner/admin/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/runner/",      // ← key line (assets will be /runner/assets/*)
  plugins: [react()],
  server: { host: true, port: 5175, strictPort: true, proxy: {
    "/api":    { target: "http://127.0.0.1:8081", changeOrigin: true, rewrite: p => p.replace(/^\/api/, "") },
    "/healthz":{ target: "http://127.0.0.1:8081", changeOrigin: true },
  }},
  preview: { host: true, port: 5175 },
  build: { outDir: "dist", assetsDir: "assets" }
});

