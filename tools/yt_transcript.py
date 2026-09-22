# -*- coding: utf-8 -*-
"""
YouTube 逐字稿抓取工具（多益字彙旅程・每日影片用）
用法：
    python yt_transcript.py <youtube網址或影片ID> [輸出資料夾]
輸出：
    <影片ID>.json  — 逐字稿含時間軸 [{start, dur, text}]
    <影片ID>.txt   — 純文字全文
需求：pip install youtube-transcript-api
"""
import sys, os, re, json

def vid_of(s):
    m = re.search(r'(?:v=|youtu\.be/|shorts/|embed/)([A-Za-z0-9_-]{11})', s)
    return m.group(1) if m else s.strip()

def fetch(vid, langs=('en','en-US','en-GB')):
    from youtube_transcript_api import YouTubeTranscriptApi
    api = YouTubeTranscriptApi()
    fetched = api.fetch(vid, languages=list(langs))
    segs = [{'start': round(s.start, 2), 'dur': round(s.duration, 2), 'text': s.text.replace('\n', ' ').strip()}
            for s in fetched]
    return fetched.language_code, segs

def main():
    if len(sys.argv) < 2:
        print('用法: python yt_transcript.py <網址或ID> [輸出資料夾]'); return
    vid = vid_of(sys.argv[1])
    out = sys.argv[2] if len(sys.argv) > 2 else '.'
    os.makedirs(out, exist_ok=True)
    lang, segs = fetch(vid)
    full = ' '.join(s['text'] for s in segs)
    json.dump({'video_id': vid, 'lang': lang, 'segments': segs},
              open(os.path.join(out, vid + '.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    open(os.path.join(out, vid + '.txt'), 'w', encoding='utf-8').write(full)
    dur = segs[-1]['start'] + segs[-1]['dur'] if segs else 0
    print('OK video=%s lang=%s 段=%d 字=%d 長=%.1f分' % (vid, lang, len(segs), len(full), dur/60))
    print('輸出:', os.path.join(out, vid + '.json'), '/', vid + '.txt')

if __name__ == '__main__':
    main()
