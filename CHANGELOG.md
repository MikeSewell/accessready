# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

- Compares pages for consistent identification (3.2.4, flagged for a person) and consistent help (3.2.6), and looks for more than one way to find pages (2.4.5, flagged for a person).
- Downloads each PDF linked from audited pages, once per audit, and reports untagged files (1.3.1), missing titles (2.4.2), missing language (3.1.1), scans with no text (1.1.1, 1.4.5) and long files with no bookmarks.
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
