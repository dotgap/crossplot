# Security policy

## Supported versions

crossplot is before 1.0. Security fixes go into the latest release of each `@crossplot/*` package
only; please upgrade to it.

## Reporting a vulnerability

Please do not open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub instead: on the
[Security tab](https://github.com/dotgap/crossplot/security) of this repository, choose
**Report a vulnerability**. Only the maintainers can see the report.

If you can't use GitHub, email [security@dotgap.dev](mailto:security@dotgap.dev) instead.

Please include:

- the package and version affected,
- what an attacker can do, and under which conditions,
- steps or a small example that reproduces it.

## What happens next

- We aim to acknowledge a report within 3 working days and to give a first assessment within
  7 days.
- We work on a fix in a private security advisory and keep you updated on progress.
- Once a fix is released, we publish the advisory and credit you, unless you prefer to stay
  anonymous.

## Scope

crossplot runs in the browser and in Node.js on data supplied by the application. Reports are most
useful when they concern the published `@crossplot/*` packages, such as code execution or markup
injection through data values or labels. The demo and the docs site are examples rather than
supported software, but reports about them are welcome too.
