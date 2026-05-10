/* 封面接故事 — 主邏輯 */
(() => {
  'use strict';

  // ---- 風格清單（前端只負責 id + emoji + label，提示詞在後端）----
  const STYLES = [
    { id: 'cinematic',     emoji: '🎬', label: '寫實電影級', sub: 'Sora / Veo' },
    { id: 'suno_mv',       emoji: '🎵', label: '抒情 MV',     sub: 'Suno 風' },
    { id: 'storyboard_kid',emoji: '🎨', label: '童趣動畫板', sub: '給小朋友' },
    { id: 'anime_jp',      emoji: '🇯🇵', label: '日系動漫',   sub: '二次元' },
    { id: 'cyberpunk',     emoji: '🌃', label: '賽博龐克',   sub: '霓虹未來' },
    { id: 'ghibli',        emoji: '🌸', label: 'Ghibli 溫馨',  sub: '手繪療癒' },
    { id: 'documentary',   emoji: '📽️', label: '紀錄片寫實', sub: '手持自然光' },
    { id: 'kpop_mv',       emoji: '⚡', label: 'K-pop 高能',  sub: '快剪舞蹈' },
  ];

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const fileInput      = $('file-input');
  const dropZone       = $('drop-zone');
  const dropZoneInner  = $('drop-zone-inner');
  const fileError      = $('file-error');
  const frameSection   = $('frame-section');
  const generateSection = $('generate-section');
  const resultsSection = $('results-section');
  const resultsGrid    = $('results-grid');
  const video          = $('video');
  const canvas         = $('canvas');
  const coverPreview   = $('cover-preview');
  const timeSlider     = $('time-slider');
  const timeCurrent    = $('time-current');
  const timeTotal      = $('time-total');
  const btnDownload    = $('btn-download');
  const btnGenerate    = $('btn-generate');
  const generateHint   = $('generate-hint');
  const styleGrid      = $('style-grid');
  const btnStyleAll    = $('btn-style-all');
  const btnStyleNone   = $('btn-style-none');
  const turnstileEl    = $('turnstile-widget');
  const loading        = $('loading');
  const toast          = $('toast');
  const btnHelp        = $('btn-help');
  const btnHelpClose   = $('btn-help-close');
  const btnHelpOk      = $('btn-help-ok');
  const helpModal      = $('help-modal');
  const videoWrap      = $('video-preview-wrap');
  const btnPlayPause   = $('btn-play-pause');

  // ---- 狀態 ----
  let currentVideoUrl = null;
  let currentCoverDataUrl = null;
  let selectedStyleIds = new Set(STYLES.map(s => s.id));
  let turnstileWidgetId = null;
  let turnstileToken = null;
  let isScrubbing = false;     // 使用者正在拖時間軸（避免 timeupdate 衝突）

  const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200MB

  // ---- 初始化 ----
  initStyleChips();
  initFileUpload();
  initVideoControls();
  initGenerateButton();
  initHelpModal();
  initFooterYear();
  initTurnstile();
  initVersionCheck();

  // ====================================================================
  // 風格 chip
  // ====================================================================
  function initStyleChips() {
    styleGrid.innerHTML = STYLES.map(s => `
      <div class="style-chip selected" data-style-id="${s.id}" role="checkbox" aria-checked="true" tabindex="0">
        <span class="style-chip-emoji">${s.emoji}</span>
        <span class="style-chip-label">${s.label}</span>
        <span class="text-[10px] text-slate-400">${s.sub}</span>
      </div>
    `).join('');

    styleGrid.addEventListener('click', (e) => {
      const chip = e.target.closest('.style-chip');
      if (!chip) return;
      toggleChip(chip);
    });
    styleGrid.addEventListener('keydown', (e) => {
      const chip = e.target.closest('.style-chip');
      if (chip && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        toggleChip(chip);
      }
    });

    btnStyleAll.addEventListener('click', () => {
      selectedStyleIds = new Set(STYLES.map(s => s.id));
      syncChipUI();
      updateGenerateButton();
    });
    btnStyleNone.addEventListener('click', () => {
      selectedStyleIds = new Set();
      syncChipUI();
      updateGenerateButton();
    });
  }

  function toggleChip(chip) {
    const id = chip.dataset.styleId;
    if (selectedStyleIds.has(id)) selectedStyleIds.delete(id);
    else selectedStyleIds.add(id);
    syncChipUI();
    updateGenerateButton();
  }

  function syncChipUI() {
    [...styleGrid.children].forEach(chip => {
      const sel = selectedStyleIds.has(chip.dataset.styleId);
      chip.classList.toggle('selected', sel);
      chip.setAttribute('aria-checked', sel ? 'true' : 'false');
    });
  }

  // ====================================================================
  // 檔案上傳（拖拉 + 點選）
  // ====================================================================
  function initFileUpload() {
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleFile(file);
    });

    ['dragenter', 'dragover'].forEach(ev => {
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZoneInner.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(ev => {
      dropZone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZoneInner.classList.remove('dragover');
      });
    });
    dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  }

  function handleFile(file) {
    hideError();
    if (!file.type.startsWith('video/')) {
      showError('請選擇影片檔案（mp4 / webm / mov）');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showError(`影片太大（${(file.size / 1024 / 1024).toFixed(0)} MB），請小於 200 MB`);
      return;
    }
    if (currentVideoUrl) URL.revokeObjectURL(currentVideoUrl);
    currentVideoUrl = URL.createObjectURL(file);
    video.src = currentVideoUrl;
    video.load();
  }

  function showError(msg) {
    fileError.textContent = msg;
    fileError.classList.remove('hidden');
  }
  function hideError() { fileError.classList.add('hidden'); }

  // ====================================================================
  // 影片載入 / 抓幀 / 下載封面
  // ====================================================================
  function initVideoControls() {
    video.addEventListener('loadedmetadata', () => {
      const dur = video.duration || 0;
      timeSlider.min = 0;
      timeSlider.max = Math.max(dur, 0.1);
      timeSlider.step = Math.max(0.05, dur / 1000);
      timeSlider.value = 0;
      timeTotal.textContent = formatTime(dur);
      timeCurrent.textContent = '0.0s';

      frameSection.classList.remove('hidden');
      generateSection.classList.remove('hidden');
      if (videoWrap) videoWrap.classList.add('has-video');  // 啟用播放按鈕顯示
      // 第一幀立刻抓
      extractFrameAt(0).catch(() => {});
      // 滾動讓使用者看到下個 step
      setTimeout(() => frameSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    });

    video.addEventListener('error', () => {
      showError('這個影片解碼失敗了，可能是格式問題（試試 mp4 / webm）');
    });

    // ---- 播放 / 暫停 ----
    function togglePlay() {
      if (!video.src) return;
      if (video.paused || video.ended) {
        video.play().catch((err) => {
          console.warn('[video] play() rejected', err);
        });
      } else {
        video.pause();
      }
    }
    if (btnPlayPause) {
      btnPlayPause.addEventListener('click', (e) => { e.stopPropagation(); togglePlay(); });
    }
    // 點影片本身也可以切換
    video.addEventListener('click', togglePlay);
    // 影片狀態變化 → 同步 wrapper class（用 CSS 切換圖示）
    video.addEventListener('play',  () => videoWrap && videoWrap.classList.add('playing'));
    video.addEventListener('pause', () => videoWrap && videoWrap.classList.remove('playing'));
    video.addEventListener('ended', () => videoWrap && videoWrap.classList.remove('playing'));

    // ---- 播放時時間軸跟著動（除非使用者正在拖）----
    video.addEventListener('timeupdate', () => {
      if (isScrubbing) return;
      if (!isFinite(video.duration)) return;
      timeSlider.value = String(video.currentTime);
      timeCurrent.textContent = formatTime(video.currentTime);
    });

    // ---- 時間軸：拖動 = 選封面（拖的時候自動暫停避免衝突）----
    timeSlider.addEventListener('input', () => {
      isScrubbing = true;
      if (!video.paused) video.pause();
      timeCurrent.textContent = formatTime(parseFloat(timeSlider.value));
    });
    let extractTimer = null;
    timeSlider.addEventListener('change', () => {
      if (extractTimer) clearTimeout(extractTimer);
      extractTimer = setTimeout(() => {
        extractFrameAt(parseFloat(timeSlider.value)).finally(() => {
          isScrubbing = false;
        });
      }, 50);
    });
    // 鍵盤拖也算 scrub 結束
    timeSlider.addEventListener('blur',     () => { isScrubbing = false; });

    // ---- 空白鍵快捷：播放/暫停（焦點在 body 時才生效，避免干擾輸入）----
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!video.src) return;
      e.preventDefault();
      togglePlay();
    });

    btnDownload.addEventListener('click', () => {
      if (!currentCoverDataUrl) return;
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      a.href = currentCoverDataUrl;
      a.download = `cover-${ts}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('✅ 封面下載完成');
    });
  }

  function formatTime(sec) {
    if (!isFinite(sec)) return '0.0s';
    if (sec < 60) return sec.toFixed(1) + 's';
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1);
    return `${m}:${s.padStart(4, '0')}`;
  }

  function extractFrameAt(timeSec) {
    return new Promise((resolve, reject) => {
      if (!video.duration || isNaN(video.duration)) return reject(new Error('no video'));
      const target = Math.min(Math.max(timeSec, 0), Math.max(video.duration - 0.05, 0));

      const onSeeked = () => {
        try {
          video.removeEventListener('seeked', onSeeked);
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0);
          const dataUrl = canvas.toDataURL('image/png');
          currentCoverDataUrl = dataUrl;
          coverPreview.src = dataUrl;
          btnDownload.disabled = false;
          updateGenerateButton();
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };

      video.addEventListener('seeked', onSeeked, { once: true });
      try {
        video.currentTime = target;
      } catch (err) {
        video.removeEventListener('seeked', onSeeked);
        reject(err);
      }
    });
  }

  // ====================================================================
  // Turnstile（無感人機驗證）
  // ====================================================================
  function initTurnstile() {
    // Turnstile script 是 async，等它把 window.turnstile 注入後再 render
    const tryRender = () => {
      const cfg = window.MCS_CONFIG || {};
      if (!cfg.turnstileSiteKey) {
        turnstileEl.innerHTML = '<p class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">⚠️ 尚未設定 Turnstile sitekey（管理員請編輯 config.js）</p>';
        return;
      }
      if (!window.turnstile) {
        setTimeout(tryRender, 200);
        return;
      }
      try {
        turnstileWidgetId = window.turnstile.render(turnstileEl, {
          sitekey: cfg.turnstileSiteKey,
          theme: 'light',
          appearance: 'always',
          callback: (token) => { turnstileToken = token; updateGenerateButton(); },
          'error-callback': () => { turnstileToken = null; updateGenerateButton(); },
          'expired-callback': () => { turnstileToken = null; updateGenerateButton(); },
        });
      } catch (err) {
        console.error('Turnstile render failed', err);
      }
    };
    tryRender();
  }

  function resetTurnstile() {
    turnstileToken = null;
    if (turnstileWidgetId !== null && window.turnstile) {
      try { window.turnstile.reset(turnstileWidgetId); } catch (_) {}
    }
    updateGenerateButton();
  }

  // ====================================================================
  // 生成按鈕 / 後端呼叫
  // ====================================================================
  function initGenerateButton() {
    btnGenerate.addEventListener('click', () => generate().catch(err => {
      hideLoading();
      console.error(err);
      showToast('❌ ' + (err.message || '生成失敗'), 4000);
    }));
    updateGenerateButton();
  }

  function updateGenerateButton() {
    const ok = currentCoverDataUrl && selectedStyleIds.size > 0 && !!turnstileToken;
    btnGenerate.disabled = !ok;
    if (!currentCoverDataUrl) generateHint.textContent = '先上傳影片並選擇封面那一幀';
    else if (selectedStyleIds.size === 0) generateHint.textContent = '至少勾選一種分鏡風格';
    else if (!turnstileToken) generateHint.textContent = '請完成上方人機驗證';
    else generateHint.textContent = `準備就緒 · 已選 ${selectedStyleIds.size} 種風格`;
  }

  async function generate() {
    if (btnGenerate.disabled) return;

    showLoading();
    resultsSection.classList.add('hidden');
    resultsGrid.innerHTML = '';

    const cfg = window.MCS_CONFIG || {};
    if (!cfg.functionsUrl) {
      hideLoading();
      throw new Error('尚未設定後端 Functions URL（管理員請編輯 config.js）');
    }

    const base64 = currentCoverDataUrl.split(',')[1];
    const mimeType = 'image/png';
    const selectedIds = [...selectedStyleIds];

    let payload;
    try {
      const res = await fetch(cfg.functionsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            coverImageBase64: base64,
            mimeType,
            selectedStyleIds: selectedIds,
            turnstileToken,
          },
        }),
      });

      const json = await res.json();

      if (!res.ok || json.error) {
        const msg = (json.error && (json.error.message || json.error.status)) || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      payload = json.result;
    } catch (err) {
      hideLoading();
      resetTurnstile();
      throw err;
    }

    hideLoading();
    resetTurnstile();
    renderResults(payload);
  }

  function showLoading() { loading.classList.remove('hidden'); }
  function hideLoading() { loading.classList.add('hidden'); }

  // ====================================================================
  // 結果渲染
  // ====================================================================
  function renderResults(payload) {
    const list = (payload && payload.styles) || [];
    if (list.length === 0) {
      showToast('⚠️ 沒拿到結果，再試一次', 3500);
      return;
    }
    resultsGrid.innerHTML = list.map(item => renderCard(item)).join('');
    resultsSection.classList.remove('hidden');
    setTimeout(() => resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);

    // bind 所有複製按鈕（segment + 整體）
    resultsGrid.querySelectorAll('[data-copy-target]').forEach(btn => {
      btn.addEventListener('click', () => copyByTarget(btn));
    });
    // bind 段落展開/收合
    resultsGrid.querySelectorAll('.segment-row').forEach(row => {
      row.querySelector('.segment-header').addEventListener('click', () => {
        row.classList.toggle('expanded');
      });
    });
    // bind「全部段一鍵下載 .txt」
    resultsGrid.querySelectorAll('.btn-download-txt').forEach(btn => {
      btn.addEventListener('click', () => downloadStyleTxt(btn));
    });
  }

  function renderCard(item) {
    const meta = STYLES.find(s => s.id === item.style_id) || { emoji: '🎬', label: item.style_name || '分鏡' };
    const segments = Array.isArray(item.segments) ? item.segments : [];
    const total = item.total_duration_seconds || item.duration_seconds || 25;

    const segmentRows = segments.map((seg) => `
      <div class="segment-row" data-seg-index="${seg.index}">
        <div class="segment-header">
          <span class="seg-badge">${escapeHtml(String(seg.index || ''))}</span>
          <div class="seg-meta">
            <div class="seg-line-1">
              <span class="seg-time">${escapeHtml(seg.time || '')}</span>
              <span class="seg-shot">${escapeHtml(seg.shot || '')}</span>
              <span class="seg-duration">${escapeHtml(String(seg.duration_seconds || ''))}s</span>
            </div>
            <div class="seg-line-2">${escapeHtml(seg.action || '')}</div>
            <div class="seg-line-3">氛圍：${escapeHtml(seg.mood || '')}</div>
          </div>
          <span class="seg-toggle" aria-hidden="true">▾</span>
        </div>
        <div class="segment-body">
          <div class="seg-prompt-group">
            <p class="seg-prompt-label">📝 中文 Prompt（這段獨立可貼）</p>
            <div class="prompt-block" data-seg-zh="${seg.index}">${escapeHtml(seg.prompt_zh || '')}</div>
          </div>
          <div class="seg-prompt-group">
            <p class="seg-prompt-label">📝 English Prompt</p>
            <div class="prompt-block" data-seg-en="${seg.index}">${escapeHtml(seg.prompt_en || '')}</div>
          </div>
          <div class="seg-buttons">
            <button type="button" class="copy-btn copy-btn-mini" data-copy-target="[data-seg-zh='${seg.index}']">📋 複製中文</button>
            <button type="button" class="copy-btn copy-btn-mini" data-copy-target="[data-seg-en='${seg.index}']">📋 Copy EN</button>
          </div>
        </div>
      </div>
    `).join('');

    return `
      <article class="result-card" data-style-id="${item.style_id}">
        <div class="result-card-header theme-${item.style_id}">
          <span class="text-xl">${meta.emoji}</span>
          <span class="flex-1">${escapeHtml(item.style_name || meta.label)}</span>
          <span class="text-xs font-medium opacity-80">${segments.length} 段 · ${escapeHtml(String(total))}s</span>
        </div>
        <div class="result-card-body">
          <div class="segments-intro">
            <p class="result-card-section-title">🎬 分段提示詞</p>
            <p class="segments-hint">每段獨立可貼到 Google Flow / Canva AI / Sora / Veo / Runway / 海螺，產出 3-6 秒短片，最後串接成完整影片</p>
          </div>
          <div class="segments-list">${segmentRows}</div>

          <details class="full-prompt-details">
            <summary>📦 整體版 prompt（給支援長 prompt 的平台一次產整部）</summary>
            <div class="full-prompt-content">
              <div class="seg-prompt-group">
                <p class="seg-prompt-label">中文整體 Prompt</p>
                <div class="prompt-block" data-full-zh>${escapeHtml(item.full_prompt_zh || item.prompt_zh || '')}</div>
              </div>
              <div class="seg-prompt-group">
                <p class="seg-prompt-label">English Full Prompt</p>
                <div class="prompt-block" data-full-en>${escapeHtml(item.full_prompt_en || item.prompt_en || '')}</div>
              </div>
              <div class="seg-buttons">
                <button type="button" class="copy-btn copy-btn-mini" data-copy-target="[data-full-zh]">📋 複製整體中文</button>
                <button type="button" class="copy-btn copy-btn-mini" data-copy-target="[data-full-en]">📋 Copy Full EN</button>
              </div>
            </div>
          </details>

          <div class="card-footer-actions">
            <button type="button" class="btn-download-txt">⬇️ 下載這個風格全部段（.txt）</button>
          </div>
        </div>
      </article>
    `;
  }

  async function copyByTarget(btn) {
    const card = btn.closest('.result-card');
    const target = btn.dataset.copyTarget;
    const el = card.querySelector(target);
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.textContent);
      const orig = btn.textContent;
      btn.textContent = '✅ 已複製';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
    } catch (err) {
      showToast('複製失敗，請長按選取文字', 3000);
    }
  }

  function downloadStyleTxt(btn) {
    const card = btn.closest('.result-card');
    const styleId = card.dataset.styleId;
    const styleName = card.querySelector('.result-card-header .flex-1').textContent.trim();
    const lines = [];
    lines.push(`# ${styleName} (${styleId})`);
    lines.push('');
    card.querySelectorAll('.segment-row').forEach((row) => {
      const idx = row.dataset.segIndex;
      const time = row.querySelector('.seg-time').textContent;
      const shot = row.querySelector('.seg-shot').textContent;
      const dur  = row.querySelector('.seg-duration').textContent;
      const zh   = row.querySelector(`[data-seg-zh="${idx}"]`).textContent;
      const en   = row.querySelector(`[data-seg-en="${idx}"]`).textContent;
      lines.push(`## 分段 ${idx} · ${time} · ${shot} · ${dur}`);
      lines.push('');
      lines.push('### 中文 Prompt');
      lines.push(zh);
      lines.push('');
      lines.push('### English Prompt');
      lines.push(en);
      lines.push('');
      lines.push('---');
      lines.push('');
    });
    // 整體版
    const fullZh = card.querySelector('[data-full-zh]');
    const fullEn = card.querySelector('[data-full-en]');
    if (fullZh && fullZh.textContent.trim()) {
      lines.push('## 整體版（一次產整部）');
      lines.push('');
      lines.push('### 中文整體 Prompt');
      lines.push(fullZh.textContent);
      lines.push('');
      lines.push('### English Full Prompt');
      lines.push(fullEn ? fullEn.textContent : '');
      lines.push('');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    a.href = URL.createObjectURL(blob);
    a.download = `storyboard-${styleId}-${ts}.txt`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    showToast('✅ 已下載 .txt（含全部分段 + 整體版）');
  }

  // ====================================================================
  // 使用說明 modal
  // ====================================================================
  function initHelpModal() {
    const SEEN_KEY = 'mcs_help_seen_v1';
    const open = () => helpModal.classList.remove('hidden');
    const close = () => {
      helpModal.classList.add('hidden');
      try { localStorage.setItem(SEEN_KEY, '1'); } catch (_) {}
    };
    btnHelp.addEventListener('click', open);
    btnHelpClose.addEventListener('click', close);
    btnHelpOk.addEventListener('click', close);
    helpModal.addEventListener('click', (e) => { if (e.target === helpModal) close(); });
    let seen = false;
    try { seen = !!localStorage.getItem(SEEN_KEY); } catch (_) {}
    if (!seen) setTimeout(open, 600);
  }

  // ====================================================================
  // 版本檢查 / 更新 banner
  // ====================================================================
  function initVersionCheck() {
    const banner   = document.getElementById('update-banner');
    const btnNow   = document.getElementById('btn-update-now');
    const btnLater = document.getElementById('btn-update-dismiss');
    if (!banner || !btnNow || !btnLater) return;

    const localVersion = (window.MCS_CONFIG && window.MCS_CONFIG.version) || '0.0.0';
    let dismissed = false;

    const showBanner = () => { if (!dismissed) banner.classList.remove('hidden'); };
    const hideBanner = () => banner.classList.add('hidden');

    // 點「立刻更新」→ 通知 SW skipWaiting + 清掉相關快取 + reload
    btnNow.addEventListener('click', async () => {
      btnNow.disabled = true;
      btnNow.textContent = '更新中…';
      try {
        // 通知 SW 立刻接管
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
        }
        // 清除所有 mcs-* cache（保險）
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.filter(k => k.startsWith('mcs-')).map(k => caches.delete(k)));
        }
      } catch (_) {}
      location.reload();
    });

    // 點「稍後」→ 隱藏，本次造訪不再彈
    btnLater.addEventListener('click', () => { dismissed = true; hideBanner(); });

    // 比較線上 version.json
    const checkVersion = async () => {
      try {
        const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.version && data.version !== localVersion) {
          console.log('[version] new version available:', data.version, '(local:', localVersion, ')');
          showBanner();
        }
      } catch (_) { /* offline 或 404 都吞掉 */ }
    };

    // 開站後 30 秒檢查一次，之後每 5 分鐘檢查；切回頁面立刻檢查
    setTimeout(checkVersion, 30000);
    setInterval(checkVersion, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkVersion();
    });

    // SW 觸發 controllerchange（新 SW 接管）→ 自動 reload 一次
    if ('serviceWorker' in navigator) {
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        // 不主動 reload，讓使用者按 banner 控制；但若 banner 還沒出來就 reload 是 OK 的
        // 留空：使用者會在下次重新整理時拿到新版
      });
    }
  }

  // ====================================================================
  // 工具 / Footer
  // ====================================================================
  function initFooterYear() {
    const el = document.getElementById('footer-year');
    if (el) el.textContent = String(new Date().getFullYear());
  }

  function showToast(msg, duration = 1800) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.classList.add('hidden');
      toast.classList.remove('show');
    }, duration);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
})();
