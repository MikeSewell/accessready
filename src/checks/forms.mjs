// Forms, the way a person who makes mistakes uses them. Two parts:
//   look     reads every form on the page: labels, required markers, format hints,
//            autocomplete, help, repeated questions, login fields, CAPTCHAs, and
//            containers for status messages that are not live regions.
//   operate  opens a separate copy of the page where nothing can reach a server, leaves
//            required fields empty, types obvious nonsense into typed fields, presses the
//            submit button and reads what the page shows.
// Safety: the copy blocks every request that is not a plain GET or HEAD from the moment it
// opens, every request of any kind once the form work starts, every navigation (answered
// with 204 No Content, so the page stays put), every WebSocket, and service workers. The
// form attempt never runs on the page the other checks use.
import { inPage, loadIssue } from './inpage.mjs';

const MAX_FORMS = 3; // forms tried per page
const MAX_FIELDS = 20; // fields filled per form
const SETTLE = 600; // ms to wait for a form to react to the submit button

// Hosts that only collect analytics or error reports. A beacon to one of them when the
// submit button is pressed is not the form sending its data.
const TELEMETRY = /(^|\.)(google-analytics\.com|analytics\.google\.com|googletagmanager\.com|doubleclick\.net|facebook\.com|facebook\.net|segment\.(io|com)|hotjar\.(com|io)|clarity\.ms|plausible\.io|sentry\.io|newrelic\.com|nr-data\.net|mixpanel\.com|amplitude\.com|heap(analytics)?\.(io|com)|fullstory\.com|bing\.com|linkedin\.com|tiktok\.com|stats\.wp\.com)$/;

// Everything the copy sends once armed is recorded, then answered locally: navigations with
// 204, anything else aborted. Before arming, only GET and HEAD go out, so the page can load.
async function blockOutgoing(context, guard) {
  await context.route('**/*', (route) => {
    const req = route.request();
    const method = req.method();
    if (!guard.armed && (method === 'GET' || method === 'HEAD')) return route.continue();
    guard.sent.push({ method, url: req.url(), type: req.resourceType(), navigation: req.isNavigationRequest() });
    if (req.isNavigationRequest()) return route.fulfill({ status: 204, body: '' });
    return route.abort('blockedbyclient');
  });
  // Not connecting to the server leaves the page with a socket that goes nowhere.
  await context.routeWebSocket(/.*/, (ws) => {
    ws.onMessage(() => { guard.sent.push({ method: 'WS', url: ws.url(), type: 'websocket', navigation: false }); });
  });
}

// Did this request carry the form's data somewhere? Images, styles and scripts the page
// loads in reaction do not; navigations, non-GET requests and script requests do.
function isSend(r) {
  if (r.type === 'websocket') return true;
  let host = '';
  try { host = new URL(r.url).hostname; } catch { /* data: and the like */ }
  if (TELEMETRY.test(host)) return false;
  return r.navigation || (r.method !== 'GET' && r.method !== 'HEAD') || ['fetch', 'xhr', 'eventsource', 'ping', 'beacon'].includes(r.type);
}

// ---------------------------------------------------------------------------------------
// In the page: what each form is.

// Classifies the forms on the page, shared by the look and operate parts so they agree.
function describeForms(h, { mark, maxForms, maxFields }) {
  const FINANCIAL_BUTTON = /\b(pay|purchase|buy|place (your |my )?order|complete (your |my )?(order|purchase)|checkout|check out|donate|give now|transfer|confirm (payment|order|purchase)|subscribe and pay)\b/i;
  const LEGAL_BUTTON = /\b(e-?sign|sign (the |this )?(agreement|contract|lease|form|application|petition)|i agree|accept (the )?(agreement|contract|offer)|submit (application|claim|return))\b/i;
  const REVIEW_BUTTON = /\b(review|continue|next|preview|proceed|step \d)\b/i;
  const CONFIRM_BOX = /\b(confirm|reviewed|correct|accurate|verified)\b/i;
  const SEND_BUTTON = /\b(send|submit|sign|log ?in|continue|next|save|pay|subscribe|join|register|apply|donate|order|book|reserve|request|create|search|go)\b/i;
  const out = [];
  let index = 0;
  for (const form of document.querySelectorAll('form')) {
    const fields = h.fieldsOf(form);
    if (!fields.length) continue;
    const search = h.isSearch(form);
    const passwords = fields.filter((f) => f.type === 'password');
    const login = passwords.length === 1 && passwords[0].autocomplete !== 'new-password' &&
      fields.filter((f) => /^(text|email|tel|password|)$/.test(f.type)).length <= 4;
    const buttons = [...form.querySelectorAll('button, input[type=submit], input[type=image], [role=button]')]
      .concat(form.id ? [...document.querySelectorAll(`[form="${CSS.escape(form.id)}"]`)] : [])
      .filter(h.visible);
    const submit = buttons.find((b) => b.matches('[type=submit], input[type=image], button:not([type])')) ||
      buttons.find((b) => SEND_BUTTON.test(h.accName(b) || b.value || ''));
    const submitText = submit ? h.clean(h.accName(submit) || submit.value) : '';
    const boxes = fields.filter((f) => f.type === 'checkbox').map((f) => h.fieldName(f).name);
    const cc = fields.some((f) => /^cc-|\bcc-/.test(f.autocomplete || '') || /card.?(number|no)|cc-?num|cvv|cvc|security code/i.test(`${f.name} ${f.id} ${h.fieldName(f).name}`));
    const info = {
      index, name: h.clean(form.getAttribute('aria-label') || form.querySelector('legend, h1, h2, h3, h4')?.textContent || form.id || form.getAttribute('name') || ''),
      search, login, fields: fields.length, method: (form.getAttribute('method') || 'get').toLowerCase(),
      submitText, hasSubmit: !!submit,
      // A form that cannot be sent until it is complete has no error to identify.
      submitDisabled: !!submit && (submit.disabled || submit.getAttribute('aria-disabled') === 'true'),
      // Only a real submit button makes the browser run its own validation.
      realSubmit: !!submit && submit.matches('[type=submit], input[type=image], button:not([type])'),
      financial: cc || FINANCIAL_BUTTON.test(submitText) || LEGAL_BUTTON.test(submitText),
      finalAction: !REVIEW_BUTTON.test(submitText),
      confirmBox: boxes.some((b) => CONFIRM_BOX.test(b)),
      selector: h.selector(form), html: h.snippet(form).slice(0, 120),
    };
    if (mark && !search && index < maxForms) {
      form.setAttribute('data-accessready-form', String(index));
      if (submit) submit.setAttribute('data-accessready-submit', String(index));
      info.plan = [];
      fields.slice(0, maxFields).forEach((f, k) => {
        f.setAttribute('data-accessready-field', `${index}-${k}`);
        const { name } = h.fieldName(f);
        // Obvious nonsense, never anything that looks like real data.
        let fill = null;
        if (f.type === 'email' || (/^(text|)$/.test(f.type) && /e-?mail/i.test(`${name} ${f.name} ${f.id}`))) fill = 'not-an-email';
        else if (f.type === 'url') fill = 'not a web address';
        else if (f.type === 'number' && f.min !== '') fill = String(Number(f.min) - 1000);
        else if (f.type === 'number' && f.max !== '') fill = String(Number(f.max) + 1000);
        else if (f.type === 'date' && f.min && f.min > '1900-01-01') fill = '1900-01-01';
        else if (/^(text|tel|search|)$/.test(f.type) && f.pattern) fill = '!!';
        const textLike = f.tagName === 'TEXTAREA' || /^(text|email|tel|url|number|search|password|date|)$/.test(f.type);
        info.plan.push({ k, name, fill, clear: !fill && textLike && f.value !== '' && (f.required || f.getAttribute('aria-required') === 'true') });
      });
      info.capped = fields.length > maxFields;
    }
    out.push(info);
    index++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// In the page: the look part.

function readForms(h) {
  const out = [];
  const add = (id, el, message, extra = {}) => out.push({ id, message, selector: h.selector(el), html: h.snippet(el), ...extra });
  const list = (names) => names.slice(0, 4).map((n) => `"${n.slice(0, 40)}"`).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '');
  const required = (f) => f.required || f.getAttribute('aria-required') === 'true';
  const pseudo = (el) => ['::before', '::after'].map((p) => getComputedStyle(el, p).content).filter((c) => c && c !== 'none' && c !== 'normal').join(' ');
  const describedText = (f) => h.clean(h.byIds(f.getAttribute('aria-describedby')).map(h.textOf).join(' '));
  // The box that belongs to one field: its parents up to the first that holds another field.
  const wrapperOf = (f, form) => {
    let w = f;
    for (let n = f.parentElement, i = 0; n && n !== form && i < 3; n = n.parentElement, i++) {
      if (h.fieldsOf(n).some((o) => o !== f && !(o.type === 'radio' && o.name === f.name))) break;
      w = n;
    }
    return w;
  };
  const labelText = (f) => {
    const labels = [...(f.labels || [])];
    return h.clean([h.fieldName(f).name, ...labels.map(pseudo), describedText(f)].join(' '));
  };
  const MARKED = /\*|\brequired\b|\bmandatory\b|\(req\.?\)|\bobligatori[oa]\b|\bobligatoire\b|\berforderlich\b|\bpflichtfeld/i;
  const ALL_REQUIRED = /\ball (fields|questions) (are )?(required|mandatory)\b|\bevery field is required\b/i;
  const STAR_EXPLAINED = /(\*|asterisk)[^.]{0,40}\b(required|mandatory)\b|\b(required|mandatory)[^.]{0,30}(\*|asterisk)/i;
  const GENERIC = /^(field|input|text|textbox|text box|text field|value|enter (text|value|here)|type here|untitled|label|form field|(field|input|question) ?\d+)$/i;
  const FORMAT_HINT = /format|e\.g\.|example|such as|\bdigits?\b|\bcharacters?\b|\bletters?\b|\bnumbers?\b|\d|\b(mm|dd|yy|yyyy|hh)\b|\//i;
  const OTHER_PERSON = /friend|recipient|their|child|kid|guest|emergency|reference|referr|spouse|partner|parent|guardian|attendee|other|manager|supervisor|company|business|organi[sz]ation|employer|search|keyword|promo|coupon|gift|student/i;
  const PURPOSES = [
    [/^(your |full )?name$|^(first|last|given|family|middle|sur) ?name$|^(fname|lname|firstname|lastname|full_?name|your-?name)$/i, 'name'],
    [/e-?mail/i, 'email'],
    [/phone|mobile|telephone|^tel$/i, 'tel'],
    [/street|^address( line)? ?1?$|^(home |mailing |postal )?address$/i, 'street-address'],
    [/^(city|town)$/i, 'address-level2'],
    [/zip|postal|post ?code/i, 'postal-code'],
    [/^country/i, 'country-name'],
  ];
  const captchaIn = (root) => [...root.querySelectorAll('.g-recaptcha, .h-captcha, iframe[src*="recaptcha"], iframe[src*="hcaptcha"], img[src*="captcha" i], img[alt*="captcha" i], img[id*="captcha" i]')]
    .find((el) => h.visible(el) && el.getAttribute('data-size') !== 'invisible' && !/[?&]size=invisible/.test(el.getAttribute('src') || ''));

  const described = describeForms(h, { mark: false });
  const forms = [...document.querySelectorAll('form')].filter((f) => h.fieldsOf(f).length);
  forms.forEach((form, i) => {
    const info = described[i];
    if (!info || info.search) return;
    const fields = h.fieldsOf(form);
    const formText = h.clean(form.innerText);
    const before = form.previousElementSibling ? h.clean(form.previousElementSibling.innerText) : '';

    // 3.3.2: a placeholder is the only label. It disappears as soon as the user types.
    for (const f of fields) {
      if (h.fieldName(f).source === 'placeholder') add('placeholder-only-label', f, `the field "${h.fieldName(f).name}" is labelled only by its placeholder, which disappears as soon as someone types`);
    }

    // 3.3.2 and 1.4.1: required fields have to be marked in text, and the marking has to be
    // in the code too, so screen readers say it.
    const req = fields.filter(required);
    const formSaysAll = ALL_REQUIRED.test(formText) || ALL_REQUIRED.test(before);
    const unmarked = req.filter((f) => !MARKED.test(labelText(f)));
    if (unmarked.length && !formSaysAll) {
      // Labels of required fields in a different color from the others, with no text marker.
      const colorOf = (f) => (f.labels?.[0] ? getComputedStyle(f.labels[0]).color : '');
      const optional = fields.filter((f) => !required(f) && f.labels?.[0]);
      const reqColors = new Set(unmarked.map(colorOf).filter(Boolean));
      const optColors = new Set(optional.map(colorOf));
      if (optional.length && reqColors.size === 1 && ![...reqColors].some((c) => optColors.has(c))) {
        add('required-color-only', unmarked[0], `required fields (${list(unmarked.map((f) => h.fieldName(f).name))}) are told apart from optional ones only by the color of their labels`);
      } else {
        add('required-not-shown', unmarked[0], `${list(unmarked.map((f) => h.fieldName(f).name))} ${unmarked.length === 1 ? 'is' : 'are'} required, but nothing on screen says so before the form is sent`);
      }
    }
    const starOnly = fields.filter((f) => !required(f) && f.type !== 'checkbox' && f.type !== 'radio' && /\*|\brequired\b/i.test(labelText(f)));
    if (starOnly.length && (STAR_EXPLAINED.test(formText) || STAR_EXPLAINED.test(before) || starOnly.some((f) => /\brequired\b/i.test(labelText(f))))) {
      add('required-not-programmatic', starOnly[0], `${list(starOnly.map((f) => h.fieldName(f).name))} ${starOnly.length === 1 ? 'is' : 'are'} marked required on screen, but not with the required or aria-required attribute`);
    }

    // 3.3.2: a format the field insists on, with no instruction about it.
    for (const f of fields) {
      const { name } = h.fieldName(f);
      const hint = [name, f.getAttribute('placeholder'), f.getAttribute('title'), describedText(f), h.clean(wrapperOf(f, form).innerText)].join(' ');
      const datey = /^(text|)$/.test(f.type) && /\b(date|dob|birth ?(day|date)?)\b/i.test(`${name} ${f.name} ${f.id}`);
      if ((f.pattern && /^(text|tel|search|email|url|password|)$/.test(f.type)) || datey) {
        if (!FORMAT_HINT.test(hint)) add('format-no-instruction', f, f.pattern ? `the field "${name}" only accepts a set format (pattern="${f.pattern.slice(0, 40)}") and nothing tells the user what it is` : `the date field "${name}" is a plain text box and does not say how to write the date`);
      }
    }

    // 2.4.6: labels that do not describe the field, and two fields with the same label.
    for (const f of fields) {
      const { name } = h.fieldName(f);
      if (name && GENERIC.test(name)) add('label-generic', f, `the field labelled "${name}" does not say what to enter`);
    }
    const byName = new Map();
    for (const f of fields) {
      if (f.type === 'radio' || f.type === 'checkbox') continue;
      const key = h.fieldName(f).name.toLowerCase();
      if (!key) continue;
      const group = f.closest('fieldset, [role=group], [role=radiogroup]');
      const groupName = group ? h.clean(group.querySelector('legend')?.textContent || group.getAttribute('aria-label') || h.byIds(group.getAttribute('aria-labelledby')).map(h.textOf).join(' ')) : '';
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push({ f, groupName });
    }
    for (const [, same] of byName) {
      if (same.length < 2 || new Set(same.map((s) => s.groupName)).size === same.length) continue;
      add('label-duplicate', same[1].f, `${same.length} fields in this form are all labelled "${h.fieldName(same[0].f).name}", with nothing to tell them apart`);
    }

    // 1.3.5: fields that collect the user's own details, with no autocomplete to say so.
    const missing = [];
    for (const f of fields) {
      if (f.tagName !== 'INPUT' || !/^(text|email|tel)$/.test(f.type)) continue;
      if (info.login && f.type !== 'tel') continue; // credentials are judged by the login checks
      if (f.hasAttribute('autocomplete') && f.getAttribute('autocomplete').trim() !== '') continue;
      const { name } = h.fieldName(f);
      const said = `${name} ${f.name} ${f.id}`;
      if (OTHER_PERSON.test(said)) continue;
      const purpose = f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : PURPOSES.find(([re]) => re.test(name) || re.test(f.name) || re.test(f.id))?.[1];
      if (purpose) missing.push({ f, name: name || f.name, purpose });
    }
    if (missing.length) add('autocomplete-missing', missing[0].f, `${list(missing.map((m) => m.name))} ${missing.length === 1 ? 'asks' : 'ask'} for the user's own details but ${missing.length === 1 ? 'has' : 'have'} no autocomplete attribute (for example autocomplete="${missing[0].purpose}")`);

    // 3.3.5 (AAA): a longer form with no instructions, hints or help link.
    if (fields.length >= 4) {
      const hints = [...form.querySelectorAll('p, small, span, div, li')].some((el) =>
        !el.closest('label, legend, button') && !el.querySelector('p, div, label, input, select, textarea') && h.words(el.textContent).length >= 3 && h.visible(el));
      const helpLink = [...form.querySelectorAll('a[href], button'), ...(form.parentElement ? form.parentElement.querySelectorAll(':scope > a[href], :scope > p a[href]') : [])]
        .some((a) => /help|faq|support|contact|question|how to|guide|instructions/i.test(h.accName(a)));
      const anyDescribed = fields.some((f) => describedText(f) || f.getAttribute('title'));
      if (!hints && !helpLink && !anyDescribed) add('form-no-help', form, `this form has ${fields.length} fields and no instructions, hints or link to help`);
    }

    // 3.3.7: the same information asked twice in one form.
    const tokens = new Map();
    for (const f of fields) {
      const raw = (f.getAttribute('autocomplete') || '').toLowerCase().split(/\s+/).filter((t) => t && !t.startsWith('section-'));
      const token = raw.join(' ');
      if (!token || /^(on|off)$/.test(token) || /(new|current)-password|one-time-code/.test(token)) continue;
      if (!tokens.has(token)) tokens.set(token, []);
      tokens.get(token).push(f);
    }
    const sameAs = fields.some((f) => (f.type === 'checkbox' || f.type === 'radio') && /same|copy|identical|use (my |the )?(shipping|billing|delivery|home)/i.test(h.fieldName(f).name)) ||
      [...form.querySelectorAll('button')].some((b) => /same as|copy (from|my)|use (my |the )?(shipping|billing)/i.test(h.accName(b)));
    const twice = [...tokens].find(([, fs]) => fs.length > 1);
    const ADDRESS = /street-address|address-line1|postal-code|address-level[12]/;
    const billing = [...tokens.keys()].some((t) => t.startsWith('billing ') && ADDRESS.test(t));
    const shipping = [...tokens.keys()].some((t) => t.startsWith('shipping ') && ADDRESS.test(t));
    if (billing && shipping && !sameAs) {
      add('redundant-entry', form, 'the form asks for a billing address and a shipping address with no option to use the same one');
    } else if (twice) {
      const [token, [first, second]] = twice;
      add('redundant-entry', second, `"${h.fieldName(second).name}" asks again for what "${h.fieldName(first).name}" already asked (both autocomplete="${token}")`);
    }

    // 3.3.8 and 3.3.9: logging in.
    if (info.login) {
      const pw = fields.find((f) => f.type === 'password');
      const user = fields.filter((f) => f !== pw && /^(text|email|tel|)$/.test(f.type))[0];
      const off = [user, pw].filter((f) => f && ((f.getAttribute('autocomplete') || form.getAttribute('autocomplete') || '').toLowerCase().trim() === 'off'));
      if (off.length) add('auth-autocomplete-off', off[0], `the login ${off.map((f) => (f === pw ? 'password' : 'username')).join(' and ')} field${off.length > 1 ? 's turn' : ' turns'} off autocomplete, which tells password managers not to fill ${off.length > 1 ? 'them' : 'it'}`);
      const captcha = captchaIn(form) || captchaIn(form.parentElement || form);
      if (captcha) {
        const kind = captcha.tagName === 'IMG' ? 'an image of text to retype' : /h-captcha|hcaptcha/.test(captcha.className + (captcha.getAttribute('src') || '')) ? 'an hCaptcha puzzle' : 'a reCAPTCHA puzzle';
        add('auth-captcha', captcha, `logging in requires ${kind}; object recognition is allowed at AA, but retyping text or solving a puzzle is not unless there is another way to log in`);
        add('auth-captcha-enhanced', captcha, `logging in requires ${kind}, a test of memory or perception that AAA does not allow without another way to log in`);
      }
    }
  });

  // 4.1.3: an empty or hidden box named like a place for messages, which is not a live
  // region. Whatever a script writes into it later is not announced.
  const TOAST = /^(toast|toasts|toaster|snackbar|flash|flash-messages?|notifications?|notice|alerts?|status-message|messages|form-status|form-message|feedback)$/i;
  const LIVE = '[aria-live]:not([aria-live=off]), [role=alert], [role=status], [role=log], [role=alertdialog], output';
  const boxes = [];
  for (const el of document.body.querySelectorAll('div, span, p, section, aside, ul')) {
    const tokens = [el.id, ...(typeof el.className === 'string' ? el.className.split(/\s+/) : [])].filter(Boolean);
    if (!tokens.some((t) => TOAST.test(t))) continue;
    if (el.closest(LIVE) || el.querySelector(LIVE) || el.closest('form, nav, [role=dialog], dialog')) continue;
    if (h.clean(el.textContent) && h.shown(el)) continue; // a message already on screen when the page loaded
    if (boxes.some((b) => b.contains(el))) continue;
    boxes.push(el);
    out.push({ id: 'status-not-live', message: `"${h.selector(el)}" looks like a place for messages (toasts, alerts or notices) but is not a live region, so what appears in it is not announced`, selector: h.selector(el), html: h.snippet(el) });
  }
  return out;
}

// Starts recording text that appears or changes on the page while other checks press keys
// and open things, so the operate part can see status messages that were not announced.
function watchChanges() {
  if (window.__accessready_changes) return;
  const seen = [];
  Object.defineProperty(window, '__accessready_changes', { value: seen, configurable: true });
  // The text is kept as it was at the time: a toggle that is closed again afterwards puts the
  // old text back, but the message was still shown and not announced.
  const note = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return;
    const text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    const known = seen.find((s) => s.el === el);
    // Only changes right after a key press or click count, so content the page renders by
    // itself before anyone touches it is left out.
    const acted = navigator.userActivation ? navigator.userActivation.isActive : true;
    if (known) {
      if (acted && text && !known.texts.includes(text) && known.texts.length < 5) known.texts.push(text);
      return;
    }
    if (seen.length >= 300 || !acted) return;
    seen.push({ el, texts: text ? [text] : [], focusInside: el.contains(document.activeElement) && document.activeElement !== document.body });
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') note(r.target);
      else if (r.type === 'childList') r.addedNodes.forEach(note);
      else if (r.type === 'attributes') note(r.target);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
  Object.defineProperty(window, '__accessready_observer', { value: observer, configurable: true });
}

function readChanges(h) {
  const changes = window.__accessready_changes || [];
  window.__accessready_observer?.disconnect();
  const STATUS = /\b(\d+ (results?|items?|matches|products|records|entries|programs|events|jobs)( found| shown)?|no (results|matches)|showing \d+|added to|removed from|saved|updated|copied|sent|submitted|subscribed|success(fully)?|thank you|failed|error)\b/i;
  const TOAST = /\b(toast|snackbar|flash|notification|notice|status|alert)\b/i;
  const LIVE = '[aria-live]:not([aria-live=off]), [role=alert], [role=status], [role=log], [role=alertdialog], [role=timer], output';
  const OWNED = [...document.querySelectorAll('[aria-expanded][aria-controls]')].flatMap((t) => h.byIds(t.getAttribute('aria-controls')));
  const out = [];
  const reported = [];
  for (const { el, texts, focusInside } of changes) {
    if (!el.isConnected || focusInside || !h.visible(el)) continue;
    if (el.closest(LIVE) || el.closest('dialog, [role=dialog], [role=menu], [role=listbox], [role=tooltip], button, a, label, nav') || el.contains(document.activeElement)) continue;
    if (OWNED.some((o) => o.contains(el))) continue;
    const cls = `${el.id} ${typeof el.className === 'string' ? el.className : ''}`;
    const text = texts.find((t) => t.length >= 2 && t.length <= 200 && STATUS.test(t)) || (TOAST.test(cls) ? texts.find((t) => t.length >= 2 && t.length <= 200) : null);
    if (!text) continue;
    if (reported.some((r) => r.contains(el) || el.contains(r))) continue;
    reported.push(el);
    out.push({ id: 'status-not-live', message: `"${text.slice(0, 60)}" appeared while the page was being used, without taking focus and outside any live region, so screen readers do not announce it`, selector: h.selector(el), html: h.snippet(el) });
    if (out.length >= 3) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// In the copy: the operate part.

function pasteBlocked(h, i) {
  const form = document.querySelector(`[data-accessready-form="${i}"]`);
  if (!form) return [];
  const fields = h.fieldsOf(form);
  const pw = fields.find((f) => f.type === 'password');
  const user = fields.filter((f) => f !== pw && /^(text|email|tel|)$/.test(f.type))[0];
  const blocked = [];
  for (const f of [user, pw].filter(Boolean)) {
    let data = null;
    try { data = new DataTransfer(); data.setData('text/plain', 'x'); } catch { /* older engines */ }
    let ev;
    try { ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }); } catch { ev = new Event('paste', { bubbles: true, cancelable: true }); }
    f.focus();
    const allowed = f.dispatchEvent(ev);
    if (!allowed || ev.defaultPrevented) blocked.push({ which: f === pw ? 'password' : 'username', selector: h.selector(f), html: h.snippet(f) });
  }
  document.activeElement?.blur?.();
  return blocked;
}

const STYLE_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor',
  'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth', 'borderTopStyle', 'borderBottomStyle', 'outlineStyle', 'outlineWidth', 'boxShadow', 'backgroundImage', 'textDecorationLine'];
const COLOR_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor'];

function snapshot(h, { i, props }) {
  const own = (el) => h.clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
  const state = new WeakMap();
  for (const el of document.body.querySelectorAll('*')) state.set(el, { text: own(el), shown: h.shown(el) });
  const styles = {}, pseudo = {};
  // Text drawn by CSS (::before or ::after content) on the field's label or wrapper.
  const pseudoText = (f) => [f.labels?.[0], f.parentElement].filter(Boolean).flatMap((el) => ['::before', '::after'].map((p) => getComputedStyle(el, p).content))
    .filter((c) => c && c !== 'none' && c !== 'normal' && c !== '""').join(' ');
  for (const f of document.querySelectorAll(`[data-accessready-form="${i}"] [data-accessready-field]`)) {
    const read = (el) => (el ? props.map((p) => getComputedStyle(el)[p]) : []);
    const k = f.getAttribute('data-accessready-field');
    styles[k] = [read(f), read(f.labels?.[0]), read(f.parentElement)];
    pseudo[k] = pseudoText(f);
  }
  Object.defineProperty(window, '__accessready_snap', { value: { state, styles, pseudo, pseudoText }, configurable: true });
  document.activeElement?.blur?.();
}

function judge(h, { i, props, colorProps, filled, realSubmit }) {
  const form = document.querySelector(`[data-accessready-form="${i}"]`);
  const snap = window.__accessready_snap;
  if (!form || !snap) return { gone: true };
  const own = (el) => h.clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
  const LIVE = '[aria-live]:not([aria-live=off]), [role=alert], [role=status], [role=log], [role=alertdialog], output';
  const fields = [...form.querySelectorAll('[data-accessready-field]')];
  const required = (f) => f.required || f.getAttribute('aria-required') === 'true';
  const empty = (f) => (f.type === 'checkbox' || f.type === 'radio' ? !form.querySelector(`[name="${CSS.escape(f.name)}"]:checked`) && !f.checked : f.value === '');

  // Text that appeared or changed, outside buttons and the fields themselves.
  const changed = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('button, [role=button], script, style, select, option, textarea') || !h.visible(el)) continue;
    const t = own(el);
    if (!t) continue;
    const prev = snap.state.get(el);
    if (prev && prev.text === t && prev.shown) continue;
    if (changed.some((c) => c.el.contains(el))) continue;
    changed.push({ el, text: h.clean(el.innerText || t), live: !!el.closest(LIVE) });
  }

  const problems = [];
  for (const f of fields) {
    const k = f.getAttribute('data-accessready-field');
    const wasFilled = filled.includes(k);
    if (!wasFilled && !(required(f) && empty(f))) continue;
    if (f.type === 'radio' && problems.some((p) => p.radio === f.name)) continue;
    const linkedEls = [...h.byIds(`${f.getAttribute('aria-describedby') || ''} ${f.getAttribute('aria-errormessage') || ''}`), ...(f.labels || [])];
    const linked = changed.filter((c) => linkedEls.some((l) => l.contains(c.el) || c.el.contains(l)));
    // The box around this field, up to the first parent that holds another field.
    let wrap = f;
    for (let n = f.parentElement, d = 0; n && n !== form.parentElement && d < 3; n = n.parentElement, d++) {
      if ([...n.querySelectorAll('[data-accessready-field]')].some((o) => o !== f && !(o.type === 'radio' && o.name === f.name))) break;
      wrap = n;
    }
    const fr = f.getBoundingClientRect();
    const near = changed.filter((c) => {
      if (wrap.contains(c.el)) return true;
      const r = c.el.getBoundingClientRect();
      return r.top >= fr.top - 40 && r.top <= fr.bottom + 48 && r.left < fr.right && r.right > fr.left;
    });
    const drawn = snap.pseudoText(f);
    if (drawn && drawn !== snap.pseudo[k]) near.push({ el: f, text: drawn.replace(/^"|"$/g, '') });
    const before = snap.styles[k] || [];
    const now = [f, f.labels?.[0], f.parentElement].map((el) => (el ? props.map((p) => getComputedStyle(el)[p]) : []));
    let style = 'none';
    for (let e = 0; e < now.length; e++) for (let p = 0; p < props.length; p++) {
      if (!before[e] || before[e][p] === now[e][p]) continue;
      if (colorProps.includes(props[p])) { if (style === 'none') style = 'color'; } else style = 'other';
    }
    problems.push({
      k, name: h.fieldName(f).name || f.name || f.type, kind: wasFilled ? 'invalid' : 'empty', radio: f.type === 'radio' ? f.name : null,
      invalid: f.getAttribute('aria-invalid') === 'true', linked: linked.length > 0, near: near.length > 0,
      message: h.clean((linked[0] || near[0])?.text || ''), style, selector: h.selector(f), html: h.snippet(f),
    });
  }
  const active = document.activeElement;
  const focus = active && active !== document.body && active.hasAttribute('data-accessready-field') && problems.some((p) => p.k === active.getAttribute('data-accessready-field')) ? 'field'
    : active && changed.some((c) => c.el.contains(active) || active.contains(c.el)) ? 'message' : 'other';
  return {
    gone: false,
    nativeBlocked: realSubmit && !form.noValidate && !form.checkValidity(),
    problems,
    texts: changed.map((c) => ({ text: c.text.slice(0, 200), live: c.live })),
    focus,
  };
}

const VAGUE_ERROR = /^(this (field|value|entry) is )?(invalid|not valid|incorrect|wrong|error|bad (input|value)|invalid (input|value|entry|format|data)|please correct( this)?( field)?|check this field|not allowed|try again)[.!]?$/i;
const HELPFUL = /@|example|format|e\.g\.|such as|must|should|use |include|like |digits|characters|letters|between|at least|no more than|\d/i;
// An error message that says something is wrong without saying what right looks like. The
// field's own name is taken out first, so "Email: invalid" counts as just "invalid".
function isVague(message, name) {
  const bare = message.toLowerCase().split(name.toLowerCase()).join(' ').replace(/^[\s:,.-]+|[\s:,.-]+$/g, '').trim();
  if (VAGUE_ERROR.test(bare)) return true;
  return !HELPFUL.test(message) && bare.split(/\s+/).length <= 3 && /invalid|error|wrong|incorrect|not valid/i.test(bare);
}

async function attemptForms(page, ctx) {
  if (!ctx.result.review?.forms?.length) return [];
  const issue = await loadIssue();
  const guard = { armed: false, sent: [] };
  let copy;
  try {
    copy = await ctx.fresh({ serviceWorkers: 'block', prepare: (context) => blockOutgoing(context, guard) });
  } catch (e) {
    return { issues: [], notes: [`the form check could not open a safe copy of the page: ${String(e.message).split('\n')[0]}`] };
  }
  guard.armed = true;
  const dialogs = [];
  copy.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
  copy.context().on('page', (p) => p.close().catch(() => {}));

  const issues = [], notes = [];
  const forms = await inPage(copy, describeForms, { mark: true, maxForms: MAX_FORMS, maxFields: MAX_FIELDS });
  const tryable = forms.filter((f) => !f.search);
  // The copy refuses anything but GET while it loads; a page that builds its forms from a
  // POST request (some GraphQL sites) may show fewer of them.
  if (forms.length < ctx.result.review.forms.length) notes.push(`the safe copy of the page showed ${forms.length} of its ${ctx.result.review.forms.length} forms; the others were not tried`);
  if (tryable.length > MAX_FORMS) notes.push(`${tryable.length} forms on this page; the first ${MAX_FORMS} were tried with mistakes`);

  for (const form of tryable.filter((f) => f.plan)) {
    if (form.capped) notes.push(`the form "${form.name || form.selector}" has more than ${MAX_FIELDS} fields; the first ${MAX_FIELDS} were tried`);
    const where = { selector: form.selector, html: form.html };

    // 3.3.8: paste into the login fields. Password managers and people who cannot remember
    // a password both rely on it.
    if (form.login) {
      for (const b of await inPage(copy, pasteBlocked, form.index)) {
        issues.push(issue('auth-paste-blocked', { message: `the login ${b.which} field cancels paste, so a password cannot be pasted from a password manager or a note`, selector: b.selector, html: b.html }));
      }
    }
    if (!form.hasSubmit || form.submitDisabled) continue;

    const filled = [];
    for (const step of form.plan) {
      const field = copy.locator(`[data-accessready-field="${form.index}-${step.k}"]`);
      if (step.fill !== null && await field.fill(step.fill, { timeout: 1500 }).then(() => true, () => false)) filled.push(`${form.index}-${step.k}`);
      else if (step.clear) await field.fill('', { timeout: 1500 }).catch(() => {});
    }
    await inPage(copy, snapshot, { i: form.index, props: STYLE_PROPS });
    const sentBefore = guard.sent.length;
    dialogs.length = 0;
    const submit = copy.locator(`[data-accessready-submit="${form.index}"]`);
    if (!await submit.click({ timeout: 2000 }).then(() => true, () => false)) {
      await submit.focus({ timeout: 1000 }).catch(() => {});
      await copy.keyboard.press('Enter').catch(() => {});
    }
    await copy.waitForTimeout(SETTLE);
    const look = () => inPage(copy, judge, { i: form.index, props: STYLE_PROPS, colorProps: COLOR_PROPS, filled, realSubmit: form.realSubmit }).catch(() => ({ gone: true }));
    let r = await look();
    // Before calling a form silent, give a slow message (a fade, a check that waits) more time.
    const quiet = (x) => !x.gone && !x.nativeBlocked && x.problems.length && !x.texts.length && !dialogs.length && x.problems.every((p) => p.style === 'none' && !p.near);
    if (quiet(r) && !guard.sent.slice(sentBefore).some(isSend)) { await copy.waitForTimeout(SETTLE * 2); r = await look(); }
    const sends = guard.sent.slice(sentBefore).filter(isSend);
    if (r.gone) { notes.push(`the page changed after the form "${form.name || form.selector}" was tried; the remaining forms were not tried`); break; }

    const posts = sends.some((s) => s.method !== 'GET' && s.method !== 'HEAD' || s.type === 'fetch' || s.type === 'xhr' || s.type === 'websocket') || form.method === 'post';
    if (sends.length) {
      // It tried to send what it was given: empty required fields and nonsense. Anything the
      // server would have said about that was never seen.
      if (r.problems.length) notes.push(`the form "${form.name || form.selector}" tried to send with ${r.problems.length} field${r.problems.length === 1 ? '' : 's'} empty or invalid; accessready stopped the request, so errors that only the server reports were not seen`);
      if (form.financial && form.finalAction && !form.confirmBox) {
        issues.push(issue('error-prevention-financial', { ...where, message: `"${form.submitText}" sent the form straight away with ${r.problems.length ? 'empty or invalid fields' : 'every field left empty'}: no check, no review step and no confirmation box before a payment or commitment` }));
      } else if (posts && form.finalAction && !form.confirmBox) {
        issues.push(issue('error-prevention-all', { ...where, message: `"${form.submitText || 'Submit'}" sent the form straight away with ${r.problems.length ? 'empty or invalid fields' : 'every field left empty'}: nothing was checked, reviewed or confirmed first` }));
      }
      continue;
    }
    if (r.nativeBlocked || !r.problems.length) continue; // the browser's own messages identify the field

    const texts = [...r.texts.map((t) => t.text), ...dialogs].join(' ').toLowerCase();
    const named = (p) => p.name && texts.includes(p.name.toLowerCase().replace(/[*:]/g, '').trim());
    const unidentified = r.problems.filter((p) => !p.linked && !p.near && !named(p));
    const names = (ps) => ps.slice(0, 4).map((p) => `"${p.name}"`).join(', ') + (ps.length > 4 ? ` and ${ps.length - 4} more` : '');
    const colorOnly = unidentified.filter((p) => p.style === 'color');
    const silent = unidentified.filter((p) => p.style !== 'color');
    const nothing = !r.texts.length && !dialogs.length;
    if (colorOnly.length) {
      issues.push(issue('form-error-color-only', { message: `after "${form.submitText || 'submit'}", ${names(colorOnly)} ${colorOnly.length === 1 ? 'is' : 'are'} marked as wrong only by a change of color, with no text`, selector: colorOnly[0].selector, html: colorOnly[0].html }));
    }
    if (silent.length) {
      const what = nothing && silent.every((p) => p.style === 'none') ? 'the form did not send and nothing on screen changed'
        : nothing ? 'the form did not send and no error text appeared'
        : 'a message appeared, but it does not say which field is wrong';
      issues.push(issue('form-error-silent', { message: `after "${form.submitText || 'submit'}" with ${names(silent)} ${silent.every((p) => p.kind === 'empty') ? 'left empty' : 'empty or invalid'}, ${what}`, selector: silent[0].selector, html: silent[0].html }));
    }
    const notLinked = r.problems.filter((p) => p.near && !p.linked);
    if (notLinked.length) {
      issues.push(issue('form-error-not-linked', { message: `the error shown next to ${names(notLinked)} ("${notLinked[0].message.slice(0, 60)}") is not tied to the field with aria-describedby or aria-errormessage${notLinked[0].invalid ? '' : ', and the field is not marked aria-invalid'}`, selector: notLinked[0].selector, html: notLinked[0].html }));
    }
    const vague = r.problems.filter((p) => p.kind === 'invalid' && p.message && isVague(p.message, p.name));
    if (vague.length) {
      issues.push(issue('form-error-vague', { message: `the error for ${names(vague)} says only "${vague[0].message.slice(0, 60)}", not what a valid entry looks like`, selector: vague[0].selector, html: vague[0].html }));
    }
    if (r.texts.length && !dialogs.length && !r.texts.some((t) => t.live) && r.focus === 'other') {
      issues.push(issue('form-error-not-announced', { ...where, message: `error messages appeared after "${form.submitText || 'submit'}" ("${r.texts[0].text.slice(0, 60)}"), but focus stayed where it was and none of them is in a live region, so a screen reader says nothing` }));
    }
  }
  await copy.context().close().catch(() => {});
  return { issues, notes };
}

export const probes = [
  {
    name: 'form fields', phase: 'look',
    async run(page) {
      const issue = await loadIssue();
      const found = await inPage(page, readForms, null, [describeForms]);
      await page.evaluate(watchChanges);
      return found.map(({ id, ...fields }) => issue(id, fields));
    },
  },
  {
    name: 'status messages', phase: 'operate',
    async run(page) {
      const issue = await loadIssue();
      return (await inPage(page, readChanges)).map(({ id, ...fields }) => issue(id, fields));
    },
  },
  // Not `isolated`: that would load every page a second time. This opens its own blocked
  // copy through ctx.fresh, and only when the page has a form.
  { name: 'form errors', phase: 'operate', run: attemptForms },
];

export const rules = {
  'form-error-silent': {
    title: 'Form error is not identified in text', criteria: ['3.3.1'], kinds: ['likely'],
    covers: 'Each form is tried with required fields empty and nonsense in typed fields. A form that refuses to send without saying in text which field is wrong is flagged.',
    why: 'If a form will not send and nothing says why, people with low vision, cognitive disabilities or screen readers are stuck, with no way to find the field to fix.',
  },
  'form-error-color-only': {
    title: 'Form error is shown by color alone', criteria: ['1.4.1', '3.3.1'], kinds: ['likely'],
    covers: 'After a failed submit, fields whose only sign of error is a change of color (a red border) with no text are flagged.',
    why: 'People who cannot tell red from other colors, and screen reader users, do not see a color change, so they never learn which field is wrong.',
  },
  'form-error-not-linked': {
    title: 'Error message is not tied to its field', criteria: ['3.3.1', '1.3.1'], kinds: ['likely'],
    covers: 'Error text that appears next to a field but is not connected to it with aria-describedby or aria-errormessage.',
    why: 'A screen reader user moving to the field hears its label but not the error printed beside it, so they do not know what is wrong.',
  },
  'form-error-not-announced': {
    title: 'Form errors appear without being announced', criteria: ['4.1.3'], kinds: ['likely'],
    covers: 'Error messages that appear after a failed submit while focus stays put and nothing is in a live region.',
    why: 'Screen reader users only hear what is announced. If errors appear silently and focus does not move to them, they think the form was sent.',
  },
  'form-error-vague': {
    title: 'Error message does not say how to fix it', criteria: ['3.3.3'], kinds: ['likely'],
    covers: 'Errors for typed fields (email, web address, numbers with limits, patterns) that only say "invalid" or similar, with no example or rule.',
    why: 'People with cognitive or learning disabilities need to be told what a valid entry looks like, not only that theirs is wrong.',
  },
  'placeholder-only-label': {
    title: 'Field is labelled only by its placeholder', criteria: ['3.3.2'], kinds: ['likely'],
    covers: 'Fields with a placeholder and no label, aria-label, aria-labelledby or title.',
    why: 'Placeholder text vanishes when typing starts, often has low contrast, and people with memory or attention difficulties lose track of what the field was for.',
  },
  'required-not-shown': {
    title: 'Required field is not marked on screen', criteria: ['3.3.2'], kinds: ['likely'],
    covers: 'Fields with required or aria-required whose label, description and surrounding text carry no asterisk or "required", in a form that does not say all fields are required.',
    why: 'People find out a field was required only after the form is rejected, which costs everyone time and can strand people who struggle to find the error.',
  },
  'required-color-only': {
    title: 'Required fields are marked by color alone', criteria: ['1.4.1', '3.3.2'], kinds: ['likely'],
    covers: 'Forms where the labels of required fields differ from optional ones only in color, with no asterisk or text.',
    why: 'People who are color blind and screen reader users cannot tell which fields are required.',
  },
  'required-not-programmatic': {
    title: 'Required field is not marked in the code', criteria: ['1.3.1'], kinds: ['likely'],
    covers: 'Fields shown as required with an asterisk or the word "required" that have neither the required nor the aria-required attribute.',
    why: 'Screen readers announce a field as required from the attribute. Without it, the user may hear only "star" or nothing at all.',
  },
  'format-no-instruction': {
    title: 'Field expects a format nobody explains', criteria: ['3.3.2'], kinds: ['likely'],
    covers: 'Fields with a pattern attribute, and date fields that are plain text boxes, with no format instruction in the label, placeholder, title or description.',
    why: 'People have to guess the format, then guess again after an error. People with cognitive disabilities may not get past it.',
  },
  'label-generic': {
    title: 'Field label does not describe it', criteria: ['2.4.6'], kinds: ['likely'],
    covers: 'Fields labelled "Field", "Input", "Text", "Field 2" and similar.',
    why: 'Screen reader users hear the label instead of seeing the layout around the field, so a generic label tells them nothing.',
  },
  'label-duplicate': {
    title: 'Two fields have the same label', criteria: ['2.4.6'], kinds: ['likely'],
    covers: 'Fields in one form with the same label and no group (fieldset with legend, or labelled group) to tell them apart.',
    why: 'A screen reader user who hears "Name" twice cannot tell which is theirs and which is someone else\'s.',
  },
  'autocomplete-missing': {
    title: 'Personal detail field has no autocomplete', criteria: ['1.3.5'], kinds: ['likely'],
    covers: 'Fields that ask for the user\'s own name, email, phone or address (by type, label, name or id) with no autocomplete attribute.',
    why: 'Autocomplete lets browsers fill in details and lets assistive tools show familiar icons, which matters most for people with memory, motor or cognitive disabilities.',
  },
  'form-no-help': {
    title: 'Form has no instructions or help', criteria: ['3.3.5'], kinds: ['likely'],
    covers: 'Forms with four or more fields and no instructions, hints, field descriptions or link to help.',
    why: 'People with cognitive disabilities and people new to a process need to know what each field wants before they get it wrong.',
  },
  'error-prevention-financial': {
    title: 'Payment or commitment is sent with no check or review', criteria: ['3.3.4', '3.3.6'], kinds: ['likely'],
    covers: 'Forms that take payment or a legal commitment (card fields, "Pay", "Purchase", "Donate", "Sign") that send at once with empty or invalid fields and offer no review step or confirmation box.',
    why: 'A mistyped amount or a wrong click is costly. People with motor, reading or cognitive disabilities make these slips more often and need a chance to catch them.',
  },
  'error-prevention-all': {
    title: 'Form is sent with no check or review', criteria: ['3.3.6'], kinds: ['likely'],
    covers: 'Forms that post data and send at once with empty or invalid fields, with no review step or confirmation box.',
    why: 'Without a check or a review step, a slip goes straight through, and the user may not be able to undo it.',
  },
  'redundant-entry': {
    title: 'Form asks for the same information twice', criteria: ['3.3.7'], kinds: ['likely'],
    covers: 'Two fields in one form with the same autocomplete purpose (except passwords), and billing plus shipping addresses with no "same as" option.',
    why: 'Typing the same thing twice is extra work and extra error for people with motor or cognitive disabilities and for anyone using a switch or voice.',
  },
  'auth-paste-blocked': {
    title: 'Login field blocks paste', criteria: ['3.3.8', '3.3.9'], kinds: ['likely'],
    covers: 'A paste event is sent to the username and password fields of each login form; fields that cancel it are flagged.',
    why: 'People who cannot remember or transcribe a password rely on pasting it from a password manager. Blocking paste makes them retype it from memory.',
  },
  'auth-autocomplete-off': {
    title: 'Login field turns off autocomplete', criteria: ['3.3.8', '3.3.9'], kinds: ['likely'],
    covers: 'Login username or password fields with autocomplete="off", on the field or the form.',
    why: 'It tells password managers not to fill the field, which pushes people with memory or cognitive disabilities back to remembering the password.',
  },
  'auth-captcha': {
    title: 'Login requires a CAPTCHA', criteria: ['3.3.8'], kinds: ['likely'],
    covers: 'Visible reCAPTCHA, hCaptcha or image-of-text CAPTCHAs on a login form. Object recognition is allowed at AA, so a person confirms which kind it is and whether there is another way in.',
    why: 'Puzzles and distorted text are tests of perception and memory that many people with cognitive, learning or vision disabilities cannot pass.',
  },
  'auth-captcha-enhanced': {
    title: 'Login requires a CAPTCHA (enhanced)', criteria: ['3.3.9'], kinds: ['likely'],
    covers: 'Any visible CAPTCHA on a login form, including object recognition, which AAA does not allow without another way to log in.',
    why: 'Even picking out pictures of objects is a cognitive test some people cannot pass.',
  },
  'status-not-live': {
    title: 'Status message is not announced', criteria: ['4.1.3'], kinds: ['likely'],
    covers: 'Text that looks like a status message (results counts, "added", "saved", errors, toasts) appearing while other checks use the page, without focus and outside a live region; and empty message containers that are not live regions.',
    why: 'Screen reader users only learn about a change that is announced. A silent "added to cart" or "3 results" leaves them guessing whether anything happened.',
  },
};
