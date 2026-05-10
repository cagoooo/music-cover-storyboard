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
const { verifyTurnstile } = require('./verify-turnstile');
const { STYLES } = require('./styles');

setGlobalOptions({
  region: 'asia-east1',
  maxInstances: 5,
});

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
function buildSystemPrompt(selectedStyles) {
  const lines = selectedStyles.map((s, i) =>
    `${i + 1}. style_id="${s.id}" → ${s.label}\n   風格指引：${s.guideline}`
  );

  return `你是一位專業的 AI 短影片導演與分鏡師。使用者剛用 AI 工具（Suno / Gemini Veo / Runway 等）做出一段音樂影片，並從中擷取了一張代表性的「封面那一幀」。

你的任務：把這張封面當作**下一段 20-30 秒短影片的第 0 秒**，幫使用者編寫**接續這個畫面**的後續分鏡腳本。

**這次的產出將餵給 Google Flow、Canva AI、Sora、Veo、Runway、Kling、海螺 等 AI 影片平台。**
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

// ---- 共用：核心生成邏輯 ----
async function runGeneration({ coverImageBase64, mimeType, selectedStyleIds }) {
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

  const selectedStyles = validIds.map(id => ({ id, ...STYLES[id] }));
  const systemPrompt = buildSystemPrompt(selectedStyles);
  const responseSchema = buildResponseSchema();

  const ai = buildGenAI();

  const response = await ai.models.generateContent({
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
      maxOutputTokens: 32768, // 8 風格 × 4-6 段 × 中英文 prompt + 整體版，需要足夠 token
      thinkingConfig: { thinkingBudget: 0 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_LOW_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    },
  });

  const text = response.text || (response.response && response.response.text);
  if (!text) {
    console.error('[Gemini] empty response', JSON.stringify(response).slice(0, 500));
    throw new HttpsError('internal', 'AI 回傳空白，請重試');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error('[Gemini] JSON parse failed', text.slice(0, 800));
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

    const { coverImageBase64, mimeType, selectedStyleIds, turnstileToken } = data;

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

    // ---- 3. 呼叫 Gemini ----
    try {
      const result = await runGeneration({ coverImageBase64, mimeType, selectedStyleIds });
      res.json({ result });
    } catch (err) {
      if (err instanceof HttpsError) {
        const code = err.code || 'internal';
        const status = code === 'invalid-argument' ? 400
          : code === 'permission-denied' ? 403
          : code === 'resource-exhausted' ? 429
          : 500;
        res.status(status).json({ error: { status: code.toUpperCase().replace(/-/g, '_'), message: err.message } });
        return;
      }
      const msg = (err && err.message) || 'AI 生成失敗';
      const isQuota = /quota|rate|exceeded|429/i.test(msg);
      console.error('[generateStoryboard] failed', err);
      res.status(isQuota ? 429 : 500).json({
        error: {
          status: isQuota ? 'RESOURCE_EXHAUSTED' : 'INTERNAL',
          message: isQuota ? '今天 AI 太忙了，過幾分鐘再試' : msg,
        },
      });
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
