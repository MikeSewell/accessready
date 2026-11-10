# focuswalk

> WCAG 2.2 AA audit for a whole site. Runs axe-core, then presses Tab through every page in real Chrome to catch what rule engines miss.

[![npm](https://img.shields.io/npm/v/focuswalk.svg)](https://www.npmjs.com/package/focuswalk)
[![CI](https://github.com/MikeSewell/focuswalk/actions/workflows/ci.yml/badge.svg)](https://github.com/MikeSewell/focuswalk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```sh
npx focuswalk https://example.org
```

![focuswalk reporting a link with no focus indicator, a link hidden under a fixed bar, and a page that scrolls sideways](docs/terminal.png)

It reads the sitemap, audits every page, and exits 1 if anything fails, so it can gate a deploy.

## Why

Most accessibility checkers are built on [axe-core](https://github.com/dequelabs/axe-core). It is very good at what a rules engine can decide from the page's code: contrast, labels, alt text, ARIA. focuswalk runs it on every page.

But some of the problems that lock keyboard users out can't be decided from code. You have to use the page. As of axe-core 4.14 there is no rule for any of these:

| Problem | WCAG | How focuswalk checks it |
|---|---|---|
| A link or button shows nothing when it has focus | 2.4.7 Focus Visible | Presses Tab to each element, screenshots it focused and unfocused, and compares the pixels |
| The focused element is hidden under a sticky header, cookie banner or chat bubble | 2.4.11 Focus Not Obscured (new in 2.2) | At each Tab stop, checks whether anything of the element can be seen, and names what covers it |
| The page scrolls sideways when zoomed | 1.4.10 Reflow | Resizes to 320px wide and measures, and names the widest element |
| A video plays by itself and can't be paused | 2.2.2 Pause, Stop, Hide | Finds autoplaying or looping video with no controls and no pause button near it |

It also switches on axe-core's WCAG 2.2 target-size rule (2.5.8), which is off unless asked for.

## Why not

- **A pass is not conformance.** Automated checks find some accessibility problems, not all of them. Deque, who make axe-core, put their own coverage at [57% of issues by volume](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues). When the UK government ran ten tools against a page of planted barriers, [all of them together found 71%](https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/). You still need a person with a keyboard and a screen reader.
- **It is not a legal opinion.** It won't tell you a site is "ADA compliant", and neither will any other tool.
- **It only drives Chrome.** No Firefox or Safari.
- **It doesn't operate your UI.** It tabs through what is on the page at load. It doesn't open menus, submit forms or step through a checkout.
- If you only need rule checks on a handful of URLs, [`@axe-core/cli`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/cli) or [`pa11y-ci`](https://github.com/pa11y/pa11y-ci) are smaller.

## Install

Needs Node 20 or newer, and Google Chrome. If Chrome isn't installed, focuswalk uses Playwright's Chromium instead:

```sh
npx playwright install chromium
```

Run it without installing:

```sh
npx focuswalk https://example.org
```

Or add it to a project:

```sh
npm install --save-dev focuswalk
```

## Usage

```
focuswalk <url> [path ...] [options]
```

```sh
focuswalk https://example.org              # every page in /sitemap.xml
focuswalk https://example.org / /donate    # only these paths
focuswalk https://example.org/donate       # only this page
focuswalk http://localhost:3000            # a local build, before it ships
```

When you point it at localhost, URLs in the sitemap are rewritten onto localhost, so a production sitemap works against a local build.

| Option | Default | What it does |
|---|---|---|
| `--html <file>` | | Write a report a non-developer can read |
| `--json <file>` | | Write the full results as JSON. `-` prints to stdout |
| `--sitemap <url>` | `<url>/sitemap.xml` | Sitemap to read. Sitemap indexes are followed one level |
| `--max <n>` | 40 | Most pages to audit from a sitemap |
| `--concurrency <n>` | 2 | Pages audited at once |
| `--storage-state <file>` | | Playwright storage state, to audit logged-in pages |
| `--viewport <WxH>` | 1440x900 | Browser window size. Try `390x844` for a phone |
| `--max-tab-stops <n>` | 150 | Most Tab presses per page |
| `--timeout <ms>` | 45000 | Page load timeout |
| `--browser <name>` | auto | `auto`, `chrome` or `chromium` |
| `--proxy <url>` | | Send browser traffic through a proxy |
| `--no-dismiss` | | Leave cookie banners alone instead of clicking Reject |
| `--strict` | | Also fail on best-practice notes |
| `--no-color` | | Plain output. `NO_COLOR` works too |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | No failures |
| 1 | Failures found |
| 2 | The audit could not finish: bad arguments, no browser, or a page would not load |

### Failures and notes

A **failure** is a WCAG 2.2 A or AA problem. A **note** is recognized good practice that isn't a WCAG requirement, such as heading levels that skip, or a text field whose only focus indicator is the text cursor. Notes are printed but only fail the run with `--strict`.

axe-core also returns items it could not judge, usually text over a photo or gradient. focuswalk counts them and lists them in the HTML report for a person to check.

## The HTML report

```sh
focuswalk https://example.org --html report.html
```

One self-contained file, written for the person who owns the site as much as the developer who fixes it. Problems are grouped by kind, with a plain explanation of who each one affects.

![The HTML report: a summary, then each kind of problem with where it happens](docs/report.png)

The report passes its own audit. That is tested on every commit.

## In CI

GitHub Actions, auditing a preview or staging URL:

```yaml
name: Accessibility
on: [pull_request]

jobs:
  focuswalk:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npx focuswalk https://staging.example.org --html focuswalk.html
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: focuswalk-report
          path: focuswalk.html
```

GitHub's Ubuntu runners come with Chrome. On other CI systems, add `npx playwright install --with-deps chromium` before the audit.

To audit the build itself, start your server in the job and point focuswalk at `http://localhost:<port>`.

## Logged-in pages

Save a signed-in session once with Playwright, then hand it to focuswalk:

```sh
npx playwright codegen --save-storage=auth.json https://app.example.org/login
focuswalk https://app.example.org /dashboard /settings --storage-state auth.json
```

`auth.json` holds session cookies. Keep it out of version control.

The same trick gets a timed popup out of the way: dismiss it during `codegen` and the saved state remembers. If a popup does open partway through an audit and takes keyboard focus, focuswalk says so rather than quietly auditing half the page.

## As a library

```js
import { audit, exitCode, renderHtml } from 'focuswalk';

const result = await audit('https://example.org', { max: 10 });
console.log(result.totals); // { pages, failures, advice, needsReview, errors }
process.exitCode = exitCode(result);
```

## How the focus check works

Reading CSS can't tell you whether a focus indicator is visible. A ring can be drawn by a wrapper with `:focus-within`, or by a pseudo-element. And a rule like `:focus { color: #333 }` on dark grey text changes a style and draws nothing you can see.

So focuswalk looks at pixels. At each Tab stop it screenshots the element and a small margin around it, blurs the element, screenshots again, and counts the pixels that differ. If nothing changed, a sighted keyboard user has no way to see where they are. Two details keep it honest:

- A failure is confirmed with a second look 300ms later, after transitions have finished, so a skip link that slides in is measured once it has arrived.
- Custom checkboxes and radios hide the real input, so the label or wrapper is the area compared.

The demo pages under `test/fixtures/site` each plant one problem. Try it:

```sh
git clone https://github.com/MikeSewell/focuswalk.git && cd focuswalk && npm install
node test/serve.mjs &
node bin/focuswalk.mjs http://127.0.0.1:4173 /focus.html /obscured.html /reflow.html
```

## What the law says

focuswalk checks against WCAG 2.2 AA, which includes everything in 2.1 AA.

In the US, WCAG 2.1 AA is the technical standard for state and local government websites under the Department of Justice's [ADA Title II rule](https://www.ada.gov/resources/2024-03-08-web-rule/). For businesses and nonprofits there is no regulation naming a WCAG version; the Department's [web guidance](https://www.ada.gov/resources/web-guidance/) says it "does not have a regulation setting out detailed standards" and names WCAG among the existing standards that "provide helpful guidance".

This is background, not legal advice.

## Contributing

Bug reports and pull requests are welcome, especially false positives: a page where focuswalk reports something a person wouldn't. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Who builds this

focuswalk is built by [Mike Sewell](https://msewell.com) at [Automate Impact](https://automateimpact.org), which builds software for nonprofits. It started as the script that gates our own deploys.

## License

[MIT](LICENSE). axe-core is used unmodified under the [Mozilla Public License 2.0](https://github.com/dequelabs/axe-core/blob/develop/LICENSE).
