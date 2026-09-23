# -*- coding: utf-8 -*-
"""
國際學村「新制多益滿分單字」→ 教材包單元（dayNN-full）

課本每天最後的滿分單字表（基礎／800／900 分 × LC／Part 5,6／Part 7），
逐字抄錄在 packs/src/fullscore_dayNN.txt（版權內容，packs/ 整個不進 git）：
  ## 800 P56
  cover letter<TAB>phr. 求職信
  alert<TAB>v. 提醒（某人）注意；adj. 警覺的

用法：python tools/build_fullscore.py <教材包.json>
  會把每一天的滿分單字寫成獨立單元 dayNN-full 放進教材包（已存在就覆蓋），
  接著跑 gen_tts.py pack … --mix 產生語音、gen_tts.py split 拆成一天一檔。
"""
import glob, io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TIER_STARS = {'基礎': 1, '800': 2, '900': 3}
PART_NAME = {'LC': 'LC 聽力', 'RC': 'RC 閱讀', 'P56': 'Part 5, 6', 'P7': 'Part 7'}
POS = r'(phr|n|v|adj|adv|prep|conj)\.'


def parse_pos(s):
    """'n. 列表；名單；v. 列出' → [{p:'n.', m:'列表；名單'}, {p:'v.', m:'列出'}]"""
    out = []
    for seg in re.split(r'；\s*(?=(?:phr|n|v|adj|adv|prep|conj)\.\s)', s.strip()):   # 只在「；詞性.」處切開
        m = re.match(POS + r'\s*(.+)$', seg.strip())
        out.append({'p': m.group(1) + '.', 'm': m.group(2).strip()} if m else {'p': '', 'm': seg.strip()})
    return out


def read_day(path):
    words, tier, part = [], None, None
    for line in io.open(path, encoding='utf-8'):
        line = line.rstrip('\n')
        if not line.strip() or line.startswith('# '):
            continue
        h = re.match(r'##\s*(\S+)\s+(\S+)', line)
        if h:
            tier, part = h.group(1), h.group(2)
            continue
        w, mean = line.split('\t')
        words.append({'n': len(words) + 1, 'w': w.strip(), 's': TIER_STARS[tier],
                      'tag': ('基礎' if tier == '基礎' else tier + '分') + '・' + PART_NAME[part],
                      'pos': parse_pos(mean), 'ex': []})
    return words


def main(pack_path):
    pack = json.load(io.open(pack_path, encoding='utf-8'))
    course = pack['courses'][0]
    for src in sorted(glob.glob(os.path.join(ROOT, 'packs', 'src', 'fullscore_day*.txt'))):
        day = re.search(r'day(\d+)', src).group(1)
        base = next((u for u in course['units'] if u['id'] == 'day' + day), None)
        if not base:
            print('略過 day%s（教材包裡沒有這一天）' % day); continue
        base.pop('extra', None)                               # 舊版抄錄（不完整），改用獨立單元
        words = read_day(src)
        unit = {'id': 'day%s-full' % day, 'label': 'Day %s 滿分' % day,
                'theme': base.get('theme', '') + '・滿分單字', 'themeZh': base.get('themeZh', ''),
                'themeEn': base.get('themeEn', ''), 'full': True, 'words': words}
        old = next((u for u in course['units'] if u['id'] == unit['id']), None)
        if old:                                               # 保留已經產生好的語音檔名
            prev = {w['w']: w.get('aus') for w in old.get('words', [])}
            for w in words:
                if prev.get(w['w']):
                    w['aus'] = prev[w['w']]
            course['units'][course['units'].index(old)] = unit
        else:
            course['units'].append(unit)
        bad = [w['w'] for w in words if not w['pos'] or any(not p['p'] for p in w['pos'])]
        print('day%s-full：%d 字%s' % (day, len(words), ('（詞性待查：%s）' % bad) if bad else ''))
    course['units'].sort(key=lambda u: u['id'])
    json.dump(pack, io.open(pack_path, 'w', encoding='utf-8'), ensure_ascii=False)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit()
    main(sys.argv[1])
