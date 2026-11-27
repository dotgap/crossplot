import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // React tests are .tsx with the automatic JSX runtime.
  esbuild: { jsx: "automatic" },
  // Compiles the Svelte bindings' runes (`*.svelte.ts`) and test components; other files pass through.
  plugins: [svelte({ configFile: false })],
  resolve: {
    // Svelte's browser build, so components mount in jsdom instead of rendering on the server.
    conditions: ["browser"],
    alias: {
      "@crossplot/core/dom": new URL("./packages/core/src/dom/index.ts", import.meta.url).pathname,
      "@crossplot/react": new URL("./packages/react/src/index.ts", import.meta.url).pathname,
      "@crossplot/vue": new URL("./packages/vue/src/index.ts", import.meta.url).pathname,
      "@crossplot/svelte": new URL("./packages/svelte/src/index.ts", import.meta.url).pathname,
      "@crossplot/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@crossplot/plot": new URL("./packages/plot/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.{ts,tsx}"],
  },
});
