# -*- coding: utf-8 -*-
"""
單字的時態／詞形變化（forms）、補充衍生字（der）、滿分單字自編例句 → 寫進教材

  python tools/add_wordforms.py pack <教材包.json>   # 國際學村：packs/src/forms_core.txt ＋ fullex_dayNN.txt
  python tools/add_wordforms.py video                # 影片課程：tools/forms_video.txt → tools/episodes/*.json
  python tools/add_wordforms.py check                # 只做檢查，不寫檔

來源檔格式（TAB 分隔）：單字 | 變化 | 衍生字 [| 例句 | 中譯]
  變化：「v: 三單, 過去式, 過去分詞, 現在分詞 ; n: 複數 ; adj: 比較級, 最高級」，中文值＝說明（如「不可數」），「—」＝無變化
  衍生字：「字 詞性. 中文 | 字 詞性. 中文」
  例句／中譯：兩種詞性各一句時用「 || 」分隔
寫進單字的欄位：forms=[{p:'v.', f:[['過去式','applied'],…]} 或 {p:'n.', note:'不可數'}]、der=['employment n. 雇用', …]、
  ex=[{en, zh, ai:1}]（ai＝AI 自編，App 會標示，和課本原句區分）
"""
import glob, io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LABELS = {'v': ['三單', '過去式', '過去分詞', '現在分詞'], 'n': ['複數'], 'adj': ['比較級', '最高級'], 'adv': ['比較級', '最高級']}
HAN = re.compile(r'[一-鿿]')


def parse_forms(s):
    s = s.strip()
    if s in ('—', '-', ''):
        return []
    out = []
    for grp in s.split(' ; '):
        tag, _, val = grp.partition(':')
        tag, val = tag.strip(), val.strip()
        if tag not in LABELS:
            raise ValueError('不認得的詞性標記 %r' % grp)
        if HAN.search(val) and ',' not in val:
            out.append({'p': tag + '.', 'note': val})
            continue
        vals = [v.strip() for v in val.split(',')]
        if len(vals) != len(LABELS[tag]):
            raise ValueError('%s 需要 %d 個值：%r' % (tag, len(LABELS[tag]), grp))
        out.append({'p': tag + '.', 'f': [[l, v] for l, v in zip(LABELS[tag], vals)]})
    return out


def parse_der(s):
    s = s.strip()
    return [] if s in ('—', '-', '') else [x.strip() for x in s.split(' | ')]


def read(path):
    rows = {}
    for n, line in enumerate(io.open(path, encoding='utf-8'), 1):
        line = line.rstrip('\n')
        if not line.strip() or line.startswith('#'):
            continue
        cols = line.split('\t')
        try:
            r = {'forms': parse_forms(cols[1]), 'der': parse_der(cols[2])}
            if len(cols) >= 5:
                en = [x.strip() for x in cols[3].split('||')]
                zh = [x.strip() for x in cols[4].split('||')]
                if len(en) != len(zh):
                    raise ValueError('例句與中譯數量不同')
                r['ex'] = [{'en': a, 'zh': b, 'ai': 1} for a, b in zip(en, zh)]
        except Exception as e:
            sys.exit('%s 第 %d 行（%s）：%s' % (os.path.basename(path), n, cols[0], e))
        rows[cols[0].strip()] = r
    return rows


# ---------- 自動檢查 ----------
IRREG = {  # 會用到的不規則動詞：原形 → (過去式, 過去分詞)
    'meet': ('met', 'met'), 'send': ('sent', 'sent'), 'lay': ('laid', 'laid'), 'set': ('set', 'set'),
    'take': ('took', 'taken'), 'get': ('got', 'got/gotten'), 'go': ('went', 'gone'), 'make': ('made', 'made'),
    'bend': ('bent', 'bent'), 'let': ('let', 'let'), 'write': ('wrote', 'written'), 'come': ('came', 'come'),
    'give': ('gave', 'given'), 'hold': ('held', 'held'), 'keep': ('kept', 'kept'), 'put': ('put', 'put'),
    'stand': ('stood', 'stood'), 'draw': ('drew', 'drawn'), 'oversee': ('oversaw', 'overseen'), 'leave': ('left', 'left'),
    'speak': ('spoke', 'spoken'), 'throw': ('threw', 'thrown'), 'shut': ('shut', 'shut'), 'is': ('was', 'been'),
    'has': ('had', 'had'), 'have': ('had', 'had'), 'strive': ('strove/strived', 'striven/strived'), 'strew': ('strewed', 'strewn/strewed'),
    'upsell': ('upsold', 'upsold'), 'overcome': ('overcame', 'overcome'), 'pay': ('paid', 'paid'), 'think': ('thought', 'thought'),
    'undertake': ('undertook', 'undertaken'), 'sit': ('sat', 'sat'), 'lose': ('lost', 'lost'),
    'do': ('did', 'done'), 'redo': ('redid', 'redone'), 'bring': ('brought', 'brought'), 'proofread': ('proofread', 'proofread'),
    'read': ('read', 'read'), 'begin': ('began', 'begun'), 'slide': ('slid', 'slid'), 'win': ('won', 'won'),
    'show': ('showed', 'shown'), 'lend': ('lent', 'lent'), 'buy': ('bought', 'bought'), 'find': ('found', 'found'),
    'run': ('ran', 'run'), 'drive': ('drove', 'driven'), 'wind': ('wound', 'wound'), 'fall': ('fell', 'fallen'),
    'cast': ('cast', 'cast'), 'speed': ('sped', 'sped'), 'rise': ('rose', 'risen'), 'lead': ('led', 'led'),
    'fit': ('fitted/fit', 'fitted/fit'), 'keep': ('kept', 'kept'), 'stand': ('stood', 'stood'),
}


def regular(base):
    """規則變化：(三單, 過去式, 現在分詞)"""
    b = base
    third = b + 'es' if re.search(r'(s|x|z|ch|sh)$', b) else (b[:-1] + 'ies' if re.search(r'[^aeiou]y$', b) else b + 's')
    if re.search(r'[^aeiou]y$', b):
        past, ing = b[:-1] + 'ied', b + 'ing'
    elif b.endswith('ee'):
        past, ing = b + 'd', b + 'ing'
    elif b.endswith('e'):
        past, ing = b + 'd', b[:-1] + 'ing'
    else:
        past, ing = b + 'ed', b + 'ing'
    return third, past, ing


DOUBLE = {'log', 'set', 'get', 'let', 'put', 'shut', 'wrap', 'propel', 'sit', 'stop', 'ban', 'submit', 'admit', 'excel', 'lag', 'scrub', 'control', 'drop', 'plan', 'regret', 'refer', 'occur', 'prefer', 'permit', 'spike', 'drag', 'grip', 'jog', 'win', 'begin', 'commit', 'run', 'unplug', 'shop', 'fit'}


def check_verb(word, f):
    """檢查動詞四種形式的第一個字（片語只看動詞本身）。回傳問題清單。"""
    w0 = word.split()[0]                                   # eagerly await：副詞不變，看第二個字
    k = 1 if len(word.split()) > 1 and all(v.split()[0] == w0 for _, v in f) else 0
    head = lambda s: s.split()[k]
    got = [head(v) for _, v in f]
    base = word.split()[k]
    if base in ('be',):
        base = 'is'
    probs = []
    third, past, ing = regular(base)
    if base in DOUBLE and base != 'spike':
        past, ing = base + base[-1] + 'ed', base + base[-1] + 'ing'
    exp_past, exp_pp = IRREG.get(base, (past, past))
    if base == 'is':
        third, ing = 'is', 'being'
    if base in ('has', 'have'):
        third, ing = 'has', 'having'
    if base.endswith(('go', 'do')):
        third = base + 'es'
    exp = [third, exp_past, exp_pp, ing]
    for (lab, _), g, e in zip(f, got, exp):
        if g != e and not (base == 'get' and lab == '過去分詞' and g in ('got', 'got/gotten', 'gotten')):
            probs.append('%s %s=%s（規則推算 %s）' % (word, lab, g, e))
    return probs


def check_rows(name, rows, words):
    probs = []
    for w, r in rows.items():
        if words is not None and w not in words:
            probs.append('%s：教材裡沒有這個字' % w)
        for g in r['forms']:
            if g['p'] == 'v.' and 'f' in g:
                probs += check_verb(w, g['f'])
        for e in r.get('ex', []):
            forms_all = {w.lower()} | {v.lower() for g in r['forms'] for _, v in g.get('f', [])}
            keys = set()
            for x in forms_all:                                # 片語取主要實詞比對（one's、A、~ 之類略過）
                keys |= {t for t in re.split(r'[\s/]+', x) if len(t) > 1 and t not in ("one's", 'someone', 'the', 'a', 'an', 'to', 'of', 'do')}
            low = e['en'].lower()
            if not any(re.search(r'\b' + re.escape(k.strip('()~-=')) + r'\b', low) for k in keys if k.strip('()~-=')):
                probs.append('%s：例句裡找不到這個字 → %s' % (w, e['en']))
            if not re.search(r'[.?!]$', e['en']) or not e['en'][0].isupper():
                probs.append('%s：例句首尾格式 → %s' % (w, e['en']))
            if not re.search(r'[。？！]$', e['zh']):
                probs.append('%s：中譯結尾標點 → %s' % (w, e['zh']))
    if words is not None:
        miss = [w for w in words if w not in rows]
        if miss:
            probs.append('缺資料：%s' % miss)
    print('── %s：%d 字，%d 個待確認' % (name, len(rows), len(probs)))
    for p in probs:
        print('   ', p)
    return probs


def apply(words, rows):
    n = 0
    for w in words:
        r = rows.get(w['w'])
        if not r:
            continue
        w['forms'] = r['forms']
        if r['der'] and not w.get('fam'):
            w['der'] = r['der']
        elif 'der' in w:
            del w['der']
        if 'ex' in r:                                          # 只有滿分單字會帶例句；保留已產生的語音檔名
            old = {e['en']: e.get('aus') for e in w.get('ex', [])}
            w['ex'] = [dict(e, **({'aus': old[e['en']]} if old.get(e['en']) else {})) for e in r['ex']]
        n += 1
    return n


def src(*p):
    return os.path.join(ROOT, *p)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    core = read(src('packs', 'src', 'forms_core.txt'))
    fulls = {re.search(r'day(\d+)', f).group(1): read(f) for f in sorted(glob.glob(src('packs', 'src', 'fullex_day*.txt')))}
    video = read(src('tools', 'forms_video.txt'))
    pack_path = sys.argv[2] if mode == 'pack' else os.path.join(ROOT, 'packs', '國際學村_Day01-03.json')
    pack = json.load(io.open(pack_path, encoding='utf-8'))
    units = {u['id']: u for u in pack['courses'][0]['units']}
    core_words = [w['w'] for k, u in units.items() if not u.get('full') for w in u['words']]
    total = check_rows('核心單字', core, core_words)
    for d, rows in fulls.items():
        total += check_rows('Day %s 滿分' % d, rows, [w['w'] for w in units['day%s-full' % d]['words']])
    eps = {p: json.load(io.open(p, encoding='utf-8')) for p in sorted(glob.glob(src('tools', 'episodes', '*.json')))}
    total += check_rows('影片單字', video, [w['w'] for s in eps.values() for w in s['words']])
    if mode == 'pack':
        n = sum(apply(u['words'], core) for u in units.values() if not u.get('full'))
        for d, rows in fulls.items():
            n += apply(units['day%s-full' % d]['words'], rows)
        json.dump(pack, io.open(pack_path, 'w', encoding='utf-8'), ensure_ascii=False)
        print('已寫入教材包 %d 字 → %s' % (n, pack_path))
    elif mode == 'video':
        n = 0
        for p, s in eps.items():
            n += apply(s['words'], video)
            io.open(p, 'w', encoding='utf-8').write(json.dumps(s, ensure_ascii=False, indent=1))
        print('已寫入影片單字 %d 字，記得跑 build_video_units.py course' % n)


if __name__ == '__main__':
    main()
