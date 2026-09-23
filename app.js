/* ============================================================================
   多益字彙旅程 — 應用邏輯
   ----------------------------------------------------------------------------
   擴充方式：資料全在 data.js（課程 → 單元 → 單字），加 Day 或加新教材
   只要往 DATA.courses 丟物件，介面自動長出來。這支檔案不用動。
   進度鍵 = 「課程id/單元id/w序號」，新增內容不影響既有進度。
   記憶曲線：lv 0~6 對應間隔 0/1/2/4/7/15/30 天。
   ========================================================================== */

/* ===================== STATE ===================== */
const LS_KEY = 'tvj-v2';
const IVL = [0, 1, 2, 4, 7, 15, 30];

function defaults() {
  return {
    ver: 2,
    courseId: DATA.courses[0].id,
    unitId: DATA.courses[0].units[0].id,
    prog: {}, days: {},
    settings: { rate: 1, theme: 'auto', voiceURI: '' },
    updatedAt: 0
  };
}
function normState(o) {
  const d = defaults();
  const s = Object.assign(d, o || {}, {
    settings: Object.assign(d.settings, (o && o.settings) || {}),
    days: (o && o.days) || {},
    prog: (o && o.prog) || {}
  });
  if (![0.5, 0.75, 1, 1.25, 1.5].includes(s.settings.rate)) s.settings.rate = 1;
  return s;
}
function loadLocal() {
  try {
    const r = localStorage.getItem(LS_KEY) || localStorage.getItem('tvj-v1');
    if (r) return normState(JSON.parse(r));
  } catch (e) {}
  return defaults();
}
let S = loadLocal();
function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {} }
function touch() { S.updatedAt = Date.now(); saveLocal(); syncPushSoon(); }

/* ===================== 跨裝置同步（自架 Worker，可不用） ===================== */
const SYNC = { url: '', key: '', on: false, timer: null, busy: false };
function syncLoadCfg() {
  try { const r = JSON.parse(localStorage.getItem('tvj-sync') || '{}'); SYNC.url = r.url || ''; SYNC.key = r.key || ''; } catch (e) {}
}
function syncSaveCfg(url, key) {
  SYNC.url = (url || '').trim().replace(/\/+$/, ''); SYNC.key = (key || '').trim();
  try { localStorage.setItem('tvj-sync', JSON.stringify({ url: SYNC.url, key: SYNC.key })); } catch (e) {}
}
function setSync(mode, msg) {
  const d = el('syncDot'), t = el('syncText');
  if (d) { d.classList.toggle('on', mode === 'on'); d.classList.toggle('err', mode === 'err'); }
  if (t) t.textContent = msg || (mode === 'on' ? '已連線・跨裝置同步' : '進度儲存在此裝置');
}
async function syncPull(loud) {
  if (!SYNC.url || !SYNC.key) { setSync('off'); return; }
  try {
    const r = await fetch(SYNC.url + '/state', { headers: { 'Authorization': 'Bearer ' + SYNC.key } });
    if (r.status === 404) { SYNC.on = true; setSync('on'); await syncPush(); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const remote = await r.json();
    SYNC.on = true; setSync('on');
    if (remote && (remote.updatedAt || 0) > (S.updatedAt || 0)) {
      S = normState(remote); saveLocal(); applyTheme(); render();
      if (loud) toast('已取回較新的進度');
    } else if ((S.updatedAt || 0) > (remote && remote.updatedAt || 0)) {
      await syncPush();
    }
    if (loud) toast('同步完成');
  } catch (e) {
    SYNC.on = false; setSync('err', '同步失敗：' + (e.message || e));
    if (loud) toast('同步失敗：' + (e.message || e));
  }
}
async function syncPush() {
  if (!SYNC.url || !SYNC.key || SYNC.busy) return;
  SYNC.busy = true;
  try {
    const r = await fetch(SYNC.url + '/state', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + SYNC.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(S)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    SYNC.on = true; setSync('on');
  } catch (e) { SYNC.on = false; setSync('err', '同步失敗：' + (e.message || e)); }
  SYNC.busy = false;
}
function syncPushSoon() {
  if (!SYNC.url || !SYNC.key) return;
  clearTimeout(SYNC.timer); SYNC.timer = setTimeout(syncPush, 1500);
}

/* ===================== 教材包（本機儲存，不進 git） ===================== */
/* IndexedDB 一個 kv store 就夠：
     pack:<包id>      → 教材包 JSON（課程、單字、例句…）
     media:<檔名>     → 音檔 Blob
   兩者都只存在這台裝置的瀏覽器裡，不會上傳、不會進版控。 */
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('tvj', 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function idbTx(mode, fn) {
  return idbOpen().then(d => new Promise((res, rej) => {
    const q = fn(d.transaction('kv', mode).objectStore('kv'));
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  }));
}
const idbGet = k => idbTx('readonly', s => s.get(k));
const idbSet = (k, v) => idbTx('readwrite', s => s.put(v, k));
const idbDel = k => idbTx('readwrite', s => s.delete(k));
const idbKeys = () => idbTx('readonly', s => s.getAllKeys());

let PACKS = [];
async function loadPacks() {
  PACKS = [];
  let keys = [];
  try { keys = await idbKeys(); } catch (e) { return; }
  const packKeys = keys.filter(k => String(k).startsWith('pack:')).sort();
  for (const k of packKeys) {
    let p;
    try { p = await idbGet(k); } catch (e) { continue; }
    if (!p || !Array.isArray(p.courses)) continue;
    PACKS.push({ key: k, id: p.pack, name: p.name || p.pack, n: p.courses.reduce((a, c) => a + (c.units || []).length, 0) });
    for (const c of p.courses) {
      for (const u of (c.units || [])) {
        if (u.audioFile) {
          try {
            const blob = await idbGet('media:' + u.audioFile);
            if (blob) u.audioSrc = URL.createObjectURL(blob);
          } catch (e) {}
        }
      }
      /* 教材包排在內建課程前面 */
      const i = TVJ.courses.findIndex(x => x.id === c.id);
      if (i >= 0) TVJ.courses[i] = c; else TVJ.courses.unshift(c);
    }
  }
}
async function importPackFiles(files) {
  let packs = 0, media = 0, bad = [];
  for (const f of files) {
    if (/\.json$/i.test(f.name) || f.type === 'application/json') {
      try {
        const p = JSON.parse(await f.text());
        if (!p.pack || !Array.isArray(p.courses)) throw new Error('缺少 pack 或 courses 欄位');
        await idbSet('pack:' + p.pack, p); packs++;
      } catch (e) { bad.push(f.name + '（' + (e.message || e) + '）'); }
    } else {
      try { await idbSet('media:' + f.name, f); media++; }
      catch (e) { bad.push(f.name + '（存不進去，檔案可能太大）'); }
    }
  }
  if (bad.length) toast('有檔案讀不進來：' + bad[0]);
  else toast('已匯入 ' + packs + ' 個教材包、' + media + ' 個音檔');
  await loadPacks();
  if (!S.updatedAt && DATA.courses.length) { S.courseId = DATA.courses[0].id; S.unitId = DATA.courses[0].units[0].id; }
  fillPackList(); buildDeck(); render();
}
function fillPackList() {
  const box = el('packList'); if (!box) return;
  box.innerHTML = PACKS.length
    ? PACKS.map(p => '<div class="pack-item"><b>' + esc(p.name) + '</b><span class="s">' + p.n + ' 單元</span>' +
      '<button data-rmpack="' + esc(p.key) + '">移除</button></div>').join('')
    : '<div class="tiny muted">尚未匯入任何教材包</div>';
  box.querySelectorAll('[data-rmpack]').forEach(b => b.onclick = async () => {
    const k = b.dataset.rmpack;
    const p = await idbGet(k);
    if (p) for (const c of (p.courses || [])) {
      const i = TVJ.courses.findIndex(x => x.id === c.id);
      if (i >= 0) TVJ.courses.splice(i, 1);
      for (const u of (c.units || [])) if (u.audioFile) { try { await idbDel('media:' + u.audioFile); } catch (e) {} }
    }
    await idbDel(k); await loadPacks(); fillPackList();
    if (!DATA.courses.find(c => c.id === S.courseId) && DATA.courses.length) {
      S.courseId = DATA.courses[0].id; S.unitId = DATA.courses[0].units[0].id; touch();
    }
    buildDeck(); render(); toast('已移除教材包（進度保留）');
  });
}

/* ===================== HELPERS ===================== */
function el(i) { return document.getElementById(i); }
function esc(s) { return (s + '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function dayKey(off) { const d = new Date(); d.setDate(d.getDate() - off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function curCourse() { return DATA.courses.find(c => c.id === S.courseId) || DATA.courses[0]; }
function curUnit() { const c = curCourse(); return c.units.find(u => u.id === S.unitId) || c.units[0]; }
function gid(cid, uid, n) { return cid + '/' + uid + '/w' + n; }
function wid(w) { return gid(curCourse().id, curUnit().id, w.n); }
function pget(i) { return S.prog[i] || { st: 'new', lv: 0, seen: 0, cor: 0, wro: 0, last: 0 }; }
function pset(i, patch) { S.prog[i] = Object.assign(pget(i), patch); touch(); }
function allUnits() { const out = []; DATA.courses.forEach(c => c.units.forEach(u => out.push({ c, u }))); return out; }
function unitStats(c, u) {
  let k = 0, l = 0;
  (u.words || []).forEach(w => { const st = pget(gid(c.id, u.id, w.n)).st; if (st === 'known') k++; else if (st === 'learning') l++; });
  const t = (u.words || []).length;
  return { k, l, n: t - k - l, total: t, pct: t ? Math.round(k / t * 100) : 0 };
}
function isDue(p) { if (p.st === 'new') return false; const d = (Date.now() - (p.last || 0)) / 86400000; return d >= IVL[Math.min(p.lv || 0, IVL.length - 1)]; }
function dueList() {
  const out = [];
  allUnits().forEach(({ c, u }) => (u.words || []).forEach(w => { const i = gid(c.id, u.id, w.n), p = pget(i); if (isDue(p)) out.push({ c, u, w, i, p }); }));
  return out.sort((a, b) => (a.p.last || 0) - (b.p.last || 0));
}
function learnedTotal() {
  let k = 0, l = 0, t = 0;
  allUnits().forEach(({ c, u }) => { const s = unitStats(c, u); k += s.k; l += s.l; t += s.total; });
  return { k, l, n: t - k - l, total: t };
}
function days() { if (!S.days || typeof S.days !== 'object') S.days = {}; return S.days; }
function bumpDay(field, inc) { const d = today(); const rec = days()[d] || { w: 0, q: 0, in: false }; rec[field] = (rec[field] || 0) + (inc || 1); days()[d] = rec; }
function streak() { const D = days(); let n = 0; for (let i = 0; i < 400; i++) { const r = D[dayKey(i)]; if (r && (r.in || r.w || r.q)) n++; else if (i > 0) break; } return n; }
function hl(en, w) {
  let o = esc(en); const b = (w || '').replace(/[^a-zA-Z].*$/, '');
  if (b.length > 2) o = o.replace(new RegExp('\\b(' + b + '(?:s|es|ed|d|ing|ment)?)\\b', 'gi'), '<b>$1</b>');
  return o;
}
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function fmtT(s) { s = Math.max(0, s | 0); return String((s / 60) | 0).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
let toastT = null;
function toast(msg) {
  const t = el('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ===================== 影片內嵌 ===================== */
function ytid(u) { const m = (u || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : ''; }
function ytEmbed(u) {
  const id = ytid(u); if (!id) return '';
  return '<div class="ytwrap"><iframe src="https://www.youtube-nocookie.com/embed/' + id + '?rel=0&playsinline=1&modestbranding=1"' +
    ' title="學習影片" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"' +
    ' referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>' +
    '<div class="tiny muted" style="text-align:center;margin-top:7px">' +
    '若畫面空白，<a href="' + esc(u) + '" target="_blank" rel="noopener" style="color:var(--accent)">在 YouTube 開啟</a></div>';
}

/* ===================== TTS ===================== */
let VOICES = [];
function vscore(v) {
  const n = (v.name + ' ' + (v.voiceURI || '')).toLowerCase(); let s = 0;
  if (/en[-_]us/i.test(v.lang)) s += 3; else if (/en[-_]gb/i.test(v.lang)) s += 2; else s += 1;
  if (/neural|natural|enhanced|premium/.test(n)) s += 6;
  if (/siri/.test(n)) s += 6;
  if (/google/.test(n)) s += 4;
  if (/samantha|ava|allison|zoe|evan|nathan|aaron|nicky|serena|karen|daniel|joelle|tom|fred/.test(n)) s += 3;
  if (v.localService === false) s += 1;
  if (/compact|eloquence|espeak|zira|david|mark|hazel/.test(n)) s -= 4;
  return s;
}
function ranked() { return VOICES.slice().sort((a, b) => vscore(b) - vscore(a)); }
function pickVoice() { if (!VOICES.length) return null; return VOICES.find(v => v.voiceURI === S.settings.voiceURI) || ranked()[0]; }
function loadVoices() {
  VOICES = (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter(v => /^en(-|_)/i.test(v.lang));
  if (!S.settings.voiceURI && VOICES.length) { S.settings.voiceURI = ranked()[0].voiceURI; saveLocal(); }
  fillVoice();
}
function say(t, o) {
  o = o || {}; if (!window.speechSynthesis) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
    u.rate = o.rate || S.settings.rate || 1;
    speechSynthesis.speak(u);
  } catch (e) {}
}
function fillVoice() {
  const s = el('voiceSel'); if (!s) return;
  if (!VOICES.length) { s.innerHTML = '<option>裝置無英語語音</option>'; return; }
  s.innerHTML = ranked().map(v => '<option value="' + esc(v.voiceURI) + '"' + (v.voiceURI === S.settings.voiceURI ? ' selected' : '') + '>' +
    (vscore(v) >= 8 ? '⭐ ' : '') + esc(v.name.replace(/Microsoft |Google /, '')) + '</option>').join('');
}

/* ===================== 影子跟讀（錄音・自動抓漏字） ===================== */
const SH = { id: null, rec: null, stream: null, chunks: [], url: null, recog: null, heard: '', ref: '', ac: null, raf: 0, recogOK: false, t0: 0 };
const MICOK = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
const SRCls = window.SpeechRecognition || window.webkitSpeechRecognition || null;

function norm(s) { return (s || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
function toks(s) { const n = norm(s); return n ? n.split(' ') : []; }
function lcsDiff(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: 'ok', w: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: 'miss', w: a[i] }); i++; }
    else { out.push({ t: 'add', w: b[j] }); j++; }
  }
  while (i < n) out.push({ t: 'miss', w: a[i++] });
  while (j < m) out.push({ t: 'add', w: b[j++] });
  return out;
}
function shadowRelease() {
  try { if (SH.rec && SH.rec.state === 'recording') SH.rec.stop(); } catch (e) {}
  try { if (SH.recog) { SH.recog.onend = null; SH.recog.abort(); } } catch (e) {}
  try { if (SH.stream) SH.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  try { if (SH.ac) SH.ac.close(); } catch (e) {}
  if (SH.url) { try { URL.revokeObjectURL(SH.url); } catch (e) {} }
  cancelAnimationFrame(SH.raf);
  SH.id = null; SH.rec = null; SH.stream = null; SH.chunks = []; SH.url = null;
  SH.recog = null; SH.heard = ''; SH.ref = ''; SH.ac = null; SH.recogOK = false;
}
function shadowPanel(id) { return document.querySelector('[data-sp="' + id + '"]'); }
function shadowBtn(id) { return document.querySelector('[data-mic="' + id + '"]'); }

async function shadowStart(id, ref) {
  if (SH.id && SH.id !== id) shadowRelease();
  const panel = shadowPanel(id), btn = shadowBtn(id);
  if (!MICOK) { if (panel) panel.innerHTML = spMsg('這個瀏覽器不支援錄音。iPhone 請用 Safari，電腦請用 Chrome。'); return; }
  try {
    SH.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    if (panel) panel.innerHTML = spMsg('拿不到麥克風：' + (e.name === 'NotAllowedError' ? '你（或瀏覽器設定）拒絕了麥克風權限。請在網址列左側的鎖頭圖示裡允許麥克風。' : (e.message || e)));
    return;
  }
  SH.id = id; SH.ref = ref; SH.heard = ''; SH.chunks = []; SH.recogOK = false; SH.t0 = Date.now();

  let mime = '';
  ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'].some(m => {
    if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) { mime = m; return true; } return false;
  });
  try { SH.rec = mime ? new MediaRecorder(SH.stream, { mimeType: mime }) : new MediaRecorder(SH.stream); }
  catch (e) { SH.rec = new MediaRecorder(SH.stream); }
  SH.rec.ondataavailable = e => { if (e.data && e.data.size) SH.chunks.push(e.data); };
  SH.rec.onstop = () => shadowFinish(id);
  SH.rec.start();

  /* 音量條 */
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    SH.ac = new AC();
    const src = SH.ac.createMediaStreamSource(SH.stream), an = SH.ac.createAnalyser();
    an.fftSize = 512; src.connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let peak = 0; for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
      const m = document.querySelector('[data-lvl="' + id + '"]');
      if (m) m.style.width = Math.min(100, Math.round(peak / 70 * 100)) + '%';
      SH.raf = requestAnimationFrame(tick);
    };
    tick();
  } catch (e) {}

  /* 語音辨識（有就自動抓漏字，沒有就只錄音比對） */
  if (SRCls) {
    try {
      const r = new SRCls();
      r.lang = 'en-US'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
      r.onresult = ev => {
        let s = '';
        for (let i = 0; i < ev.results.length; i++) s += ev.results[i][0].transcript + ' ';
        SH.heard = s.trim(); SH.recogOK = true;
      };
      r.onerror = () => {};
      r.onend = () => {};
      r.start();
      SH.recog = r;
    } catch (e) { SH.recog = null; }
  }

  if (btn) { btn.classList.add('rec'); btn.innerHTML = '⏹ 停止錄音'; }
  if (panel) panel.innerHTML = '<div class="sp-head"><b style="color:var(--rec)">● 錄音中…</b>' +
    '<span class="tiny muted">照著句子念，念完按停止</span></div>' +
    '<div class="lvlmeter"><i data-lvl="' + id + '"></i></div>';
}
function shadowStop() { try { if (SH.rec && SH.rec.state === 'recording') SH.rec.stop(); } catch (e) {} }

function shadowFinish(id) {
  cancelAnimationFrame(SH.raf);
  try { if (SH.recog) SH.recog.stop(); } catch (e) {}
  try { if (SH.stream) SH.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  try { if (SH.ac) SH.ac.close(); } catch (e) {}
  SH.ac = null; SH.stream = null;
  const btn = shadowBtn(id);
  if (btn) { btn.classList.remove('rec'); btn.innerHTML = '🎙 錄音跟讀'; }
  const secs = (Date.now() - SH.t0) / 1000;
  const blob = SH.chunks.length ? new Blob(SH.chunks, { type: SH.chunks[0].type || 'audio/webm' }) : null;
  if (SH.url) { try { URL.revokeObjectURL(SH.url); } catch (e) {} }
  SH.url = blob ? URL.createObjectURL(blob) : null;
  /* 辨識結果可能晚一點才進來 */
  setTimeout(() => shadowRender(id, secs), SH.recog ? 700 : 0);
}
function spMsg(t) { return '<div class="sp-head"><b>跟讀</b><button class="x" data-spx="1">✕</button></div><div class="sp-note" style="font-size:12.5px;color:var(--ink-2)">' + esc(t) + '</div>'; }

function shadowRender(id, secs) {
  const panel = shadowPanel(id); if (!panel) return;
  const a = toks(SH.ref), b = toks(SH.heard);
  let html = '<div class="sp-head"><b>跟讀結果</b><span class="tiny muted">' + secs.toFixed(1) + ' 秒</span><button class="x" data-spx="1">✕</button></div>';

  if (SH.recogOK && b.length) {
    const d = lcsDiff(a, b);
    const ok = d.filter(x => x.t === 'ok').length;
    const miss = d.filter(x => x.t === 'miss');
    const pct = a.length ? Math.round(ok / a.length * 100) : 0;
    const col = pct >= 85 ? 'var(--good)' : pct >= 60 ? 'var(--amber)' : 'var(--bad)';
    html += '<div class="row"><div><div class="sp-score" style="color:' + col + '">' + pct + '%</div>' +
      '<div class="tiny muted">念到 ' + ok + ' / ' + a.length + ' 個字</div></div>' +
      '<div style="margin-left:auto;text-align:right" class="tiny muted">' +
      (miss.length ? '漏了 <b style="color:var(--bad)">' + miss.length + '</b> 個字' : '一個字都沒漏 👏') + '</div></div>';
    html += '<div class="sp-diff">' + d.map(x =>
      x.t === 'ok' ? '<span class="ok">' + esc(x.w) + '</span>' :
      x.t === 'miss' ? '<span class="miss">' + esc(x.w) + '</span>' :
      '<span class="add">' + esc(x.w) + '</span>').join(' ') + '</div>';
    html += '<div class="sp-note">灰色＝念到了　<span style="color:var(--bad)">紅色刪除線＝漏掉／念錯</span>　<span style="color:var(--amber)">黃色＝多念的</span><br>辨識由瀏覽器完成，口音重或環境吵時會誤判，聽自己的錄音為準。</div>';
  } else {
    html += '<div class="sp-note" style="font-size:12.5px;color:var(--ink-2)">' +
      (SRCls ? '這次沒有辨識到文字（可能太小聲、太吵，或這個瀏覽器的辨識不穩）。' : '這個瀏覽器不支援自動辨識（iPhone Safari 常見）。') +
      '<br>可以直接播下面的錄音，和範讀比對。</div>';
  }
  if (SH.url) html += '<audio class="sp-audio" controls src="' + SH.url + '"></audio>';
  html += '<div class="sbar" style="margin-top:8px">' +
    '<button class="sbtn play" data-say="' + esc(SH.ref) + '">▶ 聽範讀</button>' +
    '<button class="sbtn mic" data-mic="' + id + '" data-ref="' + esc(SH.ref) + '">🎙 再錄一次</button></div>';
  html += '<div class="sp-note">錄音只存在這個分頁的記憶體裡，換頁或關掉就消失，不會上傳也不會留檔。</div>';
  panel.innerHTML = html;
  bindShadow(panel);
  panel.querySelectorAll('[data-say]').forEach(x => x.onclick = e => { e.stopPropagation(); say(x.getAttribute('data-say')); });
}
function bindShadow(root) {
  (root || document).querySelectorAll('[data-mic]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const id = b.dataset.mic;
    if (SH.id === id && SH.rec && SH.rec.state === 'recording') shadowStop();
    else shadowStart(id, b.dataset.ref || '');
  });
  (root || document).querySelectorAll('[data-spx]').forEach(b => b.onclick = e => {
    e.stopPropagation(); const p = b.closest('[data-sp]'); shadowRelease(); if (p) p.innerHTML = '';
  });
}

/* ===================== 跟讀列（每個分頁都有） ===================== */
const spk = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>';
const SPDS = [0.5, 0.75, 1, 1.25, 1.5];
let SBN = 0;
function sbar(text, label, opt) {
  opt = opt || {};
  const id = 'sb' + (++SBN);
  const mic = opt.noMic ? '' :
    '<button class="sbtn mic" data-mic="' + id + '" data-ref="' + esc(text) + '">🎙 錄音跟讀</button>';
  return '<div class="sbar"><button class="sbtn play" data-say="' + esc(text) + '">' + spk + ' ' + (label || '跟讀') + '</button>' + mic +
    '<div class="spd">' + SPDS.map(r => '<button data-spd="' + r + '" class="' + (S.settings.rate === r ? 'on' : '') + '">' + r + '×</button>').join('') + '</div>' +
    '</div><div class="shadow-mount" data-sp="' + id + '"></div>';
}

/* ===================== ROUTER ===================== */
let TAB = 'home';
const TITLES = { home: '多益字彙旅程', vocab: '單字', listen: '聽力', read: '閱讀', quiz: '測驗', checkin: '每日打卡' };
function render() {
  const m = el('main');
  SBN = 0;
  try {
    m.innerHTML = TAB === 'home' ? viewHome() : TAB === 'vocab' ? viewVocab() : TAB === 'listen' ? viewListen() :
      TAB === 'read' ? viewRead() : TAB === 'quiz' ? viewQuiz() : viewCheckin();
  } catch (err) {
    m.innerHTML = '<div class="card pad"><b>這一頁出了點問題</b>' +
      '<div class="tiny muted" style="margin-top:8px;word-break:break-word">' + esc((err && err.message) || err) + '</div>' +
      '<button class="btn ghost sm" data-goto="home" style="margin-top:12px">回首頁</button></div>';
  }
  el('hTitle').textContent = TITLES[TAB] || '多益字彙旅程';
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === TAB));
  bindAll();
}
function go(t) { stopAudio(); shadowRelease(); TAB = t; if (t === 'vocab') buildDeck(); if (t === 'quiz') QZ = null; render(); el('main').scrollTop = 0; }

function uswitch() {
  return '<div class="uswitch">' + allUnits().map(({ c, u }) => {
    const on = (c.id === S.courseId && u.id === S.unitId);
    return '<button class="uchip' + (on ? ' on' : '') + '" data-u="' + esc(c.id) + '||' + esc(u.id) + '">' +
      '<span class="dot"></span>' + esc(u.label) + '　' + esc(u.theme || '') + '</button>';
  }).join('') + '</div>';
}

/* ===================== 首頁 ===================== */
function viewHome() {
  const d = days()[today()] || { w: 0, q: 0, in: false }, lt = learnedTotal(), due = dueList().length, sk = streak();
  const R = 42, C = 2 * Math.PI * R, pct = lt.total ? Math.round(lt.k / lt.total * 100) : 0;
  const off = C * (1 - (lt.total ? (lt.k + lt.l * .5) / lt.total : 0));
  const act = allUnits().map(({ c, u }) => ({ c, u, s: unitStats(c, u) }));
  return `<div class="view fade">
    <div class="card pad">
      <div class="row"><div>
        <div class="tiny muted">${today()}　${d.in ? '<span class="pill known">已打卡</span>' : '<span class="pill new">尚未打卡</span>'}</div>
        <div style="font-family:var(--disp);font-weight:800;font-size:19px;margin-top:4px">今日進度</div>
      </div><div style="margin-left:auto;text-align:right"><div class="streak" style="font-size:30px">${sk}</div><div class="tiny muted">連續天數</div></div></div>
      <div class="stat-grid" style="margin-top:13px">
        <div class="stat"><div class="k">今日單字</div><div class="v">${d.w || 0}<small> 個</small></div></div>
        <div class="stat"><div class="k">今日答題</div><div class="v">${d.q || 0}<small> 題</small></div></div>
        <div class="stat"><div class="k">待複習</div><div class="v" style="color:${due ? 'var(--amber)' : 'var(--ink)'}">${due}<small> 個</small></div></div>
      </div>
    </div>

    <div class="card pad">
      <div class="row" style="gap:16px">
        <div class="ring"><svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="9"/>
          <circle cx="48" cy="48" r="${R}" fill="none" stroke="var(--accent)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
        </svg><div class="pct"><b>${pct}%</b><span>總精熟</span></div></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:7px">
          <div class="kv"><span class="dot3" style="background:var(--good)"></span>已精熟<b>${lt.k}</b></div>
          <div class="kv"><span class="dot3" style="background:var(--amber)"></span>學習中<b>${lt.l}</b></div>
          <div class="kv"><span class="dot3" style="background:var(--line-2)"></span>未學<b>${lt.n}</b></div>
          <div class="kv" style="border-top:1px solid var(--line);padding-top:6px">全部單字<b>${lt.total}</b></div>
        </div>
      </div>
    </div>

    <h2 class="sect">各教材進度（單字＋影片）</h2>
    ${act.map(({ c, u, s }) => `<div class="card pad" style="padding:13px">
      <div class="row"><b style="font-size:14.5px">${esc(u.theme || u.label)}</b>
        <span class="tiny muted">${esc(c.name)}・${esc(u.label)}</span>
        <b style="margin-left:auto;font-family:var(--disp);font-variant-numeric:tabular-nums">${s.pct}%</b></div>
      <div class="bar" style="margin-top:9px"><i style="width:${s.pct}%"></i></div>
      <div class="row tiny muted" style="margin-top:7px">
        <span>已精熟 ${s.k}／${s.total}</span>
        <span style="margin-left:auto">${u.video ? '🎬 影片　' : ''}${u.audioSrc ? '🔊 真人原音' : ''}</span>
      </div>
      <div class="two" style="margin-top:11px">
        <button class="btn ghost sm" data-open="${esc(c.id)}||${esc(u.id)}||vocab">背單字</button>
        <button class="btn ghost sm" data-open="${esc(c.id)}||${esc(u.id)}||listen">聽力</button>
        <button class="btn ghost sm" data-open="${esc(c.id)}||${esc(u.id)}||read">閱讀</button>
      </div>
    </div>`).join('')}

    ${due ? `<button class="btn" data-goq="review">🔁　複習測驗（${due} 個到期）</button>` : ''}
    ${!d.in ? `<button class="btn ghost" data-goto="checkin">📅　今天還沒打卡</button>` : ''}
    ${iosHint()}
  </div>`;
}
function iosHint() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!ios || standalone) return '';
  return `<div class="card pad tiny muted" style="text-align:center">
    📲 在 Safari 按下方「分享」→「加入主畫面」，就能像 App 一樣全螢幕開啟，也能離線用。</div>`;
}

/* ===================== 單字 ===================== */
let deck = [], di = 0, flipped = false, vocabList = false;
function buildDeck() { deck = (curUnit().words || []).slice(); di = 0; flipped = false; }
function viewVocab() {
  const u = curUnit();
  if (!deck.length || (deck[0] && !(u.words || []).includes(deck[0]))) buildDeck();
  if (vocabList) return `<div class="view fade">${uswitch()}
    <button class="btn ghost sm" data-vmode="card" style="width:100%">← 回單字卡</button>
    ${(u.words || []).map(w => { const p = pget(wid(w));
      return `<div class="sent"><div class="row"><b class="en" style="font-family:var(--disp);font-size:16px">${esc(w.w)}</b>
        <span class="stars">${'★'.repeat(w.s || 1)}</span>
        <span class="pill ${p.st}" style="margin-left:auto">${p.st === 'known' ? '已懂' : p.st === 'learning' ? '學習中' : '未學'}</span></div>
        <div class="tiny muted" style="margin-top:3px">${esc((w.pos || []).map(x => x.p + ' ' + x.m).join('　'))}</div>
        ${sbar(w.w, '發音')}</div>`; }).join('')}
  </div>`;
  if (di >= deck.length) return `<div class="view fade">${uswitch()}
    <div class="card pad" style="text-align:center;padding:30px">
      <div style="font-size:38px">🎉</div><b style="font-size:18px;display:block;margin:8px 0 4px">這一輪看完了</b>
      <p class="tiny muted" style="margin:0 0 16px">今天學了 ${(days()[today()] || {}).w || 0} 個單字</p>
      <button class="btn" data-vmode="again">再刷一輪</button>
      <button class="btn ghost" data-goq="today" style="margin-top:9px">做今日測驗</button>
    </div></div>`;
  const w = deck[di], p = pget(wid(w));
  const tips = (w.tips || []).map(t => `<div class="tip"><div class="k">${t.k === '文法' ? '📘 文法解析' : t.k === '常考語句' ? '🎯 常考語句' : t.k === '易混淆' ? '⚠️ 易混淆' : '🔁 ' + esc(t.k)}</div><div class="t">${esc(t.t)}</div></div>`).join('');
  const fam = (w.fam || []).map(f => `<span class="chip"><span class="en">${esc(f.split(' ')[0])}</span> ${esc(f.split(' ').slice(1).join(' '))}</span>`).join('');
  const ex = (w.ex || []).map(e => `<div><div class="en">${hl(e.en, w.w)}</div><div class="zh">${esc(e.zh)}</div>${sbar(e.en, '跟讀例句')}</div>`).join('');
  return `<div class="view fade">${uswitch()}
    <div class="fc-top"><div class="fc-count">${di + 1}/${deck.length}</div>
      <div class="bar" style="flex:1"><i style="width:${Math.round(di / deck.length * 100)}%"></i></div>
      <button class="btn ghost sm" data-vmode="list">清單</button></div>
    <div class="flip${flipped ? ' flipped' : ''}" id="flip"><div class="flip-inner">
      <div class="face"><div class="fc-front">
        <div class="num">#${w.n}</div><div class="st stars">${'★'.repeat(w.s || 1)}</div>
        <div class="headword en${(w.w || '').length > 11 ? ' long' : ''}">${esc(w.w)}</div>
        ${w.ph ? `<div class="ph" style="margin-top:8px">${esc(w.ph)}</div>` : ''}
        ${sbar(w.w, '聽發音')}
        <div class="hint">點卡片看解釋・例句・文法</div>
      </div></div>
      <div class="face back"><div class="face-scroll">
        <div class="back-word"><span class="w en">${esc(w.w)}</span>${w.ph ? `<span class="ph">${esc(w.ph)}</span>` : ''}</div>
        <div class="pos-line">${(w.pos || []).map(x => `<div class="p"><span class="pos-tag">${esc(x.p)}</span><span>${esc(x.m)}</span></div>`).join('')}</div>
        <div class="exbox">${ex}</div>
        ${(fam || w.syn || w.ant) ? `<div class="chips">${fam}${w.syn ? `<span class="chip">同義 <span class="en">${esc(w.syn)}</span></span>` : ''}${w.ant ? `<span class="chip">反義 <span class="en">${esc(w.ant.split(' ')[0])}</span></span>` : ''}</div>` : ''}
        ${tips}
      </div></div>
    </div></div>
    <div class="grade"><button class="again" data-g="again">還不熟</button><button class="known" data-g="known">已記住</button></div>
  </div>`;
}
function grade(kind) {
  const w = deck[di], i = wid(w), p = pget(i);
  if (kind === 'known') pset(i, { st: 'known', lv: Math.min((p.lv || 0) + 1, IVL.length - 1), seen: p.seen + 1, last: Date.now() });
  else pset(i, { st: 'learning', lv: 0, seen: p.seen + 1, last: Date.now() });
  bumpDay('w', 1); touch(); shadowRelease(); di++; flipped = false; render();
}

/* ===================== 聽力 ===================== */
const LS = { audio: null, rate: 1, revealed: {} };
function stopAudio() { try { if (LS.audio) LS.audio.pause(); } catch (e) {} LS.audio = null; }
function viewListen() {
  const u = curUnit(), sents = (u.words || []).filter(w => w.ex && w.ex.length);
  let src = '';
  if (u.audioSrc) src = `<div class="card pad player">
      <div class="tiny muted">${esc(u.label)}・真人原音</div>
      <audio id="laud" src="${esc(u.audioSrc)}" preload="metadata"></audio>
      <button class="play-big" id="lplay">▶</button>
      <div class="spd" style="margin-left:0">${SPDS.map(r => `<button data-arate="${r}" class="${LS.rate === r ? 'on' : ''}">${r}×</button>`).join('')}</div>
      <div class="tiny muted" id="ltime">00:00</div></div>`;
  else if (u.video) src = `<div class="card pad">
      <div class="tiny muted" style="margin-bottom:9px;text-align:center">聽力來源：影片</div>
      ${ytEmbed(u.video)}</div>`;
  else src = `<div class="card pad tiny muted" style="text-align:center">此單元沒有音檔，可用下方逐句朗讀練習。</div>`;
  return `<div class="view fade">${uswitch()}
    ${src}
    ${(u.audioSrc && u.video) ? `<div class="card pad">${ytEmbed(u.video)}</div>` : ''}
    <h2 class="sect">逐句聽讀（先聽，再看文字）</h2>
    ${sents.map((w, k) => { const e = w.ex[0], rv = LS.revealed[w.n];
      return `<div class="sent"><div class="idx">${k + 1} / ${sents.length}</div>
        <div class="en ${rv ? '' : 'hidden-text'}">${hl(e.en, w.w)}</div>
        ${rv ? `<div class="zh">${esc(e.zh)}</div>` : ''}
        <button class="reveal-btn" data-rev="${w.n}">${rv ? '隱藏文字' : '顯示文字與中譯'}</button>
        ${sbar(e.en, '聽／跟讀')}</div>`; }).join('')}
    <button class="btn ghost" data-goq="today">做今日測驗（含聽力題）</button>
  </div>`;
}

/* ===================== 閱讀 ===================== */
const RS = { zh: true };
function viewRead() {
  const u = curUnit(), sents = (u.words || []).filter(w => w.ex && w.ex.length);
  return `<div class="view fade">${uswitch()}
    ${u.video ? `<div class="card pad">${ytEmbed(u.video)}</div>` : ''}
    <div class="row"><h2 class="sect" style="margin:0">閱讀・${esc(u.theme || u.label)}</h2>
      <button class="btn ghost sm" data-zh="1" style="margin-left:auto">${RS.zh ? '隱藏中譯' : '顯示中譯'}</button></div>
    ${sents.map((w, k) => { const e = w.ex[0];
      return `<div class="sent"><div class="idx">${k + 1}　<span class="en">${esc(w.w)}</span>　${esc((w.pos || []).map(x => x.m).join('；'))}</div>
        <div class="en">${hl(e.en, w.w)}</div>
        ${RS.zh ? `<div class="zh">${esc(e.zh)}</div>` : ''}
        ${sbar(e.en, '跟讀')}</div>`; }).join('')}
    ${(u.comp && u.comp.length) ? `<button class="btn" data-goq="today">做閱讀理解測驗（${u.comp.length} 題）</button>` : ''}
  </div>`;
}

/* ===================== 測驗 ===================== */
let QZ = null;
function buildToday() {
  const u = curUnit(), ws = u.words || []; let qs = [];
  ws.forEach((w, idx) => {
    const o = shuffle(ws.filter(x => x.n !== w.n)).slice(0, 3); if (o.length < 3) return;
    const t = idx % 3;
    if (t === 0) qs.push({ kind: 'word', prompt: w.w, ph: w.ph, say: w.w, sub: '選出正確的中文意思', opts: shuffle([w, ...o].map(x => ({ t: (x.pos || []).map(p => p.m).join('；'), ok: x.n === w.n }))), ref: { c: curCourse().id, u: u.id, n: w.n } });
    else if (t === 1) qs.push({ kind: 'zh', prompt: (w.pos || []).map(p => p.p + ' ' + p.m).join('　'), sub: '選出對應的英文單字', opts: shuffle([w, ...o].map(x => ({ t: x.w, ok: x.n === w.n, en: 1 }))), ref: { c: curCourse().id, u: u.id, n: w.n } });
    else qs.push({ kind: 'listen', say: w.w, sub: '聽發音，選出正確拼字', opts: shuffle([w, ...o].map(x => ({ t: x.w, ok: x.n === w.n, en: 1 }))), ref: { c: curCourse().id, u: u.id, n: w.n } });
  });
  (u.cloze || []).forEach(c => qs.push({ kind: 'cloze', prompt: c.s, sub: '選出符合句意的單字', opts: shuffle(c.opts.map(o => ({ t: o, ok: o === c.a, en: 1 }))) }));
  (u.comp || []).forEach(c => qs.push({ kind: 'mc', prompt: c.q, sub: '內容理解', opts: shuffle(c.opts.map(o => ({ t: o, ok: o === c.a }))) }));
  QZ = { mode: 'today', qs: shuffle(qs).slice(0, 18), i: 0, score: 0, wrong: [], answered: false };
}
function buildReview() {
  const due = dueList().slice(0, 20); let qs = [];
  due.forEach(({ c, u, w }, idx) => {
    const pool = (u.words || []).filter(x => x.n !== w.n); const o = shuffle(pool).slice(0, 3); if (o.length < 3) return;
    if (idx % 2 === 0) qs.push({ kind: 'word', prompt: w.w, ph: w.ph, say: w.w, sub: '複習：選出中文意思', opts: shuffle([w, ...o].map(x => ({ t: (x.pos || []).map(p => p.m).join('；'), ok: x.n === w.n }))), ref: { c: c.id, u: u.id, n: w.n } });
    else qs.push({ kind: 'zh', prompt: (w.pos || []).map(p => p.p + ' ' + p.m).join('　'), sub: '複習：選出英文單字', opts: shuffle([w, ...o].map(x => ({ t: x.w, ok: x.n === w.n, en: 1 }))), ref: { c: c.id, u: u.id, n: w.n } });
  });
  QZ = { mode: 'review', qs, i: 0, score: 0, wrong: [], answered: false };
}
function viewQuiz() {
  if (!QZ) {
    const due = dueList().length, u = curUnit();
    return `<div class="view fade">${uswitch()}
      <h2 class="sect">今日測驗</h2>
      <button class="mode-card" data-goq="today"><div class="mi" style="background:var(--accent-soft)">📝</div>
        <div class="t"><b>今日學習內容</b><span>${esc(u.label)}・${esc(u.theme || '')}　單字＋克漏字${(u.comp && u.comp.length) ? '＋理解題' : ''}</span></div>
        <div class="n">${(u.words || []).length}</div></button>
      <h2 class="sect">複習測驗（記憶曲線）</h2>
      <button class="mode-card" data-goq="review" ${due ? '' : 'disabled style="opacity:.55"'}>
        <div class="mi" style="background:#fff4e2">🔁</div>
        <div class="t"><b>到期複習</b><span>${due ? '依 1/2/4/7/15/30 天間隔挑出該複習的字' : '目前沒有到期的單字，先去學新的吧'}</span></div>
        <div class="n">${due}</div></button>
      <p class="tiny muted" style="text-align:center;margin:2px">答對會把該字推到下一個間隔，答錯則回到最短間隔重新記。</p>
    </div>`;
  }
  if (QZ.i >= QZ.qs.length) return quizResult();
  const q = QZ.qs[QZ.i];
  let stem = '';
  if (q.kind === 'word') stem = `<div class="q-word en">${esc(q.prompt)}</div>${q.ph ? `<div class="ph" style="text-align:center">${esc(q.ph)}</div>` : ''}<div class="row" style="justify-content:center;margin-top:6px"><button class="sbtn play" data-say="${esc(q.say)}">${spk} 播放</button></div>`;
  else if (q.kind === 'zh') stem = `<div style="text-align:center;font-size:18px;font-weight:700">${esc(q.prompt)}</div>`;
  else if (q.kind === 'listen') stem = `<div style="text-align:center;padding:8px 0"><button class="sbtn play" data-say="${esc(q.say)}">${spk} 再聽一次</button></div>`;
  else if (q.kind === 'cloze') stem = `<div class="q-cloze">${esc(q.prompt).replace(/_{2,}/g, '<u>__</u>')}</div>`;
  else stem = `<div style="font-size:16px;line-height:1.7;font-weight:700">${esc(q.prompt)}</div>`;
  return `<div class="view fade">
    <div class="fc-top"><button class="btn ghost sm" data-goq="exit">✕</button>
      <div class="bar" style="flex:1"><i style="width:${Math.round(QZ.i / QZ.qs.length * 100)}%"></i></div>
      <div class="fc-count">${QZ.i + 1}/${QZ.qs.length}</div></div>
    <div class="card pad">
      <div class="row tiny muted"><span>${QZ.mode === 'review' ? '🔁 複習' : '📝 今日'}</span><span>${esc(q.sub)}</span><span style="margin-left:auto">得分 ${QZ.score}</span></div>
      <div style="margin-top:10px">${stem}</div>
      <div class="opts" id="opts">${q.opts.map((o, i) => `<button class="opt" data-opt="${i}"><span class="k">${String.fromCharCode(65 + i)}</span><span class="${o.en ? 'en' : ''}" style="${o.en ? 'font-weight:700' : ''}">${esc(o.t)}</span></button>`).join('')}</div>
    </div><div id="qfoot"></div></div>`;
}
function answer(idx) {
  if (QZ.answered) return; QZ.answered = true;
  const q = QZ.qs[QZ.i], ok = q.opts[idx].ok;
  document.querySelectorAll('#opts .opt').forEach((b, i) => { b.setAttribute('disabled', ''); if (q.opts[i].ok) b.classList.add('correct'); else if (i === idx) b.classList.add('wrong'); });
  if (q.ref) {
    const i = gid(q.ref.c, q.ref.u, q.ref.n), p = pget(i);
    if (ok) pset(i, { lv: Math.min((p.lv || 0) + 1, IVL.length - 1), cor: p.cor + 1, last: Date.now(), st: (p.lv || 0) >= 2 ? 'known' : 'learning' });
    else pset(i, { lv: 0, wro: p.wro + 1, last: Date.now(), st: 'learning' });
  }
  if (ok) QZ.score++; else { QZ.wrong.push(q); if (q.say) say(q.say); }
  bumpDay('q', 1); touch();
  const f = el('qfoot'); if (f) f.innerHTML = `<button class="btn" id="qnext">${QZ.i + 1 >= QZ.qs.length ? '看結果' : '下一題'}</button>`;
  const n = el('qnext'); if (n) n.onclick = () => { QZ.i++; QZ.answered = false; render(); };
}
function quizResult() {
  const t = QZ.qs.length, s = QZ.score, p = t ? Math.round(s / t * 100) : 0;
  return `<div class="view fade"><div class="card pad" style="text-align:center">
    <div class="tiny muted">${QZ.mode === 'review' ? '複習測驗結果' : '今日測驗結果'}</div>
    <div class="score-big" style="color:${p >= 70 ? 'var(--good)' : 'var(--amber)'};margin:8px 0 4px">${s}<span style="font-size:20px;color:var(--ink-3)"> / ${t}</span></div>
    <div class="tiny muted" style="margin-bottom:14px">${p >= 90 ? '掌握得很好！' : p >= 70 ? '不錯，錯的再看一次就更穩。' : '多回單字頁刷幾輪。'}</div>
    <div class="two"><button class="btn ghost" data-goq="${QZ.mode}">再測一次</button><button class="btn" data-goto="vocab">回單字</button></div>
  </div>
  ${QZ.wrong.length ? `<h2 class="sect">答錯的（${QZ.wrong.length}）</h2>${QZ.wrong.map(q => `<div class="sent"><div class="en">${esc(q.prompt || q.say || '')}</div><div class="zh">正解：${esc((q.opts.find(o => o.ok) || {}).t || '')}</div>${sbar(q.prompt || q.say || '', '跟讀')}</div>`).join('')}` : ''}
  </div>`;
}

/* ===================== 每日打卡 ===================== */
function viewCheckin() {
  const D = days(), d = D[today()] || { w: 0, q: 0, in: false }, sk = streak(), lt = learnedTotal();
  const cal = []; for (let i = 29; i >= 0; i--) { const k = dayKey(i), r = D[k]; cal.push({ k, on: !!(r && (r.in || r.w || r.q)), t: i === 0 }); }
  const week = []; let mx = 1;
  for (let i = 6; i >= 0; i--) { const k = dayKey(i), r = D[k] || {}; const v = (r.w || 0); mx = Math.max(mx, v); week.push({ k, v, lab: ['日', '一', '二', '三', '四', '五', '六'][new Date(k + 'T00:00:00').getDay()] }); }
  return `<div class="view fade">
    <div class="card pad" style="text-align:center">
      <div class="streak">${sk}</div><div class="tiny muted" style="margin-bottom:14px">連續學習天數</div>
      ${d.in ? `<div class="pill known" style="font-size:13px;padding:8px 16px">✓ 今天已打卡</div>` : `<button class="btn" id="doCheck">📅　今日打卡</button>`}
      <div class="tiny muted" style="margin-top:12px">今天：${d.w || 0} 個單字 ・ ${d.q || 0} 題測驗</div>
    </div>
    <h2 class="sect">近 30 天</h2>
    <div class="card pad"><div class="cal">${cal.map(x => `<div class="d${x.on ? ' on' : ''}${x.t ? ' today' : ''}">${x.on ? '✓' : ''}</div>`).join('')}</div></div>
    <h2 class="sect">近 7 日單字量</h2>
    <div class="card pad"><div class="barsC">${week.map(w => `<div class="b"><i style="height:${Math.round((w.v / mx) * 58) + 3}px"></i><span>${w.lab}</span></div>`).join('')}</div>
      <div class="tiny muted" style="text-align:center;margin-top:8px">最高 ${mx} 個／日</div></div>
    <h2 class="sect">單字統計</h2>
    <div class="stat-grid">
      <div class="stat"><div class="k">已精熟</div><div class="v" style="color:var(--good)">${lt.k}</div></div>
      <div class="stat"><div class="k">學習中</div><div class="v" style="color:var(--amber)">${lt.l}</div></div>
      <div class="stat"><div class="k">未學</div><div class="v">${lt.n}</div></div>
    </div>
    ${allUnits().map(({ c, u }) => { const s = unitStats(c, u); return `<div class="card pad" style="padding:12px">
      <div class="row tiny"><b>${esc(u.theme || u.label)}</b><span class="muted">${esc(u.label)}</span><b style="margin-left:auto;font-family:var(--disp)">${s.k}/${s.total}</b></div>
      <div class="mini-bar" style="margin-top:7px"><i style="width:${s.pct}%"></i></div></div>`; }).join('')}
  </div>`;
}

/* ===================== BIND ===================== */
function bindAll() {
  document.querySelectorAll('[data-say]').forEach(b => b.onclick = e => { e.stopPropagation(); say(b.getAttribute('data-say')); });
  document.querySelectorAll('[data-spd]').forEach(b => b.onclick = e => {
    e.stopPropagation(); S.settings.rate = parseFloat(b.dataset.spd); touch();
    document.querySelectorAll('[data-spd]').forEach(x => x.classList.toggle('on', parseFloat(x.dataset.spd) === S.settings.rate));
  });
  bindShadow(document);
  document.querySelectorAll('[data-u]').forEach(b => b.onclick = () => {
    const p = b.dataset.u.split('||'); stopAudio(); shadowRelease();
    S.courseId = p[0]; S.unitId = p[1]; touch(); buildDeck(); QZ = null; LS.revealed = {}; render();
  });
  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
    const p = b.dataset.open.split('||'); stopAudio(); shadowRelease();
    S.courseId = p[0]; S.unitId = p[1]; touch(); buildDeck(); QZ = null; LS.revealed = {}; go(p[2]);
  });
  document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => go(b.dataset.goto));
  document.querySelectorAll('[data-goq]').forEach(b => b.onclick = () => {
    const m = b.dataset.goq; shadowRelease();
    if (m === 'exit') { QZ = null; render(); return; }
    if (m === 'today') buildToday(); else buildReview();
    TAB = 'quiz'; render(); el('main').scrollTop = 0;
  });
  if (TAB === 'vocab') {
    const f = el('flip');
    if (f) f.onclick = e => {
      if (e.target.closest('[data-say]') || e.target.closest('[data-spd]') || e.target.closest('[data-mic]') ||
          e.target.closest('.shadow-panel') || e.target.closest('[data-sp]')) return;
      flipped = !flipped; f.classList.toggle('flipped', flipped);
    };
    document.querySelectorAll('[data-g]').forEach(b => b.onclick = () => grade(b.dataset.g));
    document.querySelectorAll('[data-vmode]').forEach(b => b.onclick = () => {
      const m = b.dataset.vmode; shadowRelease();
      if (m === 'list') vocabList = true; else if (m === 'card') vocabList = false; else if (m === 'again') buildDeck();
      render();
    });
  }
  if (TAB === 'listen') {
    const a = el('laud');
    if (a) {
      LS.audio = a; a.playbackRate = LS.rate;
      const pb = el('lplay');
      if (pb) pb.onclick = () => { if (a.paused) { a.play().catch(() => toast('播放失敗，請再按一次')); pb.textContent = '❚❚'; } else { a.pause(); pb.textContent = '▶'; } };
      a.ontimeupdate = () => { const t = el('ltime'); if (t) t.textContent = fmtT(a.currentTime) + ' / ' + fmtT(a.duration || 0); };
      a.onended = () => { const p2 = el('lplay'); if (p2) p2.textContent = '▶'; };
      document.querySelectorAll('[data-arate]').forEach(b => b.onclick = () => {
        LS.rate = parseFloat(b.dataset.arate); a.playbackRate = LS.rate;
        document.querySelectorAll('[data-arate]').forEach(x => x.classList.toggle('on', x === b));
      });
    }
    document.querySelectorAll('[data-rev]').forEach(b => b.onclick = () => { const n = b.dataset.rev; LS.revealed[n] = !LS.revealed[n]; shadowRelease(); render(); });
  }
  if (TAB === 'read') document.querySelectorAll('[data-zh]').forEach(b => b.onclick = () => { RS.zh = !RS.zh; shadowRelease(); render(); });
  if (TAB === 'quiz') document.querySelectorAll('#opts .opt').forEach(b => b.onclick = () => answer(parseInt(b.dataset.opt)));
  if (TAB === 'checkin') {
    const c = el('doCheck');
    if (c) c.onclick = () => { const d = today(); const r = days()[d] || { w: 0, q: 0, in: false }; r.in = true; days()[d] = r; touch(); toast('打卡完成，連續 ' + (streak()) + ' 天'); render(); };
  }
}

/* ===================== 設定 ===================== */
function applyTheme() {
  const t = S.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
function fillRateSeg() {
  const r = el('rateSeg'); if (!r) return;
  r.innerHTML = SPDS.map(x => '<button data-rate="' + x + '" class="' + (S.settings.rate === x ? 'on' : '') + '">' + x + '×</button>').join('');
  r.querySelectorAll('button').forEach(b => b.onclick = () => {
    S.settings.rate = parseFloat(b.dataset.rate); touch(); fillRateSeg(); say('for example, a professional résumé');
  });
}
function closeSheet() { const s = el('scrim'); s.classList.remove('show'); setTimeout(() => s.hidden = true, 240); }
el('gearBtn').onclick = () => {
  const s = el('scrim'); s.hidden = false;
  const show = () => s.classList.add('show');
  requestAnimationFrame(show); setTimeout(show, 60);   // rAF 在背景分頁會被凍結，補一道 setTimeout 保險
  fillRateSeg(); fillVoice(); fillPackList();
  el('syncUrl').value = SYNC.url; el('syncKey').value = SYNC.key;
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.th === S.settings.theme));
};
el('scrim').onclick = e => { if (e.target === el('scrim')) closeSheet(); };
document.querySelectorAll('#themeSeg button').forEach(b => b.onclick = () => {
  S.settings.theme = b.dataset.th; touch(); applyTheme();
  document.querySelectorAll('#themeSeg button').forEach(x => x.classList.toggle('on', x === b));
});
el('voiceSel').onchange = e => { S.settings.voiceURI = e.target.value; touch(); say('professional'); };
el('resetBtn').onclick = () => {
  const c = curCourse(), u = curUnit();
  (u.words || []).forEach(w => { delete S.prog[gid(c.id, u.id, w.n)]; });
  touch(); closeSheet(); buildDeck(); render(); toast('已重設 ' + u.label);
};
el('syncSave').onclick = async () => {
  syncSaveCfg(el('syncUrl').value, el('syncKey').value);
  if (!SYNC.url || !SYNC.key) { setSync('off'); toast('已清除同步設定'); return; }
  toast('連線中…'); await syncPull(true);
};
el('expBtn').onclick = () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'toeic-progress-' + today() + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
el('packBtn').onclick = () => el('packFile').click();
el('packFile').onchange = async e => {
  const fs = [...e.target.files]; e.target.value = '';
  if (fs.length) { toast('匯入中…'); await importPackFiles(fs); }
};
el('impBtn').onclick = () => el('impFile').click();
el('impFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      S = normState(JSON.parse(r.result)); S.updatedAt = Date.now(); saveLocal();
      applyTheme(); buildDeck(); render(); closeSheet(); toast('進度已匯入'); syncPush();
    } catch (err) { toast('檔案讀不懂：' + (err.message || err)); }
  };
  r.readAsText(f);
  e.target.value = '';
};

document.querySelectorAll('#nav button').forEach(b => b.onclick = () => go(b.dataset.tab));
window.addEventListener('pagehide', shadowRelease);
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopAudio(); shadowRelease(); } });

/* ===================== BOOT ===================== */
(async function boot() {
  if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
  syncLoadCfg();
  applyTheme();
  try { await loadPacks(); } catch (e) {}
  if (!S.updatedAt && DATA.courses.length) { S.courseId = DATA.courses[0].id; S.unitId = DATA.courses[0].units[0].id; }
  buildDeck(); render();
  setSync(SYNC.url && SYNC.key ? 'on' : 'off', SYNC.url && SYNC.key ? '連線中…' : '進度儲存在此裝置');
  if (SYNC.url && SYNC.key) syncPull(false);
})();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
