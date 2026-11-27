// Keeps @crossplot/core free of runtime dependencies.
// - package.json declares no dependencies of any kind besides devDependencies.
// - Every import in src/ is relative, so nothing outside the package can be pulled in.
// - Only src/dom/ may import the DOM widgets; the engine and dashboard stay headless.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../packages/core/", import.meta.url).pathname;
const problems = [];

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
for (const field of [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "bundleDependencies",
  "bundledDependencies",
]) {
  const deps = pkg[field];
  if (deps && Object.keys(deps).length > 0) {
    problems.push(`package.json: "${field}" must be empty, found ${Object.keys(deps).join(", ")}`);
  }
}

const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

function* sources(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(ts|mts|js|mjs)$/.test(entry.name)) yield path;
  }
}

for (const file of sources(join(root, "src"))) {
  const rel = relative(root, file);
  const inDom = rel.startsWith(join("src", "dom"));
  for (const [, spec] of readFileSync(file, "utf8").matchAll(specifier)) {
    if (!spec.startsWith(".")) problems.push(`${rel}: imports "${spec}"; core may only import its own files`);
    else if (!inDom && /(^|\/)dom(\/|$)/.test(spec))
      problems.push(`${rel}: imports "${spec}"; only src/dom/ may use the DOM widgets`);
  }
}

if (problems.length > 0) {
  console.error(`@crossplot/core must have zero runtime dependencies:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("@crossplot/core: no runtime dependencies");
