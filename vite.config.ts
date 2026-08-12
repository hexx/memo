import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    TanStackRouterVite({
      // routes/__tests__/ 配下のテストファイルをルートとして扱わない
      routeFileIgnorePattern: "__tests__",
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
  build: {
    outDir: "dist/client",
    // シングルユーザー PWA のため 500kB 超のチャンクを許容（ADR 0008 参照）
    chunkSizeWarningLimit: 900,
  },
});
