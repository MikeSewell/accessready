// Every WCAG 2.2 success criterion, A, AA and AAA, with the WCAG version that added it, and
// the legal standards that are built on WCAG. 4.1.1 Parsing is not listed: WCAG 2.2 removed
// it, and W3C's errata for 2.0 and 2.1 treat it as always met for HTML.

const c = (name, level, since = '2.0') => ({ name, level, since });

export const CRITERIA = {
  '1.1.1': c('Non-text Content', 'A'),
  '1.2.1': c('Audio-only and Video-only (Prerecorded)', 'A'),
  '1.2.2': c('Captions (Prerecorded)', 'A'),
  '1.2.3': c('Audio Description or Media Alternative (Prerecorded)', 'A'),
  '1.2.4': c('Captions (Live)', 'AA'),
  '1.2.5': c('Audio Description (Prerecorded)', 'AA'),
  '1.2.6': c('Sign Language (Prerecorded)', 'AAA'),
  '1.2.7': c('Extended Audio Description (Prerecorded)', 'AAA'),
  '1.2.8': c('Media Alternative (Prerecorded)', 'AAA'),
  '1.2.9': c('Audio-only (Live)', 'AAA'),
  '1.3.1': c('Info and Relationships', 'A'),
  '1.3.2': c('Meaningful Sequence', 'A'),
  '1.3.3': c('Sensory Characteristics', 'A'),
  '1.3.4': c('Orientation', 'AA', '2.1'),
  '1.3.5': c('Identify Input Purpose', 'AA', '2.1'),
  '1.3.6': c('Identify Purpose', 'AAA', '2.1'),
  '1.4.1': c('Use of Color', 'A'),
  '1.4.2': c('Audio Control', 'A'),
  '1.4.3': c('Contrast (Minimum)', 'AA'),
  '1.4.4': c('Resize Text', 'AA'),
  '1.4.5': c('Images of Text', 'AA'),
  '1.4.6': c('Contrast (Enhanced)', 'AAA'),
  '1.4.7': c('Low or No Background Audio', 'AAA'),
  '1.4.8': c('Visual Presentation', 'AAA'),
  '1.4.9': c('Images of Text (No Exception)', 'AAA'),
  '1.4.10': c('Reflow', 'AA', '2.1'),
  '1.4.11': c('Non-text Contrast', 'AA', '2.1'),
  '1.4.12': c('Text Spacing', 'AA', '2.1'),
  '1.4.13': c('Content on Hover or Focus', 'AA', '2.1'),
  '2.1.1': c('Keyboard', 'A'),
  '2.1.2': c('No Keyboard Trap', 'A'),
  '2.1.3': c('Keyboard (No Exception)', 'AAA'),
  '2.1.4': c('Character Key Shortcuts', 'A', '2.1'),
  '2.2.1': c('Timing Adjustable', 'A'),
  '2.2.2': c('Pause, Stop, Hide', 'A'),
  '2.2.3': c('No Timing', 'AAA'),
  '2.2.4': c('Interruptions', 'AAA'),
  '2.2.5': c('Re-authenticating', 'AAA'),
  '2.2.6': c('Timeouts', 'AAA', '2.1'),
  '2.3.1': c('Three Flashes or Below Threshold', 'A'),
  '2.3.2': c('Three Flashes', 'AAA'),
  '2.3.3': c('Animation from Interactions', 'AAA', '2.1'),
  '2.4.1': c('Bypass Blocks', 'A'),
  '2.4.2': c('Page Titled', 'A'),
  '2.4.3': c('Focus Order', 'A'),
  '2.4.4': c('Link Purpose (In Context)', 'A'),
  '2.4.5': c('Multiple Ways', 'AA'),
  '2.4.6': c('Headings and Labels', 'AA'),
  '2.4.7': c('Focus Visible', 'AA'),
  '2.4.8': c('Location', 'AAA'),
  '2.4.9': c('Link Purpose (Link Only)', 'AAA'),
  '2.4.10': c('Section Headings', 'AAA'),
  '2.4.11': c('Focus Not Obscured (Minimum)', 'AA', '2.2'),
  '2.4.12': c('Focus Not Obscured (Enhanced)', 'AAA', '2.2'),
  '2.4.13': c('Focus Appearance', 'AAA', '2.2'),
  '2.5.1': c('Pointer Gestures', 'A', '2.1'),
  '2.5.2': c('Pointer Cancellation', 'A', '2.1'),
  '2.5.3': c('Label in Name', 'A', '2.1'),
  '2.5.4': c('Motion Actuation', 'A', '2.1'),
  '2.5.5': c('Target Size (Enhanced)', 'AAA', '2.1'),
  '2.5.6': c('Concurrent Input Mechanisms', 'AAA', '2.1'),
  '2.5.7': c('Dragging Movements', 'AA', '2.2'),
  '2.5.8': c('Target Size (Minimum)', 'AA', '2.2'),
  '3.1.1': c('Language of Page', 'A'),
  '3.1.2': c('Language of Parts', 'AA'),
  '3.1.3': c('Unusual Words', 'AAA'),
  '3.1.4': c('Abbreviations', 'AAA'),
  '3.1.5': c('Reading Level', 'AAA'),
  '3.1.6': c('Pronunciation', 'AAA'),
  '3.2.1': c('On Focus', 'A'),
  '3.2.2': c('On Input', 'A'),
  '3.2.3': c('Consistent Navigation', 'AA'),
  '3.2.4': c('Consistent Identification', 'AA'),
  '3.2.5': c('Change on Request', 'AAA'),
  '3.2.6': c('Consistent Help', 'A', '2.2'),
  '3.3.1': c('Error Identification', 'A'),
  '3.3.2': c('Labels or Instructions', 'A'),
  '3.3.3': c('Error Suggestion', 'AA'),
  '3.3.4': c('Error Prevention (Legal, Financial, Data)', 'AA'),
  '3.3.5': c('Help', 'AAA'),
  '3.3.6': c('Error Prevention (All)', 'AAA'),
  '3.3.7': c('Redundant Entry', 'A', '2.2'),
  '3.3.8': c('Accessible Authentication (Minimum)', 'AA', '2.2'),
  '3.3.9': c('Accessible Authentication (Enhanced)', 'AAA', '2.2'),
  '4.1.2': c('Name, Role, Value', 'A'),
  '4.1.3': c('Status Messages', 'AA', '2.1'),
};

export const LEVELS = ['A', 'AA', 'AAA'];
const RANK = { A: 1, AA: 2, AAA: 3 };
const VERSION = { '2.0': 0, '2.1': 1, '2.2': 2 };

// Is this criterion part of a conformance target such as "AA"?
export const inLevel = (number, level) => !!CRITERIA[number] && RANK[CRITERIA[number].level] <= RANK[level];

export const criterionLabel = (wcag) => wcag.length
  ? wcag.map((n) => (CRITERIA[n] ? `${n} ${CRITERIA[n].name}` : n)).join(', ')
  : 'Best practice';

// W3C's Understanding page for a criterion. The slug is the name in lower case, without
// punctuation, words joined by hyphens: "Pause, Stop, Hide" is pause-stop-hide.
export const understandingUrl = (number) => CRITERIA[number]
  ? `https://www.w3.org/WAI/WCAG22/Understanding/${CRITERIA[number].name.toLowerCase().replace(/[(),]/g, '').replace(/\s+/g, '-')}.html`
  : null;

const wcagSet = (version, level, except = []) => Object.keys(CRITERIA).filter((n) =>
  VERSION[CRITERIA[n].since] <= VERSION[version] && RANK[CRITERIA[n].level] <= RANK[level] && !except.includes(n));

// Requirements outside WCAG that some standards add for the web: the player controls for
// captions and audio description, and documents (PDFs) linked from a site.
export const EXTRA = {
  'caption-controls': 'Captions and audio description can be turned on from the player\'s own controls',
  documents: 'Documents linked from the site (PDF) are accessible',
};

// The standards a report can be read against. `wcag` is the set of criteria each one
// includes; `extra` the further requirements above. Where a standard names an older WCAG
// version, criteria added later are not part of it, even though accessready still checks them.
export const STANDARDS = [
  { id: 'wcag22-aa', name: 'WCAG 2.2 AA', wcag: wcagSet('2.2', 'AA'), extra: [], basis: 'W3C Recommendation, 12 December 2024' },
  { id: 'wcag22-aaa', name: 'WCAG 2.2 AAA', wcag: wcagSet('2.2', 'AAA'), extra: [], basis: 'Everything in WCAG 2.2. W3C does not recommend requiring AAA for whole sites.' },
  { id: 'ada-title-ii', name: 'ADA Title II (US state and local government)', wcag: wcagSet('2.1', 'AA'), extra: ['documents'], basis: 'DOJ rule of April 2024: WCAG 2.1 AA for web content and conventional electronic documents' },
  { id: 'section-508', name: 'Section 508 (US federal)', wcag: wcagSet('2.0', 'AA'), extra: ['caption-controls', 'documents'], basis: 'WCAG 2.0 AA (E205.4), caption and audio description controls (503.4)' },
  { id: 'en-301-549', name: 'EN 301 549 (EU, European Accessibility Act)', wcag: wcagSet('2.1', 'AA'), extra: ['caption-controls', 'documents'], basis: 'v3.2.1: clause 9 is WCAG 2.1 AA; clause 7 covers caption and audio description controls; clause 10 covers documents' },
  { id: 'aoda', name: 'AODA (Ontario)', wcag: wcagSet('2.0', 'AA', ['1.2.4', '1.2.5']), extra: [], basis: 'Integrated Accessibility Standards: WCAG 2.0 AA, except live captions and prerecorded audio description' },
];
