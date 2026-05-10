/**
 * 封面接故事 — Cloud Functions 入口
 *
 * 流程：
 *  1. 前端呼叫 mcs_generateStoryboard，帶上：cover base64 + 風格 array + Turnstile token
 *  2. 後端先驗 Turnstile token（防刷）
 *  3. 用 @google/genai 呼叫 gemini-2.5-flash（多模態 + JSON mode）
 *  4. 結構化 JSON 回前端
 */

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const { GoogleGenAI } = require('@google/genai');
const crypto = require('crypto');
const { verifyTurnstile } = require('./verify-turnstile');
const { STYLES } = require('./styles');

setGlobalOptions({
  region: 'asia-east1',
  maxInstances: 5,
});

// =====================================================================
// E2: in-memory 結果快取（24 小時 TTL，LRU eviction）
//
// 同一個 instance 內，若使用者用相同的封面 + 風格組合 + 進階提示再產一次，
// 直接回傳快取結果，省 Gemini API quota（每天 1500 RPD 的 80% 都會被快取救回）。
// =====================================================================
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;          // 約 50 × ~20KB = 1MB 記憶體
const responseCache = new Map();       // key → { ts, result }

function makeCacheKey(coverBase64, styleIds, lyrics, character) {
  const styleSorted = [...styleIds].sort().join(',');
  const h = crypto.createHash('sha256');
  h.update(coverBase64);
  h.update('|' + styleSorted);
  h.update('|' + (lyrics || ''));
  h.update('|' + (character || ''));
  return h.digest('hex').slice(0, 32);
}

function getCachedResult(key) {
  const e = responseCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  // LRU bump：重新插入到 Map 末端
  responseCache.delete(key);
  responseCache.set(key, e);
  return e.result;
}

function setCachedResult(key, result) {
  responseCache.set(key, { ts: Date.now(), result });
  // 超出上限，刪最舊的（Map 保留插入順序，第一個就是最舊）
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    responseCache.delete(oldestKey);
  }
}

// ---- Secrets ----
const GEMINI_API_KEY = defineSecret('MCS_GEMINI_API_KEY');
const TURNSTILE_SECRET = defineSecret('MCS_TURNSTILE_SECRET');

// ---- 模型設定 ----
const MODEL_ID = 'gemini-2.5-flash';

// ---- 共用：建立 Gemini client ----
function buildGenAI() {
  const apiKey = GEMINI_API_KEY.value();
  if (!apiKey) throw new HttpsError('internal', 'Server missing Gemini API key');
  return new GoogleGenAI({ apiKey });
}

// ---- 共用：構造 system prompt ----
function buildSystemPrompt(selectedStyles, opts = {}) {
  const lines = selectedStyles.map((s, i) =>
    `${i + 1}. style_id="${s.id}" → ${s.label}\n   風格指引：${s.guideline}`
  );

  // 進階提示：歌詞/主題 + 主角外觀（兩者都是可選，使用者沒填就跳過）
  const hasLyrics = opts.lyrics && opts.lyrics.trim().length > 0;
  const hasCharacter = opts.characterDescription && opts.characterDescription.trim().length > 0;

  let advancedSection = '';
  if (hasLyrics || hasCharacter) {
    advancedSection = `\n\n## 使用者提供的進階提示（必須吸收進每一段 prompt）\n\n`;
    if (hasLyrics) {
      advancedSection += `### 🎵 歌詞 / 主題（讓分鏡氛圍呼應這個情感）\n${opts.lyrics.trim()}\n\n`;
      advancedSection += `→ 處理方式：把這個情感、意象、敘事走向融入每段的 mood / action / 視覺隱喻。但不要把歌詞**直接寫進 prompt**（AI 影片平台不需要看到歌詞文字本身），要轉化成畫面語言。\n\n`;
    }
    if (hasCharacter) {
      advancedSection += `### 👤 主角外觀（每段 prompt_zh 與 prompt_en 都必須完整寫出這個外觀，讓 Veo / Anijam / Runway 跨段保持角色一致）\n${opts.characterDescription.trim()}\n\n`;
      advancedSection += `→ 處理方式：每一段 prompt 描述主體時，**完整重述這個外觀**（不要省略、不要用「同上」），這樣每個短影片片段才能跨段角色一致。\n\n`;
    }
  }

  return `你是一位專業的 AI 短影片導演與分鏡師。使用者剛用 AI 工具（Suno / Gemini Veo / Runway 等）做出一段音樂影片，並從中擷取了一張代表性的「封面那一幀」。${advancedSection}

你的任務：把這張封面當作**下一段 20-30 秒短影片的第 0 秒**，幫使用者編寫**接續這個畫面**的後續分鏡腳本。

**這次的產出將餵給 Google Flow、Canva AI、Anijam、Veo、Runway、Kling、海螺 等 AI 影片平台。**
這些平台多半「一次只能產 3-5 秒短片」，所以使用者的工作流是：
  1. 把分段 1 的 prompt 貼到平台 → 產出 5 秒影片 segment-1.mp4
  2. 把分段 2 的 prompt 貼到平台 → 產出 5 秒影片 segment-2.mp4
  3. ...
  4. 最後用剪輯軟體把 N 段串接成完整 20-30 秒短片

因此**每一段 prompt 都必須獨立完整**：使用者貼任何一段都能直接產一段合理畫面，不需要看其他段。

請仔細**看圖**，先理解：
- 主體（人物、角色、物件、場景、衣著、配色、時段、天氣）
- 情緒線索（表情、動作暗示、構圖張力）
- 場景延伸性（這個畫面接下來最自然的故事走向）

然後針對下列每一個「使用者選的風格」各產出一份完整分鏡：

${lines.join('\n\n')}

## 每份分鏡的要求

### 結構
- **total_duration_seconds**：整體總長 20-30 秒（建議 25 秒）
- **segments**：分成 4-6 段，每段 4-6 秒（建議 5 秒一段）
- 第 1 段必須**從封面畫面延續開始**（不可重新換場）
- 後續各段要在故事與情緒上連貫推進，逐步往故事高潮 / 結尾走

### 每段 segments[i] 必填欄位
- \`index\`：段號（從 1 起算）
- \`time\`：時間段，例如 "0-5s"、"5-10s"
- \`duration_seconds\`：本段秒數（建議 4-6）
- \`shot\`：鏡頭語言摘要（例：「中景跟拍」、「特寫慢動作」、「廣角推軌」）
- \`action\`：本段角色動作或畫面變化的一句話描述
- \`mood\`：本段氛圍關鍵字（例：「溫馨、希望」、「孤獨、靜謐」）
- \`prompt_zh\`：**完整可貼的繁體中文 prompt**，120-220 字。包含：
    主體（誰）、動作（在做什麼）、場景（在哪裡）、運鏡（怎麼拍）、
    光線（什麼時段什麼光）、色調（暖/冷/什麼配色）、本段秒數
    例：「鏡頭由廣角推軌至中景，5 秒。一位戴眼鏡的小學女生穿著畢業服，從校門慢慢走出，逆光剪影下髮絲被風吹起。背景是磚紅色校舍與盛開鳳凰木。色調暖黃帶淡橘，電影感 LUT，淺景深背景模糊。情緒：離別中的希望感。」
- \`prompt_en\`：**完整可貼的英文 prompt**（用 cinematic / video AI 平台慣用語）。包含 cinematography terms（dolly, tracking, close-up, shallow DoF, golden hour, slow motion 等）

### 整體版欄位（給「一次產整部」的使用者）
- \`full_prompt_zh\`：把上面所有段串成一個整體 prompt（300-500 字），給支援長 prompt 的平台一次產 25-30 秒
- \`full_prompt_en\`：同上的英文版

## 銜接邏輯

第 i 段的開頭畫面 = 第 i-1 段的結尾畫面。但**不要在 prompt 裡寫「承接上一段」這種字眼**，每段 prompt 都要能獨立貼出去產畫面，不需依賴前後文。
你要做的是：在 prompt 內**直接描述本段開始時的畫面狀態**（例如「鏡頭從中景帶到特寫，女孩臉上淚光閃爍…」），讓 AI 平台拿到 prompt 就能直接產。

## 安全與適用對象

- 這是給老師、家長、學生用的**教學工具**
- 不要使用任何敏感、暴力、色情、政治元素
- 角色避免具體真人姓名（用「一位男孩」「一位老師」這類描述）

## 各風格之間

各 style_id 的分鏡應有明顯不同的 mood / shot / 色調，別產出八個雷同版本。

## 輸出格式

輸出**單一 JSON 物件**，欄位 \`styles\` 是陣列。不要任何 markdown 包裹、不要 \`\`\`json，只回 JSON 本體。`;
}

// ---- 共用：建立 responseSchema ----
function buildResponseSchema() {
  return {
    type: 'object',
    properties: {
      styles: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            style_id: { type: 'string' },
            style_name: { type: 'string' },
            total_duration_seconds: { type: 'integer' },
            segments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  time: { type: 'string' },
                  duration_seconds: { type: 'integer' },
                  shot: { type: 'string' },
                  action: { type: 'string' },
                  mood: { type: 'string' },
                  prompt_zh: { type: 'string' },
                  prompt_en: { type: 'string' },
                },
                required: ['index', 'time', 'duration_seconds', 'shot', 'action', 'mood', 'prompt_zh', 'prompt_en'],
              },
            },
            full_prompt_zh: { type: 'string' },
            full_prompt_en: { type: 'string' },
          },
          required: ['style_id', 'style_name', 'total_duration_seconds', 'segments', 'full_prompt_zh', 'full_prompt_en'],
        },
      },
    },
    required: ['styles'],
  };
}

// ---- 共用：核心生成邏輯（streaming 版本）----
// onChunk: function(text, totalLength) — 每收到一段文字會被 call 一次（給 SSE handler 即時 forward）
async function runGenerationStream({ coverImageBase64, mimeType, selectedStyleIds, lyrics, characterDescription }, onChunk) {
  // 過濾未知 style id
  const validIds = (selectedStyleIds || []).filter(id => Object.prototype.hasOwnProperty.call(STYLES, id));
  if (validIds.length === 0) {
    throw new HttpsError('invalid-argument', '至少要選一種有效的分鏡風格');
  }
  if (validIds.length > 10) {
    throw new HttpsError('invalid-argument', '一次最多 10 種風格');
  }

  // 安全：base64 大小檢查（< 8MB）
  const approxBytes = Math.floor(coverImageBase64.length * 0.75);
  if (approxBytes > 8 * 1024 * 1024) {
    throw new HttpsError('invalid-argument', '封面圖片過大（請降低解析度後再試）');
  }

  // 進階欄位安全限制（防超長攻擊）
  const safeLyrics = typeof lyrics === 'string' ? lyrics.slice(0, 500) : '';
  const safeCharacter = typeof characterDescription === 'string' ? characterDescription.slice(0, 300) : '';

  const selectedStyles = validIds.map(id => ({ id, ...STYLES[id] }));
  const systemPrompt = buildSystemPrompt(selectedStyles, {
    lyrics: safeLyrics,
    characterDescription: safeCharacter,
  });
  const responseSchema = buildResponseSchema();

  const ai = buildGenAI();

  const stream = await ai.models.generateContentStream({
    model: MODEL_ID,
    contents: [
      {
        role: 'user',
        parts: [
          { text: systemPrompt },
          { inlineData: { mimeType: mimeType || 'image/png', data: coverImageBase64 } },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0.85,
      topP: 0.95,
      maxOutputTokens: 32768,
      thinkingConfig: { thinkingBudget: 0 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    },
  });

  let fullText = '';
  for await (const chunk of stream) {
    const t = (chunk && chunk.text) || '';
    if (!t) continue;
    fullText += t;
    if (typeof onChunk === 'function') {
      try { onChunk(t, fullText.length); } catch (_) { /* don't break stream on UI error */ }
    }
  }

  if (!fullText) {
    console.error('[Gemini] empty response from stream');
    throw new HttpsError('internal', 'AI 回傳空白，請重試');
  }

  let parsed;
  try {
    parsed = JSON.parse(fullText);
  } catch (err) {
    console.error('[Gemini] JSON parse failed', fullText.slice(0, 800));
    throw new HttpsError('internal', 'AI 回傳格式錯誤，請重試');
  }

  // 補風格中文標籤（如果模型沒填好）
  if (Array.isArray(parsed.styles)) {
    parsed.styles = parsed.styles.map(s => ({
      ...s,
      style_name: s.style_name || (STYLES[s.style_id] && STYLES[s.style_id].label) || s.style_id,
    }));
  }
  return parsed;
}

// =====================================================================
// 對外：callable HTTPS endpoint（前端用 fetch JSON POST 呼叫）
// =====================================================================
exports.mcs_generateStoryboard = onRequest(
  {
    region: 'asia-east1',
    secrets: [GEMINI_API_KEY, TURNSTILE_SECRET],
    timeoutSeconds: 120, // 32K token 輸出 + 8 風格可能需要 30-90 秒
    memory: '512MiB',
    cors: true,
    maxInstances: 5,
  },
  async (req, res) => {
    // CORS preflight 由 cors:true 處理；method 限制
    if (req.method !== 'POST') {
      res.status(405).json({ error: { status: 'METHOD_NOT_ALLOWED', message: 'Use POST' } });
      return;
    }

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    const data = (body && body.data) || body || {};

    const { coverImageBase64, mimeType, selectedStyleIds, turnstileToken, lyrics, characterDescription } = data;

    // ---- 1. Turnstile 驗證 ----
    const remoteIp = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim();
    const turnstileResult = await verifyTurnstile(turnstileToken, TURNSTILE_SECRET.value(), remoteIp);
    if (!turnstileResult.success) {
      console.warn('[Turnstile] failed', turnstileResult.errorCodes);
      res.status(403).json({
        error: {
          status: 'PERMISSION_DENIED',
          message: '人機驗證失敗，請重新驗證',
          codes: turnstileResult.errorCodes,
        },
      });
      return;
    }

    // ---- 2. 基本參數檢查 ----
    if (!coverImageBase64 || typeof coverImageBase64 !== 'string') {
      res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: '缺少封面圖片' } });
      return;
    }
    if (!Array.isArray(selectedStyleIds) || selectedStyleIds.length === 0) {
      res.status(400).json({ error: { status: 'INVALID_ARGUMENT', message: '請至少選一種風格' } });
      return;
    }

    // ---- 3. 切到 SSE streaming 模式 ----
    // 從這裡開始，所有訊息（chunk / done / error）都用 SSE event 送
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 防 reverse proxy buffering
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const sendEvent = (type, payload) => {
      try {
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
      } catch (e) {
        // client disconnected — 忽略 write error，下個 chunk 會丟異常終止
      }
    };

    // ---- 4. 檢查快取（E2）----
    const validIdsForCache = (selectedStyleIds || []).filter(id => Object.prototype.hasOwnProperty.call(STYLES, id));
    const safeLyricsForCache = typeof lyrics === 'string' ? lyrics.slice(0, 500) : '';
    const safeCharForCache = typeof characterDescription === 'string' ? characterDescription.slice(0, 300) : '';
    const cacheKey = makeCacheKey(coverImageBase64 || '', validIdsForCache, safeLyricsForCache, safeCharForCache);
    const cached = getCachedResult(cacheKey);

    if (cached) {
      console.log('[cache] HIT', cacheKey.slice(0, 8), 'styles:', validIdsForCache.length);
      // 開頭 + 直接 done，標記 cached:true 給前端顯示
      sendEvent('start', { ts: Date.now(), cached: true });
      // 模擬一次 chunk（讓前端 progress bar 跑一下，不然瞬間結束沒手感）
      const fakeText = JSON.stringify(cached);
      sendEvent('chunk', { text: fakeText.slice(0, 1), total: fakeText.length, cached: true });
      sendEvent('done', { result: cached, cached: true });
      res.end();
      return;
    }
    console.log('[cache] MISS', cacheKey.slice(0, 8), 'styles:', validIdsForCache.length);

    // 開頭事件，讓前端立刻知道 stream 開始
    sendEvent('start', { ts: Date.now(), cached: false });

    try {
      const result = await runGenerationStream(
        { coverImageBase64, mimeType, selectedStyleIds, lyrics, characterDescription },
        (chunkText, totalLen) => {
          sendEvent('chunk', { text: chunkText, total: totalLen });
        }
      );
      // 寫進快取
      setCachedResult(cacheKey, result);
      sendEvent('done', { result, cached: false });
      res.end();
    } catch (err) {
      let status = 'INTERNAL';
      let message = (err && err.message) || 'AI 生成失敗';
      if (err instanceof HttpsError) {
        const code = err.code || 'internal';
        status = code.toUpperCase().replace(/-/g, '_');
      } else if (/quota|rate|exceeded|429/i.test(message)) {
        status = 'RESOURCE_EXHAUSTED';
        message = '今天 AI 太忙了，過幾分鐘再試';
      }
      console.error('[generateStoryboard] stream failed', err);
      sendEvent('error', { status, message });
      res.end();
    }
  }
);

// =====================================================================
// 健康檢查（給部署後驗證用）
// =====================================================================
exports.mcs_health = onRequest(
  { region: 'asia-east1', cors: true, maxInstances: 1 },
  (req, res) => {
    res.json({ ok: true, service: 'music-cover-storyboard', model: MODEL_ID, time: new Date().toISOString() });
  }
);
