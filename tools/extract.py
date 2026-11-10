import re,sys,json,html
src,out=sys.argv[1],sys.argv[2]
t=open(src,encoding='utf8').read()
pages=re.findall(r'<page[^>]*>(.*?)</page>',t,re.S)
def lines(pg):
    r=[]
    for m in re.finditer(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</line>',pg,re.S):
        ws=[]
        for w in re.finditer(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>',m[5],re.S):
            ws.append((float(w[1]),float(w[2]),float(w[3]),float(w[4]),html.unescape(w[5])))
        r.append(dict(x=float(m[1]),y=float(m[2]),X=float(m[3]),Y=float(m[4]),ws=ws,t=' '.join(w[4] for w in ws)))
    return r
res=[];skipped=[]
for i,pg in enumerate(pages,12):
    L=[l for l in lines(pg) if not re.search(r'@|^PAGE\b|^#\d+$|^P ?PA',l['t'])]
    ih=next((l for l in L if re.match(r'INGREDIENTS?\b',l['t'].strip(),re.I) and l['x']<300),None)
    dh=next((l for l in L if re.match(r'(DIRECTIONS?|METHOD|INSTRUCTIONS?)\b',l['t'].strip(),re.I)),None)
    full=' '.join(l['t'] for l in L)
    cal=re.search(r'CALORIES:?\s*([\d.]+)',full,re.I)
    if not ih or not cal:
        skipped.append((i,full[:90])); continue
    def g(k):
        m=re.search(k+r':?\s*([\d.]+)',full,re.I); return float(m[1]) if m else None
    top=[l for l in L if l['y']<ih['y']-1]
    basis=' '.join(l['t'] for l in top if re.search(r'PER|TOTAL|\(\s*\d',l['t']) and not re.search('LOW CAL|HIGH',l['t']))
    tm=re.search(r'(\d+)\s*(?:-\s*\d+\s*)?(MIN|HOUR|HR)',' '.join(l['t'] for l in top),re.I)
    nutx=min([l['x'] for l in top if re.search(r'CALORIES|NUTRITIONAL',l['t'])]or[400])
    title=' '.join(l['t'] for l in sorted(top,key=lambda a:a['y']) if l['x']<nutx-10 and not re.search(r'NUTRITION|^\s*\d+\s*(MIN|HOUR)',l['t']))
    dx=dh['x'] if dh else 300
    # lines may be merged across columns: split at words
    ing=[];dir_=[];foot=[]
    for l in sorted(L,key=lambda a:(round(a['y']),a['x'])):
        if l['y']<=ih['y']+2: continue
        if re.match(r'(INGREDIENTS|DIRECTIONS)\b',l['t']): continue
        if l['x']<dx-8 and l['X']>dx+40 and l['t'].upper()==l['t'] and len(l['t'])>30: foot.append(l['t']); continue
        left=[w for w in l['ws'] if w[0]<dx-8]; right=[w for w in l['ws'] if w[0]>=dx-8]
        if left: ing.append(' '.join(w[4] for w in left))
        if right: dir_.append(' '.join(w[4] for w in right))
    res.append(dict(page=i,title=title,basis=basis,mins=(int(tm[1])*(60 if tm[2].upper()!='MIN' else 1)) if tm else None,
      kcal=g('CALORIES'),c=g('CARBS'),f=g('FATS?'),p=g('PROTEIN'),ing=ing,dir=dir_,foot=foot))
json.dump(res,open(out,'w',encoding='utf8'),ensure_ascii=False,indent=0)
print(len(res),'recipes; skipped',len(skipped))
for s in skipped: print(s)
