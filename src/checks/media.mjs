// Audio and video: the alternatives people who cannot hear or see the media rely on, the
// player controls that turn them on, and sound that starts by itself.
//
// What a machine can see is whether an alternative exists at all: a caption or description
// track, a link to a described version or a transcript, words such as "transcript" next to
// the player. Whether the alternative is accurate, and whether a video needs description in
// the first place (a talking head may say everything that is shown), is for a person. So
// most findings here are "likely". The ones that are failures rest on evidence that settles
// it: a player that reports no caption tracks at all, a caption track with no control to
// turn it on, sound a script started with no way to stop it.
import { issue } from './index.mjs';

const MAX_YOUTUBE = 3;
const YOUTUBE_WAIT = 4000;

// Words that show an alternative sits next to the player. Kept broad on purpose: a miss here
// becomes a "likely" finding a person dismisses, a hit only silences one.
const WORDS = {
  transcript: /transcript|text version|text alternative|full text|read the (text|script)|\bscript\b|lyrics/i,
  described: /audio[- ]?described|audio description|described version|with description|descriptive (audio|video|version)|extended description|\bAD version\b/i,
  sign: /sign language|signed version|\b(ASL|BSL|Auslan|LSF|DGS|ISL|NZSL)\b|sign interpret/i,
  // A recording of the page's own text is a media alternative for text, which WCAG exempts.
  readAloud: /listen to (this|the) (article|page|post|story|text)|read aloud|audio version of (this|the) (article|page|post|story)|text[- ]to[- ]speech/i,
  live: /live (captions?|transcript|text)|real[- ]time (captions?|text|transcript)|\bCART\b|captions? (are|is) (shown|available|provided)/i,
};

// A control that stops, pauses or mutes sound, by its name.
const SOUND_CONTROL = /pause|stop|mute|unmute|sound (off|on)|volume|audio (off|on)/i;
const CAPTION_CONTROL = /caption|subtitle|\bCC\b|transcript|audio description|described|\bAD\b/i;

// In the page: every audio and video element, with what is around it.
function collectMedia({ words, captionControl }) {
  const W = Object.fromEntries(Object.entries(words).map(([k, v]) => [k, new RegExp(v, 'i')]));
  const CAPTION = new RegExp(captionControl, 'i');
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
  const selector = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let part = n.tagName.toLowerCase();
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const nameOf = (b) => clean(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || b.value || '');

  // The text that belongs with a player: its section, figure or card, plus anything the
  // player itself points at with aria-describedby.
  const regionOf = (el) => el.closest('figure, section, article, aside, li, [role=region], [role=group]')
    || el.parentElement?.parentElement || document.body;
  const contextText = (el) => {
    const region = regionOf(el);
    const parts = [region.innerText || ''];
    for (const a of region.querySelectorAll('a[href]')) parts.push(a.getAttribute('aria-label') || '', a.getAttribute('title') || '', a.href);
    for (const id of (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)) parts.push(document.getElementById(id)?.innerText || '');
    parts.push(el.getAttribute('aria-label') || '', el.getAttribute('title') || '');
    return parts.join(' ');
  };

  // Chrome reports a media element's tracks through captureStream, Firefox through
  // mozHasAudio, Safari through audioTracks. null when the browser cannot say yet.
  const tracksOf = (m) => {
    if (m.srcObject && typeof m.srcObject.getTracks === 'function') {
      return { audio: m.srcObject.getAudioTracks().length > 0, video: m.srcObject.getVideoTracks().length > 0 };
    }
    if (m.readyState < 1) return { audio: null, video: null };
    if ('audioTracks' in m && m.audioTracks) return { audio: m.audioTracks.length > 0, video: m.videoTracks ? m.videoTracks.length > 0 : null };
    if ('mozHasAudio' in m) return { audio: !!m.mozHasAudio, video: m.videoWidth > 0 };
    try {
      const stream = (m.captureStream || m.mozCaptureStream).call(m);
      const out = { audio: stream.getAudioTracks().length > 0, video: stream.getVideoTracks().length > 0 };
      for (const t of stream.getTracks()) t.stop();
      // A stream with no tracks at all means the browser had not wired them up yet.
      return out.audio || out.video ? out : { audio: null, video: null };
    } catch { return { audio: null, video: null }; } // cross-origin media cannot be captured
  };

  const items = [];
  const media = [...document.querySelectorAll('video, audio')];
  for (const m of media) {
    const isVideo = m.tagName === 'VIDEO';
    if (isVideo && !shown(m)) continue;
    if (!m.currentSrc && !m.src && !m.srcObject && !m.querySelector('source[src]')) continue;
    const tracks = [...m.querySelectorAll('track')];
    const kinds = new Set(tracks.map((t) => (t.getAttribute('kind') || 'subtitles').toLowerCase()));
    const region = regionOf(m);
    const captionButton = [...region.querySelectorAll('button, [role=button], input[type=checkbox], [role=switch], [role=menuitemcheckbox]')]
      .some((b) => shown(b) && CAPTION.test(nameOf(b) + ' ' + (b.labels ? [...b.labels].map((l) => l.textContent).join(' ') : '')));
    const text = contextText(m);
    items.push({
      kind: isVideo ? 'video' : 'audio',
      selector: selector(m),
      html: m.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
      // A muted, looping clip with no controls is decoration, like a background image.
      background: isVideo && m.muted && (m.loop || m.autoplay) && !m.controls,
      // A MediaStream (a camera, a WebRTC call, a broadcast) has no end.
      live: m.duration === Infinity || !!(m.srcObject && typeof m.srcObject.getTracks === 'function'),
      ...tracksOf(m),
      captions: kinds.has('captions') || kinds.has('subtitles'),
      descriptions: kinds.has('descriptions'),
      defaultTrack: tracks.some((t) => t.default && /captions|subtitles|descriptions/.test(t.getAttribute('kind') || 'subtitles')),
      controls: m.controls,
      captionButton,
      found: Object.fromEntries(Object.entries(W).map(([k, re]) => [k, re.test(text)])),
    });
  }

  const embeds = [];
  for (const f of document.querySelectorAll('iframe[src]')) {
    if (!shown(f)) continue;
    const provider = /youtube(-nocookie)?\.com\/embed\/|youtu\.be\//.test(f.src) ? 'youtube' : /player\.vimeo\.com\/video\//.test(f.src) ? 'vimeo' : null;
    if (!provider) continue;
    const url = new URL(f.src);
    const text = contextText(f);
    embeds.push({
      kind: 'embed', provider, src: f.src, selector: selector(f),
      html: f.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
      live: /\/embed\/live_stream/.test(url.pathname),
      // Vimeo's background mode is a muted loop with no controls: decoration.
      background: provider === 'vimeo' && url.searchParams.get('background') === '1',
      controlsOff: url.searchParams.get('controls') === '0',
      found: Object.fromEntries(Object.entries(W).map(([k, re]) => [k, re.test(text)])),
    });
  }

  // When the page holds a single player, its transcript may be anywhere on the page.
  if (items.length + embeds.length === 1) {
    const whole = document.body.innerText + ' ' + [...document.querySelectorAll('a[href]')].map((a) => a.href).join(' ');
    for (const it of [...items, ...embeds]) for (const [k, re] of Object.entries(W)) it.found[k] ||= re.test(whole);
  }
  return { items, embeds };
}

// In the page: sound a script started, or tried to start, before anyone touched the page.
// Automated browsers block sound without a user gesture, as Chrome does for most visitors;
// Chrome lets it through on sites a person often plays media on, and other browsers can be
// set to allow it. So a blocked attempt is still evidence.
function collectAutoplay(soundControl) {
  const SOUND = new RegExp(soundControl, 'i');
  const log = window.__accessready_log;
  if (!log) return null;
  const attempts = log.media.filter((m) => !m.user && !m.muted);
  if (!attempts.length) return null;
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
  const nameOf = (b) => clean(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '');
  const pageControl = [...document.querySelectorAll('button, [role=button], [role=switch], input[type=checkbox], input[type=range]')]
    .some((b) => shown(b) && SOUND.test(nameOf(b) + ' ' + (b.labels ? [...b.labels].map((l) => l.textContent).join(' ') : '')));
  const found = [];
  let unplaced = 0;
  for (const tag of new Set(attempts.map((a) => a.tag))) {
    // The autoplay attribute is axe-core's no-autoplay-audio rule; this is the script case.
    const els = [...document.querySelectorAll(tag)].filter((m) => !m.autoplay && !m.muted && m.volume > 0);
    const played = els.filter((m) => !m.paused || m.ended || m.currentTime > 0);
    // Which element the script played is known when one played, or when only one could have.
    const candidates = played.length ? played : els.filter((m) => m.paused && m.currentTime === 0);
    if (candidates.length !== 1) { unplaced++; continue; }
    const m = candidates[0];
    const live = m.duration === Infinity || (m.srcObject && typeof m.srcObject.getTracks === 'function');
    found.push({
      selector: m.id ? `#${CSS.escape(m.id)}` : m.tagName.toLowerCase(),
      html: m.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
      tag: m.tagName.toLowerCase(),
      duration: live ? 'live' : Number.isFinite(m.duration) ? m.duration : null,
      controls: m.controls,
      played: played.length > 0,
    });
  }
  return { found, unplaced, pageControl };
}

// What to report for one player, from what was found. Shared by native players and embeds.
function alternativeIssues(it, { level }) {
  const out = [];
  const where = it.kind === 'embed' ? `the ${it.provider === 'youtube' ? 'YouTube' : 'Vimeo'} player` : `the ${it.kind}`;
  const at = { selector: it.selector, html: it.html };
  const f = it.found;
  if (it.live) {
    if (it.kind === 'audio' || it.video === false) {
      if (!f.live && !f.transcript) out.push(issue('live-audio-no-alternative', { ...at, message: `${where} streams live audio and nothing near it offers a live text version` }));
    } else if (!it.captions && !f.live) {
      out.push(issue('live-no-captions', { ...at, message: `${where} is a live stream with no caption track, and nothing near it mentions live captions` }));
    }
    return out;
  }
  if (it.kind === 'audio') {
    if (!f.transcript && !f.readAloud) out.push(issue('audio-no-transcript', { ...at, message: 'the audio player has no transcript in its section of the page' }));
    return out;
  }
  if (it.audio === false) {
    if (!f.transcript && !f.described && !it.descriptions) out.push(issue('video-only-no-alternative', { ...at, message: 'the video has no sound track, and nothing near it offers a text description or an audio track describing it' }));
    return out;
  }
  const described = it.descriptions || f.described;
  if (!described) {
    out.push(f.transcript
      ? issue('video-transcript-no-audio-description', { ...at, message: `${where} has a transcript but no audio description track and no link to a described version` })
      : issue('video-no-audio-description', { ...at, message: `${where} has no audio description track, no link to a described version and no transcript` }));
  }
  if (level === 'AAA') {
    if (!f.sign) out.push(issue('video-no-sign-language', { ...at, message: `nothing near ${where} offers a sign language version` }));
    if (!f.transcript) out.push(issue('video-no-media-alternative', { ...at, message: `nothing near ${where} offers a full text alternative (transcript)` }));
  }
  return out;
}

// What a YouTube or Vimeo player said about its own captions. `tracks` lists each track as
// { auto }, where auto marks captions the platform generated by speech recognition.
export function embedCaptionIssues({ provider, tracks, live, controlsOff, selector, html }) {
  const name = provider === 'youtube' ? 'YouTube' : 'Vimeo';
  const at = { selector, html };
  const out = [];
  if (live) {
    if (!tracks.length) out.push(issue('live-no-captions', { ...at, message: `the ${name} player is a live stream and reports no caption track` }));
    return out;
  }
  if (!tracks.length) {
    out.push(issue('embed-no-captions', { ...at, message: `the ${name} player reports no caption tracks for this video` }));
  } else if (tracks.every((t) => t.auto)) {
    out.push(issue('embed-no-captions', { ...at, kind: 'likely', message: `the ${name} player only has captions generated by speech recognition, which are rarely accurate enough to rely on` }));
  }
  if (tracks.length && controlsOff) {
    out.push(issue('captions-no-control', { ...at, message: `the ${name} player has captions but is embedded with controls=0, so there is no button to turn them on` }));
  }
  return out;
}

// In a Vimeo player frame: its text tracks, from the configuration it loads with.
function readVimeo() {
  const c = window.playerConfig;
  if (!c || !c.request) return null;
  return {
    live: !!(c.video && c.video.live_event),
    tracks: (c.request.text_tracks || []).map((t) => ({ auto: /auto/i.test(String(t.kind || '') + String(t.label || '')) })),
  };
}

// In a YouTube player frame, once it has loaded the video: its caption tracks. Tracks of
// kind "asr" are YouTube's automatic captions. The caption list only means something when
// YouTube agreed to play the video: a bot check or an age gate (common from CI and data
// centre addresses) answers with videoDetails and no captions at all, which would read as a
// video with none. Anything but status OK is returned as `unplayable`, and judged by nobody.
function readYouTube() {
  const player = document.querySelector('#movie_player');
  const response = player && typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : null;
  if (!response || !response.videoDetails) return null;
  const status = response.playabilityStatus && response.playabilityStatus.status;
  if (status !== 'OK') return { unplayable: String(status || 'no playability status') };
  return {
    live: !!response.videoDetails.isLive,
    tracks: ((response.captions && response.captions.playerCaptionsTracklistRenderer && response.captions.playerCaptionsTracklistRenderer.captionTracks) || [])
      .map((t) => ({ auto: t.kind === 'asr' })),
  };
}

async function frameFor(page, src) {
  for (const handle of await page.$$('iframe[src]')) {
    if (await handle.getAttribute('src').then((s) => s && new URL(s, page.url()).href === src, () => false)) return handle.contentFrame();
  }
  return null;
}

async function checkMedia(page, ctx) {
  const { items, embeds } = await page.evaluate(collectMedia, {
    words: Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, v.source])),
    captionControl: CAPTION_CONTROL.source,
  });
  const issues = [];
  const notes = [];
  for (const it of items) {
    if (it.background) continue;
    issues.push(...alternativeIssues(it, ctx));
    // EN 301 549 7.3 and Section 508 503.4: captions and description need a control at the
    // same level as play and pause. A browser's own controls have one.
    if ((it.captions || it.descriptions) && !it.controls && !it.captionButton) {
      issues.push(issue('captions-no-control', {
        selector: it.selector, html: it.html, kind: it.defaultTrack ? 'likely' : 'failure',
        message: it.defaultTrack
          ? `the ${it.kind} shows its ${it.descriptions && !it.captions ? 'description' : 'caption'} track by default, but has no browser controls and no button to turn it off or choose another`
          : `the ${it.kind} has a ${it.descriptions && !it.captions ? 'description' : 'caption'} track, but no browser controls and no button to turn it on`,
      }));
    }
  }

  for (const e of embeds) {
    if (e.background) continue;
    // Live embeds are judged on live captions only, once the player has said what it has.
    if (!e.live) issues.push(...alternativeIssues({ ...e, audio: null, captions: false, descriptions: false }, ctx));
    if (e.provider !== 'vimeo') continue;
    const frame = await frameFor(page, e.src);
    const info = frame ? await frame.evaluate(readVimeo).catch(() => null) : null;
    if (!info) { notes.push('could not read the caption tracks of a Vimeo player; check its captions by hand'); continue; }
    issues.push(...embedCaptionIssues({ provider: 'vimeo', ...info, live: info.live || e.live, controlsOff: e.controlsOff, selector: e.selector, html: e.html }));
  }

  const autoplay = await page.evaluate(collectAutoplay, SOUND_CONTROL.source);
  if (autoplay && !autoplay.pageControl) {
    for (const m of autoplay.found) {
      if (m.controls) continue;
      const long = m.duration === 'live' || (m.duration !== null && m.duration > 3);
      if (m.duration !== null && !long) continue;
      const length = m.duration === 'live' ? 'a live stream' : m.duration === null ? 'of unknown length' : `${Math.round(m.duration)} seconds long`;
      issues.push(m.played
        ? issue('script-autoplay-audio', { selector: m.selector, html: m.html, kind: long ? 'failure' : 'likely', message: `a script played this ${m.tag} with sound before anyone used the page (${length}), and there is no control to pause, stop or mute it` })
        : issue('script-autoplay-audio', { selector: m.selector, html: m.html, kind: 'likely', message: `a script tries to play this ${m.tag} with sound before anyone uses the page (${length}), and there is no control to pause, stop or mute it. The audit browser blocked it; browsers that allow sound on load, such as Chrome on sites people often play media on, will play it` }));
    }
    if (autoplay.unplaced) {
      issues.push(issue('script-autoplay-audio', {
        selector: 'html', kind: 'likely',
        message: 'a script started or tried to start sound before anyone used the page, and there is no control on the page to pause, stop or mute it; which player it came from could not be told',
      }));
    }
  }
  return { issues, notes };
}

// YouTube embeds only say which captions they have once the video starts, so this presses
// the player's own Play button on a fresh copy of the page, reads the tracks, and pauses.
async function checkYouTube(page, ctx) {
  const count = await page.$$eval('iframe[src]', (fs) => fs.filter((f) => /youtube(-nocookie)?\.com\/embed\//.test(f.src) && f.getBoundingClientRect().width > 0).length).catch(() => 0);
  if (!count) return [];
  const p = await ctx.fresh();
  const embeds = (await p.evaluate(collectMedia, {
    words: Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, v.source])),
    captionControl: CAPTION_CONTROL.source,
  })).embeds.filter((e) => e.provider === 'youtube');
  const issues = [];
  let unread = 0;
  const refused = [];
  for (const e of embeds.slice(0, MAX_YOUTUBE)) {
    const frame = await frameFor(p, e.src);
    let info = null;
    if (frame) {
      // No Play button means the player shows an error ("video unavailable"); one look is enough.
      const played = await frame.getByRole('button', { name: /^play/i }).first().click({ timeout: 2000 }).then(() => true, () => false);
      for (let waited = 0; waited < (played ? YOUTUBE_WAIT : 1) && !info; waited += 250) {
        await p.waitForTimeout(250);
        info = await frame.evaluate(readYouTube).catch(() => null);
      }
      await frame.evaluate(() => document.querySelector('#movie_player')?.pauseVideo?.()).catch(() => {});
    }
    if (!info) { unread++; continue; }
    if (info.unplayable) { refused.push(info.unplayable); continue; }
    issues.push(...embedCaptionIssues({ provider: 'youtube', ...info, live: info.live || e.live, controlsOff: e.controlsOff, selector: e.selector, html: e.html }));
  }
  const notes = [];
  if (unread) notes.push(`could not read the caption tracks of ${unread} YouTube player(s) (the video did not load, or embedding is blocked); check their captions by hand`);
  if (refused.length) notes.push(`could not read the caption tracks of ${refused.length} YouTube player(s): YouTube would not play the video to this browser (${[...new Set(refused)].join(', ')}), as it often does for automated browsers and data centre addresses; check their captions by hand`);
  if (embeds.length > MAX_YOUTUBE) notes.push(`read captions from the first ${MAX_YOUTUBE} YouTube players only; ${embeds.length - MAX_YOUTUBE} more were not checked`);
  return { issues, notes };
}

export const probes = [
  { name: 'media alternatives', phase: 'look', run: checkMedia },
  { name: 'YouTube captions', phase: 'operate', run: checkYouTube },
];

export const rules = {
  'audio-no-transcript': {
    title: 'Audio has no transcript', criteria: ['1.2.1'], kinds: ['likely'],
    covers: 'Audio players with no transcript, text version or lyrics mentioned in their section of the page.',
    why: 'Deaf and hard of hearing people cannot get anything from a recording without a transcript.',
  },
  'video-only-no-alternative': {
    title: 'Silent video has no text description', criteria: ['1.2.1'], kinds: ['likely'],
    covers: 'Video with no sound track (read from the media itself) and no transcript, description or described version near it.',
    why: 'Blind people get nothing from a video with no sound unless a text or audio description says what it shows.',
  },
  'embed-no-captions': {
    title: 'Embedded video has no captions', criteria: ['1.2.2'], kinds: ['failure', 'likely'],
    covers: 'YouTube and Vimeo players whose own caption list is empty (a failure), or holds only automatic speech-recognition captions (likely).',
    why: 'Deaf and hard of hearing people cannot follow speech in a video without captions. Automatic captions get names, numbers and technical words wrong.',
  },
  'video-no-audio-description': {
    title: 'Video has no audio description or text alternative', criteria: ['1.2.3', '1.2.5', '1.2.7'], kinds: ['likely'],
    covers: 'Video with sound that has no description track, no link to a described version and no transcript nearby.',
    why: 'Blind people hear the soundtrack but miss whatever is only shown: text on screen, actions, who is speaking. Description or a full transcript fills that gap.',
  },
  'video-transcript-no-audio-description': {
    title: 'Video has a transcript but no audio description', criteria: ['1.2.5', '1.2.7'], kinds: ['likely'],
    covers: 'Video with sound that has a transcript nearby but no description track and no link to a described version.',
    why: 'A transcript helps, but at level AA blind people should be able to follow the video itself, with what is shown described in the audio.',
  },
  'video-no-sign-language': {
    title: 'Video has no sign language version', criteria: ['1.2.6'], kinds: ['likely'],
    covers: 'At level AAA, video with sound and no sign language version mentioned near it.',
    why: 'For many Deaf people a sign language is their first language, and captions in a written language are a second-language read.',
  },
  'video-no-media-alternative': {
    title: 'Video has no full text alternative', criteria: ['1.2.8'], kinds: ['likely'],
    covers: 'At level AAA, video with sound and no transcript or text alternative mentioned near it.',
    why: 'Deafblind people, and anyone who reads with a braille display, can only use a video through a full text version of everything said and shown.',
  },
  'live-no-captions': {
    title: 'Live stream has no captions', criteria: ['1.2.4'], kinds: ['likely'],
    covers: 'Live streams (media reporting an endless duration, YouTube live players) with no caption track and no mention of live captions.',
    why: 'Deaf and hard of hearing people cannot take part in a live event without real-time captions.',
  },
  'live-audio-no-alternative': {
    title: 'Live audio has no text alternative', criteria: ['1.2.9'], kinds: ['likely'],
    covers: 'At level AAA, live audio streams with no live transcript or captions mentioned near them.',
    why: 'Deaf and hard of hearing people cannot follow live radio, a podcast stream or a phone-in without a real-time text version.',
  },
  'captions-no-control': {
    title: 'Captions cannot be turned on from the player', criteria: [], extra: ['caption-controls'], kinds: ['failure', 'likely'],
    covers: 'Players that carry caption or description tracks but offer no control to turn them on: no browser controls and no caption button nearby, or a YouTube or Vimeo player embedded with its controls switched off.',
    why: 'Captions that exist but cannot be switched on are no use to the Deaf and hard of hearing viewers they were made for. EN 301 549 and Section 508 require the control.',
  },
  'script-autoplay-audio': {
    title: 'Sound starts by itself with no way to stop it', criteria: ['1.4.2'], kinds: ['failure', 'likely'],
    covers: 'Audio or video that a script started with sound before anyone used the page, longer than three seconds, with no browser controls and no pause, stop or mute button on the page.',
    why: 'Screen reader users hear the page through speech. Sound that starts by itself talks over it, and they cannot find the control to stop it while it does.',
  },
};
