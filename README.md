# accessready

> WCAG 2.2 audit for a whole site, levels A to AAA, on a phone and a desktop screen. Runs axe-core, then uses every page the way people with disabilities do, to catch what rule engines miss.

[![npm](https://img.shields.io/npm/v/accessready.svg)](https://www.npmjs.com/package/accessready)
[![CI](https://github.com/MikeSewell/accessready/actions/workflows/ci.yml/badge.svg)](https://github.com/MikeSewell/accessready/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/MikeSewell/accessready/blob/main/LICENSE)

```sh
npx accessready https://example.org
```

![accessready reporting a link with no focus indicator, a hover-only menu, a keyboard trap and text too faint over an image](https://raw.githubusercontent.com/MikeSewell/accessready/main/docs/terminal.png)

It reads the sitemap, audits every page on a phone and a desktop screen, and exits 1 if anything fails, so it can gate a deploy. It also reads the results against ADA Title II, Section 508, EN 301 549 and AODA.

## Why

Most accessibility checkers are built on [axe-core](https://github.com/dequelabs/axe-core). It is very good at what a rules engine can decide from the page's code: contrast, labels, alt text, ARIA. accessready runs it on every page.

But many of the problems that lock people out can't be decided from code. You have to use the page. So after axe-core, accessready does:

| It does this | To catch this | WCAG |
|---|---|---|
| Presses Tab to every element and screenshots it focused and unfocused | A link or button that shows nothing when it has focus | 2.4.7 |
| Checks whether anything of the focused element can be seen | Focus hidden under a sticky header, cookie banner or chat bubble | 2.4.11 |
| Keeps pressing Tab, then Shift+Tab | A field that keyboard focus can't leave | 2.1.2 |
| Looks for controls that can't take focus | A `div` with a click handler that only a mouse can use | 2.1.1 |
| Hovers each menu, then tries the same from the keyboard | A menu that only opens on mouse hover | 2.1.1 |
| Presses Enter and Space on buttons that open something | A button that answers a click but not the keyboard | 2.1.1 |
| Widens line, letter and word spacing | Text that gets cut off when a reader adjusts spacing | 1.4.12 |
| Hides the text and measures the pixels behind it | Text too faint to read over a photo or gradient | 1.4.3 |
| Resizes to 320px wide | A page that scrolls sideways when zoomed | 1.4.10 |
| Finds video with no controls and no pause button | Video that plays by itself and can't be stopped | 2.2.2 |
| Compares the main navigation across every page | A menu in a different order on one page | 3.2.3 |
| Compares header and footer links, search and help across pages | A contact link renamed on one page, or help that moves | 3.2.4, 3.2.6 |
| Looks for search, a site map page or related links besides the menu | A site you can only get around by its menu | 2.4.5 |
| Downloads every linked PDF and reads it | A scanned or untagged PDF, or one with no title or language | 1.1.1, 1.3.1, 2.4.2, 3.1.1 |
| Measures each focus indicator against what was there before | A focus ring too faint or too thin to see | 1.4.11, 2.4.13 |
| Tries each form with mistakes, on a copy that cannot reach your server | Errors shown only in red, or not at all, or that say "invalid" and nothing else | 3.3.1, 3.3.3, 1.4.1 |
| Moves the clock forward 20 minutes on a copy of the page | A session that expires without warning, a popup that interrupts, a carousel that never stops | 2.2.1, 2.2.2, 2.2.4 |
| Records the screen for three seconds and counts flashes | Content that flashes fast enough to trigger seizures | 2.3.1 |
| Zooms to 200% and turns a phone sideways | Text that does not grow or gets cut off, a page locked to one orientation | 1.4.4, 1.3.4 |
| Reads the text inside images | A banner whose words are a picture | 1.4.5 |
| Checks every video and audio player, YouTube and Vimeo included | Video with no captions, no transcript or no audio description | 1.2.1 to 1.2.5 |
| Watches which elements listen for touch, drag and motion | A carousel you can only swipe, a slider you can only drag | 2.5.1, 2.5.7 |
| Opens tooltips, tabs, switches and dialogs, then checks their state | A tab that changes on screen but not for a screen reader, a tooltip Escape cannot close | 4.1.2, 1.4.13 |
| Presses single letter keys with nothing focused | A shortcut that fires when a voice-control user says a word | 2.1.4 |
| Detects the language of the text | Spanish text marked as English | 3.1.1, 3.1.2 |

As of axe-core 4.14, it has no rule for focus visibility, hidden focus, keyboard traps, hover-only menus, reflow or navigation order, and it hands text over images back as "needs review".

### What it covers

<!-- coverage:start -->
| Of the 86 WCAG 2.2 criteria | A | AA | AAA | All |
|---|---|---|---|---|
| Checked | 19 | 14 | 10 | 43 |
| Flagged for a person | 12 | 10 | 17 | 39 |
| AI review | 0 | 0 | 2 | 2 |
| Listed for review | 0 | 0 | 1 | 1 |
| By hand | 0 | 0 | 1 | 1 |
<!-- coverage:end -->

Every A and AA criterion has at least one automated check. Where a check cannot be sure, it reports a likely problem for a person to confirm instead of guessing. `--level AAA` adds the AAA criteria.

Every criterion, what is tested and what is left to a person: [docs/COVERAGE.md](https://github.com/MikeSewell/accessready/blob/main/docs/COVERAGE.md). The table is generated from the code and checked on every commit.

For the part no tool can judge, the HTML report gives you a worklist instead of a warning: every image with its description beside it, every video, every form, every "click here" link, and each page's heading outline.

## Why not

- **A pass is not conformance.** Automated checks find some accessibility problems, not all of them. Deque, who make axe-core, put their own coverage at [57% of issues by volume](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues). When the UK government ran ten tools against a page of planted barriers, [all of them together found 71%](https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/). You still need a person with a keyboard and a screen reader.
- **It is not a legal opinion.** It won't tell you a site is "ADA compliant", and neither will any other tool.
- **It drives Chrome unless told otherwise.** `--browser firefox`, `webkit` or `all` adds Firefox and WebKit, the engine inside Safari, from Playwright's own builds. It does not drive the Safari app itself.
- **It doesn't use your site like a visitor with a goal.** It never lets a form reach your server, logs in or steps through a checkout, so what happens after a real submission is left to a person.
- **It takes time.** Each page is audited twice, on a phone and a desktop screen, and some checks open fresh copies of the page. Use `--viewports desktop` or `--max` for a quicker pass.
- If you only need rule checks on a handful of URLs, [`@axe-core/cli`](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/cli) or [`pa11y-ci`](https://github.com/pa11y/pa11y-ci) are smaller.

## Similar projects

Other open source tools use the page as accessready does, each on part of it: [A11y Pulse audits](https://github.com/A11y-Pulse/audits) (focus, keyboard traps, reflow, text spacing, one page at a time), [Sightline](https://github.com/Ax1zz/sightline) (the WCAG 2.2 criteria axe-core cannot test), [SpecA11y](https://github.com/OKlueck/SpecA11y) (interaction rules on Playwright, with an optional AI pass), [Out of Order](https://github.com/spaansba/out-of-order) (tab order, with an overlay and a test matcher) and the New Zealand government's [CWAC](https://github.com/GOVTNZ/cwac) (scanning many sites). [Unlighthouse](https://github.com/harlan-zw/unlighthouse) runs Lighthouse across a whole site. accessready puts the rule engine, the keyboard walk and the interaction checks in one command over a whole site, writes a report a site owner can read, and publishes what it covers criterion by criterion.

## Install

Needs Node 22 or newer, and Google Chrome. If Chrome isn't installed, accessready uses Playwright's Chromium instead:

```sh
npx playwright install chromium
```

Run it without installing:

```sh
npx accessready https://example.org
```

Or add it to a project:

```sh
npm install --save-dev accessready
```

## Usage

```
accessready <url> [path ...] [options]
```

```sh
accessready https://example.org              # every page in /sitemap.xml
accessready https://example.org / /donate    # only these paths
accessready https://example.org/donate       # only this page
accessready http://localhost:3000            # a local build, before it ships
```

When you point it at localhost, URLs in the sitemap are rewritten onto localhost, so a production sitemap works against a local build.

| Option | Default | What it does |
|---|---|---|
| `--html <file>` | | Write a report a non-developer can read |
| `--json <file>` | | Write the full results as JSON. `-` prints to stdout |
| `--sarif <file>` | | Write SARIF 2.1.0, for GitHub code scanning |
| `--config <file>` | `accessready.config.json` | Options and ignored findings from a file |
| `--baseline <file>` | | Fail only on findings that are not in this saved baseline |
| `--update-baseline` | | Save the current findings to the `--baseline` file |
| `--sitemap <url>` | `<url>/sitemap.xml` | Sitemap to read. Sitemap indexes are followed one level |
| `--max <n>` | 40 | Most pages to audit from a sitemap |
| `--concurrency <n>` | 2 | Pages audited at once |
| `--storage-state <file>` | | Playwright storage state, to audit logged-in pages |
| `--level <A\|AA\|AAA>` | AA | WCAG level to check against |
| `--viewports <list>` | desktop,phone | Screen sizes: `desktop` (1440x900), `phone` (390x844, touch), or `WIDTHxHEIGHT`, comma separated |
| `--viewport <WxH>` | | One screen size only |
| `--max-tab-stops <n>` | 150 | Most Tab presses per page |
| `--timeout <ms>` | 45000 | Page load timeout |
| `--browser <list>` | auto | `auto` (installed Chrome, else Playwright's Chromium), `chrome`, `chromium`, `firefox`, `webkit`, or `all`; comma separated |
| `--rate <n>` | 8 | Most requests a second to the audited site after a short burst; `0` for no limit |
| `--proxy <url>` | | Send browser traffic through a proxy |
| `--no-dismiss` | | Leave cookie banners alone instead of clicking Reject |
| `--strict` | | Also fail on likely problems and best-practice notes |
| `--ai <provider[:model]>` | | Add the AI review; see below |
| `--no-color` | | Plain output. `NO_COLOR` works too |

### Exit codes

| Code | Meaning |
|---|---|
| 0 | No failures. With `--baseline`: no new failures |
| 1 | Failures found. With `--baseline`: new failures found |
| 2 | The audit could not finish: bad arguments or config, no browser, or a page would not load |

### Config file

Put `accessready.config.json` in the folder you run from, or name one with `--config`. It sets defaults for any option, using the option names in camelCase (`storageState`, `maxTabStops`, `dismiss: false`). Options on the command line win. File paths in it are read from the config file's folder.

```json
{
  "url": "http://localhost:3000",
  "paths": ["/", "/donate", "/contact"],
  "viewports": ["desktop", "phone"],
  "level": "AA",
  "ignore": [
    { "rule": "color-contrast", "page": "/blog/*", "selector": ".share-widget", "reason": "Vendor widget; fix requested in ticket 4411" }
  ]
}
```

With `url` set, `npx accessready` on its own runs the audit, and `npx accessready /donate` audits one path of it.

Each `ignore` names a `rule` (the id shown after each finding) and may narrow it to a `page` (`*` matches anything) and a `selector`. A `reason` is required: an ignore without one stops the run with exit code 2. Ignored findings leave the totals and the reports; the console says how many, and the JSON lists each under `ignored` with its reason.

### Baseline

To start using accessready on a site that already has problems, save them once and fail only on new ones:

```sh
accessready https://staging.example.org --baseline accessready-baseline.json --update-baseline
accessready https://staging.example.org --baseline accessready-baseline.json
```

The second run reports how many known findings it skipped, lists the new ones and the ones fixed since the baseline, and exits 1 only for new failures. Findings are matched by rule, page path, element and message with numbers taken out, so a contrast ratio that moves from 4.31:1 to 4.29:1, or a different host, does not count as new. Commit the baseline and refresh it with `--update-baseline` as problems get fixed.

### Failures, likely problems and notes

A **failure** is a WCAG problem the tool is sure of. A **likely problem** is strong evidence of one that a person should confirm, because the criterion has an exception a machine cannot see: a logo is allowed to be an image of text, a timed step can be essential. A **note** is recognized good practice that WCAG doesn't require (heading levels that skip). Failures fail the run; likely problems and notes do only with `--strict`.

A finding seen on only one screen size or browser says so, for example "phone only".

axe-core also returns items it could not judge. Where that is text over an image, accessready measures it: if it fails everywhere it becomes a failure, if it passes everywhere it is dropped, and if it is mixed it goes on the report's worklist with the measured range.

## The HTML report

```sh
accessready https://example.org --html report.html
```

One file, written for the person who owns the site as much as the developer who fixes it. Problems are grouped by kind, with a plain explanation of who each one affects. Below them is the worklist of what to check by hand.

![The HTML report: a summary, then each kind of problem with where it happens](https://raw.githubusercontent.com/MikeSewell/accessready/main/docs/report.png)

![The worklist: each image with its description, vague links, forms and text over images](https://raw.githubusercontent.com/MikeSewell/accessready/main/docs/worklist.png)

The report passes its own audit. That is tested on every commit.

## In CI

### The GitHub Action

```yaml
name: Accessibility
on: [pull_request]

permissions:
  contents: read
  pull-requests: write      # to comment the summary
  # security-events: write  # with upload-sarif: true

jobs:
  accessready:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: MikeSewell/accessready@main   # pin to a release tag or commit
        with:
          url: https://staging.example.org
          paths: / /donate /contact
          # args: --viewports desktop --max 20
          # config: accessready.config.json
          # baseline: accessready-baseline.json
          # upload-sarif: true
```

It installs the accessready of the tag or commit you point at, audits, uploads the HTML report as an artifact, writes the summary to the run page and, on pull requests, posts it as a comment that later runs edit instead of adding new ones. With `upload-sarif: true` the findings also appear in the repository's code scanning alerts. The step fails exactly when the command line would (exit code 1 or 2), and its `exit-code`, `html`, `json` and `sarif` outputs are there for later steps.

To audit the pull request's own build, start the server in an earlier step and use `url: http://localhost:<port>`.

### By hand

GitHub Actions, auditing a preview or staging URL:

```yaml
name: Accessibility
on: [pull_request]

jobs:
  accessready:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v7
        with:
          node-version: 26
      - run: npx accessready https://staging.example.org --html accessready.html
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: accessready-report
          path: accessready.html
```

GitHub's Ubuntu runners come with Chrome. On other CI systems, add `npx playwright install --with-deps chromium` before the audit.

To audit the build itself, start your server in the job and point accessready at `http://localhost:<port>`.

## Logged-in pages

Save a signed-in session once with Playwright, then hand it to accessready:

```sh
npx playwright codegen --save-storage=auth.json https://app.example.org/login
accessready https://app.example.org /dashboard /settings --storage-state auth.json
```

`auth.json` holds session cookies. Keep it out of version control.

The same trick gets a timed popup out of the way: dismiss it during `codegen` and, if the site remembers that in a cookie or local storage, the saved state carries it over. If a popup does open partway through an audit and covers the page, accessready says so and stops walking that page rather than reporting everything behind the popup as hidden.

## AI review

Some of WCAG is about meaning: does an image description say what the image is for, does a link say where it goes, does an instruction rely on color? `--ai` asks a model you choose to judge these, on top of the automated checks.

Use a coding agent you already pay for, with the account it is logged in to and no key to set:

```sh
npx accessready https://example.org --ai claude-code        # Claude Code
npx accessready https://example.org --ai codex              # OpenAI Codex
npx accessready https://example.org --ai gemini-cli         # Gemini CLI, text only
npx accessready https://example.org --ai qwen-code          # Qwen Code, text only
```

Or an API with your own key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `ACCESSREADY_AI_KEY` for any), or a model on your own machine:

```sh
npx accessready https://example.org --ai anthropic:<model>
npx accessready https://example.org --ai openai:<model>
npx accessready https://example.org --ai gemini:<model>
npx accessready https://example.org --ai ollama:<model>     # or lmstudio:<model>
```

Add `:<model>` to a coding agent to pick its model, for example `--ai claude-code:opus`. Its findings are likely problems for a person to confirm, marked as AI judgments with the model's reason; they never fail a run unless `--strict` is set. Before the first request it prints what will be sent and to whom. Each page is one request; answers are kept in `.accessready-cache/ai`, so a rerun on unchanged pages sends nothing, and `--ai-max-requests` (default 50) caps a run.

The coding agents run headless, in an empty temporary folder that is deleted afterwards, with their file and command tools turned off where the CLI allows. Claude Code runs with no tools at all. Codex runs in its read-only sandbox with its shell turned off; a page could still in principle ask it to read a file on your machine, so use another provider on sites you do not trust.

**Privacy:** each page's text, links, headings, form labels and images (scaled down) go to the provider you name, or through the CLI you name to its service. Use a local model for pages whose content must not leave your machine.

## As a library

```js
import { audit, exitCode, renderHtml } from 'accessready';

const result = await audit('https://example.org', { max: 10 });
console.log(result.totals); // { pages, failures, advice, needsReview, errors }
process.exitCode = exitCode(result);
```

## What it does to your pages

accessready only does what a visitor could do. It clicks Reject on a cookie banner, presses Tab, hovers menus, and presses Enter on buttons marked `aria-expanded="false"`, closing each one again. It never presses Enter on a link. If a button navigates away anyway, it stops operating that page and says so.

Some checks work on a fresh copy of the page, thrown away afterwards, so nothing they do touches the copy that is being walked: they move the page's clock forward 20 minutes, resize the window and zoom, turn a phone sideways, press single letter keys and arrow keys, hover tooltips and press Escape, press a mouse button without releasing it, simulate tilting a phone, press Play on a YouTube player to read its captions, change a dropdown, radio button or checkbox (never in a login or payment form, and with every request blocked), and cancel any alert or confirm box the page opens. At level AAA it also scrolls and hovers to look for motion.

An audit opens each page several times: on each screen size, and in fresh copies for checks that change things. To keep that from looking like an attack to a server with a rate limit or fail2ban, stylesheets, scripts, images and fonts from your site are downloaded once per audit and reused, every other request to your site is paced (`--rate`, 8 a second by default), a "429 Too Many Requests" or "503" slows the audit to one request a second, and if your site stops accepting connections partway through, the remaining pages are not tried and the report says why. Requests to other hosts are not paced.

To see how forms handle mistakes, it opens a separate copy of the page that cannot reach your server. While the copy loads, only GET and HEAD requests go out and service workers are off. Once the form test starts, every request, navigation and WebSocket message is stopped inside the browser and only recorded. In that copy it leaves required fields empty, types obvious nonsense such as `not-an-email` into typed fields, presses the submit button and reads what the page shows. It never types anything that looks like real data, tries at most three forms per page, and throws the copy away afterwards. If a form tries to send anyway, the report says so.

## How the focus check works

Reading CSS can't tell you whether a focus indicator is visible. A ring can be drawn by a wrapper with `:focus-within`, or by a pseudo-element. And a rule like `:focus { color: #333 }` on dark grey text changes a style and draws nothing you can see.

So accessready looks at pixels. At each Tab stop it screenshots the element and a small margin around it, blurs the element, screenshots again, and counts the pixels that differ. If nothing changed, a sighted keyboard user has no way to see where they are. Two details keep it honest:

- A failure is confirmed with a second look 300ms later, after transitions have finished, so a skip link that slides in is measured once it has arrived.
- Custom checkboxes and radios hide the real input, so the label or wrapper is the area compared.
- A date field takes several Tab presses to cross. The walk keeps pressing instead of mistaking it for a trap.

The demo pages under `test/fixtures/site` each plant one problem. Try it:

```sh
git clone https://github.com/MikeSewell/accessready.git && cd accessready && npm install
node test/serve.mjs &
node bin/accessready.mjs http://127.0.0.1:4173 /focus.html /menu.html /trap.html /overimage.html
```

## What the law says

accessready checks against WCAG 2.2, AA unless `--level` says otherwise. The HTML report also reads the findings against the standards built on WCAG:

| Standard | What it requires of a website |
|---|---|
| ADA Title II (US state and local government) | WCAG 2.1 AA, for web content and documents such as PDFs |
| Section 508 (US federal) | WCAG 2.0 AA, plus player controls for captions and audio description (503.4) |
| EN 301 549 (EU, the European Accessibility Act) | WCAG 2.1 AA (clause 9), caption and audio description controls (clause 7), documents (clause 10) |
| AODA (Ontario) | WCAG 2.0 AA, except live captions and prerecorded audio description |

In the US, WCAG 2.1 AA is the technical standard for state and local government websites under the Department of Justice's [ADA Title II rule](https://www.ada.gov/resources/2024-03-08-web-rule/). For businesses and nonprofits there is no regulation naming a WCAG version; the Department's [web guidance](https://www.ada.gov/resources/web-guidance/) says it "does not have a regulation setting out detailed standards" and names WCAG among the existing standards that "provide helpful guidance".

This is background, not legal advice.

## Contributing

Bug reports and pull requests are welcome, especially false positives: a page where accessready reports something a person wouldn't. See [CONTRIBUTING.md](https://github.com/MikeSewell/accessready/blob/main/CONTRIBUTING.md).

## Who builds this

accessready is built by [Michael Sewell](https://msewell.com). It started as the accessibility check he runs before every deploy of the apps he builds for nonprofits at [Automate Impact](https://automateimpact.org).

## License

[MIT](https://github.com/MikeSewell/accessready/blob/main/LICENSE). axe-core is used unmodified under the [Mozilla Public License 2.0](https://github.com/dequelabs/axe-core/blob/develop/LICENSE).
