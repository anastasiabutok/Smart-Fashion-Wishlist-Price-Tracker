const SHOPS = ['Zalando', 'Zalando Lounge', 'Answear', 'AboutYou', 'BestSecret', 'Farfetch', 'Mytheresa', 'Net-a-Porter', 'SSENSE', 'Shopbop', 'LuisaViaRoma', 'Other'];
const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const profileBtn = document.getElementById('profile-btn');

// --- helpers --------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur = 'CZK') => (n == null ? '–' : `${Number(n).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })} ${cur}`);
// Only allow http(s) links and images from user input.
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
// Photos are either uploaded (served from /uploads/) or an older http(s) link.
const imgUrl = (u) => (/^\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(u || '') ? u : safeUrl(u));

// Shrink a photo before upload: phone photos are huge, and 900px is plenty for a card.
async function shrinkPhoto(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the photo'))), 'image/jpeg', 0.85));
}

async function uploadPhoto(itemId, file) {
  const blob = await shrinkPhoto(file);
  const res = await fetch(`/api/items/${itemId}/photo`, { method: 'POST', headers: { 'x-profile': profile() }, body: blob });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Photo upload failed');
  return data;
}

function profile() {
  let p = localStorage.getItem('profile');
  if (!p) {
    p = (prompt('Profile name (e.g. your first name):') || 'me').trim().toLowerCase() || 'me';
    localStorage.setItem('profile', p);
  }
  return p;
}

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-profile': profile() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.').replace(/\s/g, '')));
const go = (hash) => { location.hash = hash; };

// --- views ----------------------------------------------------------------
async function itemsView() {
  titleEl.textContent = 'Items';
  const items = await api('GET', '/items');
  if (!items.length) {
    view.innerHTML = '<p class="empty">Nothing tracked yet.<br>Tap “Check item” to compare an item across shops.</p>';
    return;
  }
  view.innerHTML = items.map((i) => {
    const b = i.best;
    const img = imgUrl(i.image_url);
    return `<a class="card item" href="#/item/${i.id}" style="text-decoration:none;color:inherit">
      ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy">` : '<div class="thumb"></div>'}
      <div class="grow">
        <div class="name">${esc(i.name)}</div>
        <div class="mute">${esc([i.brand, i.color].filter(Boolean).join(' · '))}</div>
        <div class="price">${b ? money(b.final, b.currency) : '–'}${i.at_target ? '<span class="badge good">at target</span>' : ''}</div>
        <div class="mute">${b ? `cheapest at ${esc(b.shop)}` : 'no prices yet'}</div>
      </div></a>`;
  }).join('');
}

function trendSvg(history) {
  if (history.length < 2) return '<p class="mute">Trend appears after at least two price readings.</p>';
  // One point per date: the lowest price read that day.
  const byDate = new Map();
  for (const h of history) byDate.set(h.date, Math.min(byDate.get(h.date) ?? Infinity, h.price));
  const pts = [...byDate.entries()];
  if (pts.length < 2) return '<p class="mute">Trend appears once prices are read on different days.</p>';
  const ys = pts.map((p) => p[1]);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const line = pts.map(([, y], i) => `${(i / (pts.length - 1)) * 300},${70 - ((y - lo) / span) * 60}`).join(' ');
  return `<svg class="trend" viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label="Price trend">
    <polyline points="${line}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div class="mute">Lowest read: ${money(lo)} · highest: ${money(hi)} (own readings only)</div>`;
}

const SHOP_SITES = [['Zalando', 'zalando.cz'], ['Answear', 'answear.cz'], ['AboutYou', 'aboutyou.cz'], ['Farfetch', 'farfetch.com'], ['Mytheresa', 'mytheresa.com'], ['Net-a-Porter', 'net-a-porter.com'], ['SSENSE', 'ssense.com'], ['Shopbop', 'shopbop.com'], ['LuisaViaRoma', 'luisaviaroma.com']].map(([name, domain]) => ({ name, domain }));

async function itemView(id) {
  const i = await api('GET', `/items/${id}`);
  titleEl.textContent = i.brand || 'Item';
  const img = imgUrl(i.image_url);
  const rows = i.sources.map((s) => {
    const url = safeUrl(s.url);
    const checked = s.final != null;
    return `<div class="row ${s.cheapest ? 'best' : ''}">
      <div class="grow">
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(s.shop)}</a>` : esc(s.shop)}
        ${s.cheapest ? '<span class="badge good">cheapest</span>' : ''}
        ${s.shop_type === 'gated' ? '<span class="badge">login needed</span>' : ''}
        ${s.uncertain ? '<span class="badge warn">uncertain match</span>' : ''}
        <div class="mute">${esc(s.age)}${s.code_used ? ` · code ${esc(s.code_used.code)}` : ''}</div>
      </div>
      <div style="text-align:right">
        ${checked ? `<div class="price">${money(s.final, s.currency)}${s.code_used ? `<span class="strike">${money(s.price, s.currency)}</span>` : ''}</div>` : '<div class="mute">not checked yet</div>'}
        <button class="link" data-act="price" data-id="${s.id}">${checked ? 'update price' : 'enter price'}</button>
        <button class="link" data-act="del-source" data-id="${s.id}">remove</button>
      </div></div>`;
  }).join('');

  const have = new Set(i.sources.map((s) => s.shop));
  const otherShops = SHOP_SITES.filter((s) => !have.has(s.name));
  view.innerHTML = `
    ${img ? `<img class="hero" src="${esc(img)}" alt="">` : ''}
    <label class="photo-btn">${img ? 'Change photo' : 'Add photo'}<input id="photo-input" type="file" accept="image/*" hidden></label>
    <div class="card">
      <div class="name">${esc(i.name)}${i.at_target ? '<span class="badge good">at or below target</span>' : ''}</div>
      <div class="mute">${esc([i.brand, i.color].filter(Boolean).join(' · '))}</div>
      ${i.sizes ? `<div class="mute">Sizes: ${esc(i.sizes)}</div>` : ''}
      <h2>Shops, cheapest first</h2>${rows || '<p class="mute">No shops yet.</p>'}
    </div>
    <div class="card"><h2 style="margin-top:0">Price trend</h2>${trendSvg(i.history)}</div>
    <div class="card">
      <h2 style="margin-top:0">Find it in other shops</h2>
      <p class="muted">Open a search, find the same item, paste its link here. The price is read and added.</p>
      <div>${otherShops.map((s) => `<a class="badge" target="_blank" rel="noopener" href="${esc(`https://www.google.com/search?q=${encodeURIComponent([i.brand, i.name, i.color].filter(Boolean).join(' '))}+site:${s.domain}`)}">${esc(s.name)}</a>`).join(' ')}</div>
      <div style="display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:10px"><input id="from-link" inputmode="url" placeholder="https://… link from another shop"><button id="from-link-btn" type="button">Add</button></div>
      <p id="from-link-msg" class="muted"></p>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Add a shop</h2>
      <form id="src-form">
        <label>Shop</label><select name="shop">${SHOPS.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
        <div class="two"><div><label>Price (CZK)</label><input name="price" inputmode="decimal" placeholder="leave empty if unknown"></div>
        <div><label>Link</label><input name="url" inputmode="url" placeholder="https://…"></div></div>
        <button class="primary">Add shop</button>
      </form>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Target price</h2>
      <form id="target-form">
        <label>The price you would buy at (optional, only for this item)</label>
        <input name="target" inputmode="decimal" value="${i.target_price ?? ''}" placeholder="e.g. 10000">
        <button class="primary">Save target</button>
      </form>
      <button class="link" data-act="del-item">Delete item</button>
    </div>`;

  view.querySelector('#from-link-btn').onclick = async () => {
    const msg = view.querySelector('#from-link-msg');
    const url = view.querySelector('#from-link').value.trim();
    if (!url) { msg.textContent = 'Paste a link first.'; return; }
    msg.textContent = 'Reading the page…';
    try {
      const r = await api('POST', `/items/${id}/sources/from-link`, { url });
      const note = convertedFrom(r) ? ` Price ${convertedFrom(r)}.` : '';
      if (!r.price_found) alert('Shop added, but I could not read the price. Enter it by hand.');
      else if (r.match.uncertain) alert(`Added, but please check it is the same item (${r.match.reasons.join(', ')}).${note}`);
      else if (note) alert(`Added.${note}`);
      itemView(id);
    } catch (err) { msg.textContent = `Could not add it (${err.message}). Use "Add a shop" below.`; }
  };
  view.querySelector('#photo-input').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { await uploadPhoto(id, file); } catch (err) { alert(err.message); }
    itemView(id);
  };
  view.querySelector('#src-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api('POST', `/items/${id}/sources`, { shop: f.get('shop'), price: num(f.get('price')), url: f.get('url') || null });
    itemView(id);
  };
  view.querySelector('#target-form').onsubmit = async (e) => {
    e.preventDefault();
    await api('PATCH', `/items/${id}`, { target_price: num(new FormData(e.target).get('target')) });
    itemView(id);
  };
  view.onclick = async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'price') {
      const v = num(prompt('Current price in CZK:'));
      if (v == null || Number.isNaN(v)) return;
      await api('PUT', `/sources/${b.dataset.id}`, { price: v });
      itemView(id);
    } else if (b.dataset.act === 'del-source') {
      if (confirm('Remove this shop from the item?')) { await api('DELETE', `/sources/${b.dataset.id}`); itemView(id); }
    } else if (b.dataset.act === 'del-item') {
      if (confirm('Delete this item and its price history?')) { await api('DELETE', `/items/${id}`); go('#/items'); }
    }
  };
}

const convertedFrom = (r) => (r.price != null && r.foreign_price != null ? `converted from ${money(r.foreign_price, r.foreign_currency)}` : '');

function addView() {
  titleEl.textContent = 'Check item';
  view.innerHTML = `<form id="add" class="card">
    <label>Paste a product link to fill in the details</label>
    <div style="display:grid;grid-template-columns:1fr auto;gap:10px"><input id="link" inputmode="url" placeholder="https://www.zalando.cz/…"><button type="button" id="fill">Fill in</button></div>
    <p id="fill-msg" class="muted"></p><img id="fill-img" alt="" hidden style="max-width:140px;border-radius:8px">
    <label>Item name</label><input name="name" required placeholder="e.g. Marianne sweater">
    <div class="two"><div><label>Brand</label><input name="brand" placeholder="STAUD"></div>
    <div><label>Colour</label><input name="color" placeholder="black"></div></div>
    <label>Sizes available (optional)</label><input name="sizes" placeholder="XS, S, M">
    <label>Photo (optional): take one or pick from your gallery or screenshots</label><input name="photo" type="file" accept="image/*">
    <h2>First shop</h2>
    <label>Shop</label><select name="shop">${SHOPS.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
    <div class="two"><div><label>Price (CZK)</label><input name="price" inputmode="decimal"></div>
    <div><label>Link</label><input name="url" inputmode="url" placeholder="https://…"></div></div>
    <label>Target price (optional)</label><input name="target" inputmode="decimal">
    <button class="primary">See the price comparison</button></form>`;
  const form = view.querySelector('#add');
  let fetchedImage = null;
  view.querySelector('#fill').onclick = async () => {
    const msg = view.querySelector('#fill-msg');
    const link = view.querySelector('#link').value.trim();
    if (!link) { msg.textContent = 'Paste a link first.'; return; }
    msg.textContent = 'Reading the page…';
    try {
      const r = await api('POST', '/extract', { url: link });
      const set = (n, v) => { if (v != null && v !== '') form.elements[n].value = v; };
      set('name', r.name); set('brand', r.brand); set('color', r.color); set('sizes', r.sizes); set('price', r.price); set('url', r.url);
      if (r.shop && [...form.elements.shop.options].some((o) => o.value === r.shop)) form.elements.shop.value = r.shop;
      fetchedImage = r.image_url || null;
      const img = view.querySelector('#fill-img');
      img.hidden = !fetchedImage; if (fetchedImage) img.src = safeUrl(fetchedImage);
      const missing = ['name', 'price', 'image_url'].filter((k) => !r[k]).map((k) => ({ name: 'name', price: 'price', image_url: 'photo' }[k]));
      msg.textContent = missing.length ? `Filled in what I could. Please check: ${missing.join(', ')}.` : `Filled in${convertedFrom(r) ? ` (price ${convertedFrom(r)})` : ''}. Check it, then save.`;
    } catch (err) {
      msg.textContent = `Could not read that page (${err.message}). Fill it in by hand below.`;
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const created = await api('POST', '/items', {
      name: f.get('name'), brand: f.get('brand') || null, color: f.get('color') || null,
      sizes: f.get('sizes') || null, target_price: num(f.get('target')), image_url: fetchedImage,
      sources: [{ shop: f.get('shop'), price: num(f.get('price')), url: f.get('url') || null }],
    });
    const photo = f.get('photo');
    if (photo && photo.size) {
      try { await uploadPhoto(created.id, photo); } catch (err) { alert(`Item saved, but the photo failed: ${err.message}`); }
    }
    go(`#/item/${created.id}`);
  };
}

function importView() {
  titleEl.textContent = 'Import links';
  view.innerHTML = `<form id="imp" class="card">
    <label>Paste product links, one per line (e.g. from your wishlist)</label>
    <textarea name="links" rows="8" placeholder="https://www.zalando.cz/…&#10;https://answear.cz/p/…" style="width:100%"></textarea>
    <button class="primary">Import</button></form><div id="imp-out"></div>`;
  view.querySelector('#imp').onsubmit = async (e) => {
    e.preventDefault();
    const links = [...new Set(new FormData(e.target).get('links').split(/\s+/).filter((l) => /^https?:\/\//i.test(l)))].slice(0, 50);
    const out = view.querySelector('#imp-out');
    if (!links.length) { out.innerHTML = '<p class="muted">No links found.</p>'; return; }
    out.innerHTML = '<div class="card" id="imp-list"></div>';
    const list = view.querySelector('#imp-list');
    for (const link of links) {
      const row = document.createElement('div'); row.className = 'row';
      row.innerHTML = `<div class="grow mute">${esc(link.slice(0, 60))}…</div><div>reading…</div>`;
      list.append(row);
      const status = row.lastElementChild;
      try {
        const r = await api('POST', '/extract', { url: link });
        if (!r.name) throw new Error('no product found');
        const created = await api('POST', '/items', { name: r.name, brand: r.brand, color: r.color, sizes: r.sizes, image_url: r.image_url, sources: [{ shop: r.shop || 'Other', price: r.price, url: r.url }] });
        row.firstElementChild.innerHTML = `<a href="#/item/${created.id}">${esc(r.name)}</a>`;
        status.textContent = r.price != null ? `${money(r.price, r.currency || 'CZK')}${convertedFrom(r) ? ` (${convertedFrom(r)})` : ''}` : 'price missing';
      } catch (err) { status.textContent = `failed: ${err.message}`; }
    }
  };
}

async function codesView() {
  titleEl.textContent = 'Discount codes';
  const codes = await api('GET', '/codes');
  view.innerHTML = `<form id="code-form" class="card">
    <label>Code</label><input name="code" required placeholder="22PRORADOST">
    <label>Shop</label><select name="shop"><option value="all">All shops</option>${SHOPS.map((s) => `<option>${esc(s)}</option>`).join('')}</select>
    <div class="two"><div><label>Type</label><select name="type"><option value="percent">Percent</option><option value="fixed">Fixed amount</option></select></div>
    <div><label>Value</label><input name="value" inputmode="decimal" required placeholder="22"></div></div>
    <div class="two"><div><label>Minimum order</label><input name="min_order" inputmode="decimal" placeholder="1499"></div>
    <div><label>Valid until</label><input name="valid_to" type="date"></div></div>
    <button class="primary">Save code</button></form>
    ${codes.map((c) => `<div class="card row" style="border-top:0"><div class="grow"><div class="name">${esc(c.code)}</div>
      <div class="mute">${c.type === 'percent' ? `${c.value}%` : money(c.value)} · ${esc(c.shop)}${c.min_order ? ` · min ${money(c.min_order)}` : ''}${c.valid_to ? ` · until ${esc(c.valid_to)}` : ''}</div></div>
      <button class="link" data-del="${c.id}">delete</button></div>`).join('') || '<p class="mute">No codes saved yet. Only the best single code is applied per shop.</p>'}`;
  view.querySelector('#code-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await api('POST', '/codes', { code: f.get('code'), shop: f.get('shop'), type: f.get('type'), value: num(f.get('value')), min_order: num(f.get('min_order')), valid_to: f.get('valid_to') || null });
    codesView();
  };
  view.onclick = async (e) => {
    const b = e.target.closest('button[data-del]');
    if (b) { await api('DELETE', `/codes/${b.dataset.del}`); codesView(); }
  };
}

// --- router ---------------------------------------------------------------
async function route() {
  const [, page, id] = (location.hash || '#/items').split('/');
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.nav === (page === 'item' ? 'items' : page)));
  profileBtn.textContent = profile();
  view.onclick = null;
  try {
    if (page === 'item') await itemView(id);
    else if (page === 'add') addView();
    else if (page === 'import') importView();
    else if (page === 'codes') await codesView();
    else await itemsView();
  } catch (e) {
    view.innerHTML = `<p class="empty">${esc(e.message)}</p>`;
  }
}

document.querySelectorAll('nav button').forEach((b) => (b.onclick = () => go(`#/${b.dataset.nav}`)));
profileBtn.onclick = () => { localStorage.removeItem('profile'); profile(); route(); };
window.addEventListener('hashchange', route);
route();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
