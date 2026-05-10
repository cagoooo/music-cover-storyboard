/* 客戶端設定（可進 git，全部都是公開值） */
/* 這個檔在部署 Cloud Functions + 建好 Turnstile site 後會被自動更新 */
window.MCS_CONFIG = {
  // Cloud Functions v2 callable URL（部署後填）
  // 範例：https://mcs-generatestoryboard-xxxxx-de.a.run.app
  functionsUrl: '',

  // Cloudflare Turnstile site key（公開值）
  turnstileSiteKey: '',

  // 版本號（用於 PWA cache-bust）
  version: '1.0.0',
};
