import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.VITE_API_TARGET || "http://127.0.0.1:8075";

export default defineConfig({
  plugins: [react()],
  define: { __APP_BUILD__: JSON.stringify(new Date().toISOString()) },
  server: {
    port: 5175,
    watch: { ignored: ["**/src-tauri/target/**"] },
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/ws": { target: apiTarget.replace("http", "ws"), ws: true },
    },
  },
});
