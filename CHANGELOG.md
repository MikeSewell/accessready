# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0 - unreleased

First release.

- Audits every page in a sitemap, a list of paths, or a single page, in Chrome or Playwright's Chromium.
- Runs axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rules, including target size, plus its best-practice rules as notes.
- Walks each page with the Tab key and reports elements with no visible focus indicator (2.4.7) and elements that take focus while hidden (2.4.11).
- Reports sideways scroll at 320px wide (1.4.10) and video that plays by itself with no pause control (2.2.2).
- Console, JSON and HTML reports.
- Exit codes for CI: 0 clean, 1 failures, 2 the audit could not finish.
