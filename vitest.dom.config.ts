import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicStaticDir = path.join(rootDir, "public", "static");
const publicI18nDir = path.join(rootDir, "public", "i18n");

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^\/static\/i18n\/(.*)$/,
        replacement: `${publicI18nDir}${path.sep}$1`,
      },
      {
        find: /^\/static\/(.*)$/,
        replacement: `${publicStaticDir}${path.sep}$1`,
      },
    ],
  },
  test: {
    environment: "jsdom",
    include: ["test/dom/**/*.test.ts", "test/dom/**/*.test.js"],
    globals: true,
    testTimeout: 20000,
  },
});
