# -*- coding: utf-8 -*-
"""
滿分單字補 KK 音標（課本的滿分單字表沒有音標，核心 40 字才有）

  python tools/add_phonetics.py draft             # 由 CMU 發音字典轉 KK，寫 packs/src/ph_fullscore.txt（已有的列不動）
  python tools/add_phonetics.py pack <教材包.json> # 依 ph_fullscore.txt 把 ph 寫進 dayNN-full 單元

ph_fullscore.txt 是 TAB 分隔「單字<TAB>[KK]」，draft 產生後要人工逐字核對；
查不到的字會標 ??，必須手動補上才能 pack。格式比照課本核心字：ˋ主重音、ˏ次重音、單音節不標。
需要 pip install cmudict。
"""
import glob, io, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PH_FILE = os.path.join(ROOT, 'packs', 'src', 'ph_fullscore.txt')

V = {'AA': 'ɑ', 'AE': 'æ', 'AO': 'ɔ', 'AW': 'aʊ', 'AY': 'aɪ', 'EH': 'ɛ', 'EY': 'e', 'IH': 'ɪ',
     'IY': 'i', 'OW': 'o', 'OY': 'ɔɪ', 'UH': 'ʊ', 'UW': 'u'}
C = {'B': 'b', 'CH': 'tʃ', 'D': 'd', 'DH': 'ð', 'F': 'f', 'G': 'ɡ', 'HH': 'h', 'JH': 'dʒ', 'K': 'k',
     'L': 'l', 'M': 'm', 'N': 'n', 'NG': 'ŋ', 'P': 'p', 'R': 'r', 'S': 's', 'SH': 'ʃ', 'T': 't',
     'TH': 'θ', 'V': 'v', 'W': 'w', 'Y': 'j', 'Z': 'z', 'ZH': 'ʒ'}
ONSETS = {'pl', 'pr', 'bl', 'br', 'tr', 'dr', 'kl', 'kr', 'ɡl', 'ɡr', 'fl', 'fr', 'θr', 'ʃr', 'sp', 'st',
          'sk', 'sm', 'sn', 'sl', 'sw', 'spl', 'spr', 'str', 'skr', 'skw', 'kw', 'tw', 'dw', 'ɡw',
          'pj', 'bj', 'kj', 'mj', 'fj', 'vj', 'hj', 'nj', 'lj', 'θw', 'sj'}


def kk_word(phones):
    """CMU 音素串 → KK（含重音符號）"""
    segs = []                                   # [(音, 重音 or None)]
    for p in phones:
        m = re.match(r'([A-Z]+)(\d)?$', p)
        base, st = m.group(1), m.group(2)
        if st is None:
            segs.append([C[base], None])
        elif base == 'ER':
            segs.append(['ɝ' if st in '12' else 'ɚ', st])
        elif base == 'AH':
            segs.append(['ʌ' if st in '12' else 'ə', st])
        else:
            segs.append([V[base] if not (base == 'IY' and st == '0') else 'ɪ', st])
    # aɪ／aʊ＋ɚ 併成一個音節（hire [haɪr]、attire [əˋtaɪr]）
    i = 0
    while i < len(segs) - 1:
        if segs[i][0] in ('aɪ', 'aʊ') and segs[i + 1][0] == 'ɚ':
            segs[i + 1] = ['r', None]
        i += 1
    # 母音前的 ɚ 拆成 ə＋r（reference [ˋrɛfərəns]、corporation）
    i = 0
    while i < len(segs) - 1:
        if segs[i][0] == 'ɚ' and segs[i + 1][1] is not None:
            segs[i:i + 1] = [['ə', '0'], ['r', None]]
        i += 1
    nsyl = sum(1 for s in segs if s[1] is not None)
    # 字尾「子音＋əl」寫成 l（professional、sample），但仍算一個音節
    if len(segs) >= 3 and segs[-1][0] == 'l' and segs[-2][0] == 'ə' and segs[-3][1] is None:
        del segs[-2]
    vows = [i for i, s in enumerate(segs) if s[1] is not None]
    # 字首緊接主重音的次重音不標（impressed [ɪmˋprɛst]）；字尾 -y 的次重音也不標
    if len(vows) > 1 and segs[vows[0]][1] == '2' and segs[vows[1]][1] == '1':
        segs[vows[0]][1] = '0'
    if len(vows) > 1 and vows[-1] == len(segs) - 1 and segs[-1][0] == 'i' and segs[-1][1] == '2':
        segs[-1] = ['ɪ', '0']
    # -ically：kəlɪ → klɪ（electronically）
    if len(segs) >= 4 and [s[0] for s in segs[-4:]] == ['k', 'ə', 'l', 'ɪ']:
        del segs[-3]; nsyl -= 1
    marks = {}
    if nsyl > 1:
        prev = -1
        for vi in vows:
            st = segs[vi][1]
            if st in '12':
                cons = [segs[k][0] for k in range(prev + 1, vi)]
                take = 0
                for n in range(len(cons), 0, -1):          # 最大首音
                    cl = ''.join(cons[-n:])
                    if n == 1 or cl in ONSETS:
                        if n == 1 and cons[-1] == 'ŋ':
                            continue
                        take = n; break
                start = vi - take if prev >= 0 or take else vi
                if prev < 0:
                    start = 0
                marks[start] = 'ˋ' if st == '1' else 'ˏ'
            prev = vi
    return ''.join(marks.get(i, '') + s[0] for i, s in enumerate(segs))


def kk(text, d):
    out = []
    for tok in text.split():
        parts = []
        for piece in tok.split('-'):
            key = re.sub(r"[^a-z']", '', piece.lower())
            if key not in d:
                return None
            parts.append(kk_word(d[key][0]))
        out.append('-'.join(parts))
    return '[' + ' '.join(out) + ']'


def words_in_order():
    seen = []
    for src in sorted(glob.glob(os.path.join(ROOT, 'packs', 'src', 'fullscore_day*.txt'))):
        for line in io.open(src, encoding='utf-8'):
            if '\t' in line and not line.startswith('#'):
                w = line.split('\t')[0].strip()
                if w not in seen:
                    seen.append(w)
    return seen


def read_ph():
    if not os.path.exists(PH_FILE):
        return {}
    out = {}
    for line in io.open(PH_FILE, encoding='utf-8'):
        if '\t' in line and not line.startswith('#'):
            w, p = line.rstrip('\n').split('\t')[:2]
            out[w] = p
    return out


def draft():
    import cmudict
    d = cmudict.dict()
    have = read_ph()
    rows, miss = [], []
    for w in words_in_order():
        p = have.get(w) or kk(w, d) or '??'
        if p == '??':
            miss.append(w)
        rows.append('%s\t%s' % (w, p))
    with io.open(PH_FILE, 'w', encoding='utf-8', newline='\n') as f:
        f.write('# 滿分單字 KK 音標（CMU 字典轉寫＋人工核對）｜跟著 packs/ 不進 git\n')
        f.write('\n'.join(rows) + '\n')
    print('%d 字，查不到 %d：%s' % (len(rows), len(miss), miss))


def pack(pack_path):
    import json
    ph = read_ph()
    bad = [w for w, p in ph.items() if '?' in p or not p.startswith('[')]   # 兩種詞性念法不同時寫「[..] n.／[..] v.」
    if bad:
        sys.exit('音標未完成：%s' % bad)
    data = json.load(io.open(pack_path, encoding='utf-8'))
    n, miss = 0, []
    for u in data['courses'][0]['units']:
        if not u.get('full'):
            continue
        for w in u['words']:
            if w['w'] in ph:
                w['ph'] = ph[w['w']]; n += 1
            else:
                miss.append(w['w'])
    if miss:
        sys.exit('ph_fullscore.txt 缺：%s' % miss)
    json.dump(data, io.open(pack_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print('已寫入 %d 字音標' % n)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit()
    if sys.argv[1] == 'draft':
        draft()
    elif sys.argv[1] == 'pack':
        pack(sys.argv[2])
