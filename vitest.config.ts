import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify("test"),
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/main.tsx", "src/types/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["src/**/*.dom.test.tsx"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.dom.test.tsx"],
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(dir, "./src"),
    },
  },
});
