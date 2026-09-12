import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// Konfigurasi minimal: kita hanya menguji fungsi murni di
// src/shared/lib (tanpa render komponen React), jadi tidak
// perlu environment jsdom maupun setup file tambahan.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDir, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
