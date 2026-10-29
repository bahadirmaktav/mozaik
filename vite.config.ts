import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;
const excalidrawAssets = resolve(
  "node_modules/@excalidraw/excalidraw/dist/prod",
);

// Excalidraw loads its fonts at runtime from EXCALIDRAW_ASSET_PATH. Ship them with the app
// so drawing and export never fall back to the CDN. The dev server serves node_modules.
function excalidrawFonts(): Plugin {
  return {
    name: "tessera-excalidraw-fonts",
    apply: "build",
    generateBundle() {
      const fonts = join(excalidrawAssets, "fonts");
      for (const entry of readdirSync(fonts, {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile()) continue;
        const file = join(entry.parentPath, entry.name);
        this.emitFile({
          type: "asset",
          fileName: `excalidraw/${relative(excalidrawAssets, file).split(sep).join("/")}`,
          source: readFileSync(file),
        });
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), excalidrawFonts()],
  resolve: {
    alias: [
      // Excalidraw's file saves go through Tessera's native dialog (see fs-access.ts).
      {
        find: /^browser-fs-access$/,
        replacement: resolve("src/plugins/excalidraw/fs-access.ts"),
      },
      {
        find: /^tessera-browser-fs-access$/,
        replacement: resolve("node_modules/browser-fs-access/dist/index.mjs"),
      },
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
