# Launch checklist

The manual steps left before crossplot goes public and the first release reaches npm. Everything
in the repository is ready; these steps need an owner of the GitHub organization or the npm scope.
Work through them in order, and delete this file once they are all done.

## 1. Before the repository goes public

- [ ] Organization settings → Authentication security: require two-factor authentication for all
      members.
- [ ] Organization settings → Member privileges: turn off repository creation for members (at
      least public repositories).
- [ ] Organization settings → Actions → General: allow GitHub Actions to create and approve pull
      requests. The release workflow needs it to open the version pull request.
- [ ] Check what goes public: open issues, pull request descriptions and comments, and the git
      history. Secret scanning (step 2) scans the whole history once it is on; read its results
      before announcing anything.

## 2. Make the repository public

- [ ] Settings → General → Danger zone → Change visibility → Public.
- [ ] Settings → General: add the description ("Coordinated, cross-filtered charts for
      TypeScript"), the website (`https://dotgap.github.io/crossplot/`) and topics such as
      `crossfilter`, `data-visualization`, `charts`, `typescript`, `observable-plot`.
- [ ] Settings → Code security: turn on **private vulnerability reporting** (`SECURITY.md` points to
      it), **secret scanning** with **push protection**, and Dependabot alerts and security updates.
- [ ] Settings → Rules → Rulesets: protect `main`. Require a pull request before merging, require
      these status checks to pass: `Lint and format`, `Typecheck and test (Node 22)`,
      `Typecheck and test (Node 24)` and `Build, package checks, bundle size, demo and docs`, block
      force pushes and deletion, and require linear history. Leave the bypass list empty, or add only
      organization owners.

## 3. Docs site on GitHub Pages

- [ ] Settings → Pages → Build and deployment → Source: **GitHub Actions**.
- [ ] Settings → Secrets and variables → Actions → Variables: add `DOCS_DEPLOY` = `true`. Every
      push to `main` then deploys the docs, with the demo under `/demo/`.
- [ ] Run the **Docs** workflow once by hand (Actions → Docs → Run workflow) and open
      `https://dotgap.github.io/crossplot/`.
- [ ] Later, to serve the docs at `https://dotgap.dev/crossplot/`: create the repository
      `dotgap/dotgap.github.io`, give its Pages site the custom domain `dotgap.dev` (with the DNS
      records GitHub lists), and GitHub then serves this project site under `/crossplot/`. Update
      `homepage` in each `packages/*/package.json`, the docs links and the repository website.

## 4. npm

Publishing uses [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OpenID Connect):
no npm token exists anywhere, and npm accepts a publish only from the release workflow.

- [ ] On npmjs.com, confirm the `crossplot` organization owns the `@crossplot` scope, and require
      two-factor authentication for every member (organization settings). Use a security key or an
      authenticator app, not SMS.
- [ ] npm only lets you set up trusted publishing on a package that exists, so publish an empty
      `0.0.0` placeholder of each package once by hand (it also reserves the unscoped `crossplot`
      name): `npm login`, then `node scripts/npm-placeholders.mjs` to see the list and
      `node scripts/npm-placeholders.mjs --publish` to publish it.
- [ ] For each `@crossplot/*` package on npmjs.com, Settings → Trusted publishing: add GitHub
      Actions with organization `dotgap`, repository `crossplot`, workflow `release.yml` and
      environment `npm`. Then set Publishing access to **Require two-factor authentication and
      disallow tokens**.
- [ ] Settings → Environments → New environment `npm`. Restrict deployment branches to `main`, and
      optionally add yourself as a required reviewer so each release waits for your approval. It
      needs no secrets.
- [ ] Settings → Rules → Rulesets → New tag ruleset for `@crossplot/*` tags: restrict creation,
      updates and deletion, with only organization owners and GitHub Actions allowed to bypass.
      Turn on immutable releases (Settings → General → Releases) as well.

## 5. First release

The repository must be public first: npm rejects provenance from private repositories, and
trusted publishing always adds provenance.

- [x] Update the status note in `README.md` (and the line in `CLAUDE.md`) that says nothing is
      published to npm yet.
- [ ] Settings → Secrets and variables → Actions → Variables: add `RELEASE_ENABLED` = `true`. Until
      it is set, the release workflow only runs when started by hand.
- [ ] Run the **Release** workflow (or push to `main`). It opens a `chore: version packages` pull
      request from the pending changesets; the first one releases all five
      `@crossplot/*` packages as `0.1.0`. GitHub does not run CI on pull requests opened by a workflow,
      so close and reopen it if you want the checks to run.
- [ ] Merge that pull request. The workflow publishes to npm with provenance, pushes the
      `@crossplot/*@0.1.0` tags and creates the GitHub releases.
- [ ] Check the packages on npmjs.com show the provenance badge, and install them in a fresh
      project.

## Later

- [ ] Deprecate the `0.0.0` placeholders (`npm deprecate @crossplot/core@0.0.0 "Placeholder, use 0.1.0 or later"`, and the same for the others).
- [ ] Turn the changelog's contributor credit on (`disableThanks` in `.changeset/config.json`) once
      outside contributions start.
