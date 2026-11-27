// Checks that every publishable package under packages/ is ready for npm. Run after `pnpm build`.
// - package.json carries the metadata npm shows and the release workflow relies on.
// - README.md and LICENSE ship with the package.
// - publint validates exports, types and the packed file list against the built output.
// New packages are picked up automatically; private packages are skipped.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { publint } from "publint";
import { formatMessage } from "publint/utils";

const root = new URL("../", import.meta.url).pathname;
const license = readFileSync(join(root, "LICENSE"), "utf8");
const problems = [];

for (const dir of readdirSync(join(root, "packages")).sort()) {
  const pkgDir = join(root, "packages", dir);
  const pkgPath = join(pkgDir, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.private) continue;
  const fail = (message) => problems.push(`packages/${dir}: ${message}`);

  if (!pkg.name?.startsWith("@crossplot/")) fail(`name must be in the @crossplot scope, found "${pkg.name}"`);
  for (const field of ["version", "description", "homepage", "keywords", "exports", "files"]) {
    if (pkg[field] === undefined) fail(`package.json is missing "${field}"`);
  }
  if (pkg.license !== "MIT") fail(`license must be "MIT", found "${pkg.license}"`);
  if (pkg.type !== "module") fail(`type must be "module"`);
  if (pkg.sideEffects === undefined)
    fail(`package.json must declare "sideEffects" (false, or the files that have them)`);
  if (pkg.repository?.url !== "git+https://github.com/dotgap/crossplot.git") {
    fail(`repository.url must be "git+https://github.com/dotgap/crossplot.git"`);
  }
  if (pkg.repository?.directory !== `packages/${dir}`) fail(`repository.directory must be "packages/${dir}"`);
  if (pkg.publishConfig?.access !== "public") fail(`publishConfig.access must be "public"`);
  if (!pkg.files?.includes("dist")) fail(`files must include "dist"`);
  if (pkg.dependencies?.["@crossplot/core"]) fail(`depend on @crossplot/core as a peer dependency, not a dependency`);
  if (!existsSync(join(pkgDir, "README.md"))) fail("README.md is missing");
  if (!existsSync(join(pkgDir, "LICENSE"))) fail("LICENSE is missing (copy the root LICENSE)");
  else if (readFileSync(join(pkgDir, "LICENSE"), "utf8") !== license) fail("LICENSE differs from the root LICENSE");

  const { messages } = await publint({ pkgDir, level: "warning", strict: true, pack: "pnpm" });
  for (const message of messages) fail(`publint: ${formatMessage(message, pkg, { color: false })}`);
}

if (problems.length > 0) {
  console.error(`Package check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("Package check passed.");
