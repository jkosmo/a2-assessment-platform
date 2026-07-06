// AA-4/#652 follow-up: package the repo-canonical a2-authoring-api skill as a
// distributable zip. The zip contains the skill FOLDER (a2-authoring-api/SKILL.md
// at its root), which is the layout both ChatGPT (workspace/institution skill
// deploy, per-user install) and claude.ai (capabilities upload) expect.
//
// Usage: npm run skill:package
// Output: dist/skills/a2-authoring-api-v<package.json version>.zip
//
// jszip (devDependency) is used instead of PowerShell Compress-Archive because
// PS 5.1 writes backslash entry names, which breaks unzip in other systems.

import { readFile, readdir, mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = path.join(ROOT, "skills", "a2-authoring-api");
const OUT_DIR = path.join(ROOT, "dist", "skills");

async function addDirectory(zip, absoluteDir, zipPrefix) {
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(absoluteDir, entry.name);
    const zipPath = `${zipPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await addDirectory(zip, absolute, zipPath);
    } else {
      // Normalize to LF so the artifact is identical regardless of the
      // packaging machine's git eol settings (see the #653 CRLF incident).
      const raw = await readFile(absolute);
      const isText = /\.(md|mjs|mts|json)$/.test(entry.name);
      zip.file(zipPath, isText ? raw.toString("utf8").replaceAll("\r\n", "\n") : raw);
    }
  }
}

async function main() {
  await stat(path.join(SKILL_DIR, "SKILL.md")); // fail fast if layout changed
  const version = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")).version;

  const zip = new JSZip();
  await addDirectory(zip, SKILL_DIR, "a2-authoring-api");

  await mkdir(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `a2-authoring-api-v${version}.zip`);
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeFile(outFile, buffer);

  const fileCount = Object.keys(zip.files).filter((name) => !zip.files[name].dir).length;
  console.log(`Wrote ${outFile} (${fileCount} files, ${buffer.length} bytes)`);
  console.log("Deploy: ChatGPT admin (institusjons-skill) / claude.ai capabilities — same zip.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
