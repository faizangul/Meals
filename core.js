// Meals: all the sums and decisions, with no screen code, so they can be tested.
export const STORES = [
  { id: 'aldi', name: 'ALDI' },
  { id: 'coles', name: 'Coles' },
  { id: 'woolies', name: 'Woolies' },
];

// How long a rating keeps a recipe out of the rotation, in days.
export const REPEAT_DAYS = { 5: 7, 4: 14, 3: 30, 2: 75, 1: Infinity };
export const SKIP_DAYS = 7;
const DAY = 86400000;
const MACROS = ['kcal', 'p', 'c', 'f'];

export const repeatLabel = (stars) => ({
  5: 'about every week',
  4: 'about every 2 weeks',
  3: 'about once a month',
  2: 'every couple of months',
  1: "won't suggest it again",
}[stars] || '');

export function indexCatalogue(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.id, r);
  return map;
}

// Current price for one store: the person's own price wins over the estimate.
export function priceOf(ing, store, overrides = {}) {
  const own = overrides[ing.id]?.[store];
  if (own && own.price != null) return { price: own.price, own: true, at: own.at };
  const est = ing.prices?.[store];
  return est == null ? null : { price: est, own: false, at: null };
}

// Everything the recipe screen shows, given the portion changes.
// adj = { servings, perServe: { itemIndex: gramsPerServe } }
export function viewRecipe(recipe, adj = {}, cat, overrides = {}) {
  const base = recipe.servings || 1;
  const servings = Math.max(0.5, adj.servings || base);
  const per = { kcal: recipe.kcal, p: recipe.p, c: recipe.c, f: recipe.f };
  const cost = Object.fromEntries(STORES.map((s) => [s.id, 0]));
  const missing = Object.fromEntries(STORES.map((s) => [s.id, []]));
  const items = recipe.items.map((it, idx) => {
    const ing = it.ing ? cat.get(it.ing) : null;
    const baseG = (it.g || 0) / base;
    const g1 = adj.perServe?.[idx] ?? baseG;
    const ratio = baseG ? g1 / baseG : 1;
    if (ing && baseG && g1 !== baseG) {
      for (const k of MACROS) per[k] += ((g1 - baseG) * ing[k]) / 100;
    }
    const totalG = g1 * servings;
    const q = it.q == null ? null : (it.q / base) * ratio * servings;
    if (ing && totalG > 0 && !it.optional) {
      for (const s of STORES) {
        const p = priceOf(ing, s.id, overrides);
        if (p) cost[s.id] += (totalG / ing.pack) * p.price;
        else missing[s.id].push(ing.name);
      }
    }
    return { ...it, idx, ingredient: ing, baseG, perG: g1, totalG, qty: q, changed: Math.abs(g1 - baseG) > 0.05 };
  });
  for (const k of MACROS) per[k] = Math.max(0, per[k]);
  const stores = STORES.map((s) => ({ ...s, total: cost[s.id], perServe: cost[s.id] / servings, missing: missing[s.id] }));
  const complete = stores.filter((s) => !s.missing.length);
  const pool = complete.length ? complete : stores;
  const best = pool.reduce((a, b) => (b.total < a.total ? b : a));
  return { recipe, servings, items, per, stores, best };
}

export const fmtQty = (n) => {
  if (n == null) return '';
  const r = n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 2) / 2 : Math.round(n * 100) / 100;
  return String(r);
};

// Rewrites amounts printed in a method step so they match the portions.
// Only touches gram and ml figures that belong to exactly one new amount.
export function stepText(step, view) {
  const map = new Map();
  const conflict = new Set();
  const add = (from, to, unit) => {
    if (!from || !to) return;
    const key = `${+from.toFixed(2)}${unit}`;
    if (map.has(key) && Math.abs(map.get(key) - to) > 0.01) conflict.add(key);
    map.set(key, to);
  };
  const base = view.recipe.servings || 1;
  for (const it of view.items) {
    if (!it.q || !['g', 'ml'].includes(it.unit)) continue;
    add(it.q, it.qty, it.unit);
    if (base > 1) add(it.q / base, it.qty / view.servings, it.unit);
  }
  let changed = false;
  const text = step.replace(/(\d+(?:\.\d+)?)\s?(g|ml)\b/gi, (all, num, u) => {
    const unit = u.toLowerCase();
    const key = `${+parseFloat(num).toFixed(2)}${unit}`;
    if (!map.has(key) || conflict.has(key)) return all;
    const to = map.get(key);
    if (Math.abs(to - parseFloat(num)) < 0.05) return all;
    changed = true;
    return `\u0001${fmtQty(to)}${unit}\u0002`;
  });
  return { text, changed };
}

// Moves the main protein and main carb so a serving lands near the target.
export function fitToTarget(recipe, adj, cat, target, overrides = {}) {
  const next = { servings: adj?.servings, perServe: { ...(adj?.perServe || {}) } };
  const pick = (macro, floor, skip) => {
    const v = viewRecipe(recipe, next, cat, overrides);
    let top = null;
    for (const it of v.items) {
      if (!it.ingredient || !it.q || it.optional || it.idx === skip) continue;
      const per100 = it.ingredient[macro];
      if (per100 < floor) continue;
      const load = it.perG * per100;
      if (!top || load > top.load) top = { it, load, per100 };
    }
    return top;
  };
  const move = (macro, goal, top) => {
    if (!top || !(goal > 0)) return;
    const cur = viewRecipe(recipe, next, cat, overrides).per[macro];
    const wanted = top.it.perG + ((goal - cur) * 100) / top.per100;
    const lo = top.it.baseG * 0.4;
    const hi = top.it.baseG * 1.8;
    next.perServe[top.it.idx] = roundStep(Math.min(hi, Math.max(lo, wanted)));
  };
  const protein = pick('p', 15);
  move('p', target.p, protein);
  move('c', target.c, pick('c', 15, protein?.it.idx));
  return next;
}
const roundStep = (g) => (g >= 40 ? Math.round(g / 5) * 5 : Math.round(g));

export function mealType(recipe) {
  if (recipe.tags?.includes('sweet')) return 'sweet';
  return recipe.kcal >= 280 ? 'meal' : 'snack';
}

export const perMealTarget = (t) => {
  const m = Math.max(1, t.meals || 3);
  return { kcal: t.kcal / m, p: t.p / m, c: t.c / m, f: t.f / m };
};

export function macroFit(per, target) {
  if (!target?.kcal) return 0.5;
  const e = (a, b) => (b ? Math.abs(a - b) / b : 0);
  const miss = e(per.kcal, target.kcal) * 0.45 + e(per.p, target.p) * 0.4 + e(per.c, target.c) * 0.1 + e(per.f, target.f) * 0.05;
  return Math.max(0, 1 - miss);
}

// Daily calorie and macro starting point: Mifflin-St Jeor, 2g protein per kg.
export function suggestTargets({ sex, kg, cm, age, activity, goal }) {
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === 'f' ? -161 : 5);
  const tdee = bmr * activity;
  const kcal = Math.round((tdee + goal) / 10) * 10;
  const p = Math.round(kg * 2);
  const f = Math.round((kcal * 0.25) / 9);
  const c = Math.max(0, Math.round((kcal - p * 4 - f * 9) / 4));
  return { kcal, p, c, f, tdee: Math.round(tdee) };
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}
const lastCooked = (log) => (log && log.length ? log[log.length - 1] : null);

export function nextDue(entry) {
  const last = lastCooked(entry?.log);
  if (!last) return null;
  const d = REPEAT_DAYS[last.stars ?? 3] ?? 30;
  return d === Infinity ? Infinity : last.at + d * DAY;
}

// Ranks recipes. opts: { mode, target, type, diet, seed, now, store }
export function suggest(recipes, history, cat, overrides, adjust, opts) {
  const now = opts.now ?? Date.now();
  const macro = opts.mode === 'macro' && opts.target?.kcal;
  const target = macro ? perMealTarget(opts.target) : null;
  const banned = new Set(opts.diet || []);
  const scored = [];
  for (const r of recipes) {
    if (opts.type && mealType(r) !== opts.type) continue;
    if (r.tags?.some((t) => banned.has(t))) continue;
    const entry = history[r.id];
    if (entry?.skipUntil > now) continue;
    const last = lastCooked(entry?.log);
    const stars = last?.stars ?? null;
    if (stars === 1) continue;
    let due = 0.7;
    let rest = 0;
    if (last) {
      const days = (now - last.at) / DAY;
      const every = REPEAT_DAYS[stars ?? 3];
      due = Math.min(1.3, days / every);
      rest = days / every;
      if (rest < 0.6) continue; // made too recently for its rating
    }
    const view = viewRecipe(r, adjust[r.id], cat, overrides);
    const taste = { 5: 1, 4: 0.8, 3: 0.5, 2: 0.2 }[stars] ?? 0.55;
    const scoreMacros = macro && mealType(r) === 'meal';
    const fit = scoreMacros ? macroFit(view.per, target) : 0;
    const cheap = Math.max(0, 1 - view.best.perServe / 9);
    const quick = r.mins ? Math.max(0, 1 - r.mins / 75) : 0.4;
    const jitter = hash(`${r.id}:${opts.seed ?? ''}`);
    const score = scoreMacros
      ? fit * 0.42 + due * 0.26 + taste * 0.18 + cheap * 0.08 + jitter * 0.06
      : due * 0.42 + taste * 0.26 + cheap * 0.12 + quick * 0.08 + jitter * 0.12;
    scored.push({ recipe: r, view, score, why: reasons({ r, last, stars, now, macro: scoreMacros, view, target }) });
  }
  return scored.sort((a, b) => b.score - a.score);
}

function reasons({ last, stars, now, macro, view, target }) {
  const out = [];
  if (!last) out.push("You haven't tried this yet");
  else {
    const d = Math.round((now - last.at) / DAY);
    const when = d < 14 ? `${d} days ago` : d < 60 ? `${Math.round(d / 7)} weeks ago` : `${Math.round(d / 30)} months ago`;
    out.push(`${stars ? `Rated ${stars}★, last` : 'Last'} made ${when}`);
  }
  if (macro) {
    const gap = Math.round(view.per.kcal - target.kcal);
    const size = Math.abs(gap);
    out.push(size <= 40 ? `Right on your meal target at ${Math.round(view.per.p)}g protein` : `${size} kcal ${gap > 0 ? 'over' : 'under'} your meal target`);
  }
  return out;
}

// Combines the planned meals into one list and prices it at each store.
// plan: [{ recipe, adj }]
export function shoppingList(plan, cat, overrides = {}, have = new Set()) {
  const lines = new Map();
  const toTaste = new Set();
  for (const { recipe, adj } of plan) {
    const v = viewRecipe(recipe, adj, cat, overrides);
    for (const it of v.items) {
      if (!it.ingredient) continue;
      if (!it.totalG) {
        if (it.ingredient.staple) toTaste.add(it.ingredient.id);
        continue;
      }
      if (it.optional) continue;
      const line = lines.get(it.ingredient.id) || { ingredient: it.ingredient, g: 0, recipes: new Set() };
      line.g += it.totalG;
      line.recipes.add(recipe.name);
      lines.set(it.ingredient.id, line);
    }
  }
  const buy = [];
  const owned = [];
  for (const line of lines.values()) {
    const ing = line.ingredient;
    const packs = Math.max(1, Math.ceil(line.g / ing.pack - 1e-9));
    const offers = STORES.map((s) => {
      const p = priceOf(ing, s.id, overrides);
      return { store: s.id, name: s.name, price: p?.price ?? null, own: !!p?.own, cost: p ? p.price * packs : null };
    });
    const row = { ...line, recipes: [...line.recipes], packs, offers, best: bestOffer(offers) };
    if (offers.every((o) => o.cost === 0)) continue; // tap water and the like
    if (have.has(ing.id)) owned.push(row);
    else buy.push(row);
  }
  buy.sort((a, b) => a.ingredient.aisle.localeCompare(b.ingredient.aisle) || a.ingredient.name.localeCompare(b.ingredient.name));
  const totals = STORES.map((s) => {
    let sum = 0;
    const absent = [];
    for (const row of buy) {
      const o = row.offers.find((x) => x.store === s.id);
      if (o.cost == null) absent.push(row.ingredient.name);
      else sum += o.cost;
    }
    return { ...s, total: sum, absent };
  });
  const mix = buy.reduce((n, row) => n + (row.best?.cost ?? 0), 0);
  return { buy, owned, totals, mix, toTaste: [...toTaste].map((id) => cat.get(id)) };
}
const bestOffer = (offers) => offers.filter((o) => o.cost != null).reduce((a, b) => (!a || b.cost < a.cost ? b : a), null);

// Reads one typed ingredient line, for recipes added by hand.
export function parseIngredientLine(line, rows) {
  const FR = { '½': 0.5, '¼': 0.25, '¾': 0.75 };
  const text = line.trim();
  const m = text.match(/^(\d+(?:\.\d+)?(?:\/\d+)?|[½¼¾])\s*(kg|g|ml|l|tbsp|tsp|cups?)?\b\.?\s*(.*)$/i);
  let q = null;
  let unit = null;
  let name = text;
  if (m) {
    q = FR[m[1]] ?? (m[1].includes('/') ? m[1].split('/').reduce((a, b) => a / b) : parseFloat(m[1]));
    unit = (m[2] || 'each').toLowerCase();
    name = m[3];
  }
  const low = name.toLowerCase();
  const row = rows.find((r) => new RegExp(r.rx, 'i').test(low)) || null;
  let g = 0;
  if (q != null) {
    const tsp = row?.tsp || 5;
    g = { g: q, kg: q * 1000, ml: q, l: q * 1000, tsp: q * tsp, tbsp: q * tsp * 3, cup: q * 240, cups: q * 240 }[unit] ?? q * (row?.each || 30);
  }
  return { text, sec: null, name: low, ing: row?.id ?? null, optional: /optional/i.test(text), q, unit, g: Math.round(g * 10) / 10 };
}

// Checks an imported recipe pack before anything is saved.
export function readPack(data) {
  if (!data || data.format !== 'meals-pack' || !Array.isArray(data.recipes)) throw new Error('That file is not a Meals recipe file.');
  const ok = data.recipes.filter((r) => r && r.id && r.name && Array.isArray(r.items) && Number.isFinite(r.kcal));
  if (!ok.length) throw new Error('No recipes found in that file.');
  return ok;
}

export const aud = (n) => `$${n.toFixed(2)}`;
