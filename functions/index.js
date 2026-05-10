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

你的任務：把這張封面當作**下一段 15-30 秒短影片的第 0 秒**，幫使用者編寫**接續這個畫面**的 15-30 秒分鏡腳本，讓他可以貼回 Sora / Veo / Runway / Kling / 海螺 等平台繼續產影片。

請仔細**看圖**，先理解：
- 主體是什麼（人物、角色、物件、場景）
- 環境氛圍（時段、天氣、地點、配色）
- 情緒線索（表情、動作暗示、構圖張力）

然後針對下列每一個「使用者選的風格」各產出一份完整分鏡：

${lines.join('\n\n')}

每份分鏡的要求：
- duration_seconds 介於 15 ~ 30 秒之間
- scene_breakdown 至少 3 段、最多 5 段，**從第 0 秒延續封面畫面**開始，逐步推進故事
- prompt_zh：完整繁體中文 prompt，可以直接貼到中文 AI 影片平台（海螺 / 可靈）。包含主體、動作、運鏡、氛圍、光線、色調、時長
- prompt_en：完整英文 prompt，可以直接貼到 Sora / Veo / Runway。包含 cinematography terms（dolly, tracking, close-up, shallow DoF…）
- 每段 scene_breakdown 的 shot 寫鏡頭語言（例如「中景跟拍」、「特寫慢動作」），action 寫角色動作或畫面變化，mood 寫氛圍

**重要**：
- 完全銜接封面畫面、不要重新換場
- 各風格之間要明顯不同
- 不要使用任何敏感、暴力、色情元素，這是給老師、家長、學生用的教學工具
- prompt_zh 與 prompt_en 必須是「完整可貼上去就能用」的長 prompt（150-400 字內），不是大綱

最後輸出**單一 JSON 物件**，欄位 styles 是陣列，每個元素照下方 schema。不要任何 markdown 包裹、不要 \`\`\`json，只回 JSON 本體。`;
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
            duration_seconds: { type: 'integer' },
            scene_breakdown: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  time: { type: 'string' },
                  shot: { type: 'string' },
                  action: { type: 'string' },
                  mood: { type: 'string' },
                },
                required: ['time', 'shot', 'action', 'mood'],
              },
            },
            prompt_zh: { type: 'string' },
            prompt_en: { type: 'string' },
          },
          required: ['style_id', 'style_name', 'duration_seconds', 'scene_breakdown', 'prompt_zh', 'prompt_en'],
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
      maxOutputTokens: 8192,
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
    timeoutSeconds: 60,
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
