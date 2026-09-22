# 多益字彙旅程

Mischa 的個人多益 800+ 備考 App。純靜態網頁，手機加到主畫面就像原生 App，可離線用。

| 分頁 | 內容 |
|---|---|
| 首頁 | 今日進度、連續天數、總精熟度、各教材進度、待複習數 |
| 單字 | 翻卡（正面單字＋音標，背面詞性/例句/文法解析）、清單模式 |
| 聽力 | 教材真人原音播放器（0.5–1.5 倍速）或影片內嵌、逐句遮字聽讀 |
| 閱讀 | 影片內嵌、逐句中英對照、中譯可隱藏 |
| 測驗 | ① 今日學習測驗 ② 依記憶曲線出題的累積複習測驗 |
| 打卡 | 30 天日曆、近 7 日單字量長條圖、單字統計 |

**每一頁都有跟讀**：▶ 聽範讀（可選 0.5 / 0.75 / 1 / 1.25 / 1.5 倍速）＋ 🎙 錄音跟讀。
錄完會自動比對漏字（紅色刪除線＝漏掉／念錯，黃色＝多念的），並給念到幾成的分數。
**錄音只存在分頁的記憶體裡，換頁或關掉瀏覽器就消失**，不上傳、不留檔。

---

## 教材的兩種來源

進度鍵是 `課程id/單元id/w序號`，兩種來源共用同一套進度，加新教材不影響既有進度。

| | 內建課程 | 教材包 |
|---|---|---|
| 放哪 | `courses/*.js`，進 git | 自己的雲端硬碟，**不進 git** |
| 適合 | 沒有版權疑慮的（每日 YouTube 影片） | 有版權的（國際學村單字大全） |
| 怎麼裝 | 推上去就有 | ⚙️ 設定 →「匯入教材包」，每台裝置做一次 |
| 存在哪 | 網站檔案 | 瀏覽器本機 IndexedDB，不會上傳 |

### 教材包（有版權的教材）

`教材包/` 放在 Google Drive `800+的小小夢想💭/多益學習App/教材包/`：
一個 `.json` 加對應的音檔。格式：

```json
{ "pack":"gjxc-vocab", "name":"國際學村・單字大全",
  "courses":[ { "id":"gjxc-vocab", "name":"國際學村・單字大全",
    "units":[ { "id":"day01", "label":"Day 01", "theme":"擺脫失業",
                "audioFile":"day01_all.mp4", "words":[ ... ] } ] } ] }
```

在手機（Safari）和電腦（Chrome）各開一次網站 → ⚙️ → 匯入教材包 →
**同時選 `.json` 和音檔**。之後離線也讀得到。
加新的 Day 就是把新單元加進同一個 `.json` 再匯入一次（會整包覆蓋，進度保留）。

### 內建課程（可公開的教材）

在 `courses/` 加一個 `.js`，呼叫一次 `TVJ.register({...})`，
再到 `index.html` 加一行 `<script src="courses/你的檔名.js"></script>`。

### 單元與單字的格式（兩種來源共用）

```js
{
  id:'day02', label:'Day 02', theme:'升遷加薪', themeEn:'Promotion',
  audioFile:'day02_all.mp4',      // 教材包用；內建課程改用 audioSrc:'audio/xxx.mp4'
  words:[
    { n:1, w:'promote', s:3, ph:'[prəˋmot]',
      pos:[{p:'v.', m:'升遷；促銷'}],
      ex:[{en:'She was promoted to manager.', zh:'她被升為經理。'}],
      fam:['promotion n. 升遷'], syn:'elevate', ant:'demote 降職',
      tips:[{k:'文法', t:'被動語態 be promoted to + 職位。'}] },
    // ...
  ],
  cloze:[ {s:'She was ___ to manager last year.', a:'promoted',
           opts:['promoted','demoted','applied','hired']} ]
}
```

欄位只有 `n / w / pos` 是必填，其他留空或不寫都可以。

### 加一支每日影片

1. 抓逐字稿：`python tools/yt_transcript.py <YouTube網址> <輸出資料夾>`
2. 在 `courses/daily-video.js` 的 `units` 陣列尾端加一個單元：

```js
{
  id:'yt-<影片ID>', label:'影片 2', theme:'主題中文', themeEn:'English Theme',
  video:'https://youtu.be/<影片ID>', audioSrc:'',
  words:[ /* 從逐字稿挑出的單字，格式同上 */ ],
  cloze:[ /* 克漏字 */ ],
  comp:[ {q:'影片的核心訊息是…', a:'正確選項', opts:['正確選項','...','...','...']} ]
}
```

### 加教材音檔

MP3 要先轉成 mp4（瀏覽器對 mp4 的相容性最好）：

```bash
ffmpeg -i day02.mp3 -vn -c:a aac -ac 1 -b:a 64k day02_all.mp4
```

放到 Google Drive 的 `教材包/`，在單元裡寫 `audioFile:'day02_all.mp4'`，
下次匯入教材包時一起選起來即可。

> ⚠️ **國際學村的單字、例句、原音都有版權，絕對不要放進這個 repo。**
> `audio/`、`packs/`、`_tvj_pack_*.json` 已經寫在 `.gitignore` 裡擋著。

---

## 跨裝置同步（選用）

不設定的話，進度存在各裝置的瀏覽器裡（可用設定裡的「匯出／匯入」手動搬）。
要讓手機和電腦自動同步，部署 `worker/`：

```bash
cd worker
wrangler kv namespace create TVJ      # 把印出的 id 貼進 wrangler.toml
wrangler deploy
```

然後在 App 的 ⚙️ 設定裡填入 Worker 網址和一把自訂金鑰（≥12 字元），
兩台裝置填**一樣**的金鑰就會互通。金鑰以 SHA-256 當 KV 鍵，伺服器存不到原始金鑰。

---

## 本機預覽

```bash
python -m http.server 8791
```

> 麥克風需要安全來源。`localhost` 算安全來源可以直接測；正式站請用 HTTPS。

## 部署

靜態站，GitHub Pages 開啟即可（Settings → Pages → Branch: `main` / root）。
有版權的教材不在 repo 裡，是各裝置自己匯入的，所以 repo 可以公開。

改版後記得把 `sw.js` 的 `VER` 加一，使用者才會拿到新檔。
