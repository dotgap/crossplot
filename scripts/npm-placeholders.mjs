// Publishes an empty 0.0.0 placeholder for each public package, plus the unscoped `crossplot` name.
//
// npm only lets you configure trusted publishing on a package that already exists, so each package
// needs one hand publish before the release workflow can publish it with OpenID Connect. Run this
// once, from a machine where you are logged in to npm (`npm login`) as an owner of the `crossplot`
// organization; npm asks for a two-factor code for each publish. Already published names are skipped.
//
//   node scripts/npm-placeholders.mjs            # list what would be published
//   node scripts/npm-placeholders.mjs --publish  # publish the placeholders
//
// See LAUNCH.md, step 4.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const publish = process.argv.includes("--publish");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const names = [];
for (const dir of readdirSync(join(root, "packages")).sort()) {
  const pkgPath = join(root, "packages", dir, "package.json");
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (!pkg.private) names.push(pkg.name);
}
names.push("crossplot");

const exists = (name) => {
  try {
    execFileSync(npm, ["view", name, "name"], { stdio: "pipe", shell: process.platform === "win32" });
    return true;
  } catch {
    return false;
  }
};

const work = mkdtempSync(join(tmpdir(), "crossplot-placeholders-"));
for (const name of names) {
  if (exists(name)) {
    console.log(`skip     ${name} (already on npm)`);
    continue;
  }
  if (!publish) {
    console.log(`would publish ${name}@0.0.0`);
    continue;
  }
  const dir = join(work, name.replace("/", "__"));
  mkdirSync(dir);
  const scoped = name.startsWith("@");
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: "0.0.0",
        description: scoped
          ? "Placeholder. The first release of this crossplot package is coming soon."
          : "Placeholder for the crossplot project. Install the @crossplot/* packages instead.",
        license: "MIT",
        repository: { type: "git", url: "git+https://github.com/dotgap/crossplot.git" },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, "README.md"),
    `# ${name}\n\nPlaceholder. See [crossplot](https://github.com/dotgap/crossplot) for the real packages.\n`,
  );
  console.log(`publish  ${name}@0.0.0`);
  execFileSync(npm, ["publish", "--access", "public", "--ignore-scripts"], {
    cwd: dir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
if (!publish) console.log("\nDry run. Pass --publish to publish.");
