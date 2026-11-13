// Audio and video. Each media-* page plants one problem; media-clean has every alternative
// in place. Only the findings of the media rules are compared, so a page can also trip an
// unrelated rule (axe-core's own caption rule, say) without this file caring.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { audit } from '../src/index.mjs';
import { rules, embedCaptionIssues, probes } from '../src/checks/media.mjs';
import { startSite } from './helpers.mjs';

const MINE = new Set(Object.keys(rules));
const found = (page) => page.issues.filter((i) => MINE.has(i.id)).map((i) => [i.kind, i.id, i.selector]);

const AA = ['media-audio', 'media-video-only', 'media-no-description', 'media-transcript-only', 'media-caption-controls', 'media-live', 'media-live-audio', 'media-autoplay', 'media-aaa', 'media-clean'];
const AAA = ['media-aaa', 'media-live-audio', 'media-no-description', 'media-clean'];
let site, aa, aaa;
const page = (result, list, name) => result.pages[list.indexOf(name)];

before(async () => {
  site = await startSite();
  [aa, aaa] = await Promise.all([
    audit(site.origin, { viewports: ['desktop'], paths: AA.map((p) => `/${p}.html`), concurrency: 3 }),
    audit(site.origin, { viewports: ['desktop'], level: 'AAA', paths: AAA.map((p) => `/${p}.html`), concurrency: 2 }),
  ]);
});
after(() => site.close());

test('audio with no transcript nearby is a likely problem', () => {
  assert.deepEqual(found(page(aa, AA, 'media-audio')), [['likely', 'audio-no-transcript', '#episode']]);
});

test('video with no sound track and no description is a likely problem', () => {
  assert.deepEqual(found(page(aa, AA, 'media-video-only')), [['likely', 'video-only-no-alternative', '#silent']]);
});

test('video with sound and no description or transcript is flagged for 1.2.3 and 1.2.5', () => {
  const [i] = page(aa, AA, 'media-no-description').issues.filter((x) => MINE.has(x.id));
  assert.deepEqual(found(page(aa, AA, 'media-no-description')), [['likely', 'video-no-audio-description', '#year']]);
  assert.deepEqual(i.wcag, ['1.2.3', '1.2.5', '1.2.7']);
});

test('a transcript answers 1.2.3 but not the audio description of 1.2.5', () => {
  const p = page(aa, AA, 'media-transcript-only');
  assert.deepEqual(found(p), [['likely', 'video-transcript-no-audio-description', '#year']]);
  assert.deepEqual(p.issues.find((i) => MINE.has(i.id)).wcag, ['1.2.5', '1.2.7']);
});

test('captions with no control to turn them on fail the caption-controls requirement', () => {
  const p = page(aa, AA, 'media-caption-controls');
  assert.deepEqual(found(p), [['failure', 'captions-no-control', '#custom']]);
  const i = p.issues.find((x) => x.id === 'captions-no-control');
  assert.deepEqual([i.wcag, i.extra], [[], ['caption-controls']]);
});

test('a live stream with no captions is flagged for 1.2.4', () => {
  assert.deepEqual(found(page(aa, AA, 'media-live')), [['likely', 'live-no-captions', '#live']]);
});

test('live audio is a level AAA question: quiet at AA, flagged at AAA', () => {
  assert.deepEqual(found(page(aa, AA, 'media-live-audio')), []);
  assert.deepEqual(found(page(aaa, AAA, 'media-live-audio')), [['likely', 'live-audio-no-alternative', '#radio']]);
});

test('sound a script starts before anyone uses the page is flagged, naming the player', () => {
  const p = page(aa, AA, 'media-autoplay');
  assert.deepEqual(found(p), [['likely', 'script-autoplay-audio', '#welcome']]);
  assert.match(p.issues.find((i) => i.id === 'script-autoplay-audio').message, /\(5 seconds long\).*The audit browser blocked it/);
});

test('at AAA a video with captions, description and a transcript still needs sign language', () => {
  assert.deepEqual(found(page(aa, AA, 'media-aaa')), []);
  assert.deepEqual(found(page(aaa, AAA, 'media-aaa')), [['likely', 'video-no-sign-language', '#year']]);
});

test('at AAA a bare video is also missing sign language and a full text alternative', () => {
  assert.deepEqual(found(page(aaa, AAA, 'media-no-description')), [
    ['likely', 'video-no-audio-description', '#year'],
    ['likely', 'video-no-sign-language', '#year'],
    ['likely', 'video-no-media-alternative', '#year'],
  ]);
});

test('media with every alternative in place reports nothing, at AA and AAA', () => {
  assert.deepEqual(found(page(aa, AA, 'media-clean')), []);
  assert.deepEqual(found(page(aaa, AAA, 'media-clean')), []);
  assert.ok(aa.pages.every((p) => !p.notes.some((n) => /could not finish/.test(n))), 'no media check crashed');
});

// YouTube and Vimeo players cannot load offline, so what they report is fed in directly.
// How each one reports its tracks was checked by hand against live embeds.
test('embedded players: no captions fails, automatic captions only is likely, controls=0 hides them', () => {
  const at = { selector: 'iframe', html: '<iframe>' };
  const ids = (list) => list.map((i) => [i.kind, i.id]);
  assert.deepEqual(ids(embedCaptionIssues({ provider: 'youtube', tracks: [], live: false, ...at })), [['failure', 'embed-no-captions']]);
  assert.deepEqual(ids(embedCaptionIssues({ provider: 'youtube', tracks: [{ auto: true }], live: false, ...at })), [['likely', 'embed-no-captions']]);
  assert.deepEqual(ids(embedCaptionIssues({ provider: 'vimeo', tracks: [{ auto: false }, { auto: true }], live: false, ...at })), []);
  assert.deepEqual(ids(embedCaptionIssues({ provider: 'vimeo', tracks: [{ auto: false }], live: false, controlsOff: true, ...at })), [['failure', 'captions-no-control']]);
  assert.deepEqual(ids(embedCaptionIssues({ provider: 'youtube', tracks: [], live: true, ...at })), [['likely', 'live-no-captions']]);
  assert.deepEqual(ids(embedCaptionIssues({ provider: 'youtube', tracks: [{ auto: true }], live: true, ...at })), []);
});

// A stand-in for YouTube's embed page: a Play button and a #movie_player whose player
// response is the one given. Routed in place of youtube.com, so nothing leaves the machine.
const fakePlayer = (response) => `<!doctype html><html lang="en"><head><title>Player</title></head><body>
<div id="movie_player"></div><button aria-label="Play (k)">Play</button>
<script>document.getElementById('movie_player').getPlayerResponse = () => (${JSON.stringify(response)});</script></body></html>`;
const PLAYERS = {
  // What YouTube answers an automated browser on a data centre address: video details, no
  // captions, and a playability status other than OK.
  'bot-check': { videoDetails: { videoId: 'bot-check', isLive: false }, playabilityStatus: { status: 'LOGIN_REQUIRED', reason: "Sign in to confirm you're not a bot" } },
  'no-captions': { videoDetails: { videoId: 'no-captions', isLive: false }, playabilityStatus: { status: 'OK' } },
  captioned: { videoDetails: { videoId: 'captioned', isLive: false }, playabilityStatus: { status: 'OK' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ kind: '', languageCode: 'en' }] } } },
};

test('a YouTube player that will not play the video (bot check, age gate) is a note, not a missing-captions failure', async () => {
  const iframe = (id) => `<iframe title="Video: ${id}" width="560" height="315" src="https://www.youtube.com/embed/${id}"></iframe>`;
  const own = await startSite({ '/youtube.html': () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Videos</title></head><body><main><h1>Videos</h1>${Object.keys(PLAYERS).map(iframe).join('')}</main></body></html>` });
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const context = await browser.newContext();
    await context.route(/^https:\/\/www\.youtube\.com\/embed\//, (route) => route.fulfill({ contentType: 'text/html', body: fakePlayer(PLAYERS[new URL(route.request().url()).pathname.split('/').pop()]) }));
    const url = `${own.origin}/youtube.html`;
    const page = await context.newPage();
    await page.goto(url);
    const fresh = async () => { const p = await context.newPage(); await p.goto(url); return p; };
    const youtube = probes.find((p) => p.name === 'YouTube captions');
    const out = await youtube.run(page, { fresh, level: 'AA' });
    // Only the player that played and reported no captions is a failure.
    assert.deepEqual(out.issues.map((i) => [i.kind, i.id, i.selector]), [['failure', 'embed-no-captions', 'html > body > main > iframe:nth-of-type(2)']]);
    assert.deepEqual(out.notes, ["could not read the caption tracks of 1 YouTube player(s): YouTube would not play the video to this browser (LOGIN_REQUIRED), as it often does for automated browsers and data centre addresses; check their captions by hand"]);
  } finally {
    await browser.close();
    await own.close();
  }
});
