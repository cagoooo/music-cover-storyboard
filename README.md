# 封面接故事 · 音樂影片分鏡產生器

> 上傳 MV → 抓出封面 → 一鍵接續 15-30 秒分鏡

## 這是什麼

把你用 Gemini Veo / Suno / 其他 AI 工具產出的音樂影片丟進來：

1. **抓封面** — 自動或挑你喜歡的那一幀，下載成 PNG
2. **接故事** — AI 看封面，產出 8 種風格的後續分鏡 prompt（中英文）
3. **一鍵複製** — 貼回 Sora / Veo / Runway / Kling / 海螺，繼續創作

完全免費、不需登入、不需 API key、影片不上傳任何伺服器（瀏覽器端處理）。

## 線上試用

🌐 https://cagoooo.github.io/music-cover-storyboard/

## 八種分鏡風格

| 風格 | 適合 |
|---|---|
| 🎬 寫實電影級 | Sora / Veo 等高擬真平台 |
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

## 授權

MIT

---

Made with ❤️ by [阿凱老師](https://www.smes.tyc.edu.tw/modules/tadnews/page.php?ncsn=11&nsn=16#a5) · 桃園市石門國小
