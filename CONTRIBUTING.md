# Contributing to focuswalk

Issues and pull requests are welcome.

## The most useful report: a false positive

focuswalk is only worth running if people trust what it says. If it reports something a person looking at the page would not call a problem, or misses something obvious, open an issue with:

- The URL, or a small HTML file that reproduces it
- The command you ran and what it printed
- What you expected instead

## Other bugs

Include your Node version (`node --version`), your operating system, and whether you ran with installed Chrome or Playwright's Chromium (`--browser`).

## Pull requests

For anything beyond a small fix, open an issue first so we can agree on the approach before you spend time on it.

- One pull request, one concern. Don't reformat unrelated code.
- A change to a check needs a demo page. Every check has a page under `test/fixtures/site` that plants the problem, and a test in `test/checks.test.mjs` that pins down exactly what is reported for it. Add or extend one.
- Don't hand-write a rule that axe-core already has. Rule-based checks belong upstream in [axe-core](https://github.com/dequelabs/axe-core); focuswalk's own checks are the ones that need a real keyboard or a real viewport.
- New dependencies need a reason. There are three today: `playwright`, `@axe-core/playwright` and `pngjs`.
- Be precise about WCAG. A check that reports a failure has to map to a level A or AA success criterion. Good practice that WCAG doesn't require is a note (`kind: 'advice'`).

## Running locally

```sh
git clone https://github.com/MikeSewell/focuswalk.git
cd focuswalk
npm install
npm test
```

The tests start a local server and drive a real browser, so they take about a minute. They use installed Chrome if there is one, otherwise run `npx playwright install chromium` first.

To try a change by hand:

```sh
node test/serve.mjs &
node bin/focuswalk.mjs http://127.0.0.1:4173 /focus.html
```

## Code style

- Plain Node ES modules, no build step.
- Comments say why, not what.
- No em dashes in code, comments or docs. Use regular dashes.

## Releasing (maintainers)

1. Update `CHANGELOG.md` and the version in `package.json`.
2. Run `node scripts/readme-images.mjs` if the output changed.
3. Tag `vX.Y.Z` and publish a GitHub release. The release workflow publishes to npm.
