import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const { PORT = "3000" } = loadEnv(mode, "../..", "");

  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${PORT}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
