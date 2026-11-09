// Finds product links on a shop page. Used by the extension popup and by tests.
// Patterns are per shop; they only decide which links on the page look like a product page.
const PATTERNS = [
  [/(^|\.)zalando\.[a-z]+$/, /-[a-z0-9]{9}-[a-z0-9]{3}\.html$/i],
  [/(^|\.)answear\.[a-z]+$/, /^\/p\//],
  [/(^|\.)aboutyou\.[a-z]+$/, /^\/p\//],
  [/(^|\.)farfetch\.com$/, /-item-\d+\.aspx$/],
  [/(^|\.)mytheresa\.com$/, /-p\d+$/],
  [/(^|\.)net-a-porter\.com$/, /\/shop\/product\//],
  [/(^|\.)ssense\.com$/, /\/product\//],
  [/(^|\.)shopbop\.com$/, /\/vp\/|\/product\//],
  [/(^|\.)luisaviaroma\.com$/, /\/p\//],
];

export function productLinks(hrefs, pageUrl) {
  let page;
  try { page = new URL(pageUrl); } catch { return []; }
  const rule = PATTERNS.find(([host]) => host.test(page.hostname));
  if (!rule) return [];
  const out = new Set();
  for (const h of hrefs) {
    let u;
    try { u = new URL(h, page); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.hostname !== page.hostname || !rule[1].test(u.pathname)) continue;
    out.add(u.origin + u.pathname);
  }
  return [...out];
}
