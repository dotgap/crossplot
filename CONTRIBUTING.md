# Contributing to crossplot

Thanks for helping. crossplot is young, so for anything larger than a fix, please open an issue
first to agree on the approach. Everyone taking part agrees to the
[Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in
[SECURITY.md](SECURITY.md), not in issues.

## Setup

You need Node.js 20 or newer and [pnpm](https://pnpm.io) (the version is pinned in
`package.json`; `corepack enable` picks it up).

```sh
git clone https://github.com/dotgap/crossplot.git
cd crossplot
pnpm install
pnpm build
pnpm test
```

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/core` | `@crossplot/core`: headless engine, filter store and dashboard model. Zero runtime dependencies. |
| `packages/plot` | `@crossplot/plot`: the Observable Plot renderer. |
| `examples/dinosaurs` | The demo, a scrollable page of linked charts on fossil data. |
| `docs` | The VitePress docs site, with live examples and a generated API reference. |
| `bench` | Engine brush latency benchmark. |
| `scripts` | Repository checks run in CI. |
| `.changeset` | Pending release notes, see [Releases](#releases). |

## Commands

| Command | What it does |
| --- | --- |
| `pnpm build` | Builds the packages (`tsc -b`). The demo, docs and checks use the built `dist/`. |
| `pnpm test` | Runs the tests with Vitest. `pnpm test:watch` keeps them running. |
| `pnpm vitest run <file>` | Runs one test file; add `-t "<name>"` for one test. |
| `pnpm typecheck` | Type checks the packages, tests, demo and docs. |
| `pnpm lint` | Lints and checks formatting with [Biome](https://biomejs.dev). |
| `pnpm format` | Fixes formatting and import order. |
| `pnpm check:deps` | Checks that `@crossplot/core` has no runtime dependencies and stays headless. |
| `pnpm check:packages` | After a build: checks each package's npm metadata and exports (with publint). |
| `pnpm check:size` | After a build: checks each entry point against its gzipped size budget. |
| `pnpm demo` | Starts the demo dev server. |
| `pnpm docs` | Starts the docs dev server. |
| `pnpm bench [rows]` | Measures engine brush latency, 1M rows by default (`pnpm bench 1e6,1e7` for both). |
| `pnpm changeset` | Adds a changeset for your pull request. |

Before you open a pull request, run:

```sh
pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm check:packages
```

CI runs these, plus the size check and production builds of the demo and docs, on Node 22 and 24.

## Conventions

- **TypeScript.** Strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
  ESM only, with `.js` extensions in relative imports and `import type` for types. No default
  exports.
- **Public API** is whatever `packages/*/src/index.ts` exports. Keep JSDoc on exported types and
  options, because the API reference is generated from it. When the API changes, update the
  package README, the root README example and the docs guide in the same pull request.
- **Core stays small.** `@crossplot/core` has zero runtime dependencies and touches the DOM only in
  `src/dom/`. Renderers and framework wrappers are separate packages with peer dependencies.
- **Data flows one way.** Renderers receive chart data and report intents (brush, select, reset) in
  data space. They never read or write filters.
- **Engine changes need a test.** The randomized test in `packages/core/test/crossindex.test.ts`
  compares the engine against a brute-force reference; extend it for any new dimension, filter or
  aggregate kind. Run `pnpm bench` before and after changes to the engine's hot path.
- **Size budgets.** Every public entry point has a gzipped budget in `scripts/size-limits.json`.
  Raise one only on purpose, and say why in the pull request.

## Pull requests

- Keep each pull request to one change. Small pull requests get reviewed faster.
- **Titles follow [Conventional Commits](https://www.conventionalcommits.org) style:**
  `type(scope): summary`, in the imperative and lowercase after the colon. Types are `feat`, `fix`,
  `perf`, `refactor`, `docs`, `test`, `build`, `ci` and `chore`; the scope is a package or area
  such as `core`, `plot`, `demo` or `docs`. For example: `feat(plot): add a box plot mark`.
- **Pull requests are squash-merged**, so the title becomes the commit message on `main`. Commits
  on your branch can be as messy as you like.
- The description says what the pull request adds or fixes and why. Link the issue it closes.
- CI must be green before merge.

## Dependencies

pnpm is set up to resist supply-chain attacks (`pnpm-workspace.yaml`): it only installs versions
that have been public for 3 days, refuses a version whose publishing trust got weaker, and runs no
install scripts. If a new dependency really needs its install script, add it to
`onlyBuiltDependencies` with a comment saying why. GitHub Actions are pinned by commit SHA, and
CI checks the workflows with [zizmor](https://docs.zizmor.sh/).

## Releases

Releases use [Changesets](https://github.com/changesets/changesets). If your pull request changes
anything a user of a published package would notice, add a changeset:

```sh
pnpm changeset
```

Choose the packages and the bump type, and write one line for the changelog. Before 1.0, use
`minor` for features and breaking changes and `patch` for fixes. Docs, tests, CI and demo-only
changes need no changeset.

All `@crossplot/*` packages share one version. When changesets land on `main`, a bot opens a
`chore: version packages` pull request that bumps versions and updates the changelogs; merging it
publishes the packages to npm with provenance. New packages under `packages/` are included
automatically, as long as they pass `pnpm check:packages`.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
