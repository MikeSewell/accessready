# WCAG 2.2 coverage

What accessready does about each of the 55 level A and AA success criteria in WCAG 2.2. Generated from `src/coverage.mjs` and axe-core 4.14.0; do not edit by hand.

| | Criteria | What it means |
|---|---|---|
| **Checked** | 26 | At least one automated check can fail a page on this. It never covers the whole criterion; the last column says what is left. |
| **Listed for review** | 8 | Nothing is judged automatically, but the HTML report lists exactly what a person has to look at. |
| **By hand** | 21 | No tool support. A person has to test it. |

No automated tool can establish that a site conforms to WCAG. This table is here so you can see what a clean run does and does not tell you.

| Criterion | Level | Status | What is tested automatically | What a person still checks |
|---|---|---|---|---|
| 1.1.1 Non-text Content | A | Checked | Images, icons and image buttons that have no description at all. axe-core: `aria-meter-name`, `aria-progressbar-name`, `image-alt`, `input-image-alt`, `object-alt`, `role-img-alt`, `svg-img-alt`. | Whether each description says what the image is for. The report lists every image with its description. |
| 1.2.1 Audio-only and Video-only (Prerecorded) | A | Listed for review | Nothing. | Audio-only and silent video need a transcript or description. The report lists every audio and video file. |
| 1.2.2 Captions (Prerecorded) | A | Checked | Video elements with no caption track. axe-core: `video-caption`. | Whether captions exist on embedded players (YouTube, Vimeo) and whether they are accurate. |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | A | Listed for review | Nothing. | Whether video has audio description or a text alternative. |
| 1.2.4 Captions (Live) | AA | By hand | Nothing. | Live video needs live captions. |
| 1.2.5 Audio Description (Prerecorded) | AA | Listed for review | Nothing. | Whether prerecorded video has audio description. |
| 1.3.1 Info and Relationships | A | Checked | Broken list, table and ARIA structure. axe-core: `aria-hidden-body`, `aria-required-children`, `aria-required-parent`, `definition-list`, `dlitem`, `list`, `listitem`, `td-headers-attr`, `th-has-data-cells`. | Whether headings, lists and tables are marked up as what they look like. The report shows each page's heading outline. |
| 1.3.2 Meaningful Sequence | A | By hand | Nothing. | Whether the reading order in the code matches the visual order. |
| 1.3.3 Sensory Characteristics | A | By hand | Nothing. | Instructions that rely on shape, position or sound ("click the round button on the right"). |
| 1.3.4 Orientation | AA | By hand | Nothing. | Whether the page works in both portrait and landscape. |
| 1.3.5 Identify Input Purpose | AA | Checked | Invalid autocomplete values on form fields. axe-core: `autocomplete-valid`. | Whether fields that collect personal details have autocomplete set at all. |
| 1.4.1 Use of Color | A | Checked | Links inside text that differ from it by color alone. axe-core: `link-in-text-block`. | Color used as the only signal elsewhere: error states, charts, required fields. |
| 1.4.2 Audio Control | A | Checked | Audio that plays by itself for more than three seconds with no way to stop it. axe-core: `no-autoplay-audio`. | Audio started by scripts after the page loads. |
| 1.4.3 Contrast (Minimum) | AA | Checked | Text contrast on solid backgrounds, and text over images, gradients and video measured from a screenshot. axe-core: `color-contrast`. accessready: `contrast-on-image`. | Text over an image that passes in some places and fails in others. The report lists each one with its measured range. |
| 1.4.4 Resize Text | AA | Checked | Pages that block pinch-zoom. axe-core: `meta-viewport`. | Whether text stays readable and nothing is lost at 200% text size. |
| 1.4.5 Images of Text | AA | Listed for review | Nothing. | Images that contain text which could have been real text. |
| 1.4.10 Reflow | AA | Checked | Sideways scrolling at 320px wide, with the widest element named. accessready: `reflow`. | Content that is hidden or overlaps at that width without causing a scrollbar. |
| 1.4.11 Non-text Contrast | AA | By hand | Nothing. | Contrast of icons, form field borders and focus indicators against what is next to them. |
| 1.4.12 Text Spacing | AA | Checked | Text that is cut off once line, letter, word and paragraph spacing are widened to the values WCAG names. axe-core: `avoid-inline-spacing`. accessready: `text-spacing`. | Text that overlaps other content instead of being cut off. |
| 1.4.13 Content on Hover or Focus | AA | By hand | Nothing. | Tooltips and popovers that appear on hover or focus: can they be dismissed, hovered and do they stay put. |
| 2.1.1 Keyboard | A | Checked | Controls that cannot take keyboard focus, menus that open on hover only, and buttons that answer a click but not Enter or Space. axe-core: `frame-focusable-content`, `scrollable-region-focusable`, `server-side-image-map`. accessready: `keyboard-unreachable`, `hover-only-menu`, `keyboard-activation`. | Whether every custom widget (sliders, drag and drop, carousels) can be fully operated from the keyboard. |
| 2.1.2 No Keyboard Trap | A | Checked | An element that Tab and Shift+Tab cannot leave. accessready: `keyboard-trap`. | Traps inside widgets the walk did not open, such as a popup with no way out. |
| 2.1.4 Character Key Shortcuts | A | By hand | Nothing. | Single-key shortcuts that cannot be turned off or remapped. |
| 2.2.1 Timing Adjustable | A | Checked | Pages that redirect or refresh on a timer. axe-core: `meta-refresh`. | Session timeouts and timed steps: can the user extend them. |
| 2.2.2 Pause, Stop, Hide | A | Checked | Video that plays by itself with no pause control, and blinking or scrolling text. axe-core: `blink`, `marquee`. accessready: `moving-video`. | Carousels, animations and auto-updating content. |
| 2.3.1 Three Flashes or Below Threshold | A | By hand | Nothing. | Content that flashes more than three times a second. |
| 2.4.1 Bypass Blocks | A | Checked | Pages with no skip link, landmarks or headings to jump past repeated content. axe-core: `bypass`. | Whether the skip link goes to the right place. |
| 2.4.2 Page Titled | A | Checked | Pages with no title. Different pages that share a title are reported as a note. axe-core: `document-title`. | Whether each title describes its page. |
| 2.4.3 Focus Order | A | By hand | Nothing that fails a page. A dialog that opens without taking keyboard focus is reported as a note. | Whether the Tab order follows the visual order and makes sense. |
| 2.4.4 Link Purpose (In Context) | A | Checked | Links with no text at all. axe-core: `area-alt`, `link-name`. | Whether each link says where it goes. The report lists links such as "click here" and "read more". |
| 2.4.5 Multiple Ways | AA | By hand | Nothing. | Whether there are two ways to find a page: navigation plus search or a site map. |
| 2.4.6 Headings and Labels | AA | Listed for review | Nothing. | Whether headings and labels describe what follows. The report shows each page's heading outline. |
| 2.4.7 Focus Visible | AA | Checked | Every Tab stop is screenshotted focused and unfocused; if nothing on screen changes, it fails. accessready: `focus-visible`. | Focus indicators inside widgets the walk did not open. |
| 2.4.11 Focus Not Obscured (Minimum) | AA | Checked | Every Tab stop is checked for being completely covered by something else or off screen. accessready: `focus-not-obscured`. | Elements that are mostly but not completely covered. |
| 2.5.1 Pointer Gestures | A | By hand | Nothing. | Swipe, pinch and other multi-finger gestures that have no single-tap alternative. |
| 2.5.2 Pointer Cancellation | A | By hand | Nothing. | Actions that fire on press instead of release and cannot be cancelled. |
| 2.5.3 Label in Name | A | Checked | Buttons and links whose accessible name does not contain their visible text. axe-core: `label-content-name-mismatch`. | Nothing further in most cases. |
| 2.5.4 Motion Actuation | A | By hand | Nothing. | Features triggered by shaking or tilting the device. |
| 2.5.7 Dragging Movements | AA | By hand | Nothing. | Drag and drop with no click or tap alternative. |
| 2.5.8 Target Size (Minimum) | AA | Checked | Buttons and links smaller than 24 by 24 pixels with no spacing around them. axe-core: `target-size`. | Nothing further in most cases. |
| 3.1.1 Language of Page | A | Checked | A missing or invalid page language. axe-core: `html-has-lang`, `html-lang-valid`, `html-xml-lang-mismatch`. | Whether the declared language is the language the page is written in. |
| 3.1.2 Language of Parts | AA | Checked | Invalid language codes on parts of a page. axe-core: `valid-lang`. | Passages in another language that are not marked at all. |
| 3.2.1 On Focus | A | By hand | Nothing. | Anything that changes the page or moves the user just because an element received focus. |
| 3.2.2 On Input | A | By hand | Nothing. | Forms that submit or navigate as soon as a value changes. |
| 3.2.3 Consistent Navigation | AA | Checked | The main navigation is compared across every page audited; a page that lists the same links in a different order fails. accessready: `inconsistent-navigation`. | Other repeated blocks, such as footers and sidebars. |
| 3.2.4 Consistent Identification | AA | By hand | Nothing. | The same function labelled differently on different pages. |
| 3.2.6 Consistent Help | A | By hand | Nothing. | Help and contact links in the same place on every page. |
| 3.3.1 Error Identification | A | Listed for review | Nothing. | Submit each form with mistakes: are errors described in text and tied to the field. The report lists every form. |
| 3.3.2 Labels or Instructions | A | Checked | Fields with more than one label. A field with no label at all is reported under 4.1.2. axe-core: `form-field-multiple-labels`. | Whether labels and instructions are clear, including required formats. |
| 3.3.3 Error Suggestion | AA | Listed for review | Nothing. | Whether error messages say how to fix the problem. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | By hand | Nothing. | Legal, financial and data submissions can be reviewed, corrected or reversed. |
| 3.3.7 Redundant Entry | A | Listed for review | Nothing. | Multi-step forms that ask for the same information twice. |
| 3.3.8 Accessible Authentication (Minimum) | AA | By hand | Nothing. | Logging in without a memory or puzzle test: password managers and paste must work. |
| 4.1.2 Name, Role, Value | A | Checked | Buttons, links, fields and frames with no name, and invalid ARIA roles and attributes. axe-core: `area-alt`, `aria-allowed-attr`, `aria-braille-equivalent`, `aria-command-name`, `aria-conditional-attr`, `aria-deprecated-role`, `aria-hidden-body`, `aria-hidden-focus`, `aria-input-field-name`, `aria-prohibited-attr`, `aria-required-attr`, `aria-roles`, `aria-tab-name`, `aria-toggle-field-name`, `aria-tooltip-name`, `aria-valid-attr-value`, `aria-valid-attr`, `button-name`, `duplicate-id-aria`, `frame-title-unique`, `frame-title`, `input-button-name`, `input-image-alt`, `label`, `link-name`, `nested-interactive`, `select-name`, `summary-name`. | Whether custom widgets announce their state changes to a screen reader. |
| 4.1.3 Status Messages | AA | By hand | Nothing. | Status messages ("added to cart", "3 results") announced without moving focus. |
