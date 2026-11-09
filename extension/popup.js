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
  try {
    const all = [];
    let rateLimited = false;
    for (let i = 0; i < urls.length && !rateLimited; i += 20) {
      out.textContent = `Found ${urls.length} products. Importing slowly so the shop does not block it: ${i} done so far. Keep this window open.`;
      const res = await fetch(`${app}/api/import`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-profile': profile }, body: JSON.stringify({ urls: urls.slice(i, i + 20) }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      all.push(...data.results);
      rateLimited = Boolean(data.rate_limited);
    }
    const n = (s) => all.filter((r) => r.status === s).length;
    const noPrice = all.filter((r) => r.status === 'added' && r.price == null).length;
    const notTried = n('not tried') + urls.length - all.length;
    const firstError = all.find((r) => r.status === 'failed')?.error;
    out.textContent = `Added ${n('added')}, already there ${n('already in your list')}, failed ${n('failed')}, not tried ${notTried}.`
      + (noPrice ? `\n${noPrice} added without a price (enter it in the app).` : '')
      + (firstError ? `\nFirst failure: ${firstError}.` : '')
      + (rateLimited ? '\nThe shop asked the app to slow down, so it stopped. Wait a while, then click Send again: products already added are skipped.' : '');
  } catch (e) {
    out.textContent = `Could not reach the app (${e.message}). Is it running?`;
  }
};
