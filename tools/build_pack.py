# Turn the extracted cookbook text (see tools/README.md) into a private recipe pack.
# usage: python3 tools/build_pack.py <raw.json> <private/recipes-pack.json>
# Output contains book content: it must stay out of git (private/ is ignored).
import json, re, sys, statistics
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from catalogue import ROWS

CAT = [(r, re.compile(r["rx"], re.I)) for r in ROWS]
BY_ID = {r["id"]: r for r in ROWS}

QTY = r"\d+(?:\.\d+)?(?:\s*/\s*\d+)?|[½¼¾⅓⅔]|half|one|two|three"
RANGE = r"(?:\s*(?:-|to)\s*\d+(?:\.\d+)?)?"
UNIT = r"kg|g|ml|l|tbsp|tsp|teaspoons?|tablespoons?|cups?|servings?|slices?|packets?|cans?|x"
HEAD = re.compile(rf"^\s*({QTY}){RANGE}\s*({UNIT})?(?![a-z])\.?\s*(.*)$", re.I | re.S)
STRONG = re.compile(rf"^\s*(?:{QTY}){RANGE}\s*(?:{UNIT}|[A-Z(])", re.I)
GLUE = re.compile(r"\s(?=\d+(?:\.\d+)?\s?(?:g|ml|kg|Tbsp|Tsp)\s+[A-Za-z])")
NOQ = re.compile(r"^(salt|pepper|garlic powder|onion powder|parsley|chives|oregano|paprika|smoked paprika|chilli|chili|fresh |seasoning|cooking|light cooking|olive oil spray|oil spray|spinach|chopped spinach|coriander|sesame|cucumber|dash|pinch|same seasonings|mixed herbs|cinnamon|basil|rocket|lettuce|shredded|spray|water|ice|cajun|italian|cumin|thyme|rosemary|sprinkles?|handful|lime|lemon|jalap)", re.I)
OPEN_END = re.compile(r"(?:,|&|/|-|\bof|\bor|\beach of|\bsmoked|\bdiced|\bchopped|\bcanned|\bsliced|\bfresh|\bgrated|\blight|\blow|\bcherry|\bred|\bchilli|\bgarlic|\bsweet|\bhoney|\bshredded)\s*$", re.I)
SEC = re.compile(r"^\(?\s*(ingredients?\b.*|(?:sauce|marinade|toppings?|filling|base|batter|dough|crumb|coating|frosting|icing|glaze|mixture|slaw|dressing|for the [a-z ]+|optional toppings)\)?:?)\s*\)?:?\s*$", re.I)
JUNK = re.compile(r"\*|k tip|👇|macros note|^x\s?\d|your liking!$|\bCAL\b|CALORIES|minutes?\)|\d\s?cm\b|^\d+\s*-$|^\d+\s*x\b|^\(?optional & customisable\)?$|^(optional )?toppings?:?( \(optional.*\))?$|^protein icing:?$|^store$|^recipe$|^container - \d+ total\)?$|^low calorie cooking$", re.I)
FR = {"½": .5, "¼": .25, "¾": .75, "⅓": 1/3, "⅔": 2/3, "half": .5, "one": 1, "two": 2, "three": 3}
WORDS = {"meal", "meals", "burrito", "burritos", "serve", "serving", "servings", "wrap", "wraps", "roll", "rolls", "pita", "pitas", "sandwich", "taco", "tacos", "bagel", "bagels", "container", "boat", "boats", "donut", "donuts", "crepe", "crepes", "person", "portion"}


def num(s):
    s = s.strip().lower()
    if s in FR: return FR[s]
    if "/" in s:
        a, b = s.split("/")
        return float(a) / float(b)
    return float(s)


def bal(s): return s.count("(") <= s.count(")")


def merge(lines):
    items, notes, sec = [], [], None
    for ln in lines:
        s = ln.strip()
        if not s: continue
        if JUNK.search(s): continue
        if len(s) > 12 and s.upper() == s and not re.match(r"^\d", s):
            notes.append(s); continue
        if SEC.match(s) and (not items or bal(items[-1]["raw"])):
            sec = s.strip("() :"); sec = re.sub(r"^ingredients?\s*\(?", "", sec, flags=re.I).strip() or None; continue
        new = False
        if not items: new = True
        elif STRONG.match(s) and re.match(r"^\s*(?:\d|[½¼¾⅓⅔])", s) and not re.match(r"^\s*\d+\s*(?:g|ml)?\s*(?:raw|cooked|per|in|each|total|is)\b", s): new = True
        elif not bal(items[-1]["raw"]): new = False
        elif OPEN_END.search(items[-1]["raw"]): new = False
        elif NOQ.match(s): new = True
        if new: items.append(dict(raw=s, sec=sec))
        else: items[-1]["raw"] += " " + s
    return split_all(items), notes


AMT = re.compile(r"\s(?:\d+(?:\.\d+)?(?:\s*/\s*\d+)?\s?(?:g|ml|kg|tbsp|tsp)\s+[A-Za-z(]|\d+\s+(?:large|small|low|diced|egg|garlic|slices?|servings?)\b)", re.I)
PREP = re.compile(r"\(?(?:ingredients\s+)?(?:per\s+meal\s+prep\s+\w+|meal\s+prep\s+per\s+\w+)[^)\d]*(?:\d+\s*total)?\s*\)?", re.I)
LEAD = re.compile(r"^\(([^)]*)\)\s+(?=[\d])")


def split_one(raw):
    """Split text the PDF ran together, only outside brackets."""
    parts, cur, depth, i = [], "", 0, 0
    while i < len(raw):
        ch = raw[i]
        if depth == 0 and ch.isspace():
            rest = raw[i:]
            after_close = cur.rstrip().endswith(")") and re.match(r"\s+[A-Z]", rest) and not re.match(r"\s+(Per|Or|And|Each)\b", rest)
            serving_only = re.match(r"^[\d./ ]+\s*servings?\s*\(\d+g\)$", cur.strip(), re.I)
            if cur.rstrip().endswith("-"): after_close = False
            if serving_only: after_close = False
            if cur.strip() and ((AMT.match(rest) and not cur.rstrip().endswith("-")) or after_close):
                parts.append(cur.strip()); cur = ""; i += 1; continue
        if ch == "(": depth += 1
        if ch == ")": depth = max(0, depth - 1)
        cur += ch; i += 1
    if cur.strip(): parts.append(cur.strip())
    return parts


def split_all(items):
    out, forced = [], None
    for it in items:
        raw, sec = it["raw"], it["sec"]
        l = LEAD.match(raw)
        if l: sec, raw = l[1], raw[l.end():]
        m = PREP.search(raw)
        chunks = [(raw, False)]
        if m: chunks = [(raw[:m.start()], False), (raw[m.end():], True)]
        for text, after in chunks:
            if after: forced = "Per meal"
            for p in split_one(text.strip()):
                if len(re.findall(r"\b\S{1,2}\b", p)) > 0.55 * max(1, len(p.split())) and len(p.split()) > 4: continue
                out.append(dict(raw=p, sec=forced or sec))
    return out


def servings_of(basis):
    m = re.search(r"\(\s*(\d+)", basis or "")
    if re.match(r"\s*TOTAL", basis or "", re.I): return 1, "whole recipe", True
    if m:
        u = re.search(r"\(\s*\d+\s*([A-Za-z]+)", basis)
        word = u[1].lower() if u else "serve"
        return int(m[1]), word.rstrip("s") if word not in ("in",) else "serve", True
    return None, "serve", False


def match(name, raw):
    for r, rx in CAT:
        if rx.search(name): return r["id"]
    for r, rx in CAT:
        if rx.search(raw): return r["id"]
    return None


def clean_name(s):
    s = re.sub(r"\(.*?\)|\(.*$", "", s)
    s = re.sub(r"\s+", " ", s).strip(" ,.-&").lower()
    return s


def to_grams(q, unit, r):
    if unit in ("g",): return q
    if unit == "kg": return q * 1000
    if unit == "ml": return q
    if unit == "l": return q * 1000
    tsp = (r or {}).get("tsp") or 5
    if unit in ("tsp", "teaspoon", "teaspoons"): return q * tsp
    if unit in ("tbsp", "tablespoon", "tablespoons"): return q * tsp * 3
    if unit in ("cup", "cups"): return q * (50 if (r or {}).get("id") in ("lettuce", "spinach", "rocket") else 240)
    if unit in ("serving", "servings"): return q * ((r or {}).get("serving") or (r or {}).get("each") or 30)
    if unit in ("slice", "slices"):
        e = (r or {}).get("each") or 25
        return q * (e if e <= 40 else 25)
    if unit in ("packet", "packets", "can", "cans"): return q * ((r or {}).get("pack") or 100)
    if q >= 12 and ((r or {}).get("each") or 0) >= 100: return q  # book typo: "60 Diced Red Onion" means 60g
    return q * ((r or {}).get("each") or 30)


def parse_item(it, servings):
    raw = re.sub(r"\s+", " ", it["raw"]).strip()
    m = HEAD.match(raw)
    q, unit, rest = None, None, raw
    if m and not re.match(r"^\d+%", raw):
        q, unit, rest = num(m[1]), (m[2] or "").lower() or "each", m[3]
    name = clean_name(rest)
    rid = match(name, raw.lower()) if name or raw else None
    r = BY_ID.get(rid)
    optional = bool(re.search(r"optional", raw, re.I))
    to_taste = q is None
    per_serve = False
    if not to_taste:
        # "30g cheese (per burrito)" -> amount is per serve; "360g potato (60g per burrito)" -> already total
        pm = re.search(r"\(\s*(\d+\s*(?:g|ml)?\s+)?(?:in\s+each|per)\s+([a-z]+)", raw, re.I)
        if pm and pm[2].lower() in WORDS and not pm[1]: per_serve = True
        sec = (it.get("sec") or "").lower()
        if re.search(r"per (meal|serve|burrito|container)", sec): per_serve = True
    mul = servings if per_serve and servings > 1 else 1
    out = dict(text=raw, sec=it.get("sec"), name=name or raw.lower(), ing=rid, optional=optional)
    if to_taste:
        out.update(q=None, unit=None, g=0)
    else:
        total_q = q * mul
        out.update(q=round(total_q, 3), unit=unit, g=round(to_grams(total_q, unit, r), 1))
    return out


def macro_of(items):
    t = dict(kcal=0, p=0, c=0, f=0)
    for i in items:
        r = BY_ID.get(i["ing"])
        if not r or not i["g"] or i["optional"]: continue
        for k in t: t[k] += i["g"] * r[k] / 100
    return t


def steps_of(lines):
    steps, notes, first = [], [], None
    for ln in lines:
        s = ln.strip()
        if not s or JUNK.search(s): continue
        if len(s) > 12 and s.upper() == s and not re.match(r"^\d+\s*[.)]", s):
            notes.append(s); continue
        m = re.match(r"^(\d+)\s*[.)]\s*(.*)$", s)
        if m:
            if first is None: first = int(m[1])
            steps.append(m[2])
        elif steps: steps[-1] += " " + s
        else: steps.append(s)
    return [re.sub(r"\s+", " ", x).strip() for x in steps if x.strip()], notes, first or 1


NAME_DROP = re.compile(r"\b(LOW CALORIE|LOW CAL|LOW FAT|HIGH PROTE?IN|HIGH PROTIEN|LOWER CALORIE|ANABOLIC)\b( &)?", re.I)
SMALL = {"and", "with", "of", "in", "on", "the", "a"}


def title(s):
    s = NAME_DROP.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip(" &-/")
    words = [w if w in ("BBQ", "HSP", "PB", "PB&J", "KFC", "BLT") else (w.lower() if w.lower() in SMALL and i else w.capitalize()) for i, w in enumerate(s.split())]
    return " ".join(words) or s


def tags(x, items):
    n = (x["title"] + " " + " ".join(i["name"] for i in items)).lower()
    t = ["sweet" if x["page"] >= 105 else "savoury"]
    ids = {i["ing"] for i in items}
    for tag, keys in dict(chicken=["chicken_breast", "chicken_thigh", "chicken_mince", "chicken_cooked", "chicken_tenders"],
                          beef=["beef_extra_lean", "beef_lean", "beef_strips", "chipolatas"], seafood=["prawns", "tuna", "tuna_chilli"],
                          turkey=["turkey_mince"], pork=["bacon", "bacon_diced", "ham", "chorizo"]).items():
        if ids & set(keys): t.append(tag)
    if not ({"chicken", "beef", "seafood", "turkey", "pork"} & set(t)): t.append("vegetarian")
    return t


def main(src, dst):
    raw = json.load(open(src, encoding="utf8"))
    recipes, report = [], []
    for x in raw:
        if x["kcal"] is None: continue
        if None in (x["c"], x["f"], x["p"]):  # page 150-style: blank carbs etc: recover below
            pass
        items_raw, notes = merge(x["ing"])
        s, label, known = servings_of(x["basis"])
        # first pass with a provisional count, so per-serve lines scale correctly
        provisional = s or 1
        items = [parse_item(i, provisional) for i in items_raw]
        calc = macro_of(items)["kcal"]
        guessed = False
        if not known:
            said = re.search(r"\b(?:into|makes?|between)\s+(\d+)\s+(?:even\s+|equal\s+|large\s+|small\s+)*(?:pieces?|slices?|servings?|portions?|rolls?|donuts?|balls?|cookies|bars?|squares?|muffins?|bites?|pancakes?)\b", " ".join(x["dir"]), re.I)
            s = int(said[1]) if said else (max(1, round(calc / x["kcal"])) if x["kcal"] else 1)
            guessed = not said and s > 1
            items = [parse_item(i, s) for i in items_raw]
            calc = macro_of(items)["kcal"]
        book_total = x["kcal"] * (s if re.match(r"\s*TOTAL", x["basis"] or "", re.I) is None else 1)
        ratio = calc / book_total if book_total else 0
        st, stn, first = steps_of(x["dir"])
        recipes.append(dict(id=f"af-{x['page']}", name=title(x["title"]), page=x["page"], source=BOOK,
                            servings=s, unit=label if known else "serve", mins=x["mins"],
                            kcal=x["kcal"], p=x["p"] if x["p"] is not None else round(max(0, (x["kcal"] - 4 * x["c"] - 9 * x["f"]) / 4)), c=x["c"], f=x["f"], tags=tags(x, items),
                            items=items, steps=st, firstStep=first, notes=[n.capitalize() for n in notes + stn + x.get("foot", [])],
                            check=round(ratio, 2), servingsGuessed=guessed))
        report.append((round(ratio, 2), x["page"], title(x["title"]), s, x["basis"]))
    pack = dict(format="meals-pack", version=1, name=BOOK, recipes=recipes)
    json.dump(pack, open(dst, "w", encoding="utf8"), ensure_ascii=False)
    print(len(recipes), "recipes")
    ratios = [r[0] for r in report]
    print("median calc/book", statistics.median(ratios), "within 25%:", sum(.75 <= r <= 1.25 for r in ratios), "within 40%:", sum(.6 <= r <= 1.4 for r in ratios))
    un = {}
    for r in recipes:
        for i in r["items"]:
            if i["ing"] is None: un[i["name"]] = i["text"]
    print("unmatched", len(un))
    for k, v in list(un.items())[:120]: print("  ?", k[:50], "<=", v[:70])
    print("OUTLIERS")
    for r in sorted(report):
        if not .6 <= r[0] <= 1.4: print(" ", r)


BOOK = sys.argv[3] if len(sys.argv) > 3 else "My cookbook"
main(*sys.argv[1:3])
