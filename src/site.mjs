// Checks that only make sense across pages. Each finding is attached to the page it is
// about and marked scope: 'site', so reports can show it apart from that page's own problems.

const pathOf = (url) => { const u = new URL(url); return u.pathname + u.search; };

// 3.2.3 Consistent Navigation: links that repeat from page to page have to stay in the same
// order. The most common order is the reference; a page whose shared links run in a
// different order is reported.
function navigationOrder(pages) {
  const withNav = pages.filter((p) => p.review && p.review.nav.length >= 2);
  if (withNav.length < 2) return;
  const tally = new Map();
  for (const p of withNav) {
    const key = JSON.stringify(p.review.nav);
    tally.set(key, (tally.get(key) || 0) + 1);
  }
  const reference = JSON.parse([...tally.entries()].sort((a, b) => b[1] - a[1])[0][0]);
  const position = new Map(reference.map((label, i) => [label, i]));

  for (const p of withNav) {
    const shared = [...new Set(p.review.nav)].filter((label) => position.has(label));
    if (shared.length < 2) continue; // a page with its own navigation, such as a landing page
    const moved = shared.find((label, i) => i > 0 && position.get(label) < position.get(shared[i - 1]));
    if (!moved) continue;
    p.issues.push({
      id: 'inconsistent-navigation', source: 'accessready', kind: 'failure', scope: 'site', wcag: ['3.2.3'], impact: 'moderate',
      title: 'Navigation is in a different order on this page',
      message: `the main navigation lists "${moved}" in a different place than on most other pages (usual order: ${reference.slice(0, 6).join(', ')}${reference.length > 6 ? ', ...' : ''})`,
      selector: 'nav', html: '',
    });
  }
}

// 2.4.2 Page Titled asks for a title that describes the page. Two different pages with the
// same title cannot both be described by it, but a person should confirm, so it is a note.
function duplicateTitles(pages) {
  const byTitle = new Map();
  for (const p of pages) {
    if (!p.review || !p.review.title) continue;
    if (!byTitle.has(p.review.title)) byTitle.set(p.review.title, []);
    byTitle.get(p.review.title).push(p);
  }
  for (const [title, group] of byTitle) {
    if (new Set(group.map((p) => pathOf(p.url))).size < 2) continue;
    for (const p of group) {
      const others = group.filter((o) => o !== p).map((o) => pathOf(o.url));
      p.issues.push({
        id: 'duplicate-title', source: 'accessready', kind: 'advice', scope: 'site', wcag: ['2.4.2'], impact: 'moderate',
        title: 'Page title is shared with another page',
        message: `the title "${title.slice(0, 70)}" is also used by ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` and ${others.length - 3} more` : ''}, so tabs, bookmarks and screen readers cannot tell them apart`,
        selector: 'title', html: '',
      });
    }
  }
}

export function checkAcrossPages(pages) {
  const audited = pages.filter((p) => !p.error);
  navigationOrder(audited);
  duplicateTitles(audited);
}

export const rules = {
  'inconsistent-navigation': {
    title: 'Navigation is in a different order on this page', criteria: ['3.2.3'], kinds: ['failure'],
    covers: 'The main navigation is compared across every page audited; a page that lists the same links in a different order fails.',
    why: 'People who navigate by memory or with a screen reader rely on the menu being in the same order on every page.',
  },
  'duplicate-title': {
    title: 'Page title is shared with another page', criteria: ['2.4.2'], kinds: ['advice'],
    covers: 'Different pages that share a title are noted.',
    why: 'The page title is the first thing a screen reader announces, and it is what tabs, bookmarks and search results show.',
  },
};
