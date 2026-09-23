# -*- coding: utf-8 -*-
"""
影片單元組裝工具（BBC 6 Minute English 等影片課程）

一集影片由兩個檔構成：
  tools/episodes/<影片ID>.json   單元資料（標題、上架日、單字、克漏字、理解題）— 手寫
  transcripts/<影片ID>.json      逐字稿（原文出處在最前面 → 每句 {t 秒, en, zh}）— 本工具產生

用法：
  1) 產生逐字稿（第一次處理某集時）
     python tools/build_video_units.py transcript <影片ID> <lines.json> <zh.json>
       lines.json：yt_transcript.py 產出的 <ID>_lines.json（[{t, en}]）
       zh.json   ：與 lines 一句對一句的中譯陣列
  2) 重建課程檔（每次新增或修改單元後）
     python tools/build_video_units.py course
       讀 tools/episodes/*.json → 寫 courses/bbc-6min.js（依標籤排序）
"""
import io, json, os, sys, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EP_DIR = os.path.join(ROOT, 'tools', 'episodes')
TX_DIR = os.path.join(ROOT, 'transcripts')
# 影片課程：單元資料的 course 欄位決定放進哪一個課程檔（沒寫就是 BBC）
COURSES = {
    'bbc-6min':    {'name': 'BBC 6 Minute English', 'file': 'courses/bbc-6min.js',
                    'publisher': 'BBC Learning English《6 Minute English》'},
    'daily-video': {'name': '每日影片', 'file': 'courses/daily-video.js', 'publisher': ''},
}


def load(p):
    return json.load(io.open(p, encoding='utf-8'))


def spec_of(vid):
    p = os.path.join(EP_DIR, vid + '.json')
    if not os.path.exists(p):
        sys.exit('找不到單元資料：' + p)
    return load(p)


def build_transcript(vid, lines_path, zh_path):
    spec = spec_of(vid)
    lines, zh = load(lines_path), load(zh_path)
    if len(lines) != len(zh):
        sys.exit('句數不符！英文 %d 句、中譯 %d 句，請對齊後再跑。' % (len(lines), len(zh)))
    empty = [i for i, z in enumerate(zh) if not str(z).strip()]
    if empty:
        sys.exit('第 %s 句中譯是空的。' % empty[:5])
    doc = {
        # 原文出處放最前面（Mischa 指定）
        'source': {
            'video': spec['video'],
            'original': spec.get('bbc', ''),
            'publisher': publisher_of(spec),
            'note': '英文逐字稿取自 YouTube 字幕；中文為學習用翻譯。版權屬原作者，僅供個人學習。'
        },
        'title': spec['themeEn'],
        'lines': [{'t': l['t'], 'en': l['en'], 'zh': z} for l, z in zip(lines, zh)]
    }
    os.makedirs(TX_DIR, exist_ok=True)
    out = os.path.join(TX_DIR, vid + '.json')
    json.dump(doc, io.open(out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('逐字稿 →', os.path.relpath(out, ROOT), '（%d 句）' % len(lines))


def publisher_of(spec):
    return spec.get('publisher') or COURSES[spec.get('course', 'bbc-6min')]['publisher']


def build_course():
    groups = {cid: [] for cid in COURSES}
    for p in sorted(glob.glob(os.path.join(EP_DIR, '*.json'))):
        s = load(p)
        vid = os.path.splitext(os.path.basename(p))[0]
        cid = s.get('course', 'bbc-6min')
        if cid not in COURSES:
            sys.exit('%s 的 course「%s」不認得，請加進 COURSES。' % (vid, cid))
        tx = os.path.join(TX_DIR, vid + '.json')
        if not os.path.exists(tx):
            sys.exit('%s 還沒有逐字稿，先跑 transcript 模式。' % vid)
        n = len(load(tx)['lines'])
        # 有自然語音檔（tools/gen_tts.py video 產生）就掛上 au
        for w in s['words']:
            f = 'tts/%s/w%d.mp3' % (vid, w['n'])
            if os.path.exists(os.path.join(ROOT, f)):
                w['au'] = f
            for k, e in enumerate(w.get('ex', [])):
                for acc in ('US', 'UK', 'AU', None):          # 例句檔名帶口音：w3_e0_UK.mp3
                    f = 'tts/%s/w%d_e%d%s.mp3' % (vid, w['n'], k, '_' + acc if acc else '')
                    if os.path.exists(os.path.join(ROOT, f)):
                        e['au'] = f
                        if acc:
                            e['acc'] = acc
                        break
        groups[cid].append({
            'id': s['id'], 'label': s['label'], 'theme': s['theme'], 'themeEn': s['themeEn'],
            'video': s['video'], 'source': s.get('bbc', ''), 'publisher': publisher_of(s), 'release': s['release'],
            'transcript': 'transcripts/%s.json' % vid, 'lines': n, 'audioSrc': '',
            'words': s['words'], 'cloze': s.get('cloze', []), 'comp': s.get('comp', [])
        })
    for cid, units in groups.items():
        if not units:
            continue
        meta = COURSES[cid]
        units.sort(key=lambda u: u['label'])
        course = {'id': cid, 'name': meta['name'], 'kind': 'video', 'units': units}
        head = ('/* %s 影片課程 — 由 tools/build_video_units.py 產生，請勿手改。\n'
                '   要改內容：編 tools/episodes/<影片ID>.json 後重跑 `python tools/build_video_units.py course`。\n'
                '   逐字稿（含原文出處）在 transcripts/<影片ID>.json，App 看影片時才載入。 */\n') % meta['name']
        out = os.path.join(ROOT, meta['file'])
        io.open(out, 'w', encoding='utf-8').write(head + 'TVJ.register(' + json.dumps(course, ensure_ascii=False, indent=1) + ');\n')
        print('課程檔 →', meta['file'], '（%d 集）' % len(units))
        for u in units:
            print('  %s  %s  上架 %s  單字 %d  克漏字 %d  理解題 %d  逐字稿 %d 句' % (
                u['label'], u['theme'], u['release'], len(u['words']), len(u['cloze']), len(u['comp']), u['lines']))


if __name__ == '__main__':
    if len(sys.argv) >= 5 and sys.argv[1] == 'transcript':
        build_transcript(sys.argv[2], sys.argv[3], sys.argv[4])
    elif len(sys.argv) >= 2 and sys.argv[1] == 'course':
        build_course()
    else:
        print(__doc__)
