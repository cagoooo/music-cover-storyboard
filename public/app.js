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

  // ---- 工具：trackEvent（GA4 埋點） ----
  function trackEvent(name, params) {
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', name, params || {});
      }
    } catch (_) { /* 永不阻塞 UX */ }
  }
  window.__mcs_trackEvent = trackEvent;

  // ---- 初始化 ----
  initStyleChips();
  initFileUpload();
  initVideoControls();
  initGenerateButton();
  initHelpModal();
  initFooterYear();
  initTurnstile();
  initVersionCheck();
  initAdvancedPrompt();
  initShareSheet();
  initPlatformLauncher();

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
    trackEvent('upload_video', {
      file_size_mb: Math.round(file.size / 1024 / 1024),
      file_type: file.type,
    });
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
      trackEvent('download_cover');
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
    const { lyrics, character } = getAdvancedFields();

    const _genStart = performance.now();
    trackEvent('generate_start', {
      styles_count: selectedIds.length,
      styles: selectedIds.join(','),
      has_lyrics: !!lyrics,
      has_character: !!character,
    });

    let payload;
    try {
      const res = await fetch(cfg.functionsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify({
          data: {
            coverImageBase64: base64,
            mimeType,
            selectedStyleIds: selectedIds,
            turnstileToken,
            lyrics: lyrics || undefined,
            characterDescription: character || undefined,
          },
        }),
      });

      const ct = (res.headers.get('Content-Type') || '').toLowerCase();

      // 先處理「請求驗證階段」就被拒（4xx + JSON），不是 SSE
      if (!res.ok && !ct.includes('text/event-stream')) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          errMsg = (j.error && (j.error.message || j.error.status)) || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }

      // SSE streaming 路徑
      if (ct.includes('text/event-stream') && res.body) {
        payload = await consumeSSE(res);
      } else {
        // 萬一後端 fallback 回普通 JSON（向下相容）
        const j = await res.json();
        if (j.error) throw new Error((j.error.message || j.error.status));
        payload = j.result;
      }
    } catch (err) {
      hideLoading();
      resetTurnstile();
      trackEvent('generate_error', {
        elapsed_sec: Math.round((performance.now() - _genStart) / 1000),
        message: (err && err.message || '').slice(0, 100),
      });
      throw err;
    }

    hideLoading();
    resetTurnstile();
    const elapsedSec = Math.round((performance.now() - _genStart) / 1000);
    const wasCached = payload && payload.__cached === true;
    trackEvent('generate_completed', {
      elapsed_sec: elapsedSec,
      cached: wasCached,
      styles_count: selectedIds.length,
    });
    if (wasCached) {
      showToast('⚡ 快取命中（24 小時內同樣輸入）— 省了一次 API 呼叫', 3500);
    }
    renderResults(payload);
  }

  // ====================================================================
  // SSE 解析：拿後端 streaming chunks 即時更新 loading UI
  // ====================================================================
  async function consumeSSE(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let receivedText = '';
    let result = null;
    let errorMsg = null;
    const startTime = performance.now();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE event 用 \n\n 分隔
        let sepIdx;
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);
          const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          let payload;
          try {
            payload = JSON.parse(dataLine.slice(6));
          } catch (_) {
            continue;
          }

          if (payload.type === 'start') {
            updateStreamingProgress({ phase: 'start', received: 0, elapsedMs: 0 });
          } else if (payload.type === 'chunk') {
            receivedText += payload.text || '';
            updateStreamingProgress({
              phase: 'streaming',
              received: receivedText.length,
              elapsedMs: performance.now() - startTime,
              tail: receivedText.slice(-80),  // 最後 80 字給打字機 echo
            });
          } else if (payload.type === 'done') {
            result = payload.result;
            if (result && payload.cached === true) {
              try { result.__cached = true; } catch (_) {}
            }
            updateStreamingProgress({
              phase: 'done',
              received: receivedText.length,
              elapsedMs: performance.now() - startTime,
              cached: payload.cached === true,
            });
          } else if (payload.type === 'error') {
            errorMsg = payload.message || 'AI 生成失敗';
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }

    if (errorMsg) throw new Error(errorMsg);
    if (!result) throw new Error('AI 串流未完成（連線中斷）');
    return result;
  }

  // 更新 loading overlay 的進度視覺
  function updateStreamingProgress({ phase, received, elapsedMs, tail, cached }) {
    const elCount = document.getElementById('streaming-count');
    const elPhase = document.getElementById('streaming-phase');
    const elTail  = document.getElementById('streaming-tail');
    const elBar   = document.getElementById('streaming-bar');
    if (!elCount || !elPhase || !elTail || !elBar) return;

    if (phase === 'start') {
      elPhase.textContent = '🤖 已連上 Gemini，正在閱讀封面…';
      elCount.textContent = '0 字';
      elBar.style.width = '8%';
      elTail.textContent = '';
      return;
    }
    if (phase === 'streaming') {
      const sec = (elapsedMs / 1000).toFixed(1);
      elPhase.textContent = `✏️ AI 正在編寫分鏡（已耗 ${sec}s）`;
      elCount.textContent = `${received.toLocaleString()} 字`;
      // 假設 8 風格 × 4-6 段最終約 12000-18000 字，progress bar 動態估算
      const expected = 12000;
      const pct = Math.min(95, 8 + (received / expected) * 87);
      elBar.style.width = pct.toFixed(0) + '%';
      // 打字機 echo（tail 是最後幾十個字）
      if (tail) elTail.textContent = tail;
      return;
    }
    if (phase === 'done') {
      const sec = (elapsedMs / 1000).toFixed(1);
      if (cached) {
        elPhase.textContent = `⚡ 快取命中（${sec}s）— 省一次 API 呼叫`;
      } else {
        elPhase.textContent = `✅ 完成！共 ${received.toLocaleString()} 字（${sec}s）`;
      }
      elBar.style.width = '100%';
    }
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
    // bind「分享卡片圖」
    resultsGrid.querySelectorAll('.btn-share-card').forEach(btn => {
      btn.addEventListener('click', () => generateShareCard(btn));
    });
    // bind「分享」（連結 + 文字到社群）
    resultsGrid.querySelectorAll('.btn-share-link').forEach(btn => {
      btn.addEventListener('click', () => shareStoryboard(btn.closest('.result-card')));
    });
    // bind segment「跳到平台」
    resultsGrid.querySelectorAll('[data-launch-seg]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.result-card');
        const idx = btn.dataset.launchSeg;
        const styleName = card.querySelector('.result-card-header .flex-1')?.textContent.trim() || '';
        const zh = card.querySelector(`[data-seg-zh="${idx}"]`)?.textContent || '';
        const en = card.querySelector(`[data-seg-en="${idx}"]`)?.textContent || '';
        const timeLabel = card.querySelector(`.segment-row[data-seg-index="${idx}"] .seg-time`)?.textContent || '';
        openPlatformLauncher({
          promptZh: zh,
          promptEn: en,
          contextLabel: `${styleName} · 第 ${idx} 段（${timeLabel}）`,
        });
      });
    });
    // bind「整體跳到平台」
    resultsGrid.querySelectorAll('[data-launch-full]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.result-card');
        const styleName = card.querySelector('.result-card-header .flex-1')?.textContent.trim() || '';
        const zh = card.querySelector('[data-full-zh]')?.textContent || '';
        const en = card.querySelector('[data-full-en]')?.textContent || '';
        openPlatformLauncher({
          promptZh: zh,
          promptEn: en,
          contextLabel: `${styleName} · 整體版`,
        });
      });
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
          <button type="button" class="btn-launch-platform" data-launch-seg="${seg.index}">🚀 跳到 AI 平台產這段（${escapeHtml(seg.time || '')}）</button>
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
              <button type="button" class="btn-launch-platform" data-launch-full>🚀 整體跳到 AI 平台（一次產整部）</button>
            </div>
          </details>

          <div class="card-footer-actions">
            <button type="button" class="btn-download-txt">⬇️ .txt</button>
            <button type="button" class="btn-share-card">🖼️ 卡片圖</button>
            <button type="button" class="btn-share-link">📤 分享</button>
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

      // 埋點：哪段、哪個語言被複製
      const isFull = target.includes('full-');
      const isEn = target.includes('-en');
      trackEvent('copy_prompt', {
        scope: isFull ? 'full' : 'segment',
        language: isEn ? 'en' : 'zh',
        style_id: card.dataset.styleId || '',
      });
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
    trackEvent('download_txt', { style_id: styleId });
  }

  // ====================================================================
  // D1: 生成分鏡卡片圖（IG 限動 1080×1920，含封面 + 全部分段 + URL）
  // ====================================================================
  async function generateShareCard(btn) {
    const card = btn.closest('.result-card');
    const styleId = card.dataset.styleId;
    const styleName = card.querySelector('.result-card-header .flex-1').textContent.trim();
    const totalLabel = card.querySelector('.result-card-header span:last-child').textContent.trim();

    btn.disabled = true;
    const origText = btn.textContent;
    btn.textContent = '🎨 繪製中…';

    try {
      // 等中文字型載入完成（避免 Canvas 用 fallback 字型畫圖）
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }

      const segments = [];
      card.querySelectorAll('.segment-row').forEach((row) => {
        segments.push({
          index: row.dataset.segIndex,
          time: row.querySelector('.seg-time').textContent,
          shot: row.querySelector('.seg-shot').textContent,
          duration: row.querySelector('.seg-duration').textContent,
          action: row.querySelector('.seg-line-2').textContent,
          mood: row.querySelector('.seg-line-3').textContent.replace(/^氛圍：/, ''),
        });
      });

      const W = 1080;
      const H = 1920;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');

      // === 1. 紫粉漸層背景 ===
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0,   '#a855f7');
      bg.addColorStop(0.5, '#7c3aed');
      bg.addColorStop(1,   '#ec4899');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // 柔光圈裝飾
      const glow1 = ctx.createRadialGradient(W * 0.15, H * 0.1, 30, W * 0.15, H * 0.1, 600);
      glow1.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
      glow1.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glow1;
      ctx.fillRect(0, 0, W, H);

      // === 2. 頂部標題 ===
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      roundedRect(ctx, 60, 60, W - 120, 100, 30);
      ctx.fill();

      ctx.fillStyle = 'white';
      ctx.font = '900 52px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('封面接故事', W / 2, 95);
      ctx.font = '700 28px "Noto Sans TC", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillText('AI 音樂影片分鏡產生器', W / 2, 138);

      // === 3. 封面圖（如果有的話）===
      let topY = 200;
      if (currentCoverDataUrl) {
        const coverImg = await loadImage(currentCoverDataUrl);
        const coverW = W - 160;
        const coverH = (coverImg.height / coverImg.width) * coverW;
        const maxCoverH = 480;
        const finalH = Math.min(coverH, maxCoverH);
        const finalW = coverImg.width / coverImg.height * finalH;
        const cx = (W - finalW) / 2;

        // 白框
        ctx.fillStyle = 'white';
        roundedRect(ctx, cx - 8, topY - 8, finalW + 16, finalH + 16, 20);
        ctx.fill();

        ctx.save();
        roundedRect(ctx, cx, topY, finalW, finalH, 14);
        ctx.clip();
        ctx.drawImage(coverImg, cx, topY, finalW, finalH);
        ctx.restore();

        topY += finalH + 50;
      }

      // === 4. 風格標題卡 ===
      const themeColors = {
        cinematic:    ['#1e293b', '#475569'],
        suno_mv:      ['#be185d', '#f472b6'],
        storyboard_kid: ['#f59e0b', '#fbbf24'],
        anime_jp:     ['#db2777', '#f9a8d4'],
        cyberpunk:    ['#6d28d9', '#06b6d4'],
        ghibli:       ['#16a34a', '#fde68a'],
        documentary:  ['#57534e', '#a8a29e'],
        kpop_mv:      ['#ec4899', '#f97316'],
      };
      const [c1, c2] = themeColors[styleId] || ['#7c3aed', '#ec4899'];
      const themeGrad = ctx.createLinearGradient(60, topY, W - 60, topY + 90);
      themeGrad.addColorStop(0, c1);
      themeGrad.addColorStop(1, c2);
      ctx.fillStyle = themeGrad;
      roundedRect(ctx, 60, topY, W - 120, 90, 18);
      ctx.fill();

      ctx.fillStyle = 'white';
      ctx.font = '900 44px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(styleName, 90, topY + 45);
      ctx.font = '700 26px "Noto Sans TC", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.textAlign = 'right';
      ctx.fillText(totalLabel, W - 90, topY + 45);

      topY += 120;

      // === 5. 分段列表 ===
      const segCardW = W - 120;
      const segCardX = 60;
      const segMinH = 130;
      const remainingH = H - topY - 200;  // 預留底部 200 給 footer
      const idealSegH = Math.min(segMinH + 40, remainingH / Math.max(segments.length, 1));
      const segH = Math.max(segMinH, idealSegH);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      segments.slice(0, 7).forEach((seg, i) => {
        const y = topY + i * (segH + 12);

        // 段背景
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        roundedRect(ctx, segCardX, y, segCardW, segH, 16);
        ctx.fill();

        // 段編號圓圈
        const badgeX = segCardX + 60;
        const badgeY = y + segH / 2;
        const badgeGrad = ctx.createLinearGradient(badgeX - 30, badgeY - 30, badgeX + 30, badgeY + 30);
        badgeGrad.addColorStop(0, '#a855f7');
        badgeGrad.addColorStop(1, '#ec4899');
        ctx.fillStyle = badgeGrad;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, 32, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = '900 36px "Noto Sans TC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(seg.index, badgeX, badgeY + 2);

        // 段內容（時間 + shot）
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#7c3aed';
        ctx.font = '900 28px "Noto Sans TC", sans-serif';
        ctx.fillText(seg.time, badgeX + 60, y + 24);
        ctx.fillStyle = '#1e293b';
        ctx.font = '700 28px "Noto Sans TC", sans-serif';
        ctx.fillText('· ' + seg.shot, badgeX + 60 + ctx.measureText(seg.time).width + 12, y + 24);
        // 右上角 duration 膠囊
        ctx.fillStyle = '#94a3b8';
        roundedRect(ctx, segCardX + segCardW - 100, y + 22, 80, 32, 16);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = '700 20px "Noto Sans TC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(seg.duration, segCardX + segCardW - 60, y + 32);

        // 動作描述（換行）
        ctx.textAlign = 'left';
        ctx.fillStyle = '#475569';
        ctx.font = '500 22px "Noto Sans TC", sans-serif';
        wrapText(ctx, seg.action, badgeX + 60, y + 62, segCardW - 200, 30, 2);

        // 氛圍
        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 18px "Noto Sans TC", sans-serif';
        ctx.fillText('氛圍：' + seg.mood.slice(0, 20), badgeX + 60, y + segH - 32);
      });

      if (segments.length > 7) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.font = '700 24px "Noto Sans TC", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`還有 ${segments.length - 7} 段...完整版請看網站`, W / 2, topY + 7 * (segH + 12) + 10);
      }

      // === 6. 底部署名 + URL ===
      const footerY = H - 120;
      // 半透明黑底
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillRect(0, footerY, W, 120);

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'white';
      ctx.font = '700 28px "Noto Sans TC", sans-serif';
      ctx.fillText('🎬 cagoooo.github.io/music-cover-storyboard', 60, footerY + 50);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.font = '500 22px "Noto Sans TC", sans-serif';
      ctx.fillText('Made with ❤️ by 阿凱老師 · 桃園市石門國小', 60, footerY + 88);

      // === 7. 下載 ===
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `storyboard-${styleId}-${ts}.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);

      showToast('✅ 分鏡卡片圖已下載（IG 限動尺寸 1080×1920）');
      trackEvent('download_card', {
        style_id: styleId,
        segments_count: segments.length,
      });
    } catch (err) {
      console.error('[shareCard] failed', err);
      showToast('❌ 卡片圖生成失敗：' + (err.message || '未知錯誤'), 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 99) {
    if (!text) return;
    const chars = text.split('');
    let line = '';
    let lineCount = 0;
    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i];
      const w = ctx.measureText(testLine).width;
      if (w > maxWidth && line.length > 0) {
        ctx.fillText(line, x, y + lineCount * lineHeight);
        line = chars[i];
        lineCount++;
        if (lineCount >= maxLines - 1) {
          // 最後一行，加省略號
          let last = line;
          while (ctx.measureText(last + '…').width > maxWidth && last.length > 0) {
            last = last.slice(0, -1);
          }
          for (let j = i + 1; j < chars.length; j++) {
            const c = last + chars[j];
            if (ctx.measureText(c + '…').width > maxWidth) break;
            last = c;
          }
          if (i + 1 < chars.length) last += '…';
          ctx.fillText(last, x, y + lineCount * lineHeight);
          return;
        }
      } else {
        line = testLine;
      }
    }
    if (line) ctx.fillText(line, x, y + lineCount * lineHeight);
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
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
    btnHelp.addEventListener('click', () => { open(); trackEvent('view_help'); });
    btnHelpClose.addEventListener('click', close);
    btnHelpOk.addEventListener('click', close);
    helpModal.addEventListener('click', (e) => { if (e.target === helpModal) close(); });
    let seen = false;
    try { seen = !!localStorage.getItem(SEEN_KEY); } catch (_) {}
    if (!seen) setTimeout(open, 600);
  }

  // ====================================================================
  // PlatformLauncher — 一鍵跳到 AI 影片平台（自動複製 prompt）
  // ====================================================================
  let launchCurrent = null;  // { promptZh, promptEn, contextLabel }

  function initPlatformLauncher() {
    const sheet = document.getElementById('platform-launcher');
    if (!sheet) return;

    sheet.querySelectorAll('[data-platform-close]').forEach((el) => {
      el.addEventListener('click', closePlatformLauncher);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sheet.classList.contains('hidden')) closePlatformLauncher();
    });

    sheet.querySelectorAll('.platform-card').forEach((card) => {
      card.addEventListener('click', async (e) => {
        e.preventDefault();  // 阻止 a 標籤先跳
        const platformId = card.dataset.platformId;
        const platformName = card.dataset.platformName;
        const lang = card.dataset.lang || 'zh';
        const url = card.getAttribute('href');
        await launchToPlatform(platformId, platformName, lang, url);
      });
    });
  }

  function openPlatformLauncher({ promptZh, promptEn, contextLabel }) {
    const sheet = document.getElementById('platform-launcher');
    if (!sheet) return;
    launchCurrent = { promptZh: promptZh || '', promptEn: promptEn || '', contextLabel: contextLabel || '' };

    // 更新標題
    const title = document.getElementById('platform-launcher-title');
    if (title) {
      title.textContent = contextLabel
        ? `🚀 跳到 AI 平台產「${contextLabel}」`
        : '🚀 跳到 AI 影片平台';
    }
    // 更新預覽
    const previewZh = document.getElementById('platform-preview-zh');
    const previewEn = document.getElementById('platform-preview-en');
    if (previewZh) previewZh.textContent = launchCurrent.promptZh || '（無）';
    if (previewEn) previewEn.textContent = launchCurrent.promptEn || '（無）';

    sheet.classList.remove('hidden');
  }

  function closePlatformLauncher() {
    const sheet = document.getElementById('platform-launcher');
    if (sheet) sheet.classList.add('hidden');
  }

  async function launchToPlatform(platformId, platformName, lang, url) {
    if (!launchCurrent) return;
    // 依平台語言屬性挑用哪個 prompt — 但中文 prompt 平台若英文也 OK 還是給中文
    const text = lang === 'en'
      ? (launchCurrent.promptEn || launchCurrent.promptZh)
      : (launchCurrent.promptZh || launchCurrent.promptEn);

    if (!text) {
      showToast('❌ 找不到 prompt 內容', 3000);
      return;
    }

    // 1. 複製到剪貼簿
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (err) {
      console.warn('[launcher] clipboard failed', err);
    }

    // 2. 開新分頁
    const w = window.open(url, '_blank', 'noopener,noreferrer');

    // 埋點：跳到哪個平台、哪段、哪個語言
    trackEvent('launch_platform', {
      platform_id: platformId,
      platform_name: platformName,
      language: lang,
      copied: copied,
      context: launchCurrent.contextLabel || '',
    });

    // 3. 關閉 launcher + toast 提示
    closePlatformLauncher();
    if (copied) {
      showToast(`✅ 已複製 prompt（${lang === 'en' ? '英文' : '中文'}），請貼進 ${platformName} 輸入框`, 4500);
    } else {
      showToast(`⚠️ 無法自動複製，請手動複製：${platformName} 已開啟`, 4500);
    }
    if (!w) {
      showToast(`⚠️ 瀏覽器擋了新分頁，請允許彈窗後重試`, 4000);
    }
  }

  // ====================================================================
  // ShareSheet — 一鍵分享到 X / FB / LINE / Threads / WhatsApp
  // ====================================================================
  let shareCurrent = null;  // 當前分享資料 { title, text, url }

  function initShareSheet() {
    const sheet = document.getElementById('share-sheet');
    if (!sheet) return;
    const textArea = document.getElementById('share-text');

    // 關閉
    sheet.querySelectorAll('[data-share-close]').forEach((el) => {
      el.addEventListener('click', closeShareSheet);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !sheet.classList.contains('hidden')) closeShareSheet();
    });

    // Web Share API 支援度偵測：支援就把那個按鈕顯示
    const webshareBtn = sheet.querySelector('[data-platform="webshare"]');
    if (webshareBtn && navigator.share) {
      webshareBtn.hidden = false;
    }

    // 各平台 click
    sheet.querySelectorAll('.share-platform').forEach((btn) => {
      btn.addEventListener('click', () => {
        const platform = btn.dataset.platform;
        const text = textArea.value.trim();
        const url = shareCurrent?.url || window.location.href;
        const title = shareCurrent?.title || '封面接故事';
        handlePlatformShare(platform, { title, text, url, btn });
      });
    });
  }

  function openShareSheet({ title, text, url }) {
    const sheet = document.getElementById('share-sheet');
    const textArea = document.getElementById('share-text');
    if (!sheet || !textArea) return;
    shareCurrent = { title, text, url };
    textArea.value = text;
    sheet.classList.remove('hidden');
    setTimeout(() => textArea.focus(), 50);
  }

  function closeShareSheet() {
    const sheet = document.getElementById('share-sheet');
    if (sheet) sheet.classList.add('hidden');
    shareCurrent = null;
  }

  async function handlePlatformShare(platform, { title, text, url, btn }) {
    const enc = encodeURIComponent;
    if (platform === 'webshare') {
      try {
        await navigator.share({ title, text, url });
        closeShareSheet();
        trackEvent('share', { platform: 'webshare', context: title });
      } catch (err) {
        // 使用者取消不算錯
        if (err.name !== 'AbortError') console.warn('[share] webshare failed', err);
      }
      return;
    }
    if (platform === 'copy') {
      try {
        await navigator.clipboard.writeText(`${text}\n\n${url}`);
        const orig = btn.querySelector('.share-platform-label').textContent;
        btn.classList.add('copied');
        btn.querySelector('.share-platform-label').textContent = '✓ 已複製';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.querySelector('.share-platform-label').textContent = orig;
        }, 1800);
        trackEvent('share', { platform: 'copy_link', context: title });
      } catch (err) {
        showToast('複製失敗，請手動選取', 3000);
      }
      return;
    }

    // 各平台 share intent URL
    const urls = {
      x:        `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}&hashtags=封面接故事,AI影片創作`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${enc(url)}&quote=${enc(text)}`,
      line:     `https://social-plugins.line.me/lineit/share?url=${enc(url)}&text=${enc(text)}`,
      threads:  `https://www.threads.net/intent/post?text=${enc(text + '\n\n' + url)}`,  // Threads 不接 url，塞進文字
      whatsapp: `https://wa.me/?text=${enc(text + '\n' + url)}`,
    };
    const target = urls[platform];
    if (!target) return;
    const w = window.open(target, '_blank', 'noopener,noreferrer,width=600,height=600');
    if (w) closeShareSheet();
    trackEvent('share', {
      platform: platform,
      context: shareCurrent && shareCurrent.title || '',
    });
  }

  // 主頁分享工具入口
  function shareApp() {
    openShareSheet({
      title: '封面接故事 · 音樂影片分鏡產生器',
      text: '🎬 把 AI 音樂影片接成完整故事！\n上傳 MV → 抓封面 → AI 自動產出 4-6 段獨立提示詞，貼回 Sora / Veo / Flow / Canva 一段一段產，最後串成一支完整短片！\n免費、不用登入。',
      url: 'https://cagoooo.github.io/music-cover-storyboard/',
    });
  }

  // 結果卡分享
  function shareStoryboard(card) {
    const styleName = card.querySelector('.result-card-header .flex-1')?.textContent.trim() || '分鏡';
    const totalLabel = card.querySelector('.result-card-header span:last-child')?.textContent.trim() || '';
    openShareSheet({
      title: `${styleName} · 封面接故事`,
      text: `✨ 我用「封面接故事」產了一個【${styleName}】風格分鏡（${totalLabel}）！\nAI 自動拆成獨立段提示詞，貼回 Google Flow / Canva AI / Sora / Veo 一段一段產出短片，超好用。`,
      url: 'https://cagoooo.github.io/music-cover-storyboard/',
    });
  }

  // 暴露給 inline handler 用
  window.__mcs_shareApp = shareApp;

  // ====================================================================
  // 進階提示（A1 歌詞 + A2 角色描述）
  // ====================================================================
  function initAdvancedPrompt() {
    document.querySelectorAll('.char-count').forEach((el) => {
      const targetId = el.dataset.target;
      const input = document.getElementById(targetId);
      if (!input) return;
      const max = parseInt(input.getAttribute('maxlength') || '500', 10);
      const update = () => {
        const len = input.value.length;
        el.textContent = `${len} / ${max}`;
        el.classList.toggle('near-limit', len > max * 0.9);
      };
      input.addEventListener('input', update);
      update();
    });
  }

  function getAdvancedFields() {
    const lyrics = (document.getElementById('lyrics-input')?.value || '').trim();
    const character = (document.getElementById('character-input')?.value || '').trim();
    return { lyrics, character };
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
