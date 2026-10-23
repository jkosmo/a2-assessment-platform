// Henter ikonbiblioteket Lucide (ISC) inn i repoet, i den formen plattformen og skillet bruker.
//
// Plattformen tegner ikoner i seksjonstekst (`![](icon:<navn>)`) fra én fil: public/static/icons/
// lucide-icons.json, et oppslag fra navn til ikonets indre SVG-markering. Ruta /static/icons/<navn>.svg
// setter rammen (størrelse, strek, farge) rundt. Skillet får lista over gyldige navn, så det kan
// kontrollere en pakke der repoet ikke finnes. Begge filene er sjekket inn: utrullingen og skillet
// skal ikke avhenge av node_modules.
//
// Kjør på nytt når pakken lucide-static oppgraderes:  npm run icons:vendor
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

const pkg = require("lucide-static/package.json");
const nodes = require("lucide-static/icon-nodes.json");
const licence = readFileSync(require.resolve("lucide-static/LICENSE"), "utf8");

/** Ett ikon: nodene fra Lucide som SVG-markering uten rota — rota settes av ruta. */
function markup(iconNodes) {
  return iconNodes
    .map(([element, attributes]) => {
      const attrs = Object.entries(attributes)
        .map(([name, value]) => `${name}="${String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
        .join(" ");
      return `<${element} ${attrs}/>`;
    })
    .join("");
}

const names = Object.keys(nodes).sort();
const icons = Object.fromEntries(names.map((name) => [name, markup(nodes[name])]));

const outDir = join(root, "public", "static", "icons");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "lucide-icons.json"), JSON.stringify({ name: "lucide", version: pkg.version, license: pkg.license, icons }), "utf8");
writeFileSync(join(outDir, "LICENSE-lucide.txt"), licence, "utf8");
writeFileSync(join(root, "skills", "a2-authoring-api", "references", "icon-names.txt"), `${names.join("\n")}\n`, "utf8");
// 2026-10-22: skillets flyttegner bygger ikonene inn i figuren (et bilde kan ikke hente noe utenfra),
// så skillet har samme fil som plattformen — og lisensen, som ISC krever med en kopi.
const skillScripts = join(root, "skills", "a2-authoring-api", "scripts");
writeFileSync(join(skillScripts, "lucide-icons.json"), JSON.stringify({ name: "lucide", version: pkg.version, license: pkg.license, icons }), "utf8");
writeFileSync(join(skillScripts, "LICENSE-lucide.txt"), licence, "utf8");

console.log(`lucide ${pkg.version} (${pkg.license}): ${names.length} ikoner skrevet til public/static/icons/ og skillets icon-names.txt`);
