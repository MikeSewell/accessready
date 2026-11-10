// What focuswalk does about each WCAG 2.2 level A and AA success criterion.
//   own:    ids of focuswalk's own checks that can report on it
//   guided: the report lists what a person needs to look at ("images", "media", ...)
//   tests:  what the automated part covers, in plain words (axe-core rules are added
//           from axe-core itself, so this never drifts from the installed version)
//   person: what is still left to a person
// A criterion counts as "checked" when at least one check can fail a page on it. That is
// never the whole criterion: the "person" column says what remains.
import { createRequire } from 'node:module';
import { CRITERIA } from './wcag.mjs';

const A = new Set(['1.1.1', '1.2.1', '1.2.2', '1.2.3', '1.3.1', '1.3.2', '1.3.3', '1.4.1', '1.4.2', '2.1.1', '2.1.2', '2.1.4', '2.2.1', '2.2.2', '2.3.1', '2.4.1', '2.4.2', '2.4.3', '2.4.4', '2.5.1', '2.5.2', '2.5.3', '2.5.4', '3.1.1', '3.2.1', '3.2.2', '3.2.6', '3.3.1', '3.3.2', '3.3.7', '4.1.2']);

const NOTES = {
  '1.1.1': { guided: 'images', tests: 'Images, icons and image buttons that have no description at all.', person: 'Whether each description says what the image is for. The report lists every image with its description.' },
  '1.2.1': { guided: 'media', person: 'Audio-only and silent video need a transcript or description. The report lists every audio and video file.' },
  '1.2.2': { guided: 'media', tests: 'Video elements with no caption track.', person: 'Whether captions exist on embedded players (YouTube, Vimeo) and whether they are accurate.' },
  '1.2.3': { guided: 'media', person: 'Whether video has audio description or a text alternative.' },
  '1.2.4': { person: 'Live video needs live captions.' },
  '1.2.5': { guided: 'media', person: 'Whether prerecorded video has audio description.' },
  '1.3.1': { guided: 'headings', tests: 'Broken list, table and ARIA structure.', person: 'Whether headings, lists and tables are marked up as what they look like. The report shows each page\'s heading outline.' },
  '1.3.2': { person: 'Whether the reading order in the code matches the visual order.' },
  '1.3.3': { person: 'Instructions that rely on shape, position or sound ("click the round button on the right").' },
  '1.3.4': { person: 'Whether the page works in both portrait and landscape.' },
  '1.3.5': { guided: 'forms', tests: 'Invalid autocomplete values on form fields.', person: 'Whether fields that collect personal details have autocomplete set at all.' },
  '1.4.1': { tests: 'Links inside text that differ from it by color alone.', person: 'Color used as the only signal elsewhere: error states, charts, required fields.' },
  '1.4.2': { tests: 'Audio that plays by itself for more than three seconds with no way to stop it.', person: 'Audio started by scripts after the page loads.' },
  '1.4.3': { own: ['contrast-on-image'], guided: 'contrast', tests: 'Text contrast on solid backgrounds, and text over images, gradients and video measured from a screenshot.', person: 'Text over an image that passes in some places and fails in others. The report lists each one with its measured range.' },
  '1.4.4': { tests: 'Pages that block pinch-zoom.', person: 'Whether text stays readable and nothing is lost at 200% text size.' },
  '1.4.5': { guided: 'images', person: 'Images that contain text which could have been real text.' },
  '1.4.10': { own: ['reflow'], tests: 'Sideways scrolling at 320px wide, with the widest element named.', person: 'Content that is hidden or overlaps at that width without causing a scrollbar.' },
  '1.4.11': { person: 'Contrast of icons, form field borders and focus indicators against what is next to them.' },
  '1.4.12': { own: ['text-spacing'], tests: 'Text that is cut off once line, letter, word and paragraph spacing are widened to the values WCAG names.', person: 'Text that overlaps other content instead of being cut off.' },
  '1.4.13': { person: 'Tooltips and popovers that appear on hover or focus: can they be dismissed, hovered and do they stay put.' },
  '2.1.1': { own: ['keyboard-unreachable', 'hover-only-menu', 'keyboard-activation'], tests: 'Controls that cannot take keyboard focus, menus that open on hover only, and buttons that answer a click but not Enter or Space.', person: 'Whether every custom widget (sliders, drag and drop, carousels) can be fully operated from the keyboard.' },
  '2.1.2': { own: ['keyboard-trap'], tests: 'An element that Tab and Shift+Tab cannot leave.', person: 'Traps inside widgets the walk did not open, such as a popup with no way out.' },
  '2.1.4': { person: 'Single-key shortcuts that cannot be turned off or remapped.' },
  '2.2.1': { tests: 'Pages that redirect or refresh on a timer.', person: 'Session timeouts and timed steps: can the user extend them.' },
  '2.2.2': { own: ['moving-video'], tests: 'Video that plays by itself with no pause control, and blinking or scrolling text.', person: 'Carousels, animations and auto-updating content.' },
  '2.3.1': { person: 'Content that flashes more than three times a second.' },
  '2.4.1': { tests: 'Pages with no skip link, landmarks or headings to jump past repeated content.', person: 'Whether the skip link goes to the right place.' },
  '2.4.2': { tests: 'Pages with no title. Different pages that share a title are reported as a note.', person: 'Whether each title describes its page.' },
  '2.4.3': { tests: 'Nothing that fails a page. A dialog that opens without taking keyboard focus is reported as a note.', person: 'Whether the Tab order follows the visual order and makes sense.' },
  '2.4.4': { guided: 'links', tests: 'Links with no text at all.', person: 'Whether each link says where it goes. The report lists links such as "click here" and "read more".' },
  '2.4.5': { person: 'Whether there are two ways to find a page: navigation plus search or a site map.' },
  '2.4.6': { guided: 'headings', person: 'Whether headings and labels describe what follows. The report shows each page\'s heading outline.' },
  '2.4.7': { own: ['focus-visible'], tests: 'Every Tab stop is screenshotted focused and unfocused; if nothing on screen changes, it fails.', person: 'Focus indicators inside widgets the walk did not open.' },
  '2.4.11': { own: ['focus-not-obscured'], tests: 'Every Tab stop is checked for being completely covered by something else or off screen.', person: 'Elements that are mostly but not completely covered.' },
  '2.5.1': { person: 'Swipe, pinch and other multi-finger gestures that have no single-tap alternative.' },
  '2.5.2': { person: 'Actions that fire on press instead of release and cannot be cancelled.' },
  '2.5.3': { tests: 'Buttons and links whose accessible name does not contain their visible text.', person: 'Nothing further in most cases.' },
  '2.5.4': { person: 'Features triggered by shaking or tilting the device.' },
  '2.5.7': { person: 'Drag and drop with no click or tap alternative.' },
  '2.5.8': { tests: 'Buttons and links smaller than 24 by 24 pixels with no spacing around them.', person: 'Nothing further in most cases.' },
  '3.1.1': { tests: 'A missing or invalid page language.', person: 'Whether the declared language is the language the page is written in.' },
  '3.1.2': { tests: 'Invalid language codes on parts of a page.', person: 'Passages in another language that are not marked at all.' },
  '3.2.1': { person: 'Anything that changes the page or moves the user just because an element received focus.' },
  '3.2.2': { person: 'Forms that submit or navigate as soon as a value changes.' },
  '3.2.3': { own: ['inconsistent-navigation'], tests: 'The main navigation is compared across every page audited; a page that lists the same links in a different order fails.', person: 'Other repeated blocks, such as footers and sidebars.' },
  '3.2.4': { person: 'The same function labelled differently on different pages.' },
  '3.2.6': { person: 'Help and contact links in the same place on every page.' },
  '3.3.1': { guided: 'forms', person: 'Submit each form with mistakes: are errors described in text and tied to the field. The report lists every form.' },
  '3.3.2': { guided: 'forms', tests: 'Fields with more than one label. A field with no label at all is reported under 4.1.2.', person: 'Whether labels and instructions are clear, including required formats.' },
  '3.3.3': { guided: 'forms', person: 'Whether error messages say how to fix the problem.' },
  '3.3.4': { person: 'Legal, financial and data submissions can be reviewed, corrected or reversed.' },
  '3.3.7': { guided: 'forms', person: 'Multi-step forms that ask for the same information twice.' },
  '3.3.8': { person: 'Logging in without a memory or puzzle test: password managers and paste must work.' },
  '4.1.2': { tests: 'Buttons, links, fields and frames with no name, and invalid ARIA roles and attributes.', person: 'Whether custom widgets announce their state changes to a screen reader.' },
  '4.1.3': { person: 'Status messages ("added to cart", "3 results") announced without moving focus.' },
};

// axe-core's own rule metadata: which A and AA criteria its stable rules can fail a page on.
function axeRulesByCriterion() {
  // Resolved through @axe-core/playwright so it is the same copy the audit runs.
  const require = createRequire(import.meta.url);
  const axe = createRequire(require.resolve('@axe-core/playwright'))('axe-core');
  const map = {};
  for (const rule of axe.getRules()) {
    if (rule.tags.some((t) => t === 'experimental' || t === 'deprecated')) continue;
    if (!rule.tags.some((t) => /^wcag2(1|2)?a{1,2}$/.test(t))) continue;
    for (const tag of rule.tags) {
      const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
      if (m) (map[`${m[1]}.${m[2]}.${m[3]}`] ||= []).push(rule.ruleId);
    }
  }
  return { map, version: axe.version };
}

export function coverage() {
  const { map, version } = axeRulesByCriterion();
  const rows = Object.keys(CRITERIA).map((number) => {
    const note = NOTES[number];
    const axeRules = map[number] || [];
    const own = note.own || [];
    return {
      number, name: CRITERIA[number], level: A.has(number) ? 'A' : 'AA',
      status: axeRules.length || own.length ? 'checked' : note.guided ? 'guided' : 'manual',
      axeRules, own, guided: note.guided || null, tests: note.tests || '', person: note.person,
    };
  });
  const count = (status) => rows.filter((r) => r.status === status).length;
  return { rows, axeVersion: version, counts: { total: rows.length, checked: count('checked'), guided: count('guided'), manual: count('manual') } };
}

export const STATUS_LABEL = { checked: 'Checked', guided: 'Listed for review', manual: 'By hand' };
