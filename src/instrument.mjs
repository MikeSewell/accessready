// Installed in every page before the site's own scripts run. It records what a rules engine
// cannot see from the DOM: which elements registered which event listeners, media that
// started playing, windows opened by script, and media queries the page asks about. Checks
// read it back with the helpers below. Nothing here changes how the page behaves.

export function instrument() {
  if (window.__accessready_log) return;
  const define = (obj, key, value) => Object.defineProperty(obj, key, { value, configurable: true, enumerable: false, writable: true });
  const log = { media: [], opened: [], mediaQueries: [], audioContexts: 0, motion: 0 };
  define(window, '__accessready_log', log);
  const listeners = new WeakMap();
  define(window, '__accessready_listeners', listeners);

  // Listeners are recorded the way the browser keeps them: one per type, function and capture
  // flag. A listener added with `once` is dropped when it fires, and one added with a signal
  // when the signal aborts, so the record never lists a listener the page no longer has.
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const captureOf = (opts) => (typeof opts === 'boolean' ? opts : !!opts?.capture);
  const entries = (target, type) => {
    if (!listeners.has(target)) listeners.set(target, new Map());
    const m = listeners.get(target);
    if (!m.has(type)) m.set(type, new Map());
    return m.get(type);
  };
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    try {
      if (fn && !opts?.signal?.aborted) {
        const capture = captureOf(opts);
        const byFn = entries(this, type);
        if (!byFn.has(fn)) byFn.set(fn, new Set());
        const flags = byFn.get(fn);
        if (!flags.has(capture)) {
          flags.add(capture);
          const forget = () => { flags.delete(capture); if (!flags.size) byFn.delete(fn); };
          if (opts?.once) add.call(this, type, forget, { once: true, capture });
          if (opts?.signal) add.call(opts.signal, 'abort', forget, { once: true });
          if (type === 'devicemotion' || type === 'deviceorientation') log.motion++;
        }
      }
    } catch { /* never break the page */ }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    try {
      const byFn = listeners.get(this)?.get(type);
      const flags = byFn?.get(fn);
      if (flags) { flags.delete(captureOf(opts)); if (!flags.size) byFn.delete(fn); }
    } catch { /* never break the page */ }
    return remove.call(this, type, fn, opts);
  };

  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    try {
      log.media.push({ at: performance.now(), tag: this.tagName.toLowerCase(), muted: this.muted || this.volume === 0, user: !!navigator.userActivation?.hasBeenActive });
    } catch { /* never break the page */ }
    return play.apply(this, args);
  };

  const open = window.open;
  window.open = function (...args) {
    try { log.opened.push({ url: String(args[0] || ''), user: !!navigator.userActivation?.isActive }); } catch { /* never break the page */ }
    return open.apply(this, args);
  };

  const matchMedia = window.matchMedia;
  window.matchMedia = function (query) {
    try { if (log.mediaQueries.length < 200) log.mediaQueries.push(String(query)); } catch { /* never break the page */ }
    return matchMedia.call(this, query);
  };

  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Original = window[name];
    if (typeof Original !== 'function') continue;
    // Reflect.construct keeps a page's own subclass (class Synth extends AudioContext) intact.
    window[name] = new Proxy(Original, { construct(target, args, newTarget) { log.audioContexts++; return Reflect.construct(target, args, newTarget); } });
  }
}

// In the page: the event types an element listens for, through addEventListener or an
// on* property or attribute.
export function listenerTypesSource() {
  return `(el) => {
    const types = new Set();
    const m = window.__accessready_listeners && window.__accessready_listeners.get(el);
    if (m) for (const [type, byFn] of m) if (byFn.size > 0) types.add(type);
    for (const key of ['onclick', 'onmousedown', 'onmouseup', 'onpointerdown', 'onpointerup', 'ontouchstart', 'ontouchend', 'ontouchmove', 'onkeydown', 'onkeyup', 'onkeypress', 'onmouseover', 'onmouseenter', 'onfocus', 'onchange', 'oninput', 'onpaste', 'ondragstart', 'onpointermove', 'onmousemove'])
      if (typeof el[key] === 'function' || el.hasAttribute?.(key)) types.add(key.slice(2));
    return [...types];
  }`;
}
