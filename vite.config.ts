import { defineConfig } from "vitest/config";

// Served from GitHub Pages at https://lehmuksenoksa.github.io/read-web/.
export default defineConfig({
  base: "/read-web/",
  build: {
    target: "es2022",
    // No inline scripts: the Content Security Policy allows the page's own files only.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
