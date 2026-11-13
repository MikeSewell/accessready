# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

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
