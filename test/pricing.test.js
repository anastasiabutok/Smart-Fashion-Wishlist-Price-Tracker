import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestPrice, rankSources, ageLabel, atOrBelowTarget } from '../src/pricing.js';

const NOW = new Date('2026-11-09T12:00:00');
const code22 = { shop: 'all', type: 'percent', value: 22, min_order: 1499, valid_to: '2026-12-31' };

test('Staud example: 6138 CZK with 22% code', () => {
  const r = bestPrice({ shop: 'Zalando', price: 6138 }, [code22], NOW);
  assert.equal(r.final, 4787.64);
  assert.equal(r.code, code22);
});

test('code skipped when below minimum order', () => {
  const r = bestPrice({ shop: 'Zalando', price: 1000 }, [code22], NOW);
  assert.equal(r.final, 1000);
  assert.equal(r.code, null);
});

test('expired code is skipped', () => {
  const r = bestPrice({ shop: 'Zalando', price: 5000 }, [{ ...code22, valid_to: '2026-11-01' }], NOW);
  assert.equal(r.final, 5000);
});

test('code for another shop is skipped', () => {
  const r = bestPrice({ shop: 'Answear', price: 5000 }, [{ ...code22, shop: 'Zalando' }], NOW);
  assert.equal(r.final, 5000);
});

test('best single code wins, no stacking', () => {
  const fixed = { shop: 'all', type: 'fixed', value: 500 };
  const r = bestPrice({ shop: 'Zalando', price: 3000 }, [code22, fixed], NOW);
  assert.equal(r.final, 2340); // 22% = 660 off beats 500
  assert.equal(r.code, code22);
});

test('sources sorted by final price, code can flip the order', () => {
  const sources = [
    { shop: 'Mytheresa', price: 3000, price_date: '2026-11-09' },
    { shop: 'Zalando', price: 1500, price_date: '2026-11-08' },
    { shop: 'Lounge', price: null, price_date: null },
    { shop: 'Farfetch', price: 1800, price_date: '2026-11-07' },
  ];
  const ranked = rankSources(sources, [{ shop: 'Farfetch', type: 'percent', value: 30 }], NOW);
  assert.deepEqual(ranked.map((r) => r.shop), ['Farfetch', 'Zalando', 'Mytheresa', 'Lounge']);
  assert.equal(ranked[0].cheapest, true);
  assert.equal(ranked[3].age, 'not checked yet');
});

test('age labels', () => {
  assert.equal(ageLabel('2026-11-09', NOW), 'today');
  assert.equal(ageLabel('2026-11-08', NOW), '1 day ago');
  assert.equal(ageLabel('2026-11-07', NOW), '2 days ago');
});

test('target price badge', () => {
  const ranked = rankSources([{ shop: 'Zalando', price: 4000 }], [], NOW);
  assert.equal(atOrBelowTarget(ranked, 5000), true);
  assert.equal(atOrBelowTarget(ranked, 3000), false);
  assert.equal(atOrBelowTarget(ranked, null), false);
});
