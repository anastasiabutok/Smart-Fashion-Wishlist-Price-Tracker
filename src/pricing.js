// Price engine: final price after the best valid code, sorting, age of a price.
// Prices are numbers in the source currency. Rounding to 2 decimals.

const round2 = (n) => Math.round(n * 100) / 100;

export function isCodeValid(code, source, now = new Date()) {
  if (code.shop && code.shop !== 'all' && code.shop.toLowerCase() !== source.shop.toLowerCase()) return false;
  if (code.valid_from && now < new Date(code.valid_from)) return false;
  if (code.valid_to && now > new Date(code.valid_to + 'T23:59:59')) return false;
  if (code.min_order != null && source.price < code.min_order) return false;
  return true;
}

export function applyCode(price, code) {
  if (code.type === 'percent') return round2(price * (1 - code.value / 100));
  if (code.type === 'fixed') return round2(Math.max(0, price - code.value));
  throw new Error(`Unknown code type: ${code.type}`);
}

// v1: no stacking, the single best valid code wins.
export function bestPrice(source, codes, now = new Date()) {
  if (source.price == null) return { final: null, code: null };
  let final = round2(source.price);
  let used = null;
  for (const code of codes) {
    if (!isCodeValid(code, source, now)) continue;
    const p = applyCode(source.price, code);
    if (p < final) {
      final = p;
      used = code;
    }
  }
  return { final, code: used };
}

export function ageLabel(dateStr, now = new Date()) {
  if (!dateStr) return 'not checked yet';
  const days = Math.floor((now - new Date(dateStr)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

// Sources with a price first, sorted by final price ascending; unchecked ones last.
export function rankSources(sources, codes, now = new Date()) {
  const ranked = sources.map((s) => {
    const { final, code } = bestPrice(s, codes, now);
    return { ...s, final, code_used: code, age: ageLabel(s.price_date, now) };
  });
  ranked.sort((a, b) => {
    if (a.final == null && b.final == null) return 0;
    if (a.final == null) return 1;
    if (b.final == null) return -1;
    return a.final - b.final;
  });
  const first = ranked.find((r) => r.final != null);
  if (first) first.cheapest = true;
  return ranked;
}

export function atOrBelowTarget(ranked, target) {
  if (target == null) return false;
  return ranked.some((r) => r.final != null && r.final <= target);
}
