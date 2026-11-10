import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../core.js';

const { ingredients } = JSON.parse(readFileSync(new URL('../data/ingredients.json', import.meta.url), 'utf8'));
const cat = C.indexCatalogue(ingredients);
const DAY = 86400000;
const NOW = Date.UTC(2026, 10, 10);

const recipe = (over = {}) => ({
  id: 'r1', name: 'Chicken and rice', servings: 4, kcal: 500, p: 45, c: 50, f: 8, tags: ['savoury', 'chicken'], mins: 30,
  items: [
    { text: '600g Chicken Breast', name: 'chicken breast', ing: 'chicken_breast', q: 600, unit: 'g', g: 600, optional: false },
    { text: '560g cooked rice', name: 'cooked rice', ing: 'rice_cooked', q: 560, unit: 'g', g: 560, optional: false },
    { text: 'Salt', name: 'salt', ing: 'salt', q: null, unit: null, g: 0, optional: false },
  ],
  steps: ['Season 600g of chicken.', 'Serve each on 140g of rice.'],
  ...over,
});

test('unchanged portions reproduce the macros printed in the book', () => {
  const v = C.viewRecipe(recipe(), {}, cat);
  assert.deepEqual([v.per.kcal, v.per.p, v.per.c, v.per.f], [500, 45, 50, 8]);
});

test('the number of serves does not change macros per serve', () => {
  const v = C.viewRecipe(recipe(), { servings: 10 }, cat);
  assert.equal(v.per.kcal, 500);
  assert.equal(v.items[0].totalG, 1500);
});

test('150g to 100g chicken per meal lowers macros by that ingredient only', () => {
  const v = C.viewRecipe(recipe(), { perServe: { 0: 100 } }, cat);
  const ch = cat.get('chicken_breast');
  assert.ok(Math.abs(v.per.kcal - (500 - (50 * ch.kcal) / 100)) < 1e-6);
  assert.ok(Math.abs(v.per.p - (45 - (50 * ch.p) / 100)) < 1e-6);
  assert.equal(v.items[0].totalG, 400);
  assert.equal(v.items[1].totalG, 560);
});

test('macros never go negative', () => {
  const v = C.viewRecipe(recipe({ kcal: 20, p: 2 }), { perServe: { 0: 0 } }, cat);
  assert.ok(v.per.kcal >= 0 && v.per.p >= 0);
});

test('cost follows the amount used and the store price', () => {
  const v = C.viewRecipe(recipe(), {}, cat);
  const coles = v.stores.find((s) => s.id === 'coles');
  const ch = cat.get('chicken_breast');
  const rice = cat.get('rice_cooked');
  const want = (600 / ch.pack) * ch.prices.coles + (560 / rice.pack) * rice.prices.coles;
  assert.ok(Math.abs(coles.total - want) < 1e-6);
  assert.ok(Math.abs(coles.perServe - want / 4) < 1e-6);
});

test('a price the person typed replaces the estimate', () => {
  const v = C.viewRecipe(recipe(), {}, cat, { chicken_breast: { coles: { price: 10, at: NOW } } });
  const base = C.viewRecipe(recipe(), {}, cat);
  assert.ok(v.stores.find((s) => s.id === 'coles').total < base.stores.find((s) => s.id === 'coles').total);
  assert.equal(C.priceOf(cat.get('chicken_breast'), 'coles', { chicken_breast: { coles: { price: 10, at: NOW } } }).own, true);
});

test('a store without an item is reported, not priced at zero', () => {
  const r = recipe({ items: [{ text: 'x', name: 'x', ing: 'turkey_mince', q: 400, unit: 'g', g: 400, optional: false }] });
  const v = C.viewRecipe(r, {}, cat);
  const aldi = v.stores.find((s) => s.id === 'aldi');
  assert.deepEqual(aldi.missing, ['Turkey breast mince']);
  assert.notEqual(v.best.id, 'aldi');
});

test('step amounts follow the portions, whole batch and per serve', () => {
  const v = C.viewRecipe(recipe(), { perServe: { 0: 100, 1: 100 } }, cat);
  assert.match(C.stepText('Season 600g of chicken.', v).text, /400g/);
  assert.match(C.stepText('Serve each on 140g of rice.', v).text, /100g/);
  assert.equal(C.stepText('Air fry for 200 minutes', v).changed, false);
});

test('step amounts stay put when two ingredients share a number and move differently', () => {
  const r = recipe({ items: [
    { text: 'a', name: 'a', ing: 'chicken_breast', q: 100, unit: 'g', g: 100, optional: false },
    { text: 'b', name: 'b', ing: 'rice_cooked', q: 100, unit: 'g', g: 100, optional: false },
  ], servings: 1 });
  const v = C.viewRecipe(r, { perServe: { 0: 150 } }, cat);
  assert.equal(C.stepText('Add 100g now', v).changed, false);
});

test('fit to target moves protein and carbs toward the goal', () => {
  const target = { kcal: 450, p: 35, c: 40, f: 8 };
  const adj = C.fitToTarget(recipe(), {}, cat, target);
  const v = C.viewRecipe(recipe(), adj, cat);
  assert.ok(Math.abs(v.per.p - 35) < 4, `protein ${v.per.p}`);
  assert.ok(Math.abs(v.per.c - 40) < 4, `carbs ${v.per.c}`);
});

test('fit to target never leaves a silly portion', () => {
  const adj = C.fitToTarget(recipe(), {}, cat, { kcal: 2000, p: 200, c: 300, f: 10 });
  assert.ok(adj.perServe[0] <= 150 * 1.8 + 5);
});

const hist = (at, stars) => ({ log: [{ at, stars }] });
const opts = (over = {}) => ({ mode: 'casual', seed: 'x', now: NOW, ...over });

test('a 5 star meal comes back after a week, a 3 star one does not', () => {
  const a = recipe({ id: 'a' });
  const b = recipe({ id: 'b' });
  const h = { a: hist(NOW - 8 * DAY, 5), b: hist(NOW - 8 * DAY, 3) };
  const ids = C.suggest([a, b], h, cat, {}, {}, opts()).map((s) => s.recipe.id);
  assert.deepEqual(ids, ['a']);
});

test('a higher rating ranks above a lower one when both are due', () => {
  const a = recipe({ id: 'a' });
  const b = recipe({ id: 'b' });
  const h = { a: hist(NOW - 90 * DAY, 2), b: hist(NOW - 90 * DAY, 5) };
  assert.equal(C.suggest([a, b], h, cat, {}, {}, opts())[0].recipe.id, 'b');
});

test('1 star recipes are never suggested and skipped ones wait', () => {
  const a = recipe({ id: 'a' });
  const b = recipe({ id: 'b' });
  const h = { a: hist(NOW - 400 * DAY, 1), b: { skipUntil: NOW + DAY } };
  assert.equal(C.suggest([a, b], h, cat, {}, {}, opts()).length, 0);
});

test('macro mode prefers the closer meal; casual mode does not look at macros', () => {
  const close = recipe({ id: 'close', kcal: 600, p: 50, c: 60, f: 15 });
  const far = recipe({ id: 'far', kcal: 300, p: 12, c: 40, f: 10 });
  const target = { kcal: 1800, p: 150, c: 180, f: 45, meals: 3 };
  assert.equal(C.suggest([far, close], {}, cat, {}, {}, opts({ mode: 'macro', target }))[0].recipe.id, 'close');
  const casual = C.suggest([far, close], {}, cat, {}, {}, opts());
  assert.ok(casual.every((s) => !s.why.some((w) => /kcal|target/.test(w))));
});

test('dietary exclusions apply', () => {
  assert.equal(C.suggest([recipe()], {}, cat, {}, {}, opts({ diet: ['chicken'] })).length, 0);
});

test('shopping list adds up across meals and rounds to whole packs', () => {
  const list = C.shoppingList([{ recipe: recipe(), adj: {} }, { recipe: recipe({ id: 'r2' }), adj: {} }], cat);
  const ch = list.buy.find((l) => l.ingredient.id === 'chicken_breast');
  assert.equal(ch.g, 1200);
  assert.equal(ch.packs, 2);
  const coles = list.totals.find((t) => t.id === 'coles');
  assert.ok(coles.total > 0);
  assert.ok(list.mix <= Math.min(...list.totals.map((t) => t.total)) + 1e-6);
});

test('shopping list honours scaled portions', () => {
  const list = C.shoppingList([{ recipe: recipe(), adj: { perServe: { 0: 100 } } }], cat);
  assert.equal(list.buy.find((l) => l.ingredient.id === 'chicken_breast').g, 400);
});

test('things already at home leave the total', () => {
  const list = C.shoppingList([{ recipe: recipe(), adj: {} }], cat, {}, new Set(['rice_cooked']));
  assert.equal(list.buy.some((l) => l.ingredient.id === 'rice_cooked'), false);
  assert.equal(list.owned.length, 1);
});

test('typed ingredient lines are understood', () => {
  const a = C.parseIngredientLine('150g chicken breast', ingredients);
  assert.equal(a.ing, 'chicken_breast');
  assert.equal(a.g, 150);
  const b = C.parseIngredientLine('2 eggs', ingredients);
  assert.equal(b.ing, 'egg');
  assert.equal(b.g, 116);
});

test('import rejects files that are not recipe packs', () => {
  assert.throws(() => C.readPack({ hello: 1 }));
  assert.equal(C.readPack({ format: 'meals-pack', recipes: [recipe()] }).length, 1);
});

test('the macro starting point adds back up to its calories', () => {
  const t = C.suggestTargets({ sex: 'm', kg: 80, cm: 180, age: 26, activity: 1.55, goal: -300 });
  assert.equal(t.p, 160);
  assert.ok(Math.abs(t.p * 4 + t.c * 4 + t.f * 9 - t.kcal) < 15);
});

test('the shared ingredient table has no gaps', () => {
  for (const r of ingredients) {
    assert.ok(r.pack > 0, r.id);
    assert.ok(Object.values(r.prices).some((p) => p != null), r.id);
    for (const k of ['kcal', 'p', 'c', 'f']) assert.ok(Number.isFinite(r[k]), r.id);
  }
});

test('the app build number and the offline cache version move together', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.equal(html.match(/BUILD = (\d+)/)[1], sw.match(/meals-v(\d+)/)[1]);
});

test('snacks are not judged against a full meal target', () => {
  const snack = recipe({ id: 's', kcal: 150, p: 10, c: 15, f: 4 });
  const target = { kcal: 1800, p: 150, c: 180, f: 45, meals: 3 };
  const out = C.suggest([snack], {}, cat, {}, {}, opts({ mode: 'macro', target, type: 'snack' }));
  assert.equal(out.length, 1);
  assert.ok(out[0].why.every((w) => !/target/.test(w)));
});

test('each ingredient is priced for the amount used, per serve and for the batch', () => {
  const v = C.viewRecipe(recipe(), { perServe: { 0: 100 } }, cat);
  const ch = cat.get('chicken_breast');
  const coles = v.items[0].offers.find((o) => o.id === 'coles');
  assert.ok(Math.abs(coles.perServe - (100 / ch.pack) * ch.prices.coles) < 1e-9);
  assert.ok(Math.abs(coles.total - (400 / ch.pack) * ch.prices.coles) < 1e-9);
  assert.equal(coles.pack, ch.prices.coles);
});

test('ingredient prices add back up to the recipe price', () => {
  const v = C.viewRecipe(recipe(), {}, cat);
  for (const s of v.stores) {
    const sum = v.items.reduce((n, it) => n + (it.q != null && it.offers ? it.offers.find((o) => o.id === s.id).total : 0), 0);
    assert.ok(Math.abs(sum - s.total) < 1e-9, s.id);
  }
});

test('an item a store does not carry has no price rather than zero', () => {
  const r = recipe({ items: [{ text: 'x', name: 'x', ing: 'turkey_mince', q: 400, unit: 'g', g: 400, optional: false }] });
  assert.equal(C.viewRecipe(r, {}, cat).items[0].offers.find((o) => o.id === 'aldi').perServe, null);
});

test('amounts read naturally', () => {
  assert.equal(C.fmtAmount(0.25, 'each'), '¼');
  assert.equal(C.fmtAmount(1.5, 'tbsp'), '1½');
  assert.equal(C.fmtAmount(0.125, 'tbsp'), '⅛');
  assert.equal(C.fmtAmount(0.5, 'g'), '0.5');
  assert.equal(C.fmtAmount(150, 'g'), '150');
  assert.equal(C.audSmall(0.004), '<1c');
  assert.equal(C.audSmall(null), '–');
});

test('store links search for the item', () => {
  assert.match(C.storeLink('coles', 'chicken breast'), /coles\.com\.au.*chicken%20breast/);
  assert.match(C.storeLink('woolies', 'eggs'), /woolworths\.com\.au.*eggs/);
  assert.match(C.storeLink('aldi', 'eggs'), /aldi\.com\.au.*eggs/);
});
