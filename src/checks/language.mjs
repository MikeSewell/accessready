// Language and readability. The page's text is read in the browser, then judged here in
// Node: franc-min detects the language from letter patterns, and a Flesch-Kincaid grade is
// computed for English text.
// Language detection is only trusted on long text, and only when the declared language is
// one franc-min knows. A page in Catalan detected as Spanish would otherwise look wrong.
import { francAll } from 'franc-min';
import { inPage, loadIssue } from './inpage.mjs';

const PAGE_MIN_LETTERS = 400; // enough text for the whole page's language to be certain
const PART_MIN_LETTERS = 120; // shortest passage judged on its own
const PART_MIN_WORDS = 20;
const PAGE_DECLARED_MAX = 0.85; // franc's score for the declared language, relative to the best
const PART_DECLARED_MAX = 0.8;
const MAX_PARTS = 5;
const MAX_ABBREVIATIONS = 6;
const READING_MIN_WORDS = 100;
const READING_GRADE = 9; // the end of lower secondary education

// franc-min's ISO 639-3 codes and the BCP 47 primary language subtag a page would use.
// Several 639-3 codes share a macrolanguage tag (Arabic, Persian, Malay, Chinese).
const BCP47 = {
  eng: 'en', spa: 'es', por: 'pt', ind: 'id', fra: 'fr', deu: 'de', jav: 'jv', vie: 'vi', ita: 'it', tur: 'tr', pol: 'pl',
  swh: 'sw', sun: 'su', ron: 'ro', hau: 'ha', fuv: 'ff', bos: 'bs', hrv: 'hr', nld: 'nl', srp: 'sr', ckb: 'ckb', yor: 'yo',
  uzn: 'uz', zlm: 'ms', ibo: 'ig', ceb: 'ceb', tgl: 'tl', hun: 'hu', azj: 'az', ces: 'cs', run: 'rn', plt: 'mg', qug: 'qu',
  mad: 'mad', nya: 'ny', zyb: 'za', kin: 'rw', zul: 'zu', swe: 'sv', lin: 'ln', som: 'so', hms: 'hms', hnj: 'hnj', ilo: 'ilo',
  rus: 'ru', ukr: 'uk', koi: 'kv', bel: 'be', bul: 'bg', kaz: 'kk', arb: 'ar', urd: 'ur', pes: 'fa', skr: 'skr', pbu: 'ps',
  hin: 'hi', mar: 'mr', mai: 'mai', bho: 'bho', npi: 'ne', mag: 'mag', cmn: 'zh', jpn: 'ja', kor: 'ko', tha: 'th', ben: 'bn',
  tel: 'te', tam: 'ta', guj: 'gu', kan: 'kn', mal: 'ml', mya: 'my', pan: 'pa', amh: 'am', sin: 'si', ell: 'el', khm: 'km',
  kat: 'ka', hye: 'hy', heb: 'he', ori: 'or', lao: 'lo', bod: 'bo', tir: 'ti', div: 'dv', iii: 'ii', chr: 'chr',
};
// Tags that mean the same language for this purpose, and languages franc cannot tell apart.
const SAME = [['he', 'iw'], ['id', 'in'], ['ms', 'zlm'], ['tl', 'fil'], ['ku', 'ckb'], ['sw', 'swh'], ['bs', 'hr', 'sr', 'sh'], ['id', 'ms'], ['hi', 'mr', 'ne', 'mai', 'bho', 'mag'], ['fa', 'prs'], ['no', 'nb', 'nn']];
const NAMES = { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian', nl: 'Dutch', pl: 'Polish', ru: 'Russian', uk: 'Ukrainian', tr: 'Turkish', vi: 'Vietnamese', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', ar: 'Arabic', hi: 'Hindi', sv: 'Swedish', ro: 'Romanian', hu: 'Hungarian', cs: 'Czech', el: 'Greek', he: 'Hebrew', th: 'Thai', id: 'Indonesian', tl: 'Tagalog', fa: 'Persian', bn: 'Bengali', sw: 'Swahili' };
const KNOWN = new Set(Object.values(BCP47));

const primary = (tag) => String(tag || '').trim().toLowerCase().split(/[-_]/)[0];
const same = (a, b) => a === b || SAME.some((g) => g.includes(a) && g.includes(b));
const nameOf = (tag) => NAMES[tag] || tag;
const letters = (s) => (s.match(/\p{L}/gu) || []).length;

// The best language for a text, and how close the declared one came.
function detect(text, declared) {
  const ranked = francAll(text, { minLength: 10 });
  const [code] = ranked[0] || ['und'];
  if (code === 'und' || !BCP47[code]) return null;
  const declaredScore = Math.max(0, ...ranked.filter(([c]) => BCP47[c] && same(BCP47[c], declared)).map(([, s]) => s));
  return { tag: BCP47[code], declaredScore };
}

function readText(h) {
  const pageLang = document.documentElement.getAttribute('lang') || '';
  // Table cells hold names and figures, and placeholder Latin is not a language error.
  const blocks = h.blocks().filter((el) => !el.matches('td, th') && !/lorem ipsum/i.test(el.textContent)).map((el) => ({
    text: h.clean(el.innerText), lang: el.closest('[lang]')?.getAttribute('lang') ?? '', ownLang: el.hasAttribute('lang'),
    list: el.tagName === 'LI', heading: /^H\d$/.test(el.tagName), selector: h.selector(el), html: h.snippet(el),
  })).filter((b) => b.text);

  // Abbreviations: words in capitals, outside abbr, code and text set in capitals throughout.
  const expanded = new Set([...document.querySelectorAll('abbr[title], acronym[title], dfn')].map((a) => h.clean(a.textContent)));
  const all = h.clean(document.body.innerText);
  const candidates = [];
  const seen = new Set();
  for (const el of h.blocks()) {
    const text = el.innerText;
    const lettersIn = text.match(/\p{L}/gu) || [];
    if (lettersIn.length < 12 || lettersIn.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length / lettersIn.length > 0.5) continue;
    if (getComputedStyle(el).textTransform === 'uppercase') continue;
    for (const m of text.matchAll(/\b[A-Z][A-Z0-9&]{1,6}s?\b/g)) {
      const word = m[0].replace(/s$/, '');
      if (seen.has(word) || /^[IVX]+$/.test(word) || /^(AM|PM|OK)$/.test(word) || /^\d/.test(word) || word.length < 2) continue;
      seen.add(word);
      if (expanded.has(word) || el.querySelector('abbr, acronym, code, kbd') && [...el.querySelectorAll('abbr, acronym, code, kbd')].some((a) => h.clean(a.textContent) === word)) continue;
      // Expanded in the text: "Federal Emergency Management Agency (FEMA)" or "FEMA (Federal ...)".
      const esc = word.replace(/[&]/g, '\\$&');
      if (new RegExp(`\\(\\s*${esc}s?\\s*\\)`).test(all) || new RegExp(`\\b${esc}s?\\s*\\((?!\\s*\\d)[^)]{4,}\\)`).test(all)) continue;
      candidates.push({ word, selector: h.selector(el), html: h.snippet(el) });
    }
  }
  return { pageLang, blocks, abbreviations: candidates };
}

// Flesch-Kincaid grade level, with a syllable count by vowel groups.
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function readingGrade(texts) {
  let sentences = 0, words = 0, syl = 0;
  for (const { text, list } of texts) {
    const ws = text.split(/\s+/).filter((w) => /[a-z]/i.test(w));
    if (!ws.length) continue;
    const ends = (text.match(/[.!?]+(\s|$)/g) || []).length;
    sentences += Math.max(ends, list ? 1 : 0) || 1;
    words += ws.length;
    syl += ws.reduce((n, w) => n + syllables(w), 0);
  }
  if (!words) return { grade: 0, words: 0 };
  return { grade: 0.39 * (words / sentences) + 11.8 * (syl / words) - 15.59, words };
}

async function lookAtLanguage(page, ctx) {
  const issue = await loadIssue();
  const { pageLang, blocks, abbreviations } = await inPage(page, readText);
  const issues = [], notes = [];
  const declared = primary(pageLang);

  // 3.1.1: the language of the page's own text, against the lang attribute. Missing and
  // invalid lang attributes are axe-core's; this catches a valid one that is wrong.
  const own = blocks.filter((b) => same(primary(b.lang), declared));
  const pageText = own.map((b) => b.text).join('\n');
  let pageWrong = false;
  let detected = null;
  if (declared && KNOWN.has(declared) && letters(pageText) >= PAGE_MIN_LETTERS) {
    detected = detect(pageText, declared);
    if (detected && !same(detected.tag, declared) && detected.declaredScore < PAGE_DECLARED_MAX) {
      pageWrong = true;
      issues.push(issue('page-lang-mismatch', { selector: 'html', html: `<html lang="${pageLang}">`, message: `the page says lang="${pageLang}" (${nameOf(declared)}), but its text reads as ${nameOf(detected.tag)}` }));
    }
  }

  // 3.1.2: a passage in another language with no lang attribute of its own.
  if (!pageWrong) {
    let parts = 0;
    for (const b of blocks) {
      const effective = primary(b.lang);
      if (!effective || !KNOWN.has(effective) || letters(b.text) < PART_MIN_LETTERS || b.text.split(/\s+/).length < PART_MIN_WORDS) continue;
      const d = detect(b.text, effective);
      if (!d || same(d.tag, effective) || d.declaredScore >= PART_DECLARED_MAX) continue;
      if (++parts > MAX_PARTS) { notes.push(`more than ${MAX_PARTS} passages read as another language; only the first ${MAX_PARTS} are listed`); break; }
      issues.push(issue('part-lang-unmarked', {
        selector: b.selector, html: b.html,
        message: b.ownLang
          ? `"${b.text.slice(0, 50)}..." is marked lang="${b.lang}" but reads as ${nameOf(d.tag)}`
          : `"${b.text.slice(0, 50)}..." reads as ${nameOf(d.tag)}, but has no lang attribute, so it is read with ${nameOf(effective)} pronunciation`,
      }));
    }
  }

  if (ctx.level === 'AAA') {
    // 3.1.4: abbreviations with no expansion anywhere on the page.
    for (const a of abbreviations.slice(0, MAX_ABBREVIATIONS)) {
      issues.push(issue('abbr-unexpanded', { selector: a.selector, html: a.html, message: `"${a.word}" is not expanded on the page: no abbr title and no spelled-out form in brackets` }));
    }
    if (abbreviations.length > MAX_ABBREVIATIONS) notes.push(`${abbreviations.length} unexpanded abbreviations; the first ${MAX_ABBREVIATIONS} are listed`);

    // 3.1.5: reading level, for English only.
    // When the lang attribute is wrong, go by the language the text is actually in.
    const english = pageWrong ? detected.tag === 'en' : declared ? declared === 'en' : false;
    const prose = own.filter((b) => !b.heading);
    if (!english) {
      const lang = pageWrong ? detected.tag : declared;
      if (letters(pageText) >= PAGE_MIN_LETTERS) notes.push(`reading level (3.1.5) is measured for English only; this page is in ${lang ? nameOf(lang) : 'a language it does not declare'}`);
    } else {
      const { grade, words } = readingGrade(prose);
      if (words >= READING_MIN_WORDS && grade > READING_GRADE) {
        issues.push(issue('reading-level', { selector: 'main', html: '', message: `the main text reads at about US grade ${Math.round(grade)} (Flesch-Kincaid, ${words} words); above grade ${READING_GRADE} a simpler version or summary is needed` }));
      }
    }
  }
  return { issues, notes };
}

export const probes = [{ name: 'language and reading level', phase: 'look', run: lookAtLanguage }];

export const rules = {
  'page-lang-mismatch': {
    title: 'Page language attribute is wrong', criteria: ['3.1.1'], kinds: ['failure'],
    covers: 'The language of the page\'s main text, detected from at least 400 letters, against the lang attribute on the html element.',
    why: 'Screen readers pick their voice and pronunciation from the lang attribute. With the wrong one, the whole page is read in the wrong accent and is hard or impossible to follow.',
  },
  'part-lang-unmarked': {
    title: 'Passage in another language is not marked', criteria: ['3.1.2'], kinds: ['likely'],
    covers: 'Paragraphs of at least 20 words whose detected language differs from the language they inherit, with no lang attribute of their own.',
    why: 'A screen reader reads the passage with the page\'s pronunciation rules, which turns another language into nonsense.',
  },
  'abbr-unexpanded': {
    title: 'Abbreviation is not expanded', criteria: ['3.1.4'], kinds: ['likely'],
    covers: 'Words in capitals (two to seven letters) with no abbr title and no spelled-out form in brackets anywhere on the page, skipping Roman numerals and text set in capitals throughout.',
    why: 'People with cognitive or reading disabilities, and people new to a field, may not know what an abbreviation stands for.',
  },
  'reading-level': {
    title: 'Text is above lower secondary reading level', criteria: ['3.1.5'], kinds: ['likely'],
    covers: 'The Flesch-Kincaid grade of the main text of English pages with at least 100 words; above grade 9 is flagged. Other languages are skipped and noted.',
    why: 'People with reading or cognitive disabilities, and people reading in a second language, need a simpler version or a summary of complex text.',
  },
};
