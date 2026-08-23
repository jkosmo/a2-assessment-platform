import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicStaticDir = path.join(rootDir, "public", "static");
const publicI18nDir = path.join(rootDir, "public", "i18n");

export default defineConfig({
  // #975: frontend-modulene ligger i `public/`, som Vite ellers behandler som en ren asset-mappe og
  // nekter å la moduler importere fra. Da api-client.js begynte å importere `setHidden` fra
  // /static/dom-visibility.js, veltet hele dom-kjøringen på «Cannot import non-asset file». Vi
  // serverer ingenting her — jsdom-testene importerer bare moduler — så publicDir har ingen jobb.
  publicDir: false,
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
