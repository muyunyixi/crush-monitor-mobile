import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: 'apps/web',
  base: "./",
  plugins: [react()],
  build: { outDir: '../../dist', emptyOutDir: true },
  server: {
    port: 5178,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3178" },
  },
});
