/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Settings follow the Tauri + Vite template.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    // Everything is loaded from disk inside the desktop app, so one larger bundle is fine.
    chunkSizeWarningLimit: 1000,
  },
  test: {
    environment: "node",
  },
});
