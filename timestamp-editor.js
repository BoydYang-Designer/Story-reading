// ============================================================
//  TIMESTAMP EDITOR — timestamp-editor.js
//  取代 audio-editor.js
//
//  功能：
//  1. 保留原 audio-editor.js 所有函數名稱（向下相容 quiz.js/story.js）
//  2. 新增「句子文字編輯」功能（直接修改 timestamp 句子內容）
//  3. 新增「時間切割點調整」（±0.1s / ±0.5s，邊調邊試聽）
//  4. 所有修改存入 localStorage tsOverride（以 title+index 為 key）
//  5. story.js 的 loadTimestampForStory / getTimestampForStory 優先讀取 override
//  6. 匯出修改後的完整 .txt 檔（可上傳 GitHub 取代原始檔）
//  7. 比對 GitHub 原始版 vs localStorage 暫存版，標示差異，可選擇性清除已同步項目
// ============================================================

// ── 常數 ─────────────────────────────────────────────────────
const TS_OVERRIDE_KEY  = 'tsOverride';   // localStorage key for text/time overrides
const AUDIO_ADJ_KEY    = 'audioAdjustments'; // 保留原 key（向下相容）

// ── 資料層：tsOverride ────────────────────────────────────────
// 格式：
// {
//   "文章標題": {
//     "3": { sentence, start, end, originalSentence, originalStart, originalEnd, updatedAt }
//   }
// }

function loadTsOverride() {
    try {
        return JSON.parse(localStorage.getItem(TS_OVERRIDE_KEY) || '{}');
    } catch (e) { return {}; }
}

function saveTsOverride(data) {
    localStorage.setItem(TS_OVERRIDE_KEY, JSON.stringify(data));
    // 同步 Firebase
    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ tsOverride: data }, { merge: true })
          .catch(err => console.error('[TSEditor] Firebase save error:', err));
    }
}

/**
 * 讀取某文章的 override 資料（以 index 為 key 的物件）
 * @param {string} title
 * @returns {Object} { "3": { sentence, start, end, ... }, ... }
 */
function getTsOverrideForTitle(title) {
    const all = loadTsOverride();
    return all[title] || {};
}

/**
 * 儲存一筆 override（文字 + 時間）
 */
function setTsOverride(title, index, newSentence, newStart, newEnd, originalSentence, originalStart, originalEnd) {
    const all = loadTsOverride();
    if (!all[title]) all[title] = {};
    all[title][String(index)] = {
        sentence:         newSentence,
        start:            Math.round(newStart  * 1000) / 1000,
        end:              Math.round(newEnd    * 1000) / 1000,
        originalSentence: originalSentence,
        originalStart:    originalStart,
        originalEnd:      originalEnd,
        updatedAt:        new Date().toISOString().slice(0, 10)
    };
    saveTsOverride(all);
}

/**
 * 刪除某筆 override
 */
function deleteTsOverride(title, index) {
    const all = loadTsOverride();
    if (all[title]) {
        delete all[title][String(index)];
        if (Object.keys(all[title]).length === 0) delete all[title];
    }
    saveTsOverride(all);
}

/**
 * 將 tsOverride 套用至一份 timestampData（陣列），回傳新陣列（不修改原始）
 */
function applyTsOverride(title, data) {
    if (!data || data.length === 0) return data;
    const overrides = getTsOverrideForTitle(title);
    if (Object.keys(overrides).length === 0) return data;

    return data.map((line, idx) => {
        const ov = overrides[String(idx)];
        if (!ov) return line;
        return {
            start:    ov.start,
            end:      ov.end,
            sentence: ov.sentence
        };
    });
}

// ── Firestore 同步（登入後呼叫，story.js 會呼叫此函數）────────
async function loadAudioAdjustmentsFromFirestore() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    try {
        const doc = await db.collection('userNotes').doc(currentUser.uid).get();
        if (doc.exists) {
            // 載入 tsOverride（新格式）
            if (doc.data().tsOverride) {
                localStorage.setItem(TS_OVERRIDE_KEY, JSON.stringify(doc.data().tsOverride));
                console.log('[TSEditor] tsOverride synced from Firestore.');
            }
            // 保留舊的 audioAdjustments 向下相容
            if (doc.data().audioAdjustments) {
                localStorage.setItem(AUDIO_ADJ_KEY, JSON.stringify(doc.data().audioAdjustments));
            }
        }
    } catch (e) {
        console.error('[TSEditor] Firestore load error:', e);
    }
}

// ── 向下相容：保留原 audio-editor.js 函數名稱 ────────────────
// quiz.js 呼叫了：getAdjustedTiming、getQuizTiming、createAudioEditBtn、openAudioEditor
// story.js 呼叫了：getNoteAdjustedTiming
// 這些函數全部保留，行為不變（讀舊的 audioAdjustments 表）

function loadAudioAdjustments() {
    try {
        return JSON.parse(localStorage.getItem(AUDIO_ADJ_KEY) || '{}');
    } catch (e) { return {}; }
}

function saveAudioAdjustments(data) {
    localStorage.setItem(AUDIO_ADJ_KEY, JSON.stringify(data));
    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ audioAdjustments: data }, { merge: true })
          .catch(err => console.error('[TSEditor] Firebase audioAdj save error:', err));
    }
}

function getAdjustedTiming(title, sentence, originalStart, originalEnd) {
    const adj = loadAudioAdjustments();
    const entry = adj[title]?.[sentence];
    if (entry) {
        return { start: entry.start, end: entry.end, isAdjusted: true };
    }
    return { start: originalStart, end: originalEnd, isAdjusted: false };
}

function setAudioAdjustment(title, sentence, newStart, newEnd, originalStart, originalEnd) {
    const adj = loadAudioAdjustments();
    if (!adj[title]) adj[title] = {};
    adj[title][sentence] = {
        start: Math.round(newStart * 10) / 10,
        end:   Math.round(newEnd   * 10) / 10,
        originalStart,
        originalEnd,
        updatedAt: new Date().toISOString().slice(0, 10)
    };
    saveAudioAdjustments(adj);
}

function deleteAudioAdjustment(title, sentence) {
    const adj = loadAudioAdjustments();
    if (adj[title]) {
        delete adj[title][sentence];
        if (Object.keys(adj[title]).length === 0) delete adj[title];
    }
    saveAudioAdjustments(adj);
}

function getQuizTiming(title, sentence, originalStart, originalEnd) {
    return getAdjustedTiming(title, sentence, originalStart, originalEnd);
}

function getNoteAdjustedTiming(title, sentence, originalStart, originalEnd) {
    return getAdjustedTiming(title, sentence, originalStart, originalEnd);
}

function createAudioEditBtn({ title, sentence, start, end, audioSrc, player, onSave }) {
    const adj = loadAudioAdjustments();
    const isAdjusted = !!(adj[title]?.[sentence]);

    const btn = document.createElement('button');
    btn.className = `audio-edit-inline-btn${isAdjusted ? ' is-adjusted' : ''}`;
    btn.title = isAdjusted ? '已調整（點擊再編輯）' : '調整音檔時間';
    btn.innerHTML = isAdjusted ? '✏️✓' : '✏️';

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAudioEditor({ title, sentence, start, end, audioSrc, player, onSave });
    });

    return btn;
}

// ── 向下相容：openAudioEditor（保留原有 ±0.1s/±0.5s 時間編輯彈窗）────
let _editorState = {
    title: null, sentence: null, start: 0, end: 0,
    originalStart: 0, originalEnd: 0, audioSrc: null,
    onSave: null, player: null,
};
let _editorSnippetTimer = null;

function openAudioEditor({ title, sentence, start, end, audioSrc, player, onSave }) {
    const adj = loadAudioAdjustments();
    const existing = adj[title]?.[sentence];
    _editorState = {
        title, sentence,
        start:         existing ? existing.start         : start,
        end:           existing ? existing.end           : end,
        originalStart: existing ? existing.originalStart : start,
        originalEnd:   existing ? existing.originalEnd   : end,
        audioSrc, onSave,
        player: player || new Audio(),
    };
    _renderEditorModal();
    document.getElementById('audio-editor-modal').classList.remove('is-hidden');
    _updateEditorDisplay();
}

function closeAudioEditor() {
    const modal = document.getElementById('audio-editor-modal');
    if (modal) modal.classList.add('is-hidden');
    _stopEditorPreview();
}

function _stopEditorPreview() {
    if (_editorSnippetTimer) { clearTimeout(_editorSnippetTimer); _editorSnippetTimer = null; }
    if (typeof WebAudioEngine !== 'undefined') WebAudioEngine.stop();
    if (_editorState.player) _editorState.player.pause();
}

function _renderEditorModal() {
    const modal = document.getElementById('audio-editor-modal');
    if (!modal) return;
    const box = modal.querySelector('.audio-editor-box');
    if (!box) return;

    const shortSentence = _editorState.sentence.length > 60
        ? _editorState.sentence.substring(0, 60) + '…'
        : _editorState.sentence;

    box.innerHTML = `
        <div class="audio-editor-header">
            <span class="audio-editor-icon">✏️</span>
            <span class="audio-editor-title">調整音檔時間</span>
            <button class="audio-editor-close-btn" id="audio-editor-close">✕</button>
        </div>
        <div class="audio-editor-sentence">"${escapeHtml(shortSentence)}"</div>
        <div class="audio-editor-row">
            <span class="audio-editor-label">START</span>
            <button class="audio-adj-btn" data-target="start" data-delta="-0.5">−0.5s</button>
            <button class="audio-adj-btn" data-target="start" data-delta="-0.1">−0.1s</button>
            <span class="audio-editor-value" id="editor-start-val">0.0s</span>
            <button class="audio-adj-btn" data-target="start" data-delta="0.1">+0.1s</button>
            <button class="audio-adj-btn" data-target="start" data-delta="0.5">+0.5s</button>
            <span class="audio-editor-diff" id="editor-start-diff"></span>
        </div>
        <div class="audio-editor-row">
            <span class="audio-editor-label">END</span>
            <button class="audio-adj-btn" data-target="end" data-delta="-0.5">−0.5s</button>
            <button class="audio-adj-btn" data-target="end" data-delta="-0.1">−0.1s</button>
            <span class="audio-editor-value" id="editor-end-val">0.0s</span>
            <button class="audio-adj-btn" data-target="end" data-delta="0.1">+0.1s</button>
            <button class="audio-adj-btn" data-target="end" data-delta="0.5">+0.5s</button>
            <span class="audio-editor-diff" id="editor-end-diff"></span>
        </div>
        <div class="audio-editor-duration" id="editor-duration">Duration: —</div>
        <div class="audio-editor-actions">
            <button class="audio-editor-preview-btn" id="audio-editor-preview-btn">▶ 試聽</button>
            <button class="audio-editor-reset-btn" id="audio-editor-reset-btn">↩ 還原預設</button>
        </div>
        <div class="audio-editor-footer">
            <button class="secondary" id="audio-editor-cancel-btn">取消</button>
            <button class="audio-editor-save-btn" id="audio-editor-save-btn">✓ 儲存</button>
        </div>
    `;

    box.querySelector('#audio-editor-close').addEventListener('click', closeAudioEditor);
    box.querySelector('#audio-editor-cancel-btn').addEventListener('click', closeAudioEditor);
    box.querySelectorAll('.audio-adj-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            const delta  = parseFloat(btn.dataset.delta);
            _editorState[target] = Math.round((_editorState[target] + delta) * 10) / 10;
            if (_editorState.start < 0) _editorState.start = 0;
            if (_editorState.end <= _editorState.start) {
                _editorState.end = Math.round((_editorState.start + 0.5) * 10) / 10;
            }
            _updateEditorDisplay();
        });
    });
    box.querySelector('#audio-editor-preview-btn').addEventListener('click', _playEditorPreview);
    box.querySelector('#audio-editor-reset-btn').addEventListener('click', () => {
        _editorState.start = _editorState.originalStart;
        _editorState.end   = _editorState.originalEnd;
        _updateEditorDisplay();
        _stopEditorPreview();
    });
    box.querySelector('#audio-editor-save-btn').addEventListener('click', () => {
        _stopEditorPreview();
        setAudioAdjustment(
            _editorState.title, _editorState.sentence,
            _editorState.start, _editorState.end,
            _editorState.originalStart, _editorState.originalEnd
        );
        showNotification('✓ 音檔時間已儲存', 'success');
        const onSaveCb = _editorState.onSave;
        const savedStart = _editorState.start;
        const savedEnd   = _editorState.end;
        closeAudioEditor();
        setTimeout(() => { if (onSaveCb) onSaveCb(savedStart, savedEnd); }, 200);
    });
}

function _updateEditorDisplay() {
    const startEl    = document.getElementById('editor-start-val');
    const endEl      = document.getElementById('editor-end-val');
    const durationEl = document.getElementById('editor-duration');
    const startDiffEl = document.getElementById('editor-start-diff');
    const endDiffEl   = document.getElementById('editor-end-diff');
    if (!startEl) return;
    startEl.textContent = _editorState.start.toFixed(1) + 's';
    endEl.textContent   = _editorState.end.toFixed(1) + 's';
    const dur = (_editorState.end - _editorState.start).toFixed(1);
    durationEl.textContent = `Duration: ${dur}s`;
    const startDiff = Math.round((_editorState.start - _editorState.originalStart) * 10) / 10;
    const endDiff   = Math.round((_editorState.end   - _editorState.originalEnd  ) * 10) / 10;
    const changed = startDiff !== 0 || endDiff !== 0;
    if (startDiffEl) {
        if (startDiff !== 0) {
            const sign = startDiff > 0 ? '+' : '';
            startDiffEl.textContent = `(${sign}${startDiff.toFixed(1)}s)`;
            startDiffEl.className = `audio-editor-diff ${startDiff > 0 ? 'is-positive' : 'is-negative'}`;
        } else {
            startDiffEl.textContent = '';
            startDiffEl.className = 'audio-editor-diff';
        }
    }
    if (endDiffEl) {
        if (endDiff !== 0) {
            const sign = endDiff > 0 ? '+' : '';
            endDiffEl.textContent = `(${sign}${endDiff.toFixed(1)}s)`;
            endDiffEl.className = `audio-editor-diff ${endDiff > 0 ? 'is-positive' : 'is-negative'}`;
        } else {
            endDiffEl.textContent = '';
            endDiffEl.className = 'audio-editor-diff';
        }
    }
    durationEl.style.color = changed ? 'var(--color-primary)' : 'var(--color-text-light)';
}

function _playEditorPreview() {
    _stopEditorPreview();
    const src = _editorState.audioSrc;
    const start = _editorState.start;
    const end   = _editorState.end;
    const previewBtn = document.getElementById('audio-editor-preview-btn');
    if (!src || end <= start) { showNotification('無法試聽：時間設定無效', 'warning'); return; }
    if (previewBtn) { previewBtn.textContent = '⏸ 播放中…'; previewBtn.disabled = true; }
    const onEnd = () => {
        if (previewBtn) { previewBtn.textContent = '▶ 試聽'; previewBtn.disabled = false; }
        _editorSnippetTimer = null;
    };
    if (typeof WebAudioEngine !== 'undefined' && WebAudioEngine.isSupported()) {
        WebAudioEngine.playSnippet({
            src, start, end,
            onStart: () => {},
            onEnd,
            onError: (err) => {
                console.error('[TSEditor] Preview error:', err);
                showNotification('試聽失敗', 'error');
                if (previewBtn) { previewBtn.textContent = '▶ 試聽'; previewBtn.disabled = false; }
            }
        });
        return;
    }
    const player = _editorState.player;
    const targetFilename  = src.split('/').pop();
    const currentFilename = decodeURIComponent(player.src.split('/').pop() || '');
    if (currentFilename !== decodeURIComponent(targetFilename)) { player.src = src; player.load(); }
    const isMobile = typeof isMobileDevice === 'function' && isMobileDevice();
    player.currentTime = Math.max(0, start - (isMobile ? 0.25 : 0.1));
    player.play().then(() => {
        const playMs = (end - start) * 1000 + (isMobile ? 1000 : 800);
        _editorSnippetTimer = setTimeout(() => { player.pause(); onEnd(); }, playMs);
    }).catch(() => {
        if (previewBtn) { previewBtn.textContent = '▶ 試聽'; previewBtn.disabled = false; }
    });
}

// ── HTML 工具函數 ─────────────────────────────────────────────
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ══════════════════════════════════════════════════════════════
//  新功能：句子文字編輯器（Timestamp Sentence Editor）
// ══════════════════════════════════════════════════════════════

let _tsEditorState = {
    title:         null,
    index:         -1,
    sentence:      '',
    start:         0,
    end:           0,
    originalSentence: '',
    originalStart: 0,
    originalEnd:   0,
    audioSrc:      null,
    onSave:        null,
    // 上下文資訊（顯示用）
    prevEnd:       null,   // 前一句的結束時間（秒），null 表示第一句
    nextStart:     null,   // 後一句的開始時間（秒），null 表示最後一句
    prevStart:     null,   // 前一句的開始時間（秒），備用
    nextEnd:       null,   // 後一句的結束時間（秒），備用
    audioDuration: null,   // MP3 總時長（秒）
    totalSentences: 0,     // 句子總數
};
let _tsEditorSnippetTimer = null;

/**
 * 開啟句子文字編輯器彈窗
 * @param {object} opts
 *   title          文章標題
 *   index          句子在 timestampData 中的索引
 *   sentence       句子文字
 *   start / end    時間（秒）
 *   audioSrc       mp3 路徑
 *   onSave         儲存後 callback()
 */
function openTsEditor({ title, index, sentence, start, end, audioSrc, onSave,
                        prevEnd = null, nextStart = null,
                        prevStart = null, nextEnd = null,
                        audioDuration = null, totalSentences = 0 }) {
    // 先讀取可能已有的 override
    const overrides = getTsOverrideForTitle(title);
    const existing  = overrides[String(index)];

    _tsEditorState = {
        title, index,
        sentence:         existing ? existing.sentence      : sentence,
        start:            existing ? existing.start         : start,
        end:              existing ? existing.end           : end,
        originalSentence: existing ? existing.originalSentence : sentence,
        originalStart:    existing ? existing.originalStart    : start,
        originalEnd:      existing ? existing.originalEnd      : end,
        audioSrc,
        onSave,
        prevEnd,
        nextStart,
        prevStart,
        nextEnd,
        audioDuration,
        totalSentences,
    };

    _renderTsEditorModal();
    document.getElementById('ts-editor-modal').classList.remove('is-hidden');
    _updateTsEditorDisplay();
}

function closeTsEditor() {
    const modal = document.getElementById('ts-editor-modal');
    if (modal) modal.classList.add('is-hidden');
    _stopTsEditorPreview();
}

function _stopTsEditorPreview() {
    if (_tsEditorSnippetTimer) { clearTimeout(_tsEditorSnippetTimer); _tsEditorSnippetTimer = null; }
    if (typeof WebAudioEngine !== 'undefined') WebAudioEngine.stop();
}

function _renderTsEditorModal() {
    const modal = document.getElementById('ts-editor-modal');
    if (!modal) {
        console.error('[TSEditor] ts-editor-modal not found in DOM.');
        return;
    }
    const box = modal.querySelector('.ts-editor-box');
    if (!box) return;

    const st = _tsEditorState;

    // 建立上下文資訊列
    const sentenceLabel = st.totalSentences > 0
        ? `第 ${st.index + 1} 句 / 共 ${st.totalSentences} 句`
        : `第 ${st.index + 1} 句`;

    const fmtTime = (sec) => {
        if (sec === null || sec === undefined) return '—';
        const m = Math.floor(sec / 60);
        const s = (sec % 60).toFixed(3).padStart(6, '0');
        return `${m}:${s}`;
    };

    const durationHtml = st.audioDuration !== null
        ? `<span class="ts-ctx-item ts-ctx-total">🎵 MP3 總長：${fmtTime(st.audioDuration)}</span>`
        : '';

    // 前句結束
    const prevEndHtml = st.prevEnd !== null
        ? `<span class="ts-ctx-item ts-ctx-prev" title="前一句結束時間">⬆ 前句結束：${fmtTime(st.prevEnd)}</span>`
        : `<span class="ts-ctx-item ts-ctx-prev ts-ctx-dim">⬆ 前句：第一句</span>`;

    // 本句 START / END（id 讓 _updateTsEditorDisplay 可即時更新）
    const thisStartHtml = `<span class="ts-ctx-item ts-ctx-this ts-ctx-this-start" id="ts-ctx-this-start" title="本句開始時間">▶ 本句開始：${fmtTime(st.start)}</span>`;
    const thisEndHtml   = `<span class="ts-ctx-item ts-ctx-this ts-ctx-this-end"   id="ts-ctx-this-end"   title="本句結束時間">⏹ 本句結束：${fmtTime(st.end)}</span>`;

    // 後句開始
    const nextHtml = st.nextStart !== null
        ? `<span class="ts-ctx-item ts-ctx-next" title="後一句開始時間">⬇ 後句開始：${fmtTime(st.nextStart)}</span>`
        : `<span class="ts-ctx-item ts-ctx-next ts-ctx-dim">⬇ 後句：最後一句</span>`;

    box.innerHTML = `
        <div class="ts-editor-header">
            <span class="ts-editor-icon">✏️</span>
            <span class="ts-editor-title">編輯句子</span>
            <span class="ts-editor-index-badge">${sentenceLabel}</span>
            <button class="ts-editor-close-btn" id="ts-editor-close">✕</button>
        </div>

        <div class="ts-ctx-bar">
            ${prevEndHtml}
            ${thisStartHtml}
            ${thisEndHtml}
            ${nextHtml}
        </div>
        ${durationHtml ? `<div class="ts-ctx-duration-row">${durationHtml}</div>` : ''}

        <div class="ts-editor-section-label">句子文字</div>
        <textarea id="ts-editor-text" class="ts-editor-textarea" rows="3">${escapeHtml(st.sentence)}</textarea>
        <div class="ts-editor-original-hint" id="ts-editor-text-hint"></div>

        <div class="ts-editor-section-label" style="margin-top:14px;">時間切割點</div>

        <div class="ts-editor-time-row">
            <span class="ts-editor-time-label">START</span>
            <div class="ts-adj-group">
                <button class="ts-adj-btn" data-target="start" data-delta="-0.5">−0.5s</button>
                <button class="ts-adj-btn" data-target="start" data-delta="-0.1">−0.1s</button>
                <span class="ts-editor-time-value" id="ts-start-val">0.000s</span>
                <button class="ts-adj-btn" data-target="start" data-delta="0.1">+0.1s</button>
                <button class="ts-adj-btn" data-target="start" data-delta="0.5">+0.5s</button>
            </div>
            <span class="ts-editor-time-diff" id="ts-start-diff"></span>
        </div>

        <div class="ts-editor-time-row">
            <span class="ts-editor-time-label">END</span>
            <div class="ts-adj-group">
                <button class="ts-adj-btn" data-target="end" data-delta="-0.5">−0.5s</button>
                <button class="ts-adj-btn" data-target="end" data-delta="-0.1">−0.1s</button>
                <span class="ts-editor-time-value" id="ts-end-val">0.000s</span>
                <button class="ts-adj-btn" data-target="end" data-delta="0.1">+0.1s</button>
                <button class="ts-adj-btn" data-target="end" data-delta="0.5">+0.5s</button>
            </div>
            <span class="ts-editor-time-diff" id="ts-end-diff"></span>
        </div>

        <div class="ts-editor-duration" id="ts-editor-duration">Duration: —</div>

        <div class="ts-editor-actions">
            <button class="ts-editor-preview-btn" id="ts-editor-preview-btn">▶ 試聽</button>
            <button class="ts-editor-reset-btn" id="ts-editor-reset-btn">↩ 還原預設</button>
        </div>

        <div class="ts-editor-footer">
            <button class="secondary" id="ts-editor-cancel-btn">取消</button>
            <button class="ts-editor-save-btn" id="ts-editor-save-btn">✓ 儲存</button>
        </div>
    `;

    // 關閉 / 取消
    box.querySelector('#ts-editor-close').addEventListener('click', closeTsEditor);
    box.querySelector('#ts-editor-cancel-btn').addEventListener('click', closeTsEditor);

    // 文字變動 hint
    const textarea = box.querySelector('#ts-editor-text');
    textarea.addEventListener('input', () => {
        _tsEditorState.sentence = textarea.value;
        _updateTsEditorDisplay();
    });

    // 時間微調按鈕
    box.querySelectorAll('.ts-adj-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;
            const delta  = parseFloat(btn.dataset.delta);
            _tsEditorState[target] = Math.round((_tsEditorState[target] + delta) * 1000) / 1000;
            if (_tsEditorState.start < 0) _tsEditorState.start = 0;
            if (_tsEditorState.end <= _tsEditorState.start) {
                _tsEditorState.end = Math.round((_tsEditorState.start + 0.5) * 1000) / 1000;
            }
            _updateTsEditorDisplay();
        });
    });

    // 試聽
    box.querySelector('#ts-editor-preview-btn').addEventListener('click', _playTsEditorPreview);

    // 還原
    box.querySelector('#ts-editor-reset-btn').addEventListener('click', () => {
        _tsEditorState.sentence = _tsEditorState.originalSentence;
        _tsEditorState.start    = _tsEditorState.originalStart;
        _tsEditorState.end      = _tsEditorState.originalEnd;
        textarea.value = _tsEditorState.sentence;
        _updateTsEditorDisplay();
        _stopTsEditorPreview();
    });

    // 儲存（含重疊偵測）
    box.querySelector('#ts-editor-save-btn').addEventListener('click', () => {
        _stopTsEditorPreview();
        const st = _tsEditorState;
        const newText = textarea.value.trim();
        if (!newText) { showNotification('句子文字不能為空', 'warning'); return; }
        st.sentence = newText;

        // ── 時間重疊偵測 ─────────────────────────────────────────
        const warnings = [];
        if (st.prevEnd !== null && st.start < st.prevEnd) {
            warnings.push(`⚠️ START (${st.start.toFixed(3)}s) 早於前句結束時間 (${st.prevEnd.toFixed(3)}s)，會造成時間重疊！`);
        }
        if (st.nextStart !== null && st.end > st.nextStart) {
            warnings.push(`⚠️ END (${st.end.toFixed(3)}s) 晚於後句開始時間 (${st.nextStart.toFixed(3)}s)，會造成時間重疊！`);
        }
        if (st.audioDuration !== null && st.end > st.audioDuration) {
            warnings.push(`⚠️ END (${st.end.toFixed(3)}s) 超出 MP3 總時長 (${st.audioDuration.toFixed(3)}s)！`);
        }
        if (warnings.length > 0) {
            const proceed = confirm(warnings.join('\n') + '\n\n確定仍要儲存？');
            if (!proceed) return;
        }
        // ──────────────────────────────────────────────────────────

        setTsOverride(
            st.title, st.index,
            st.sentence, st.start, st.end,
            st.originalSentence, st.originalStart, st.originalEnd
        );

        // 更新記憶體中的 timestampData（若正在閱讀這篇文章）
        if (typeof timestampData !== 'undefined' && typeof currentStoryTitle !== 'undefined'
            && currentStoryTitle === st.title && timestampData[st.index]) {
            timestampData[st.index].sentence = st.sentence;
            timestampData[st.index].start    = st.start;
            timestampData[st.index].end      = st.end;
            // 重新渲染閱讀頁面
            if (typeof renderTimestampContent === 'function') renderTimestampContent();
        }

        // 清除 timestampCache，讓下次 getTimestampForStory 重新讀取
        if (typeof timestampCache !== 'undefined') {
            delete timestampCache[st.title];
        }

        showNotification('✓ 已儲存句子修改', 'success');
        closeTsEditor();
        if (st.onSave) st.onSave();
    });
}

function _updateTsEditorDisplay() {
    const st = _tsEditorState;

    const startEl = document.getElementById('ts-start-val');
    const endEl   = document.getElementById('ts-end-val');
    const durEl   = document.getElementById('ts-editor-duration');
    const startDiffEl = document.getElementById('ts-start-diff');
    const endDiffEl   = document.getElementById('ts-end-diff');
    const textHintEl  = document.getElementById('ts-editor-text-hint');
    if (!startEl) return;

    const fmtTime = (sec) => {
        if (sec === null || sec === undefined) return '—';
        const m = Math.floor(sec / 60);
        const s = (sec % 60).toFixed(3).padStart(6, '0');
        return `${m}:${s}`;
    };

    startEl.textContent = st.start.toFixed(3) + 's';
    endEl.textContent   = st.end.toFixed(3) + 's';
    durEl.textContent   = `Duration: ${(st.end - st.start).toFixed(3)}s`;

    // 即時更新 context bar 的本句時間
    const ctxStart = document.getElementById('ts-ctx-this-start');
    const ctxEnd   = document.getElementById('ts-ctx-this-end');
    if (ctxStart) ctxStart.textContent = `▶ 本句開始：${fmtTime(st.start)}`;
    if (ctxEnd)   ctxEnd.textContent   = `⏹ 本句結束：${fmtTime(st.end)}`;

    // 重疊警示：context bar 標色
    if (ctxStart) {
        const overlapPrev = st.prevEnd !== null && st.start < st.prevEnd;
        ctxStart.classList.toggle('ts-ctx-overlap', overlapPrev);
    }
    if (ctxEnd) {
        const overlapNext = st.nextStart !== null && st.end > st.nextStart;
        ctxEnd.classList.toggle('ts-ctx-overlap', overlapNext);
    }

    const startDiff = Math.round((st.start - st.originalStart) * 1000) / 1000;
    const endDiff   = Math.round((st.end   - st.originalEnd  ) * 1000) / 1000;
    durEl.style.color = (startDiff !== 0 || endDiff !== 0 || st.sentence !== st.originalSentence)
        ? 'var(--color-primary)' : 'var(--color-text-light)';

    _renderDiff(startDiffEl, startDiff, 's');
    _renderDiff(endDiffEl,   endDiff,   's');

    if (textHintEl) {
        if (st.sentence !== st.originalSentence) {
            textHintEl.textContent = `原始：${st.originalSentence.substring(0, 60)}${st.originalSentence.length > 60 ? '…' : ''}`;
            textHintEl.style.display = 'block';
        } else {
            textHintEl.style.display = 'none';
        }
    }
}

function _renderDiff(el, diff, unit) {
    if (!el) return;
    if (diff !== 0) {
        const sign = diff > 0 ? '+' : '';
        el.textContent = `(${sign}${diff.toFixed(3)}${unit})`;
        el.className = `ts-editor-time-diff ${diff > 0 ? 'is-positive' : 'is-negative'}`;
    } else {
        el.textContent = '';
        el.className = 'ts-editor-time-diff';
    }
}

function _playTsEditorPreview() {
    _stopTsEditorPreview();
    const st  = _tsEditorState;
    const src = st.audioSrc;
    const start = st.start;
    const end   = st.end;
    const btn = document.getElementById('ts-editor-preview-btn');
    if (!src || end <= start) { showNotification('無法試聽：時間設定無效', 'warning'); return; }
    if (btn) { btn.textContent = '⏸ 播放中…'; btn.disabled = true; }
    const onEnd = () => {
        if (btn) { btn.textContent = '▶ 試聽'; btn.disabled = false; }
        _tsEditorSnippetTimer = null;
    };
    if (typeof WebAudioEngine !== 'undefined' && WebAudioEngine.isSupported()) {
        WebAudioEngine.playSnippet({
            src, start, end,
            onStart: () => {},
            onEnd,
            onError: () => {
                showNotification('試聽失敗', 'error');
                if (btn) { btn.textContent = '▶ 試聽'; btn.disabled = false; }
            }
        });
        return;
    }
    // Fallback HTMLAudioElement
    const player = new Audio(src);
    player.currentTime = Math.max(0, start - 0.1);
    player.play().then(() => {
        _tsEditorSnippetTimer = setTimeout(() => { player.pause(); onEnd(); }, (end - start) * 1000 + 800);
    }).catch(() => {
        if (btn) { btn.textContent = '▶ 試聽'; btn.disabled = false; }
    });
}

// ── 閱讀頁面：編輯模式開關 ────────────────────────────────────
let _tsEditModeActive = false;

/**
 * 初始化編輯模式按鈕（由 story.js 的 renderTimestampContent 完成後呼叫）
 * 每次進入新文章時重新呼叫，確保 ✏️ 按鈕都插入好但先隱藏
 */
function attachTsEditButtons(title) {
    const textContainer = document.getElementById('text-container');
    if (!textContainer) return;

    const overrides = getTsOverrideForTitle(title);
    const sentences = textContainer.querySelectorAll('.timestamp-sentence');
    const audioSrc  = `audio/${encodeURIComponent(title.trim())}.mp3`;

    // 取得 MP3 總時長（若 audio element 已載入）
    const audioEl = document.getElementById('audio');
    const audioDuration = (audioEl && isFinite(audioEl.duration) && audioEl.duration > 0)
        ? audioEl.duration : null;

    const totalSentences = (typeof timestampData !== 'undefined') ? timestampData.length : sentences.length;

    sentences.forEach((p, idx) => {
        // 避免重複插入
        if (p.querySelector('.ts-edit-inline-btn')) return;

        const isOverridden = !!(overrides[String(idx)]);

        const btn = document.createElement('button');
        btn.className = `ts-edit-inline-btn${isOverridden ? ' is-overridden' : ''}`;
        btn.title = isOverridden ? '已修改（點擊再編輯）' : '編輯此句';
        btn.innerHTML = isOverridden ? '✏️✓' : '✏️';
        btn.setAttribute('data-idx', idx);

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const data = (typeof timestampData !== 'undefined') ? timestampData : null;
            const line = data ? data[idx] : null;
            if (!line) return;

            // 取得前後句時間，優先讀取 override（確保顯示的是最新編輯值）
            const ov = getTsOverrideForTitle(title);

            const prevLine = (data && idx > 0) ? data[idx - 1] : null;
            const nextLine = (data && idx < data.length - 1) ? data[idx + 1] : null;

            const prevOv   = prevLine ? ov[String(idx - 1)] : null;
            const nextOv   = nextLine ? ov[String(idx + 1)] : null;

            const prevEnd   = prevLine   ? (prevOv   ? prevOv.end   : prevLine.end)   : null;
            const prevStart = prevLine   ? (prevOv   ? prevOv.start : prevLine.start) : null;
            const nextStart = nextLine   ? (nextOv   ? nextOv.start : nextLine.start) : null;
            const nextEnd   = nextLine   ? (nextOv   ? nextOv.end   : nextLine.end)   : null;

            // 動態取得最新 MP3 時長（可能在 attachTsEditButtons 後才載入完成）
            const latestDuration = (audioEl && isFinite(audioEl.duration) && audioEl.duration > 0)
                ? audioEl.duration : audioDuration;

            openTsEditor({
                title,
                index:         idx,
                sentence:      line.sentence,
                start:         line.start,
                end:           line.end,
                audioSrc,
                prevEnd,
                prevStart,
                nextStart,
                nextEnd,
                audioDuration: latestDuration,
                totalSentences,
                onSave:   () => {
                    btn.classList.add('is-overridden');
                    btn.innerHTML = '✏️✓';
                    btn.title = '已修改（點擊再編輯）';
                }
            });
        });

        p.style.position = 'relative';
        p.insertBefore(btn, p.firstChild);
    });

    // 同步目前的編輯模式狀態（換文章後保持狀態一致）
    _syncEditModeUI();
}

/**
 * 同步 text-container 的 class 與按鈕 highlight 狀態
 */
function _syncEditModeUI() {
    const textContainer = document.getElementById('text-container');
    const modeBtn       = document.getElementById('ts-edit-mode-btn');
    if (textContainer) {
        textContainer.classList.toggle('ts-edit-mode-active', _tsEditModeActive);
    }
    if (modeBtn) {
        modeBtn.classList.toggle('is-edit-mode', _tsEditModeActive);
        modeBtn.title = _tsEditModeActive ? '關閉編輯模式' : '開啟編輯模式';
    }
}

// 編輯模式按鈕點擊事件（綁定一次即可）
document.getElementById('ts-edit-mode-btn')?.addEventListener('click', () => {
    _tsEditModeActive = !_tsEditModeActive;
    _syncEditModeUI();
});

/**
 * 關閉編輯模式（供外部呼叫，例如離開文章時）
 */
function resetTsEditMode() {
    _tsEditModeActive = false;
    _syncEditModeUI();
}

/**
 * 回傳目前是否處於編輯模式（供 story.js keydown handler 查詢）
 */
function isTsEditModeActive() {
    return _tsEditModeActive;
}

// ══════════════════════════════════════════════════════════════
//  音檔時間調整記錄管理器（完整保留舊功能）
// ══════════════════════════════════════════════════════════════

function openAudioEditorManager() {
    renderAudioEditorManager();
    showView(document.getElementById('audio-editor-manager-view'));
}

function _getStoryCategory(title) {
    const normalised = title.trim().toLowerCase();
    if (typeof stories !== 'undefined' && Array.isArray(stories)) {
        const story = stories.find(s => (s['標題'] || '').trim().toLowerCase() === normalised);
        if (story) {
            return {
                major: story['大類'] || '其他',
                sub:   (Array.isArray(story['分類']) ? story['分類'][0] : story['分類']) || '其他'
            };
        }
    }
    if (typeof loadCustomArticles === 'function') {
        const custom = loadCustomArticles().find(a =>
            (a.title || '').trim().toLowerCase() === normalised ||
            (a.slug  || '').trim().toLowerCase() === normalised
        );
        if (custom) {
            return { major: custom.major || '其他', sub: custom.category || '其他' };
        }
    }
    return { major: '其他', sub: '其他' };
}

function renderAudioEditorManager() {
    const listEl = document.getElementById('audio-editor-manager-list');
    if (!listEl) return;

    // ── 分兩區塊：① tsOverride（新）② audioAdjustments（舊）──
    const tsOv = loadTsOverride();
    const adj  = loadAudioAdjustments();

    const allTitles = [...new Set([...Object.keys(tsOv), ...Object.keys(adj)])];

    if (allTitles.length === 0) {
        listEl.innerHTML = `<div class="aem-empty">尚無調整記錄。<br>在閱讀頁按 <strong>✏️</strong> 即可編輯句子。</div>`;
        const countEl = document.getElementById('aem-total-count');
        if (countEl) countEl.textContent = '共 0 筆';
        return;
    }

    // 統計
    let total = 0;
    allTitles.forEach(t => {
        total += Object.keys(tsOv[t] || {}).length;
        total += Object.keys(adj[t]  || {}).length;
    });
    const countEl = document.getElementById('aem-total-count');
    if (countEl) countEl.textContent = `共 ${total} 筆調整`;

    // 巢狀分組
    const grouped = {};
    allTitles.forEach(title => {
        const { major, sub } = _getStoryCategory(title);
        if (!grouped[major]) grouped[major] = {};
        if (!grouped[major][sub]) grouped[major][sub] = [];
        grouped[major][sub].push(title);
    });

    const majorKeys = Object.keys(grouped).sort((a, b) => {
        if (a === '其他') return 1; if (b === '其他') return -1;
        return a.localeCompare(b);
    });

    let html = '';
    majorKeys.forEach(major => {
        let majorCount = 0;
        Object.values(grouped[major]).forEach(titles =>
            titles.forEach(t => {
                majorCount += Object.keys(tsOv[t] || {}).length;
                majorCount += Object.keys(adj[t]  || {}).length;
            })
        );
        html += `
        <div class="aem-major-group">
            <div class="aem-major-header aem-collapsible">
                <span class="aem-collapse-arrow">▾</span>
                <span class="aem-major-label">${escapeHtml(major)}</span>
                <span class="aem-count-badge">${majorCount}</span>
            </div>
            <div class="aem-major-body is-collapsed">`;

        const subKeys = Object.keys(grouped[major]).sort((a, b) => {
            if (a === '其他') return 1; if (b === '其他') return -1;
            return a.localeCompare(b);
        });
        subKeys.forEach(sub => {
            const titlesInSub = grouped[major][sub].sort();
            let subCount = 0;
            titlesInSub.forEach(t => {
                subCount += Object.keys(tsOv[t] || {}).length;
                subCount += Object.keys(adj[t]  || {}).length;
            });
            html += `
            <div class="aem-sub-group">
                <div class="aem-sub-header aem-collapsible">
                    <span class="aem-collapse-arrow">▾</span>
                    <span class="aem-sub-label">${escapeHtml(sub)}</span>
                    <span class="aem-count-badge aem-count-badge--sub">${subCount}</span>
                </div>
                <div class="aem-sub-body is-collapsed">`;

            titlesInSub.forEach(title => {
                const tsEntries  = tsOv[title] || {};
                const adjEntries = adj[title]  || {};
                const total = Object.keys(tsEntries).length + Object.keys(adjEntries).length;

                html += `
                <div class="aem-article-group">
                    <div class="aem-article-title aem-collapsible">
                        <span class="aem-collapse-arrow">▾</span>
                        ${escapeHtml(title)}
                        <span class="aem-count-badge">${total}</span>
                    </div>
                    <div class="aem-article-body is-collapsed">`;

                // ── tsOverride 記錄（新格式）──
                Object.keys(tsEntries).sort((a, b) => Number(a) - Number(b)).forEach(idx => {
                    const ov = tsEntries[idx];
                    const shortSent = ov.sentence.length > 55
                        ? ov.sentence.substring(0, 55) + '…' : ov.sentence;
                    const startDiff = (ov.start - ov.originalStart).toFixed(3);
                    const endDiff   = (ov.end   - ov.originalEnd  ).toFixed(3);
                    const startSign = startDiff >= 0 ? '+' : '';
                    const endSign   = endDiff   >= 0 ? '+' : '';
                    const hasTextChange = ov.sentence !== ov.originalSentence;
                    const hasTimeChange = Number(startDiff) !== 0 || Number(endDiff) !== 0;

                    html += `<div class="aem-row aem-row--ts"
                        data-title="${escapeAttr(title)}"
                        data-idx="${escapeAttr(idx)}"
                        data-sentence="${escapeAttr(ov.originalSentence)}">
                        <div class="aem-row-sentence" title="${escapeAttr(ov.originalSentence)}">
                            ${hasTextChange ? '📝 ' : ''}${escapeHtml(shortSent)}
                        </div>
                        <div class="aem-row-meta">
                            ${hasTextChange ? `<span class="aem-text-changed">文字已修改</span>` : ''}
                            ${hasTimeChange ? `<span class="aem-timing">START ${startSign}${startDiff}s | END ${endSign}${endDiff}s</span>` : ''}
                            <span class="aem-date">${ov.updatedAt || ''}</span>
                        </div>
                        <div class="aem-row-actions">
                            <button class="aem-ts-edit-btn secondary">✏️ 重新編輯</button>
                            <button class="aem-ts-delete-btn secondary">🗑 刪除</button>
                        </div>
                    </div>`;
                });

                // ── audioAdjustments 記錄（舊格式）──
                Object.keys(adjEntries).forEach(sentence => {
                    const entry = adjEntries[sentence];
                    const startDiff = (entry.start - entry.originalStart).toFixed(1);
                    const endDiff   = (entry.end   - entry.originalEnd  ).toFixed(1);
                    const startSign = startDiff >= 0 ? '+' : '';
                    const endSign   = endDiff   >= 0 ? '+' : '';
                    const shortSent = sentence.length > 55 ? sentence.substring(0, 55) + '…' : sentence;

                    html += `<div class="aem-row"
                        data-title="${escapeAttr(title)}"
                        data-sentence="${escapeAttr(sentence)}">
                        <div class="aem-row-sentence" title="${escapeAttr(sentence)}">${escapeHtml(shortSent)}</div>
                        <div class="aem-row-meta">
                            <span class="aem-timing">START ${startSign}${startDiff}s | END ${endSign}${endDiff}s</span>
                            <span class="aem-date">${entry.updatedAt || ''}</span>
                        </div>
                        <div class="aem-row-actions">
                            <button class="aem-edit-btn secondary">✏️ 重新編輯</button>
                            <button class="aem-delete-btn secondary">🗑 刪除</button>
                        </div>
                    </div>`;
                });

                html += `</div></div>`; // aem-article-body / aem-article-group
            });

            html += `</div></div>`; // aem-sub-body / aem-sub-group
        });
        html += `</div></div>`; // aem-major-body / aem-major-group
    });

    listEl.innerHTML = html;

    // ── 折疊/展開 ──────────────────────────────────────────────
    listEl.querySelectorAll('.aem-collapsible').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            const isExpanded = header.classList.toggle('is-expanded');
            const body = header.nextElementSibling;
            if (body) body.classList.toggle('is-collapsed', !isExpanded);
        });
    });

    // ── tsOverride 的 Edit / Delete ────────────────────────────
    listEl.querySelectorAll('.aem-ts-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const row   = btn.closest('.aem-row--ts');
            const title = row.dataset.title;
            const idx   = parseInt(row.dataset.idx, 10);
            const ov    = (loadTsOverride()[title] || {})[String(idx)];
            if (!ov) return;
            openTsEditor({
                title, index: idx,
                sentence: ov.sentence,
                start: ov.start, end: ov.end,
                audioSrc: `audio/${encodeURIComponent(title.trim())}.mp3`,
                onSave: () => renderAudioEditorManager()
            });
        });
    });
    listEl.querySelectorAll('.aem-ts-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const row   = btn.closest('.aem-row--ts');
            const title = row.dataset.title;
            const idx   = row.dataset.idx;
            const sentence = (loadTsOverride()[title] || {})[idx]?.sentence || '';
            if (confirm(`刪除此修改，將恢復使用原始 timestamp。\n\n"${sentence.substring(0, 80)}"`)) {
                deleteTsOverride(title, idx);
                showNotification('已刪除修改記錄', 'success');
                renderAudioEditorManager();
            }
        });
    });

    // ── audioAdjustments 的 Edit / Delete ─────────────────────
    listEl.querySelectorAll('.aem-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const row      = btn.closest('.aem-row');
            const title    = row.dataset.title;
            const sentence = row.dataset.sentence;
            const entry    = (loadAudioAdjustments()[title] || {})[sentence];
            if (!entry) return;
            const audioSrc = `audio/${encodeURIComponent(title.trim())}.mp3`;
            openAudioEditor({
                title, sentence,
                start:    entry.originalStart,
                end:      entry.originalEnd,
                audioSrc,
                player:   new Audio(audioSrc),
                onSave:   () => renderAudioEditorManager()
            });
        });
    });
    listEl.querySelectorAll('.aem-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const row      = btn.closest('.aem-row');
            const title    = row.dataset.title;
            const sentence = row.dataset.sentence;
            if (confirm(`刪除此調整記錄，將恢復使用原始 timestamp。\n\n"${sentence.substring(0, 80)}"`)) {
                deleteAudioAdjustment(title, sentence);
                showNotification('已刪除調整記錄', 'success');
                renderAudioEditorManager();
            }
        });
    });
}

// ══════════════════════════════════════════════════════════════
//  匯出 Timestamp .txt
//  把某篇文章的 tsOverride 套用至原始 timestamp，匯出成 .txt
// ══════════════════════════════════════════════════════════════

/**
 * 將秒數轉成 [HH:MM:SS.mmm] 格式字串
 */
function _secondsToTimestamp(sec) {
    const h   = Math.floor(sec / 3600);
    const m   = Math.floor((sec % 3600) / 60);
    const s   = Math.floor(sec % 60);
    const ms  = Math.round((sec % 1) * 1000);
    const pad2 = n => String(n).padStart(2, '0');
    const pad3 = n => String(n).padStart(3, '0');
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
}

/**
 * 匯出指定文章的修改後 timestamp .txt
 * @param {string} title
 * @param {Array}  originalData  原始 timestampData（若未傳入，會 fetch GitHub 版）
 */
async function exportTimestampTxt(title, originalData) {
    let data = originalData;

    // 若沒有傳入原始資料，先 fetch GitHub 版
    if (!data) {
        const url = `https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/audio/${encodeURIComponent(title.trim())} Timestamp.txt`;
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('無法取得 GitHub 原始 Timestamp');
            const text = await resp.text();
            if (typeof parseTimestampText === 'function') {
                data = parseTimestampText(text);
            } else {
                showNotification('無法解析 Timestamp 格式', 'error');
                return;
            }
        } catch (err) {
            showNotification('匯出失敗：' + err.message, 'error');
            return;
        }
    }

    // 套用 override
    const applied = applyTsOverride(title, data);

    // 轉成 .txt 格式
    const lines = applied.map(line =>
        `[${_secondsToTimestamp(line.start)} --> ${_secondsToTimestamp(line.end)}] ${line.sentence}`
    );
    const content = lines.join('\n');

    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${title.trim()} Timestamp.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification(`✓ 已匯出「${title}」的修改版 Timestamp`, 'success');
}

// ══════════════════════════════════════════════════════════════
//  比對 GitHub 版 vs localStorage 版
// ══════════════════════════════════════════════════════════════

let _compareState = { title: null, githubData: null };

/**
 * 開啟比對視窗，比對 tsOverride 與 GitHub 原始版
 * @param {string} title
 */
async function openTsCompare(title) {
    const modal = document.getElementById('ts-compare-modal');
    if (!modal) return;
    const body = modal.querySelector('.ts-compare-body');
    if (!body) return;

    body.innerHTML = '<p class="ts-compare-loading">📡 正在下載 GitHub 原始版本…</p>';
    modal.classList.remove('is-hidden');

    const url = `https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/audio/${encodeURIComponent(title.trim())} Timestamp.txt`;
    let githubData;
    try {
        const resp = await fetch(url + '?nocache=' + Date.now());
        if (!resp.ok) throw new Error('GitHub 無法取得此文章的 Timestamp 檔');
        const text = await resp.text();
        if (typeof parseTimestampText !== 'function') throw new Error('parseTimestampText 函數不存在');
        githubData = parseTimestampText(text);
    } catch (err) {
        body.innerHTML = `<p class="ts-compare-error">❌ ${escapeHtml(err.message)}</p>`;
        return;
    }

    _compareState = { title, githubData };
    const overrides = getTsOverrideForTitle(title);

    // 逐句比對，只顯示有差異的句子（overrides）
    const diffItems = Object.keys(overrides).map(idx => {
        const ov       = overrides[idx];
        const ghLine   = githubData[Number(idx)];
        const ghSent   = ghLine ? ghLine.sentence : '（找不到對應行）';
        const ghStart  = ghLine ? ghLine.start : null;
        const ghEnd    = ghLine ? ghLine.end   : null;

        const textSame  = ov.sentence === ghSent;
        const startSame = ghStart !== null && Math.abs(ov.start - ghStart) < 0.002;
        const endSame   = ghEnd   !== null && Math.abs(ov.end   - ghEnd  ) < 0.002;
        const allSame   = textSame && startSame && endSame;

        return { idx: Number(idx), ov, ghSent, ghStart, ghEnd, textSame, startSame, endSame, allSame };
    }).sort((a, b) => a.idx - b.idx);

    if (diffItems.length === 0) {
        body.innerHTML = '<p class="ts-compare-all-same">✅ 目前沒有任何 localStorage 修改記錄。</p>';
        return;
    }

    const allSynced = diffItems.every(d => d.allSame);

    let html = `
        <p class="ts-compare-hint">
            ${allSynced
                ? '✅ 所有修改與 GitHub 版本完全一致，可安全清除暫存記錄。'
                : '⚠️ 以下句子的暫存版與 GitHub 版本有差異。確認已上傳後，勾選並清除。'}
        </p>
        <div class="ts-compare-actions-top">
            <button id="ts-compare-check-all" class="secondary">全選相同</button>
            <button id="ts-compare-clear-checked" class="ts-compare-clear-btn">清除已勾選</button>
        </div>
        <div class="ts-compare-list">
    `;

    diffItems.forEach(d => {
        const statusIcon = d.allSame ? '✅' : '⚠️';
        const checked    = d.allSame ? 'checked' : '';
        html += `
        <div class="ts-compare-item ${d.allSame ? 'is-same' : 'is-diff'}" data-idx="${d.idx}">
            <label class="ts-compare-checkbox-label">
                <input type="checkbox" class="ts-compare-checkbox" ${checked}> ${statusIcon} 第 ${d.idx + 1} 句
            </label>
            <div class="ts-compare-detail">
                <div class="ts-compare-row">
                    <span class="ts-compare-tag github">GitHub</span>
                    <span>${escapeHtml(d.ghSent)}</span>
                    ${d.ghStart !== null ? `<span class="ts-compare-time">[${d.ghStart.toFixed(3)}s → ${d.ghEnd.toFixed(3)}s]</span>` : ''}
                </div>
                <div class="ts-compare-row ${d.allSame ? '' : 'is-modified'}">
                    <span class="ts-compare-tag local">暫存</span>
                    <span>${escapeHtml(d.ov.sentence)}</span>
                    <span class="ts-compare-time">[${d.ov.start.toFixed(3)}s → ${d.ov.end.toFixed(3)}s]</span>
                </div>
            </div>
        </div>`;
    });

    html += `</div>`;
    body.innerHTML = html;

    // 全選相同
    body.querySelector('#ts-compare-check-all')?.addEventListener('click', () => {
        body.querySelectorAll('.ts-compare-item.is-same .ts-compare-checkbox').forEach(cb => { cb.checked = true; });
    });

    // 清除已勾選
    body.querySelector('#ts-compare-clear-checked')?.addEventListener('click', () => {
        const checked = body.querySelectorAll('.ts-compare-checkbox:checked');
        if (checked.length === 0) { showNotification('請先勾選要清除的項目', 'warning'); return; }
        if (!confirm(`確定清除 ${checked.length} 筆已勾選的暫存記錄？`)) return;
        checked.forEach(cb => {
            const item = cb.closest('.ts-compare-item');
            const idx  = item?.dataset.idx;
            if (idx !== undefined) deleteTsOverride(_compareState.title, idx);
        });
        showNotification(`✓ 已清除 ${checked.length} 筆暫存記錄`, 'success');
        closeTsCompare();
        renderAudioEditorManager();
    });
}

function closeTsCompare() {
    const modal = document.getElementById('ts-compare-modal');
    if (modal) modal.classList.add('is-hidden');
}

// ── 匯出 / 匯入 / 清除（舊版 audio adjustments，保留功能）──────

function clearAllAudioAdjustments() {
    const adj = loadAudioAdjustments();
    const tsOv = loadTsOverride();
    let totalEntries = 0;
    Object.values(adj).forEach(t => { totalEntries += Object.keys(t).length; });
    Object.values(tsOv).forEach(t => { totalEntries += Object.keys(t).length; });

    if (totalEntries === 0) {
        showNotification('目前沒有任何調整記錄', 'info');
        return;
    }
    if (!confirm(`確定要清除全部 ${totalEntries} 筆調整記錄嗎？\n（包含文字修改與時間調整，此操作無法復原，建議先匯出備份）`)) return;

    saveAudioAdjustments({});
    saveTsOverride({});

    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ audioAdjustments: {}, tsOverride: {} }, { merge: true })
          .catch(err => console.error('[TSEditor] Firebase clear-all error:', err));
    }
    showNotification(`✓ 已清除全部 ${totalEntries} 筆調整記錄`, 'success');
    renderAudioEditorManager();
}

function exportAudioAdjustments() {
    const adj  = loadAudioAdjustments();
    const tsOv = loadTsOverride();
    let total = 0;
    Object.values(adj).forEach(t => { total += Object.keys(t).length; });
    Object.values(tsOv).forEach(t => { total += Object.keys(t).length; });
    if (total === 0) { showNotification('目前沒有任何調整記錄可匯出', 'warning'); return; }

    const payload = {
        type: 'timestampEditorBackup',
        version: '2.0',
        exportDate: new Date().toISOString(),
        stats: { total },
        audioAdjustments: adj,
        tsOverride: tsOv
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `timestamp-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showNotification(`✓ 已匯出 ${total} 筆調整記錄`, 'success');
}

function importAudioAdjustments(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            let added = 0;

            // 支援新格式（v2）與舊格式
            if (data.type === 'timestampEditorBackup' && data.tsOverride) {
                const existing = loadTsOverride();
                Object.keys(data.tsOverride).forEach(title => {
                    if (!existing[title]) existing[title] = {};
                    Object.keys(data.tsOverride[title]).forEach(idx => {
                        if (!existing[title][idx]) { existing[title][idx] = data.tsOverride[title][idx]; added++; }
                    });
                });
                saveTsOverride(existing);
            }
            if (data.adjustments || data.audioAdjustments) {
                const incoming = data.adjustments || data.audioAdjustments;
                const existing = loadAudioAdjustments();
                Object.keys(incoming).forEach(title => {
                    if (!existing[title]) existing[title] = {};
                    Object.keys(incoming[title]).forEach(sentence => {
                        if (!existing[title][sentence]) { existing[title][sentence] = incoming[title][sentence]; added++; }
                    });
                });
                saveAudioAdjustments(existing);
            }

            renderAudioEditorManager();
            showNotification(added > 0 ? `✓ 已匯入 ${added} 筆記錄` : '所有記錄已存在，無需匯入', added > 0 ? 'success' : 'info');
        } catch (err) {
            showNotification('匯入失敗：' + err.message, 'error');
        }
    };
    reader.readAsText(file);
}

// ── DOM 初始化 ─────────────────────────────────────────────────
const _aemExportBtn   = document.getElementById('aem-export-btn');
const _aemClearAllBtn = document.getElementById('aem-clear-all-btn');
const _aemImportBtn   = document.getElementById('aem-import-btn');
const _aemImportInput = document.getElementById('aem-import-input');

if (_aemExportBtn)   _aemExportBtn.addEventListener('click', exportAudioAdjustments);
if (_aemClearAllBtn) _aemClearAllBtn.addEventListener('click', clearAllAudioAdjustments);
if (_aemImportBtn && _aemImportInput) {
    _aemImportBtn.addEventListener('click', () => _aemImportInput.click());
    _aemImportInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importAudioAdjustments(file);
        e.target.value = '';
    });
}

// 舊 audio-editor-modal 背景點擊關閉
const _oldModal = document.getElementById('audio-editor-modal');
if (_oldModal) {
    _oldModal.addEventListener('click', (e) => { if (e.target === _oldModal) closeAudioEditor(); });
}

// 新 ts-editor-modal 背景點擊關閉
const _tsModal = document.getElementById('ts-editor-modal');
if (_tsModal) {
    _tsModal.addEventListener('click', (e) => { if (e.target === _tsModal) closeTsEditor(); });
}

// ts-compare-modal
const _tsCompareModal = document.getElementById('ts-compare-modal');
if (_tsCompareModal) {
    _tsCompareModal.addEventListener('click', (e) => { if (e.target === _tsCompareModal) closeTsCompare(); });
}
const _tsCompareCloseBtn = document.getElementById('ts-compare-close-btn');
if (_tsCompareCloseBtn) _tsCompareCloseBtn.addEventListener('click', closeTsCompare);

console.log('✅ Timestamp Editor loaded (replaces audio-editor.js).');

// ══════════════════════════════════════════════════════════════
//  勾選式文章選擇器 Dialog
//  供「匯出 Timestamp」與「比對 GitHub」共用
//  opts:
//    titles       string[]     — 可選的文章標題清單
//    heading      string       — dialog 標題文字
//    confirmLabel string       — 確認按鈕文字（「匯出」/「比對」）
//    singleSelect boolean      — true = 單選模式（比對用）
//    onConfirm    fn(selected) — 確認後呼叫，傳入勾選的 title 陣列
// ══════════════════════════════════════════════════════════════
function showTsPickerDialog({ titles, heading, confirmLabel, singleSelect = false, onConfirm }) {
    // 若已有舊 dialog 先移除
    const old = document.getElementById('ts-picker-dialog');
    if (old) old.remove();

    // ── 計算每篇的修改筆數 ──────────────────────────────────────
    const tsOv = loadTsOverride();

    // ── 建立 overlay ────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = 'ts-picker-dialog';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:9999;
        background:rgba(0,0,0,.45);
        display:flex;align-items:center;justify-content:center;
        padding:16px;
    `;

    const box = document.createElement('div');
    box.style.cssText = `
        background:var(--color-surface, #fff);
        border-radius:14px;
        padding:24px 20px 20px;
        width:100%;max-width:420px;
        max-height:80vh;
        display:flex;flex-direction:column;
        box-shadow:0 8px 32px rgba(0,0,0,.18);
    `;

    // 標題列
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;';
    header.innerHTML = `
        <span style="font-weight:700;font-size:1.05em;">${heading}</span>
        <button id="ts-picker-close" style="background:none;border:none;font-size:1.3em;cursor:pointer;line-height:1;">✕</button>
    `;

    // 全選 / 取消全選（多選模式才顯示）
    let selectAllRow = null;
    if (!singleSelect) {
        selectAllRow = document.createElement('div');
        selectAllRow.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
        selectAllRow.innerHTML = `
            <button id="ts-picker-all" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--color-border,#ddd);background:var(--color-bg,#f5f5f5);cursor:pointer;font-size:.88em;">全選</button>
            <button id="ts-picker-none" style="flex:1;padding:6px;border-radius:8px;border:1px solid var(--color-border,#ddd);background:var(--color-bg,#f5f5f5);cursor:pointer;font-size:.88em;">取消全選</button>
        `;
    }

    // 文章清單（可捲動）
    const listWrap = document.createElement('div');
    listWrap.style.cssText = 'overflow-y:auto;flex:1;margin-bottom:16px;display:flex;flex-direction:column;gap:6px;';

    titles.forEach((t, i) => {
        const entryCount = Object.keys(tsOv[t] || {}).length;
        const row = document.createElement('label');
        row.style.cssText = `
            display:flex;align-items:center;gap:10px;
            padding:10px 12px;border-radius:10px;
            background:var(--color-bg,#f9f9f9);
            cursor:pointer;border:1.5px solid transparent;
            transition:border-color .15s;
        `;
        row.dataset.title = t;

        const input = document.createElement('input');
        input.type = singleSelect ? 'radio' : 'checkbox';
        input.name = 'ts-picker-item';
        input.value = t;
        input.style.cssText = 'width:16px;height:16px;flex-shrink:0;accent-color:var(--color-primary,#4a7c59);';

        const label = document.createElement('span');
        label.style.cssText = 'flex:1;font-size:.93em;line-height:1.3;';
        label.textContent = t;

        const badge = document.createElement('span');
        badge.style.cssText = `
            font-size:.78em;padding:2px 7px;border-radius:20px;
            background:var(--color-primary-light,#e8f5e9);
            color:var(--color-primary,#4a7c59);white-space:nowrap;flex-shrink:0;
        `;
        badge.textContent = `${entryCount} 筆`;

        input.addEventListener('change', () => {
            row.style.borderColor = input.checked ? 'var(--color-primary,#4a7c59)' : 'transparent';
        });

        row.append(input, label, badge);
        listWrap.appendChild(row);
    });

    // 底部按鈕
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    footer.innerHTML = `
        <button id="ts-picker-cancel" style="padding:9px 20px;border-radius:9px;border:1px solid var(--color-border,#ddd);background:none;cursor:pointer;">取消</button>
        <button id="ts-picker-confirm" style="padding:9px 20px;border-radius:9px;border:none;background:var(--color-primary,#4a7c59);color:#fff;font-weight:600;cursor:pointer;">${confirmLabel}</button>
    `;

    // 組裝
    box.append(header);
    if (selectAllRow) box.append(selectAllRow);
    box.append(listWrap, footer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // ── 事件 ────────────────────────────────────────────────────
    const close = () => overlay.remove();

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    box.querySelector('#ts-picker-close').addEventListener('click', close);
    box.querySelector('#ts-picker-cancel').addEventListener('click', close);

    if (!singleSelect) {
        box.querySelector('#ts-picker-all').addEventListener('click', () => {
            listWrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
                cb.checked = true;
                cb.closest('label').style.borderColor = 'var(--color-primary,#4a7c59)';
            });
        });
        box.querySelector('#ts-picker-none').addEventListener('click', () => {
            listWrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
                cb.checked = false;
                cb.closest('label').style.borderColor = 'transparent';
            });
        });
    }

    box.querySelector('#ts-picker-confirm').addEventListener('click', () => {
        const selected = [...listWrap.querySelectorAll('input:checked')].map(cb => cb.value);
        if (selected.length === 0) {
            if (typeof showNotification === 'function') showNotification('請至少勾選一篇文章', 'warning');
            return;
        }
        close();
        onConfirm(selected);
    });
}
