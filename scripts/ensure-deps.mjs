// Runs before `npm run dev` / `npm run build` (and so before `npm run tauri dev`).
// After pulling new changes, package.json can list packages that were never
// installed on this machine, which makes Vite fail with "Failed to resolve import".
// If anything is missing, install it once instead of failing.
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
const missing = names.filter((n) => !existsSync(join(root, "node_modules", n, "package.json")));

if (missing.length > 0) {
  console.log(`Missing packages (${missing.join(", ")}). Running npm install...`);
  execSync("npm install", { cwd: root, stdio: "inherit" });
}
