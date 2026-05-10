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

  // ---- 狀態 ----
  let currentVideoUrl = null;
  let currentCoverDataUrl = null;
  let selectedStyleIds = new Set(STYLES.map(s => s.id));
  let turnstileWidgetId = null;
  let turnstileToken = null;

  const MAX_FILE_BYTES = 200 * 1024 * 1024; // 200MB

  // ---- 初始化 ----
  initStyleChips();
  initFileUpload();
  initVideoControls();
  initGenerateButton();
  initHelpModal();
  initFooterYear();
  initTurnstile();

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
      // 第一幀立刻抓
      extractFrameAt(0).catch(() => {});
      // 滾動讓使用者看到下個 step
      setTimeout(() => frameSection.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    });

    video.addEventListener('error', () => {
      showError('這個影片解碼失敗了，可能是格式問題（試試 mp4 / webm）');
    });

    timeSlider.addEventListener('input', () => {
      timeCurrent.textContent = formatTime(parseFloat(timeSlider.value));
    });
    let extractTimer = null;
    timeSlider.addEventListener('change', () => {
      if (extractTimer) clearTimeout(extractTimer);
      extractTimer = setTimeout(() => extractFrameAt(parseFloat(timeSlider.value)), 50);
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

    // bind copy buttons
    resultsGrid.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => copyText(btn));
    });
  }

  function renderCard(item) {
    const meta = STYLES.find(s => s.id === item.style_id) || { emoji: '🎬', label: item.style_name || '分鏡' };
    const breakdown = (item.scene_breakdown || []).map(seg => `
      <div class="scene-row">
        <span class="time">${escapeHtml(seg.time || '')}</span>
        <span class="desc"><strong>${escapeHtml(seg.shot || '')}</strong>　${escapeHtml(seg.action || '')}<br/><span class="text-slate-400 text-[11px]">氛圍：${escapeHtml(seg.mood || '')}</span></span>
      </div>
    `).join('');

    return `
      <article class="result-card" data-style-id="${item.style_id}">
        <div class="result-card-header theme-${item.style_id}">
          <span class="text-xl">${meta.emoji}</span>
          <span class="flex-1">${escapeHtml(item.style_name || meta.label)}</span>
          <span class="text-xs font-medium opacity-80">${escapeHtml(String(item.duration_seconds || 25))}s</span>
        </div>
        <div class="result-card-body">
          <div>
            <p class="result-card-section-title mb-2">分鏡分段</p>
            <div class="space-y-1.5">${breakdown}</div>
          </div>
          <div>
            <p class="result-card-section-title mb-1.5">中文 Prompt</p>
            <div class="prompt-block" data-prompt-zh>${escapeHtml(item.prompt_zh || '')}</div>
          </div>
          <div>
            <p class="result-card-section-title mb-1.5">English Prompt</p>
            <div class="prompt-block" data-prompt-en>${escapeHtml(item.prompt_en || '')}</div>
          </div>
          <div class="flex gap-2">
            <button type="button" class="copy-btn" data-copy="zh">📋 複製中文</button>
            <button type="button" class="copy-btn" data-copy="en">📋 Copy EN</button>
          </div>
        </div>
      </article>
    `;
  }

  async function copyText(btn) {
    const card = btn.closest('.result-card');
    const which = btn.dataset.copy;
    const text = which === 'zh'
      ? card.querySelector('[data-prompt-zh]').textContent
      : card.querySelector('[data-prompt-en]').textContent;
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = '✅ 已複製';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1500);
    } catch (err) {
      showToast('複製失敗，請長按選取文字', 3000);
    }
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
