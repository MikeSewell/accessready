// How a single-key shortcut is confirmed, with scripted page behaviour instead of a browser,
// so timing cannot make the test pass by luck.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutConfirmed } from '../src/checks/widgets.mjs';

// A trial function that answers from a script, one answer per call, whatever key is pressed.
const scripted = (answers) => { let i = 0; return async () => answers[i++] ?? null; };
// A trial function for a page that really reacts to "s" and nothing else.
const reactsTo = (k) => async (key) => (key === k ? 'moves focus to input "Search"' : null);

test('a key the page really answers is confirmed', async () => {
  assert.equal(await shortcutConfirmed(reactsTo('s'), 's', 'moves focus to input "Search"'), true);
});

test('a popup sliding in on its own timer is not taken for a shortcut', async () => {
  // automateimpact.org: the first press of "j" landed while a newsletter box slid in. The
  // next try changed the page too, then it went quiet. The old order (key, key, no key, no
  // key) accepted this; alternating with no-key tries rejects it.
  assert.equal(await shortcutConfirmed(scripted(['changes the page', 'changes the page', null, null]), 'j', 'changes the page'), false);
  assert.equal(await shortcutConfirmed(scripted(['changes the page', null, null]), 'j', 'changes the page'), false);
});

test('a change that does not repeat with the key, or that also happens without it, is not a shortcut', async () => {
  assert.equal(await shortcutConfirmed(scripted([null, null, null]), 'k', 'changes the page'), false);
  assert.equal(await shortcutConfirmed(scripted([null, 'changes the page', 'changes the page']), 'k', 'changes the page'), false);
});
