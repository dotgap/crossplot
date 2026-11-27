# Changesets

Every pull request that changes a published package (`packages/*`) adds a changeset: a small
Markdown file that says which packages change, the bump type, and one line for the changelog.

```sh
pnpm changeset
```

Pick the packages and the bump (before 1.0, `minor` for new features and breaking changes, `patch`
for fixes), then write the line as it should read in `CHANGELOG.md`. Docs, tests, CI and demo-only
changes need no changeset.

All `@crossplot/*` packages are versioned together (`fixed` in `config.json`), and new packages
under `packages/` are picked up automatically. Private workspace packages (the demo and the docs)
are never versioned or published.

On `main`, the release workflow (`.github/workflows/release.yml`) collects pending changesets into a
"chore: version packages" pull request; merging that pull request publishes to npm. See
[CONTRIBUTING.md](../CONTRIBUTING.md#releases) and [LAUNCH.md](../LAUNCH.md).
