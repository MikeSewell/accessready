// Helpers for checks that do something to a page and then ask whether anything happened:
// a page load, a form submission, a new window, a dialog, focus or scroll moving, or the DOM
// changing. Shared by the keyboard walk and the pointer, shortcut and widget checks.

import { listenerTypesSource } from '../instrument.mjs';

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// The same issue builder as issue() in ./index.mjs, bound to one module's own rules. The
// keyboard and interact modules are loaded by src/index.mjs before the registry exists, so
// importing issue() from there would be an import cycle that fails at load time.
export const issuer = (rules) => (id, fields = {}) => {
  const rule = rules[id];
  if (!rule) throw new Error(`accessready: no rule named ${id}`);
  return {
    id, source: 'accessready', kind: rule.kinds[0], wcag: rule.criteria, extra: rule.extra || [],
    impact: rule.impact || 'serious', title: rule.title, selector: '', html: '', ...fields,
  };
};

// WebSockets. Playwright can route a socket but never unroute one, so each browser context
// gets a single route the first time it is guarded, and that route asks which guards are on.
// Sockets it routes still connect, so a chat widget opened later keeps working once the
// guard is off; while a guard is on, what the page sends is recorded and dropped.
const socketRoutes = new WeakMap();
async function routeSockets(context) {
  if (socketRoutes.has(context)) return socketRoutes.get(context);
  const state = { guards: new Set() };
  socketRoutes.set(context, state);
  await context.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      if (!state.guards.size) return server.send(message);
      for (const g of state.guards) g.sockets.push({ url: ws.url() });
    });
  });
  return state;
}

// In the page: a socket opened before the guard (on page load, which is how chat and live
// update widgets do it) is not routed, so its send() is replaced while the guard is on. What
// it would have sent is counted, not kept: it can be the visitor's data. Routing a socket
// makes Playwright swap window.WebSocket for a stand-in, and sockets opened before that are
// still the browser's own, so the browser's own prototype is kept from the first call, which
// runs before the route is added.
function holdSockets(on) {
  const h = (window.__accessready_sockets ||= { depth: 0, sent: [], send: null, proto: window.WebSocket?.prototype });
  const P = h.proto;
  if (!P) return [];
  if (on) {
    if (h.depth++ === 0) {
      h.send = P.send;
      Object.defineProperty(P, 'send', { configurable: true, writable: true, value: function send() { h.sent.push(String(this.url)); } });
    }
    return [];
  }
  if (h.depth > 0 && --h.depth === 0) Object.defineProperty(P, 'send', { configurable: true, writable: true, value: h.send });
  return h.sent.splice(0);
}

// From now on nothing the page does can leave it or reach a server. A navigation of a top-level
// page is answered with "204 No Content", which every browser treats as "stay where you are",
// so the page and everything on it survive. With `writes`, any request that is not a read
// (a POST from fetch, a beacon) is refused too. Nothing is sent over a WebSocket, whether the
// socket was open already or opens later. New windows are closed as soon as they open.
// Every attempt is recorded, which is what the checks look at: page loads and requests in
// `attempts`, socket messages in `sockets`.
export async function guard(page, { writes = false } = {}) {
  const attempts = [];
  const popups = [];
  const sockets = [];
  const context = page.context();
  const handler = async (route) => {
    const req = route.request();
    let frame = null;
    try { frame = req.frame(); } catch { /* a service worker request has no frame */ }
    const navigation = req.isNavigationRequest() && !!frame && !frame.parentFrame();
    if (navigation) {
      attempts.push({ url: req.url(), method: req.method(), navigation: true });
      return route.fulfill({ status: 204, body: '' }).catch(() => {});
    }
    if (writes && !SAFE_METHODS.includes(req.method())) {
      attempts.push({ url: req.url(), method: req.method(), navigation: false });
      return route.abort().catch(() => {});
    }
    return route.fallback().catch(() => {});
  };
  const onPage = (p) => { popups.push(p.url()); p.close().catch(() => {}); };
  await context.route('**/*', handler);
  context.on('page', onPage);
  // Every frame there is now, before the route is added (see holdSockets). A frame added
  // later opens its sockets after the route exists.
  const frames = page.frames();
  await Promise.all(frames.map((f) => f.evaluate(holdSockets, true).catch(() => {})));
  const self = { sockets };
  const routed = await routeSockets(context);
  routed.guards.add(self);
  let stopped = false;
  return {
    attempts,
    popups,
    sockets,
    navigations: () => attempts.filter((a) => a.navigation),
    async stop() {
      if (stopped) return;
      stopped = true;
      context.off('page', onPage);
      routed.guards.delete(self);
      for (const f of frames) {
        const held = await f.evaluate(holdSockets, false).catch(() => []);
        for (const url of held) sockets.push({ url });
      }
      await context.unroute('**/*', handler).catch(() => {});
    },
  };
}

// In the page: start counting what changes from here on. DOM mutations, focus, scroll, the
// address, windows opened by script and dialogs shown. Attributes this tool sets itself
// (data-accessready-*) and attribute changes on <html> and <body> (which input-detection
// libraries flip on every key press and mouse press) do not count.
export function startWatch() {
  const w = (window.__accessready_watch ||= {});
  if (w.observer) w.observer.disconnect();
  w.mutations = 0;
  w.outside = 0;
  w.changed = '';
  w.scope = window.__accessready_scope || null;
  w.observer = new MutationObserver((list) => {
    for (const r of list) {
      if (r.type === 'attributes' && (String(r.attributeName).startsWith('data-accessready') || r.target === document.documentElement || r.target === document.body)) continue;
      // Tags added to <head> (a script that loads on the first key press or scroll, a prefetch
      // link) change nothing anyone sees.
      if (document.head && (r.target === document.head || document.head.contains(r.target))) continue;
      w.mutations++;
      if (!w.scope || !w.scope.contains(r.target)) w.outside++;
      // The first element that changed, so a report can say what moved.
      if (!w.changed) {
        const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (el) w.changed = el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + (typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '') + (r.type === 'attributes' ? ` (${r.attributeName})` : '');
      }
    }
  });
  w.observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  const shown = (d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden'; };
  w.dialogs = [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog]')].filter(shown);
  w.scroll = [scrollX, scrollY];
  w.url = location.href;
  w.active = document.activeElement;
  w.opened = window.__accessready_log ? window.__accessready_log.opened.length : 0;
}

// In the page: what has changed since startWatch().
export function readWatch() {
  const w = window.__accessready_watch;
  const shown = (d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden'; };
  const dialogs = [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog]')].filter(shown);
  const added = dialogs.filter((d) => !w.dialogs.includes(d));
  const active = document.activeElement;
  return {
    mutations: w.mutations,
    outside: w.outside,
    changed: w.changed,
    scrolled: Math.abs(scrollX - w.scroll[0]) + Math.abs(scrollY - w.scroll[1]) > 2,
    focusMoved: active !== w.active,
    focusInDialog: added.some((d) => d.contains(active)),
    url: location.href !== w.url,
    opened: (window.__accessready_log ? window.__accessready_log.opened.length : 0) - w.opened,
    dialogs: added.map((d) => (d.getAttribute('aria-label') || document.getElementById(d.getAttribute('aria-labelledby') || '')?.textContent || d.id || 'dialog').trim().slice(0, 60)),
    modal: added.some((d) => d.matches('dialog:modal, [aria-modal=true]')),
  };
}

// Selector, label and markup for an element, for findings. Runs in the page; pass it as
// source with `new Function` or inline it.
export const DESCRIBE = `
  const selectorOf = (node) => {
    const parts = [];
    for (let n = node; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let part = n.tagName.toLowerCase();
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const labelOf = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
  const htmlOf = (el) => el.outerHTML.replace(/\\s+/g, ' ').slice(0, 160);
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
`;

// Runs `fn` in the page with the helpers above in scope, plus typesOf(el), the event types an
// element listens for (from src/instrument.mjs). `fn` takes one argument, passed as JSON.
export const inPage = (page, fn, arg) => page.evaluate(`(() => { const typesOf = ${listenerTypesSource()}; ${DESCRIBE} return (${fn.toString()})(${JSON.stringify(arg ?? null)}); })()`);

// A fresh copy of the page, closed again when `fn` is done, so a check that changes state
// never touches the page other checks see.
export async function withFresh(ctx, fn) {
  const page = await ctx.fresh();
  try { return await fn(page); } finally { await page.context().close().catch(() => {}); }
}

// Results of a look-phase scan, kept for the operate-phase check on the same audit, so the
// costly fresh copy is only opened when the page has something to test.
const found = new WeakMap();
export const remember = (ctx, key, value) => { if (!found.has(ctx.result)) found.set(ctx.result, {}); found.get(ctx.result)[key] = value; };
export const recall = (ctx, key) => found.get(ctx.result)?.[key];
