import { productLinks } from './collect.js';
const $ = (id) => document.getElementById(id);
const saved = await chrome.storage.local.get(['app', 'profile']);
$('app').value = saved.app || 'http://localhost:3000';
$('profile').value = saved.profile || '';

$('go').onclick = async () => {
  const app = $('app').value.trim().replace(/\/$/, '');
  const profile = $('profile').value.trim();
  const out = $('out');
  if (!app || !profile) { out.textContent = 'Fill in the app address and your profile name.'; return; }
  await chrome.storage.local.set({ app, profile });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Scroll to the bottom first: wishlists often load more items as you scroll.
  const [{ result: hrefs }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: async () => {
      for (let i = 0; i < 8; i++) { window.scrollTo(0, document.body.scrollHeight); await new Promise((r) => setTimeout(r, 600)); }
      return [...document.querySelectorAll('a[href]')].map((a) => a.href);
    },
  });
  const urls = productLinks(hrefs, tab.url);
  if (!urls.length) { out.textContent = 'No products found on this page. Open the wishlist or a list of products in a supported shop.'; return; }
  out.textContent = `Found ${urls.length} products. Importing, this can take a minute…`;
  try {
    const all = [];
    for (let i = 0; i < urls.length; i += 20) {
      const res = await fetch(`${app}/api/import`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-profile': profile }, body: JSON.stringify({ urls: urls.slice(i, i + 20) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      all.push(...data.results);
    }
    const n = (s) => all.filter((r) => r.status === s).length;
    const noPrice = all.filter((r) => r.status === 'added' && r.price == null).length;
    out.textContent = `Added ${n('added')}, already there ${n('already in your list')}, failed ${n('failed')}.` + (noPrice ? `\n${noPrice} added without a price (enter it in the app).` : '');
  } catch (e) {
    out.textContent = `Could not reach the app (${e.message}). Is it running?`;
  }
};
