import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: host || "127.0.0.1",
    port: 1420,
    strictPort: true,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] }
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "chrome105",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/react/") || id.includes("/node_modules/react-dom/") || id.includes("/node_modules/scheduler/") || id.includes("/node_modules/zustand/")) return "react";
          if (id.includes("react-markdown") || id.includes("/remark-") || id.includes("/rehype-") || id.includes("/unified/") || id.includes("/micromark") || id.includes("/mdast-") || id.includes("/hast-") || id.includes("/katex/")) return "markdown";
          if (id.includes("@tauri-apps")) return "tauri";
          if (id.includes("lucide-react")) return "icons";
        }
      }
    }
  }
});
