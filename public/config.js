/* 客戶端設定（可進 git，全部都是公開值） */
/* 這個檔在部署 Cloud Functions + 建好 Turnstile site 後會被自動更新 */
window.MCS_CONFIG = {
  // Cloud Functions v2 URL（asia-east1）
  functionsUrl: 'https://mcs-generatestoryboard-jagukesuwq-de.a.run.app',

  // Cloudflare Turnstile site key（公開值）
  turnstileSiteKey: '0x4AAAAAADMPpnhO_uRA0xGi',

  // Firebase Analytics / Google Analytics 4 measurementId（公開值，G-XXXXXXX）
  // 啟用方式：Firebase Console → Project settings → Integrations → Google Analytics → 啟用
  // 啟用後 Project settings → General → 你的 Web app → SDK setup → 找到 measurementId
  // 留空時不會載入 gtag.js（不會有任何追蹤）
  gaMeasurementId: 'G-CN9J9NRPCR',

  // 版本號（用於 PWA cache-bust）
  version: '1.9.2',
};
