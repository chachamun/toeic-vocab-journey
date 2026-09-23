# -*- coding: utf-8 -*-
"""
自然語音產生工具（Google Cloud Text-to-Speech，Chirp 3 HD）

手機／電腦內建語音太機器（iPhone 不開放高品質語音給網頁），
改成把每個單字、每句例句預先做成 mp3，App 優先播這些檔，沒有才退回內建語音。

用法：
  python tools/gen_tts.py sample                     # 同一句話用幾個聲音各做一個，給人試聽挑選
  python tools/gen_tts.py pack  <教材包.json> [--days day01,day02]   # 國際學村：音檔直接嵌進教材包（不進 git）
  python tools/gen_tts.py video                       # 影片課程單字：產生到 tts/<影片ID>/，再跑 build_video_units.py course
  共用參數：--voice en-US-Chirp3-HD-Aoede  --dry（只算字數與費用，不呼叫 API）

已經產生過的檔案會跳過，不重複計費。
費用（2026-09 官網）：Chirp 3 HD 每月前 100 萬字元免費，超過 US$30／100 萬字元。
"""
import base64, glob, hashlib, io, json, os, re, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ.get('TVJ_GCP_KEY', 'H:/Mischa/小恰/key/mischa-tools-80142180bf28.json')
DEFAULT_VOICE = 'en-US-Chirp3-HD-Aoede'
# 混合口音：單字固定美式；例句依序輪流美／英／澳（多益聽力會出現這幾種口音）
ACCENTS = [('en-US', 'US'), ('en-GB', 'UK'), ('en-AU', 'AU')]


def voice_of(base, lang):
    """base 可給簡稱（Aoede）或完整名稱；回傳指定口音的完整語音名稱。"""
    name = base.split('-')[-1]
    return '%s-Chirp3-HD-%s' % (lang, name)
CACHE = os.path.join(ROOT, 'tools', '.tts_cache')          # 產生過的音檔快取（不進 git），重跑不重複計費
FREE_PER_MONTH, USD_PER_M = 1_000_000, 30

_session = None


def session():
    global _session
    if _session is None:
        from google.oauth2 import service_account
        import google.auth.transport.requests as gtr
        import requests
        cred = service_account.Credentials.from_service_account_file(KEY, scopes=['https://www.googleapis.com/auth/cloud-platform'])
        cred.refresh(gtr.Request())
        s = requests.Session()
        s.headers.update({'Authorization': 'Bearer ' + cred.token, 'x-goog-user-project': cred.project_id})
        _session = s
    return _session


def cache_path(text, voice):
    h = hashlib.sha1((voice + '|' + text).encode('utf-8')).hexdigest()[:16]
    return os.path.join(CACHE, voice, h + '.mp3')


def synth(text, voice):
    """回傳 mp3 bytes；同一句同一聲音只會呼叫 API 一次。"""
    p = cache_path(text, voice)
    if os.path.exists(p):
        return open(p, 'rb').read(), False
    body = {'input': {'text': text},
            'voice': {'languageCode': voice[:5], 'name': voice},
            'audioConfig': {'audioEncoding': 'MP3', 'sampleRateHertz': 24000}}
    for attempt in range(4):
        r = session().post('https://texttospeech.googleapis.com/v1/text:synthesize', json=body, timeout=60)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(2 * (attempt + 1)); continue
        if not r.ok:
            sys.exit('API 錯誤 %d：%s' % (r.status_code, r.text[:400]))
        data = base64.b64decode(r.json()['audioContent'])
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'wb').write(data)
        return data, True
    sys.exit('API 一直忙線，稍後再試。')


def speakable(t):
    """給語音用的文字：去掉 ___ 之類的符號、~ 等。"""
    return re.sub(r'_{2,}', ' blank ', t).replace('～', ' ').strip()


def report(items, voice=None):
    """items：(文字, 檔名) 或 (文字, 檔名, 語音)。"""
    items = [it if len(it) == 3 else (it[0], it[1], voice) for it in items]
    todo = [it for it in items if not os.path.exists(cache_path(speakable(it[0]), it[2]))]
    chars = sum(len(speakable(t)) for t, _, _ in todo)
    over = max(0, chars - FREE_PER_MONTH)
    print('要產生 %d 段（快取已有 %d 段）；計費字元 %d（本月免費額度 %d 的 %.1f%%）；超出部分估 US$%.2f' % (
        len(todo), len(items) - len(todo), chars, FREE_PER_MONTH, chars / FREE_PER_MONTH * 100, over / 1e6 * USD_PER_M))
    return todo


def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) else default
    return default


def cmd_sample(voice_list):
    text = 'Professional business attire is required of all staff giving presentations.'
    out = os.path.join(ROOT, 'tools', 'tts_samples'); os.makedirs(out, exist_ok=True)
    for v in voice_list:
        data, new = synth(text, v)
        open(os.path.join(out, v + '.mp3'), 'wb').write(data)
        print(('新產生 ' if new else '快取 ') + v, len(data), 'bytes')
    print('試聽檔在', out)


def plan_unit(words, prefix, voice, mix):
    """一個單元要產生的音檔：[(文字, 檔名, 語音, 物件, 口音)]。
    mix：每個單字、每句例句都做美／英／澳三種口音（App 可選口音或三種連播）；否則只做美式。"""
    accs = ACCENTS if mix else ACCENTS[:1]
    out = []
    for w in words:
        for lang, acc in accs:
            out.append((w['w'], '%s_w%d_%s.mp3' % (prefix, w['n'], acc), voice_of(voice, lang), w, acc))
        for k, e in enumerate(w.get('ex', [])):
            for lang, acc in accs:
                out.append((e['en'], '%s_w%d_e%d_%s.mp3' % (prefix, w['n'], k, acc), voice_of(voice, lang), e, acc))
    return out


def cmd_pack(pack_path, voice, days, dry, mix):
    """國際學村：音檔以 base64 嵌進教材包 clips，單字與例句加上 aus = {US, UK, AU: 檔名}。"""
    pack = json.load(io.open(pack_path, encoding='utf-8'))
    plan = []
    for c in pack['courses']:
        for u in c['units']:
            if days and u['id'] not in days:
                continue
            plan += plan_unit(u.get('words', []), 'tts_%s_%s' % (c['id'], u['id']), voice, mix)
    report([(t, f, v) for t, f, v, _, _ in plan])
    if dry:
        return
    clips = pack.get('clips', {})
    for obj in {id(p[3]): p[3] for p in plan}.values():       # 清掉舊格式欄位
        obj.pop('au', None); obj.pop('acc', None); obj['aus'] = {}
    for i, (t, f, v, obj, acc) in enumerate(plan, 1):
        data, _ = synth(speakable(t), v)
        clips[f] = base64.b64encode(data).decode('ascii')
        obj['aus'][acc] = f
        if i % 100 == 0:
            print('  %d/%d' % (i, len(plan)))
    used = {f for _, f, _, _, _ in plan}
    for c in pack['courses']:                                  # 其他單元已有的也算用到
        for u in c['units']:
            for w in u.get('words', []):
                used.update((w.get('aus') or {}).values())
                for e in w.get('ex', []):
                    used.update((e.get('aus') or {}).values())
    clips = {k: v for k, v in clips.items() if k in used}      # 丟掉舊格式留下的音檔
    pack['clips'] = clips
    pack['ttsVoice'] = voice_of(voice, 'en-US') + (' ＋英澳口音' if mix else '')
    json.dump(pack, io.open(pack_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print('已嵌入 %d 段音檔 → %s（%.1f MB）' % (len(clips), pack_path, os.path.getsize(pack_path) / 1e6))


def cmd_video(voice, dry, mix):
    """影片課程：音檔放 tts/<影片ID>/w3_UK.mp3、w3_e0_AU.mp3，build_video_units.py 會掛上 aus。"""
    plan = []
    for p in sorted(glob.glob(os.path.join(ROOT, 'tools', 'episodes', '*.json'))):
        vid = os.path.splitext(os.path.basename(p))[0]
        s = json.load(io.open(p, encoding='utf-8'))
        for t, f, v, obj, acc in plan_unit(s['words'], 'tts/%s/' % vid, voice, mix):
            plan.append((t, f.replace('/_w', '/w'), v))
    todo = [it for it in plan if not os.path.exists(os.path.join(ROOT, it[1]))]
    print('影片單字音檔：共 %d 段，尚缺 %d 段' % (len(plan), len(todo)))
    report(todo)
    if dry:
        return
    for t, f, v in todo:
        data, _ = synth(speakable(t), v)
        out = os.path.join(ROOT, f); os.makedirs(os.path.dirname(out), exist_ok=True)
        open(out, 'wb').write(data)
    # 清掉舊命名（w3.mp3、只有單一口音的例句）留下的檔案
    keep = {os.path.normpath(os.path.join(ROOT, f)) for _, f, _ in plan}
    stale = [p for p in glob.glob(os.path.join(ROOT, 'tts', '*', '*.mp3')) if os.path.normpath(p) not in keep]
    for p in stale:
        os.remove(p)
    print('完成（清掉舊檔 %d 個）。記得重跑：python tools/build_video_units.py course' % len(stale))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit()
    voice = arg('--voice', DEFAULT_VOICE)
    dry = '--dry' in sys.argv
    mix = '--mix' in sys.argv          # 例句輪流美／英／澳口音
    if sys.argv[1] == 'sample':
        cmd_sample(sys.argv[2].split(',') if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else
                   ['en-US-Chirp3-HD-Aoede', 'en-US-Chirp3-HD-Leda', 'en-US-Chirp3-HD-Charon', 'en-US-Chirp3-HD-Puck'])
    elif sys.argv[1] == 'pack':
        d = arg('--days')
        cmd_pack(sys.argv[2], voice, set(d.split(',')) if d else None, dry, mix)
    elif sys.argv[1] == 'video':
        cmd_video(voice, dry, mix)
    else:
        print(__doc__)
