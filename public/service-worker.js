/* 封面接故事 — Service Worker
 *
 * 三策略快取：
 *   1. HTML / version.json   → network-first（永遠拿最新，離線時 fallback 快取）
 *   2. 靜態資源（JS/CSS/icons/og）→ cache-first（含 ?v= 自然 cache-bust）
 *   3. Cloud Functions API   → 不快取（直接 fetch）
 *
 * 部署新版時：
 *   tools/bump-version.py 會把 CACHE_VERSION 升版，
 *   activate 時把舊版 cache 全部刪掉，立刻接管所有頁面。
 */

const CACHE_VERSION = '1.9.0';
const STATIC_CACHE = `mcs-static-v${CACHE_VERSION}`;
const HTML_CACHE   = `mcs-html-v${CACHE_VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './teach.html',
  './privacy.html',
  './app.js?v=' + CACHE_VERSION,
  './styles.css?v=' + CACHE_VERSION,
  './config.js?v=' + CACHE_VERSION,
  './favicon.svg?v=' + CACHE_VERSION,
  './favicon.ico?v=' + CACHE_VERSION,
  './apple-touch-icon.png?v=' + CACHE_VERSION,
  './icon-192.png?v=' + CACHE_VERSION,
  './icon-512.png?v=' + CACHE_VERSION,
];

// =====================================================================
// install：預先放靜態資源
// =====================================================================
self.addEventListener('install', (event) => {
  self.skipWaiting(); // 不等舊 SW 退場
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      )
    )
  );
});

// =====================================================================
// activate：刪除舊版本所有 cache
// =====================================================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('mcs-') && !k.endsWith(`-v${CACHE_VERSION}`))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// =====================================================================
// fetch：依路徑套不同策略
// =====================================================================
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只攔截 GET
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }

  // 跳過非 http(s)（如 chrome-extension:）
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 跳過 Cloud Functions / Cloud Run / 各種第三方 CDN（API 永遠走網路；大檔不該佔 SW cache 額度）
  if (
    url.hostname.endsWith('.cloudfunctions.net') ||
    url.hostname.endsWith('.run.app') ||
    url.hostname.includes('challenges.cloudflare.com') ||
    url.hostname.includes('cdn.tailwindcss.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('unpkg.com') ||             // ffmpeg.wasm 30MB+，瀏覽器自己快取就好
    url.hostname.includes('googletagmanager.com') ||  // GA4 gtag.js
    url.hostname.includes('google-analytics.com')
  ) {
    return; // 預設 fetch，不走 SW
  }

  // version.json 必須永遠拿最新（不然版本檢查 banner 沒用）
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(networkOnly(req));
    return;
  }

  // HTML / navigation：network-first
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/music-cover-storyboard/')) {
    event.respondWith(networkFirst(req, HTML_CACHE));
    return;
  }

  // 靜態資源：cache-first
  if (/\.(js|css|svg|ico|png|jpg|jpeg|webp|woff2?)(\?|$)/.test(url.pathname + url.search)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // 其他：預設 fetch
});

// ---------------------------------------------------------------------
// 策略實作
// ---------------------------------------------------------------------

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type !== 'opaque') {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    return new Response('Offline', { status: 503, statusText: 'offline' });
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type !== 'opaque') {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>離線</title><h1>目前離線中</h1>',
      { status: 503, headers: { 'Content-Type': 'text/html;charset=utf-8' } }
    );
  }
}

async function networkOnly(req) {
  return fetch(req, { cache: 'no-store' });
}

// =====================================================================
// 訊息：頁面要求 SW 立刻 activate（給 update banner 用）
// =====================================================================
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
