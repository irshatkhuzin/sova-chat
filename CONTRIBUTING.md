# Contributing to Sova

Bug reports, documentation improvements, and focused pull requests are welcome.
Use English for public documentation, issues, and pull requests. The operator
panel currently uses Russian; changing its language is a separate product change.

## Development

Follow the [quick start](README.md#quick-start), use Node.js 22 or later, and
install dependencies with `npm ci`. Work on a branch in your fork. For larger
changes, open an issue describing the problem and proposed behavior first.

Run these checks from the repository root:

```sh
npm run build
npm run typecheck
npm test
npm run check:publication
```

`npm test` runs an explicit set of isolated regression tests with no database or
paid AI requests. See [testing](docs/TESTING.md) for coverage and manual verification.

## Pull requests

- Explain the problem, resulting behavior, and how you verified it.
- Keep changes focused. Add a regression test for substantive behavior fixes.
- Preserve message ordering, idempotency, product isolation, and server-side secrets.
- Keep public API and migration compatibility in mind. Add a new migration instead
  of changing one that existing installations have already applied.
- Do not include credentials, environment files, conversation exports, production
  screenshots, database dumps, build output, or local deployment notes.
- Use respectful, constructive language when discussing contributions.

Contributions are provided under the project's [MIT license](LICENSE).
Third-party dependencies retain their own licenses.
