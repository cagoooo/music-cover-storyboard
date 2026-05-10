/**
 * Cloudflare Turnstile token 後端驗證
 * 文件：https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * @param {string} token - 前端 turnstile.getResponse() 拿到的 token
 * @param {string} secret - Turnstile site 對應的 secret key
 * @param {string} [remoteIp] - 可選的 client IP
 * @returns {Promise<{ success: boolean, errorCodes?: string[] }>}
 */
async function verifyTurnstile(token, secret, remoteIp) {
  if (!token || typeof token !== 'string') {
    return { success: false, errorCodes: ['missing-input-response'] };
  }
  if (!secret || typeof secret !== 'string') {
    return { success: false, errorCodes: ['missing-input-secret'] };
  }

  const params = new URLSearchParams();
  params.append('secret', secret);
  params.append('response', token);
  if (remoteIp) params.append('remoteip', remoteIp);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: params,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const json = await res.json();
    if (json.success === true) return { success: true };
    return { success: false, errorCodes: json['error-codes'] || ['unknown'] };
  } catch (err) {
    console.error('[Turnstile] verify network error', err);
    return { success: false, errorCodes: ['network-error'] };
  }
}

module.exports = { verifyTurnstile };
