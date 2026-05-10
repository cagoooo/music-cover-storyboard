/* 客戶端設定（可進 git，全部都是公開值） */
/* 這個檔在部署 Cloud Functions + 建好 Turnstile site 後會被自動更新 */
window.MCS_CONFIG = {
  // Cloud Functions v2 URL（asia-east1）
  functionsUrl: 'https://mcs-generatestoryboard-jagukesuwq-de.a.run.app',

  // Cloudflare Turnstile site key（公開值）
  turnstileSiteKey: '0x4AAAAAADMPpnhO_uRA0xGi',

  // 版本號（用於 PWA cache-bust）
  version: '1.5.0',
};
