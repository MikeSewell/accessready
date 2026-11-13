// What accessready does about each WCAG 2.2 success criterion, A to AAA. Built from the
// rules every check module declares and from axe-core's own rule metadata, so it cannot
// drift from the code. What is left to a person is written here, per criterion.
//
// Status of a criterion:
//   checked  at least one check can fail a page on it
//   likely   checks find evidence of a failure, which a person confirms
//   ai       only the optional AI review judges it
//   guided   nothing is judged, but the report lists what a person has to look at
//   manual   no help from the tool
// None of these is the whole criterion. The "person" column says what remains.
import { createRequire } from 'node:module';
import { CRITERIA } from './wcag.mjs';
import { RULES } from './checks/index.mjs';

// What axe-core's rules cover, in plain words, for criteria where it has any.
const AXE = {
  '1.1.1': 'Images, icons and image buttons that have no description at all.',
  '1.2.2': 'Video elements with no caption track.',
  '1.3.1': 'Broken list, table and ARIA structure.',
  '1.3.5': 'Invalid autocomplete values on form fields.',
  '1.4.1': 'Links inside text that differ from it by color alone.',
  '1.4.2': 'Audio that plays by itself for more than three seconds with no way to stop it.',
  '1.4.3': 'Text contrast on solid backgrounds.',
  '1.4.4': 'Pages that block pinch-zoom.',
  '1.4.6': 'Text contrast on solid backgrounds at the enhanced ratio.',
  '1.4.12': 'Inline styles that force spacing.',
  '2.1.1': 'Scrollable regions and frames that the keyboard cannot reach.',
  '2.1.3': 'Scrollable regions that the keyboard cannot reach.',
  '2.2.1': 'Pages that redirect or refresh on a timer.',
  '2.2.2': 'Blinking and scrolling text.',
  '2.2.4': 'Pages that refresh or redirect by themselves.',
  '2.4.1': 'Pages with no skip link, landmarks or headings to jump past repeated content.',
  '2.4.2': 'Pages with no title.',
  '2.4.4': 'Links with no text at all.',
  '2.4.9': 'Links with the same text that go to different places.',
  '2.5.3': 'Buttons and links whose accessible name does not contain their visible text.',
  '2.5.8': 'Buttons and links smaller than 24 by 24 pixels with no spacing around them.',
  '3.1.1': 'A missing or invalid page language.',
  '3.1.2': 'Invalid language codes on parts of a page.',
  '3.2.5': 'Pages that refresh or redirect by themselves.',
  '3.3.2': 'Fields with more than one label.',
  '4.1.2': 'Buttons, links, fields and frames with no name, and invalid ARIA roles and attributes.',
};

// Which part of the HTML report's worklist covers a criterion.
const GUIDED = {
  '1.1.1': 'images', '1.2.1': 'media', '1.2.2': 'media', '1.2.3': 'media', '1.2.5': 'media', '1.2.6': 'media', '1.2.7': 'media', '1.2.8': 'media', '1.4.7': 'media',
  '1.3.1': 'headings', '2.4.6': 'headings', '2.4.10': 'headings', '1.4.3': 'contrast', '1.4.5': 'images', '1.4.9': 'images',
  '2.4.4': 'links', '2.4.9': 'links', '1.3.5': 'forms', '3.3.1': 'forms', '3.3.2': 'forms', '3.3.3': 'forms', '3.3.4': 'forms', '3.3.6': 'forms', '3.3.7': 'forms',
};

// What a person still has to check after every automated check has run.
const PERSON = {
  '1.1.1': 'Whether each description says what the image is for. The report lists every image with its description.',
  '1.2.1': 'Whether a flagged player really lacks an alternative (one labelled in other words or kept on another page), and whether it matches what is heard or seen.',
  '1.2.2': 'Whether captions are accurate and complete, and captions on players other than YouTube and Vimeo.',
  '1.2.3': 'Whether a flagged video needs description at all (everything shown may already be said), and whether the description covers what is not said.',
  '1.2.4': 'Live streams with captions provided another way (open captions, a CART window), and whether live captions keep up.',
  '1.2.5': 'Whether a flagged video needs description at all (everything shown may already be said), and whether the description covers what is not said.',
  '1.2.6': 'Whether the sign language version is complete and well interpreted.',
  '1.2.7': 'Whether pauses for extended description are long enough.',
  '1.2.8': 'Whether the text alternative tells the whole story of the video.',
  '1.2.9': 'Whether the live text alternative keeps up with the audio.',
  '1.3.1': 'Flagged headings, lists and tables: is each what it looks like; grouping the tool cannot see, such as related fields without a fieldset; whether the tags in linked PDFs match how the document looks.',
  '1.3.2': 'Whether the reading order makes sense in places the tool flags.',
  '1.3.3': 'Instructions the tool flags: is there also a text label to go by.',
  '1.3.4': 'Whether anything that does need one orientation (a piano app, a check deposit) is essential.',
  '1.3.5': 'Whether each flagged field really collects the user\'s own details.',
  '1.3.6': 'Whether icons and regions are identified in a way assistive tools can adapt.',
  '1.4.1': 'Color used as the only signal in charts and diagrams.',
  '1.4.2': 'Sound the tool could not tie to a player, Web Audio, and sound that starts after an interaction.',
  '1.4.3': 'Text over an image that passes in some places and fails in others. The report lists each one with its measured range.',
  '1.4.4': 'Whether flagged text is really cut off or covered at 200%, and text-only zoom settings.',
  '1.4.5': 'Whether flagged images of text are logos or essential, and scanned PDFs whose text is given in a tagged figure\'s description.',
  '1.4.6': 'Text over images at the enhanced ratio, where the measurement is mixed.',
  '1.4.7': 'Whether speech in audio stands out from background sound by 20 decibels.',
  '1.4.8': 'Whether users can choose foreground and background colors, and whether a site or browser setting provides the flagged text settings.',
  '1.4.9': 'Whether flagged images of text are logos or pure decoration.',
  '1.4.10': 'Content that is hidden or overlaps at 320px wide without causing a scrollbar.',
  '1.4.11': 'Graphs, diagrams and image icons, checkbox and radio states, and fields or icons over images and gradients.',
  '1.4.12': 'Text that overlaps other content instead of being cut off.',
  '1.4.13': 'Hover and focus popups not marked up as tooltips or descriptions, such as CSS-only hover cards.',
  '2.1.1': 'Whether every custom widget (sliders, drag and drop, carousels) can be fully operated from the keyboard.',
  '2.1.2': 'Traps inside widgets the walk did not open.',
  '2.1.3': 'Whether flagged pointer-only features have a keyboard way, and any other function that needs a mouse or touch.',
  '2.1.4': 'Whether flagged shortcuts can be turned off or remapped.',
  '2.2.1': 'Time limits after logging in or longer than 20 minutes, and whether a warning gives 20 seconds and a way to extend.',
  '2.2.2': 'Motion started by scrolling or clicking, video and canvas animation, and whether flagged motion is essential.',
  '2.2.3': 'Whether timed steps are part of a real-time event.',
  '2.2.4': 'Interruptions that arrive after logging in.',
  '2.2.5': 'Whether data entered is kept when a session runs out and the user logs in again.',
  '2.2.6': 'Whether users are told how long data is kept when inactivity can lose it.',
  '2.3.1': 'Flashing below the first screen, after the first three seconds, in video that was not playing, or in browsers other than Chromium.',
  '2.3.2': 'Flashing below the first screen, after the first three seconds, in video that was not playing, or in browsers other than Chromium.',
  '2.3.3': 'Motion triggered by interactions the tool did not perform.',
  '2.4.1': 'Whether the skip link\'s target is the main content.',
  '2.4.2': 'Whether each title describes its page or PDF.',
  '2.4.3': 'Order problems smaller than a jump up or down the page, and focus after dialogs the tool did not open.',
  '2.4.4': 'Whether flagged links truly lack context, and whether specific-looking link text is accurate. The report lists links such as "click here" and "read more".',
  '2.4.5': 'Whether each page really can be reached two ways (the check pools what the site offers), and whether flagged pages are steps in a process, which are exempt.',
  '2.4.6': 'Whether headings and labels describe what follows. The report shows each page\'s heading outline.',
  '2.4.7': 'Focus indicators inside widgets the walk did not open.',
  '2.4.8': 'Whether the user can tell where they are in sites without breadcrumbs or a marked current page.',
  '2.4.9': 'Whether each link makes sense read on its own.',
  '2.4.10': 'Whether long sections are organized by headings.',
  '2.4.11': 'Elements that are mostly but not completely covered.',
  '2.4.12': 'Covering smaller than the gaps between the nine sampled points, and widgets the walk did not open.',
  '2.4.13': 'The browser default ring, hidden inputs, wrapped links, rings more than 8px outside the element, and widgets the walk did not open.',
  '2.5.1': 'Whether flagged gestures have a single-tap alternative.',
  '2.5.2': 'Whether actions that fire on press can be aborted or undone.',
  '2.5.3': 'Nothing further in most cases.',
  '2.5.4': 'Whether flagged motion features have a button alternative and can be turned off.',
  '2.5.5': 'Whether a flagged target is essential at its size, or has an equivalent the tool could not match by address or name.',
  '2.5.6': 'Whether the site works with a mouse and a touch screen on the same device.',
  '2.5.7': 'Whether flagged drag features have a click or tap alternative.',
  '2.5.8': 'Nothing further in most cases.',
  '3.1.1': 'Whether the declared language is right where detection is unsure.',
  '3.1.2': 'Passages in another language too short for detection.',
  '3.1.3': 'Whether flagged words are defined somewhere the user can find.',
  '3.1.4': 'Whether flagged abbreviations are expanded somewhere the user can find.',
  '3.1.5': 'Whether a simpler version or summary is available for text above the reading level.',
  '3.1.6': 'Words whose meaning depends on how they are pronounced.',
  '3.2.1': 'Changes of context on focus in widgets the walk did not open.',
  '3.2.2': 'Whether the page warns beforehand about a flagged change, and changes from typing in a field.',
  '3.2.3': 'Other repeated blocks, such as footers and sidebars.',
  '3.2.4': 'Controls outside the header, footer, navigation and search, and whether flagged differences are really the same function.',
  '3.2.5': 'Whether flagged links are announced in a way the tool cannot read, and changes of context other than new windows.',
  '3.2.6': 'Help the tool does not recognize (other wording, unnamed widgets) and help inside the main content.',
  '3.3.1': 'Errors only the server reports (the tool never lets a form send), and forms beyond the first three on a page.',
  '3.3.2': 'Whether labels and instructions are clear, including required formats.',
  '3.3.3': 'Messages for empty and server-checked fields; only typed fields with an obvious format are tested.',
  '3.3.4': 'Whether forms that do check their fields also allow review, correction or reversal, and checkout steps after the first.',
  '3.3.5': 'Whether help is useful where it exists.',
  '3.3.6': 'Whether forms that do check their fields also allow review, correction or reversal, and checkout steps after the first.',
  '3.3.7': 'Multi-step processes that ask for the same information on a later step.',
  '3.3.8': 'Which kind of CAPTCHA a flagged login shows, whether another way in exists, and steps behind the first screen such as two-factor.',
  '3.3.9': 'Whether a flagged CAPTCHA has an alternative, and login steps behind the first screen.',
  '4.1.2': 'Widgets other than disclosures, switches, checkboxes and tabs (sliders, comboboxes, trees), and whether state changes are announced by a screen reader.',
  '4.1.3': 'Status messages from actions the tool did not perform (cart, save); it sees form errors, toggles and empty message boxes.',
};

// axe-core's own rule metadata: which criteria its stable rules can fail a page on.
function axeRulesByCriterion() {
  // Resolved through @axe-core/playwright so it is the same copy the audit runs.
  const require = createRequire(import.meta.url);
  const axe = createRequire(require.resolve('@axe-core/playwright'))('axe-core');
  const map = {};
  for (const rule of axe.getRules()) {
    if (rule.tags.some((t) => t === 'experimental' || t === 'deprecated')) continue;
    if (!rule.tags.some((t) => /^wcag2(1|2)?a{1,3}$/.test(t))) continue;
    for (const tag of rule.tags) {
      const m = /^wcag(\d)(\d)(\d+)$/.exec(tag);
      if (m) (map[`${m[1]}.${m[2]}.${m[3]}`] ||= []).push(rule.ruleId);
    }
  }
  return { map, version: axe.version };
}

export function coverage() {
  const { map, version } = axeRulesByCriterion();
  const rows = Object.entries(CRITERIA).map(([number, { name, level }]) => {
    const axeRules = map[number] || [];
    const own = Object.entries(RULES).filter(([, r]) => r.criteria.includes(number));
    const aiRules = own.filter(([, r]) => r.source === 'ai');
    const machine = own.filter(([, r]) => r.source !== 'ai');
    const machineKinds = new Set(machine.flatMap(([, r]) => r.kinds));
    const status = axeRules.length || machineKinds.has('failure') ? 'checked'
      : machineKinds.has('likely') ? 'likely'
      : aiRules.length ? 'ai'
      : GUIDED[number] ? 'guided' : 'manual';
    const tests = [AXE[number] && axeRules.length ? AXE[number] : '', ...machine.map(([, r]) => r.covers)].filter(Boolean).join(' ');
    return {
      number, name, level, status, axeRules,
      own: machine.map(([id]) => id), ai: own.filter(([, r]) => r.source === 'ai').map(([id]) => id),
      guided: GUIDED[number] || null, tests, person: PERSON[number],
    };
  });
  const count = (status, level) => rows.filter((r) => r.status === status && (!level || r.level === level)).length;
  const counts = { total: rows.length };
  for (const s of Object.keys(STATUS_LABEL)) counts[s] = count(s);
  return { rows, axeVersion: version, counts, countAt: count };
}

export const STATUS_LABEL = { checked: 'Checked', likely: 'Flagged for a person', ai: 'AI review', guided: 'Listed for review', manual: 'By hand' };
