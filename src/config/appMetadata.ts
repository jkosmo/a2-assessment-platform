import fs from "node:fs";
import path from "node:path";

type PackageJson = {
  name?: string;
  version?: string;
};

function loadPackageJson(): PackageJson {
  try {
    const packagePath = path.resolve(process.cwd(), "package.json");
    const raw = fs.readFileSync(packagePath, "utf8");
    return JSON.parse(raw) as PackageJson;
  } catch {
    return {};
  }
}

const packageJson = loadPackageJson();

export const appName = packageJson.name ?? "a2-assessment-platform";
export const appVersion = packageJson.version ?? "0.0.0";
