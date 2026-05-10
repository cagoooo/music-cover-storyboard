# 封面接故事 · 音樂影片分鏡產生器

> 上傳 MV → 抓出封面 → 一鍵接續 15-30 秒分鏡

## 這是什麼

把你用 Gemini Veo / Suno / 其他 AI 工具產出的音樂影片丟進來：

1. **抓封面** — 自動或挑你喜歡的那一幀，下載成 PNG
2. **接故事** — AI 看封面，產出 8 種風格的後續分鏡 prompt（中英文）
3. **一鍵複製** — 貼回 Google Flow / Canva AI / Anijam / Runway / 海螺 / Kling，繼續創作

完全免費、不需登入、不需 API key、影片不上傳任何伺服器（瀏覽器端處理）。

## 線上試用

🌐 https://cagoooo.github.io/music-cover-storyboard/

## 八種分鏡風格

| 風格 | 適合 |
|---|---|
| 🎬 寫實電影級 | Veo / Runway / Anijam 等高擬真平台 |
| 🎵 Suno 音樂 MV 抒情風 | 抒情歌、慢板情緒 |
| 🎨 動畫故事板 | 給小朋友看的可愛動畫 |
| 🇯🇵 日系動漫 MV 風 | 二次元動畫 |
| 🌃 賽博龐克霓虹 | 未來感、科技感 |
| 🌸 Studio Ghibli 溫馨風 | 手繪、田園、療癒 |
| 📽️ 紀錄片寫實 | 真實感、生活感 |
| ⚡ K-pop MV 高能剪輯 | 快剪、舞蹈 |

## 技術架構

- **前端**：純 HTML + Vanilla JS + Tailwind CDN，部署於 GitHub Pages
- **後端**：Firebase Cloud Functions v2（Node 20）
- **AI**：Google Gemini 2.5 Flash（多模態 + JSON mode）
- **防刷**：Cloudflare Turnstile（無感人機驗證）

## 本地開發

```bash
# 前端：直接開檔或用任意靜態 server
npx serve public

# 後端 emulator
cd functions
npm install
firebase emulators:start --only functions
```

## 部署

```bash
# 部署 Cloud Functions
firebase deploy --only functions

# 前端：push main，GitHub Actions 自動部署
git push origin main
```

## 發版（升 cache-bust 版本號）

每次前端 JS / CSS / icon / OG 圖有變動，跑一次升版讓使用者拿到新版：

```bash
# patch +1：1.2.0 → 1.2.1（小修小補）
python tools/bump-version.py

# minor：1.2.0 → 1.3.0（新功能）
python tools/bump-version.py minor

# major：1.2.0 → 2.0.0（破壞性變更）
python tools/bump-version.py major

# 直接指定
python tools/bump-version.py --to 2.0.0

# 只算不寫
python tools/bump-version.py --dry-run
```

腳本會一次同步更新：
- `public/version.json` 的 `version` 與 `buildTime`
- `public/config.js` 的 `version` 欄位
- `public/index.html` 所有 `?v=X.Y.Z` cache-bust 字串
- `public/service-worker.js` 的 `CACHE_VERSION` 常數

升完版 commit + push 後，已造訪過的使用者**最多 5 分鐘內**會看到「✨ 有新版可以用了」banner，
按「立刻更新」就清快取 reload 拿新版（不需要硬重整）。

## Service Worker 快取策略

| 資源類型 | 策略 | 原因 |
|---|---|---|
| HTML / 首頁導覽 | network-first | 確保入口永遠最新 |
| `version.json` | network-only | 否則版本檢查 banner 無效 |
| `*.js` / `*.css` / icons / og-image | cache-first（含 `?v=`）| 重複造訪秒開、`?v=` 升版時自動失效 |
| Cloud Functions API / Turnstile / Tailwind CDN | 不攔截（直接走網路） | 永遠拿即時資料 |

升版時 SW `activate` 會把舊版 cache（`mcs-static-v舊版號`、`mcs-html-v舊版號`）全部刪掉。

## 授權

MIT

---

Made with ❤️ by [阿凱老師](https://www.smes.tyc.edu.tw/modules/tadnews/page.php?ncsn=11&nsn=16#a5) · 桃園市石門國小
