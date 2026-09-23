# -*- coding: utf-8 -*-
"""
YouTube 逐字稿抓取工具（多益字彙旅程・影片課程用）
用法：
    python yt_transcript.py <youtube網址或影片ID> [輸出資料夾]
輸出：
    <影片ID>.json        — 原始字幕片段 [{start, dur, text}]
    <影片ID>.txt         — 純文字全文
    <影片ID>_lines.json  — 合併成完整句子、帶起始秒數 [{t, en}]（給 build_video_units.py 用）
需求：pip install youtube-transcript-api
"""
import sys, os, re, json

END = re.compile(r'[.!?]["\')\]]?$')


def vid_of(s):
    m = re.search(r'(?:v=|youtu\.be/|shorts/|embed/)([A-Za-z0-9_-]{11})', s)
    return m.group(1) if m else s.strip()


def fetch(vid, langs=('en', 'en-GB', 'en-US')):
    from youtube_transcript_api import YouTubeTranscriptApi
    fetched = YouTubeTranscriptApi().fetch(vid, languages=list(langs))
    segs = [{'start': round(s.start, 2), 'dur': round(s.duration, 2), 'text': s.text.replace('\n', ' ').strip()}
            for s in fetched]
    return fetched.language_code, segs


def merge_lines(segs):
    """字幕片段 → 完整句子；句末標點就斷，超過 40 字強制斷。"""
    lines, cur, t0 = [], '', None
    for s in segs:
        txt = re.sub(r'\s+', ' ', s['text'].replace('>>', ' ')).strip()
        if not txt:
            continue
        if t0 is None:
            t0 = s['start']
        cur = (cur + ' ' + txt).strip()
        if END.search(cur) or len(cur.split()) > 40:
            lines.append({'t': round(t0, 1), 'en': cur})
            cur, t0 = '', None
    if cur:
        lines.append({'t': round(t0, 1), 'en': cur})
    return lines


def main():
    if len(sys.argv) < 2:
        print(__doc__); return
    vid = vid_of(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else '.'
    os.makedirs(out, exist_ok=True)
    lang, segs = fetch(vid)
    full = ' '.join(s['text'] for s in segs)
    lines = merge_lines(segs)
    json.dump({'video_id': vid, 'lang': lang, 'segments': segs},
              open(os.path.join(out, vid + '.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    open(os.path.join(out, vid + '.txt'), 'w', encoding='utf-8').write(full)
    json.dump(lines, open(os.path.join(out, vid + '_lines.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    dur = segs[-1]['start'] + segs[-1]['dur'] if segs else 0
    print('OK video=%s lang=%s 段=%d 句=%d 字=%d 長=%.1f分' % (vid, lang, len(segs), len(lines), len(full), dur / 60))


if __name__ == '__main__':
    main()
