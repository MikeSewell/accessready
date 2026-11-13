# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## 0.2.0 - unreleased

Every WCAG 2.2 criterion, A to AAA, now has an automated check or is listed for a person, and every A and AA criterion has at least one automated check. Needs Node 22 or newer.

- All 86 WCAG 2.2 criteria. `--level A|AA|AAA` (AA by default). The coverage table counts checked, flagged for a person, AI review, listed for review and by hand, per level.
- Likely problems: strong evidence of a failure that a person confirms, kept apart from failures. They fail the run only with `--strict`.
- Every page on a phone and a desktop screen (`--viewports`), and Firefox and WebKit as well as Chrome (`--browser firefox,webkit` or `all`). A finding seen on only one of them says so.
- The HTML report reads the findings against ADA Title II, Section 508, EN 301 549 and AODA.
- Media: transcripts, captions on YouTube and Vimeo players, audio description, sign language, live captions, caption controls (Section 508 503.4, EN 301 549 clause 7), audio a script starts by itself.
- Time: the clock moved forward 20 minutes on a copy of the page to find redirects, expiring sessions and timed popups; carousels, tickers and endless animation with no pause; flashing measured from a screen recording (Chromium); motion on scroll and hover under reduced motion.
- Visual: text at 200% zoom, phone orientation, images of text read by OCR, field borders and icon controls under 3:1, enhanced contrast over images, visual presentation at AAA.
- Keyboard and pointer: focus indicator contrast and size, partly hidden focus, focus order, changes of context on focus and on input, single-key shortcuts, tooltips that cannot be dismissed or hovered, swipe-only and drag-only controls, actions on press, motion actuation, 44px targets, tabs, switches and disclosures whose state does not change, arrow keys in tabs and menus, dialogs, skip links that do not work, links that open new windows unannounced.
- Forms, tested on a copy of the page that cannot reach the server: errors not shown, shown by color only, not tied to their field, not announced, or vague; placeholder-only labels; required fields not marked; formats not explained; missing autocomplete; review steps for payments; redundant entry; login fields that block paste or password managers; CAPTCHAs.
- Content: text styled as headings and lists, tables with no headers, reading order, sensory instructions, generic titles, vague and repeated link text, generic headings and labels, missing landmarks, location, section headings, page and passage language, abbreviations, reading level.
- Across the site: consistent identification (3.2.4), consistent help (3.2.6), and more than one way to find pages (2.4.5).
- Documents: each linked PDF is downloaded once and checked for tags, a title, a language, real text and bookmarks.
- Optional AI review (`--ai`) of wording and meaning: image descriptions, images of text, link text, headings, labels, titles, sensory instructions, unusual words and consistent names. Runs through Claude Code, Codex, Gemini CLI or Qwen Code with the account they are logged in to, or an API (Anthropic, OpenAI, Gemini, any OpenAI-compatible server, LM Studio, Ollama). Answers are cached and requests capped.
- Gentle with your server: assets from the audited site are fetched once per audit and reused by every copy of every page, other requests are paced (`--rate`, default 8 a second), a 429 or 503 slows the audit right down, and a site that starts refusing connections is not asked again.
- Per-check timings in the JSON output.
- `accessready.config.json` (or `--config`): defaults for any option, and ignored findings, each with a required reason.
- `--baseline` and `--update-baseline`: fail only on findings that are new since a saved baseline, and list what was fixed.
- `--sarif`: SARIF 2.1.0 output for GitHub code scanning.
- A GitHub Action (`action.yml`) that audits, uploads the HTML report, optionally uploads SARIF, and keeps one summary comment up to date on pull requests.

## 0.1.0 - 2026-11-13

First release. Needs Node 22 or newer.

- Audits every page in a sitemap, a list of paths, or a single page, in Chrome or Playwright's Chromium.
- Runs axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rules, including target size, plus its best-practice rules as notes.
- Walks each page with the Tab key and reports elements with no visible focus indicator (2.4.7) and elements that take focus while hidden (2.4.11).
- Reports keyboard traps (2.1.2), controls that cannot take focus, menus that open on hover only and buttons that ignore Enter and Space (2.1.1).
- Measures contrast of text over images from a screenshot (1.4.3) and reports text cut off when spacing is widened (1.4.12).
- Reports sideways scroll at 320px wide (1.4.10) and video that plays by itself with no pause control (2.2.2).
- Compares pages with each other: navigation order (3.2.3) and shared page titles.
- Console, JSON and HTML reports. The HTML report includes a worklist of everything a person has to check: images with their descriptions, video, forms, vague links, heading outlines.
- `docs/COVERAGE.md`: what is checked, listed for review, or left to a person for each of the 55 WCAG 2.2 A and AA criteria, generated from the code.
- Exit codes for CI: 0 clean, 1 failures, 2 the audit could not finish.
