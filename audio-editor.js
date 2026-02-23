// ============================================================
//  AUDIO EDITOR — audio-editor.js
//  音檔時間軸微調系統
//  - 編輯彈窗：±0.1s / ±0.5s 微調 start/end + 試聽
//  - 資料層：独立 adjustments 表（localStorage + Firebase）
//  - 總編輯器：首頁入口，管理所有調整記錄
//  - 整合點：Quiz 各題播放按鈕旁 ✏️、Note 句子播放旁 ✏️
// ============================================================

const AUDIO_ADJ_KEY = 'audioAdjustments';

// ── 資料層 ────────────────────────────────────────────────────

function loadAudioAdjustments() {
    try {
        return JSON.parse(localStorage.getItem(AUDIO_ADJ_KEY) || '{}');
    } catch (e) { return {}; }
}

function saveAudioAdjustments(data) {
    localStorage.setItem(AUDIO_ADJ_KEY, JSON.stringify(data));
    // 同步 Firebase
    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ audioAdjustments: data }, { merge: true })
          .catch(err => console.error('[AudioEditor] Firebase save error:', err));
    }
}

/**
 * 取得某句子的調整後時間，若無調整則回傳原始值
 * @param {string} title  文章標題
 * @param {string} sentence  句子文字
 * @param {number} originalStart
 * @param {number} originalEnd
 * @returns {{ start: number, end: number, isAdjusted: boolean }}
 */
function getAdjustedTiming(title, sentence, originalStart, originalEnd) {
    const adj = loadAudioAdjustments();
    const entry = adj[title]?.[sentence];
    if (entry) {
        return { start: entry.start, end: entry.end, isAdjusted: true };
    }
    return { start: originalStart, end: originalEnd, isAdjusted: false };
}

/**
 * 儲存一筆調整記錄
 */
function setAudioAdjustment(title, sentence, newStart, newEnd, originalStart, originalEnd) {
    const adj = loadAudioAdjustments();
    if (!adj[title]) adj[title] = {};
    adj[title][sentence] = {
        start: Math.round(newStart * 10) / 10,
        end:   Math.round(newEnd   * 10) / 10,
        originalStart,
        originalEnd,
        updatedAt: new Date().toLocaleDateString()
    };
    saveAudioAdjustments(adj);
}

/**
 * 刪除調整記錄（恢復原始 timestamp）
 */
function deleteAudioAdjustment(title, sentence) {
    const adj = loadAudioAdjustments();
    if (adj[title]) {
        delete adj[title][sentence];
        if (Object.keys(adj[title]).length === 0) delete adj[title];
    }
    saveAudioAdjustments(adj);
}

// 從 Firestore 載入（登入後呼叫）
async function loadAudioAdjustmentsFromFirestore() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    try {
        const doc = await db.collection('userNotes').doc(currentUser.uid).get();
        if (doc.exists && doc.data().audioAdjustments) {
            localStorage.setItem(AUDIO_ADJ_KEY, JSON.stringify(doc.data().audioAdjustments));
        }
    } catch (e) {
        console.error('[AudioEditor] Firestore load error:', e);
    }
}

// ── 編輯彈窗 ──────────────────────────────────────────────────

let _editorState = {
    title: null,
    sentence: null,
    start: 0,
    end: 0,
    originalStart: 0,
    originalEnd: 0,
    audioSrc: null,
    onSave: null,       // callback(newStart, newEnd)
    player: null,       // Audio 物件
};

let _editorSnippetTimer = null;

/**
 * 開啟音檔編輯器彈窗
 * @param {object} opts
 *   title        文章標題
 *   sentence     句子文字
 *   start        原始 start（秒）
 *   end          原始 end（秒）
 *   audioSrc     mp3 路徑
 *   player       Audio 物件（可複用 quizAudioPlayer / noteAudioPlayer）
 *   onSave       存檔後 callback(newStart, newEnd)
 */
function openAudioEditor({ title, sentence, start, end, audioSrc, player, onSave }) {
    // 取得已有調整（如果有的話，以調整值為基礎）
    const adj = loadAudioAdjustments();
    const existing = adj[title]?.[sentence];

    _editorState = {
        title,
        sentence,
        start:         existing ? existing.start         : start,
        end:           existing ? existing.end           : end,
        originalStart: existing ? existing.originalStart : start,
        originalEnd:   existing ? existing.originalEnd   : end,
        audioSrc,
        onSave,
        player: player || new Audio(),
    };

    _renderEditorModal();
    document.getElementById('audio-editor-modal').classList.remove('is-hidden');
    _updateEditorDisplay();
}

function closeAudioEditor() {
    const modal = document.getElementById('audio-editor-modal');
    modal.classList.add('is-hidden');
    // 停止試聽
    _stopEditorPreview();
}

function _stopEditorPreview() {
    if (_editorSnippetTimer) {
        clearTimeout(_editorSnippetTimer);
        _editorSnippetTimer = null;
    }
    if (_editorState.player) {
        _editorState.player.pause();
    }
}

function _renderEditorModal() {
    const modal = document.getElementById('audio-editor-modal');
    const box   = modal.querySelector('.audio-editor-box');

    // 截短句子顯示
    const shortSentence = _editorState.sentence.length > 60
        ? _editorState.sentence.substring(0, 60) + '…'
        : _editorState.sentence;

    box.innerHTML = `
        <div class="audio-editor-header">
            <span class="audio-editor-icon">✏️</span>
            <span class="audio-editor-title">調整音檔時間</span>
            <button class="audio-editor-close-btn" id="audio-editor-close">✕</button>
        </div>

        <div class="audio-editor-sentence">"${shortSentence}"</div>

        <div class="audio-editor-row">
            <span class="audio-editor-label">START</span>
            <button class="audio-adj-btn" data-target="start" data-delta="-0.5">−0.5s</button>
            <button class="audio-adj-btn" data-target="start" data-delta="-0.1">−0.1s</button>
            <span class="audio-editor-value" id="editor-start-val">0.0s</span>
            <button class="audio-adj-btn" data-target="start" data-delta="0.1">+0.1s</button>
            <button class="audio-adj-btn" data-target="start" data-delta="0.5">+0.5s</button>
        </div>

        <div class="audio-editor-row">
            <span class="audio-editor-label">END</span>
            <button class="audio-adj-btn" data-target="end" data-delta="-0.5">−0.5s</button>
            <button class="audio-adj-btn" data-target="end" data-delta="-0.1">−0.1s</button>
            <span class="audio-editor-value" id="editor-end-val">0.0s</span>
            <button class="audio-adj-btn" data-target="end" data-delta="0.1">+0.1s</button>
            <button class="audio-adj-btn" data-target="end" data-delta="0.5">+0.5s</button>
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

    // 事件綁定
    box.querySelector('#audio-editor-close').addEventListener('click', closeAudioEditor);
    box.querySelector('#audio-editor-cancel-btn').addEventListener('click', closeAudioEditor);

    // 調整按鈕
    box.querySelectorAll('.audio-adj-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.target;   // 'start' | 'end'
            const delta  = parseFloat(btn.dataset.delta);
            _editorState[target] = Math.round((_editorState[target] + delta) * 10) / 10;
            // start 不能 < 0，end 不能 <= start
            if (_editorState.start < 0) _editorState.start = 0;
            if (_editorState.end <= _editorState.start) {
                _editorState.end = Math.round((_editorState.start + 0.5) * 10) / 10;
            }
            _updateEditorDisplay();
        });
    });

    // 試聽
    box.querySelector('#audio-editor-preview-btn').addEventListener('click', () => {
        _playEditorPreview();
    });

    // 還原預設
    box.querySelector('#audio-editor-reset-btn').addEventListener('click', () => {
        _editorState.start = _editorState.originalStart;
        _editorState.end   = _editorState.originalEnd;
        _updateEditorDisplay();
        _stopEditorPreview();
    });

    // 儲存
    box.querySelector('#audio-editor-save-btn').addEventListener('click', () => {
        _stopEditorPreview();
        setAudioAdjustment(
            _editorState.title,
            _editorState.sentence,
            _editorState.start,
            _editorState.end,
            _editorState.originalStart,
            _editorState.originalEnd
        );
        showNotification('✓ 音檔時間已儲存', 'success');

        // 存檔後自動試聽一次，然後呼叫 onSave
        const onSaveCb = _editorState.onSave;
        closeAudioEditor();

        // 延遲 200ms 讓 modal 關閉動畫完成，再自動試聽並呼叫 callback
        setTimeout(() => {
            if (onSaveCb) onSaveCb(_editorState.start, _editorState.end);
        }, 200);
    });
}

function _updateEditorDisplay() {
    const startEl    = document.getElementById('editor-start-val');
    const endEl      = document.getElementById('editor-end-val');
    const durationEl = document.getElementById('editor-duration');
    if (!startEl) return;

    startEl.textContent    = _editorState.start.toFixed(1) + 's';
    endEl.textContent      = _editorState.end.toFixed(1) + 's';
    const dur = (_editorState.end - _editorState.start).toFixed(1);
    durationEl.textContent = `Duration: ${dur}s`;

    // 標示有沒有異動
    const changed = _editorState.start !== _editorState.originalStart ||
                    _editorState.end   !== _editorState.originalEnd;
    durationEl.style.color = changed ? 'var(--color-accent)' : 'var(--color-text-light)';
}

function _playEditorPreview() {
    _stopEditorPreview();

    const player  = _editorState.player;
    const src     = _editorState.audioSrc;
    const start   = _editorState.start;
    const end     = _editorState.end;
    const previewBtn = document.getElementById('audio-editor-preview-btn');

    if (!src || end <= start) {
        showNotification('無法試聽：時間設定無效', 'warning');
        return;
    }

    // 確保 src 正確
    const targetFilename = src.split('/').pop();
    const currentFilename = decodeURIComponent(player.src.split('/').pop() || '');
    if (currentFilename !== decodeURIComponent(targetFilename)) {
        player.src = src;
        player.load();
    }

    const isMobile = typeof isMobileDevice === 'function' && isMobileDevice();
    const bufStart = isMobile ? 0.25 : 0.1;
    const trailMs  = isMobile ? 1000 : 800;

    player.currentTime = Math.max(0, start - bufStart);

    if (previewBtn) {
        previewBtn.textContent = '⏸ 播放中…';
        previewBtn.disabled = true;
    }

    player.play().then(() => {
        const playMs = (end - start) * 1000 + trailMs;
        _editorSnippetTimer = setTimeout(() => {
            player.pause();
            if (previewBtn) {
                previewBtn.textContent = '▶ 試聽';
                previewBtn.disabled = false;
            }
            _editorSnippetTimer = null;
        }, playMs);
    }).catch(() => {
        if (previewBtn) {
            previewBtn.textContent = '▶ 試聽';
            previewBtn.disabled = false;
        }
    });
}

// ── 總編輯器（Audio Editor Manager）────────────────────────────

function openAudioEditorManager() {
    renderAudioEditorManager();
    showView(document.getElementById('audio-editor-manager-view'));
}

/**
 * 從 stories（官方）或 loadCustomArticles()（自訂）查找某 title 的大類和子類。
 * 都找不到才歸入「其他 → 其他」。
 * @returns {{ major: string, sub: string }}
 */
function _getStoryCategory(title) {
    const normalised = title.trim().toLowerCase();

    // 1. 先查官方 stories
    if (typeof stories !== 'undefined' && Array.isArray(stories)) {
        const story = stories.find(s =>
            (s['標題'] || '').trim().toLowerCase() === normalised
        );
        if (story) {
            const major = story['大類'] || '其他';
            const sub   = (Array.isArray(story['分類']) ? story['分類'][0] : story['分類']) || '其他';
            return { major, sub };
        }
    }

    // 2. 再查自訂文章（有 major / category 欄位）
    if (typeof loadCustomArticles === 'function') {
        const custom = loadCustomArticles().find(a =>
            (a.title || '').trim().toLowerCase() === normalised ||
            (a.slug  || '').trim().toLowerCase() === normalised
        );
        if (custom) {
            const major = custom.major    || '其他';
            const sub   = custom.category || '其他';
            return { major, sub };
        }
    }

    // 3. 完全無法對應
    return { major: '其他', sub: '其他' };
}

function renderAudioEditorManager() {
    const listEl = document.getElementById('audio-editor-manager-list');
    if (!listEl) return;

    const adj = loadAudioAdjustments();
    const allTitles = Object.keys(adj);

    if (allTitles.length === 0) {
        listEl.innerHTML = `<div class="aem-empty">尚無調整記錄。<br>在測驗或 Note 中按 <strong>✏️</strong> 即可調整音檔時間。</div>`;
        return;
    }

    // 統計總筆數
    let totalCount = 0;
    allTitles.forEach(t => { totalCount += Object.keys(adj[t]).length; });
    document.getElementById('aem-total-count').textContent = `共 ${totalCount} 筆調整`;

    // ── 建立 大類 → 子類 → [title] 的巢狀結構 ──────────────────
    // grouped = { major: { sub: [title, ...] } }
    const grouped = {};
    allTitles.forEach(title => {
        const { major, sub } = _getStoryCategory(title);
        if (!grouped[major]) grouped[major] = {};
        if (!grouped[major][sub]) grouped[major][sub] = [];
        grouped[major][sub].push(title);
    });

    // 大類排序：「其他」永遠最後
    const majorKeys = Object.keys(grouped).sort((a, b) => {
        if (a === '其他') return 1;
        if (b === '其他') return -1;
        return a.localeCompare(b);
    });

    // ── 產生 HTML ──────────────────────────────────────────────
    let html = '';

    majorKeys.forEach(major => {
        // 計算此大類下的總筆數
        let majorCount = 0;
        Object.values(grouped[major]).forEach(titles =>
            titles.forEach(t => { majorCount += Object.keys(adj[t]).length; })
        );

        html += `
        <div class="aem-major-group" data-major="${escapeAttr(major)}">
            <div class="aem-major-header aem-collapsible is-expanded">
                <span class="aem-collapse-arrow">▾</span>
                <span class="aem-major-label">${major}</span>
                <span class="aem-count-badge">${majorCount}</span>
            </div>
            <div class="aem-major-body">`;

        const subKeys = Object.keys(grouped[major]).sort((a, b) => {
            if (a === '其他') return 1;
            if (b === '其他') return -1;
            return a.localeCompare(b);
        });

        subKeys.forEach(sub => {
            const titlesInSub = grouped[major][sub].sort();
            let subCount = 0;
            titlesInSub.forEach(t => { subCount += Object.keys(adj[t]).length; });

            html += `
            <div class="aem-sub-group" data-sub="${escapeAttr(sub)}">
                <div class="aem-sub-header aem-collapsible is-expanded">
                    <span class="aem-collapse-arrow">▾</span>
                    <span class="aem-sub-label">${sub}</span>
                    <span class="aem-count-badge aem-count-badge--sub">${subCount}</span>
                </div>
                <div class="aem-sub-body">`;

            titlesInSub.forEach(title => {
                const sentences = Object.keys(adj[title]);
                html += `
                <div class="aem-article-group">
                    <div class="aem-article-title aem-collapsible is-expanded">
                        <span class="aem-collapse-arrow">▾</span>
                        ${title}
                        <span class="aem-count-badge">${sentences.length}</span>
                    </div>
                    <div class="aem-article-body">`;

                sentences.forEach(sentence => {
                    const entry = adj[title][sentence];
                    const startDiff = (entry.start - entry.originalStart).toFixed(1);
                    const endDiff   = (entry.end   - entry.originalEnd  ).toFixed(1);
                    const startSign = startDiff >= 0 ? '+' : '';
                    const endSign   = endDiff   >= 0 ? '+' : '';
                    const shortSent = sentence.length > 55 ? sentence.substring(0, 55) + '…' : sentence;

                    html += `<div class="aem-row" data-title="${escapeAttr(title)}" data-sentence="${escapeAttr(sentence)}">
                        <div class="aem-row-sentence" title="${escapeAttr(sentence)}">${shortSent}</div>
                        <div class="aem-row-meta">
                            <span class="aem-timing">
                                START ${startSign}${startDiff}s &nbsp;|&nbsp; END ${endSign}${endDiff}s
                            </span>
                            <span class="aem-date">${entry.updatedAt || ''}</span>
                        </div>
                        <div class="aem-row-actions">
                            <button class="aem-edit-btn secondary">✏️ 重新編輯</button>
                            <button class="aem-delete-btn secondary">🗑 刪除</button>
                        </div>
                    </div>`;
                });

                html += `</div></div>`; // .aem-article-body / .aem-article-group
            });

            html += `</div></div>`; // .aem-sub-body / .aem-sub-group
        });

        html += `</div></div>`; // .aem-major-body / .aem-major-group
    });

    listEl.innerHTML = html;

    // ── 折疊/展開事件 ──────────────────────────────────────────
    listEl.querySelectorAll('.aem-collapsible').forEach(header => {
        header.addEventListener('click', (e) => {
            // 若點擊來源是內部按鈕（edit/delete），不觸發折疊
            if (e.target.closest('button')) return;
            const isExpanded = header.classList.toggle('is-expanded');
            const body = header.nextElementSibling;
            if (body) body.classList.toggle('is-collapsed', !isExpanded);
        });
    });

    // ── 綁定 Edit / Delete 事件 ────────────────────────────────
    listEl.querySelectorAll('.aem-edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const row      = btn.closest('.aem-row');
            const title    = row.dataset.title;
            const sentence = row.dataset.sentence;
            const entry    = adj[title][sentence];
            const audioSrc = `audio/${encodeURIComponent(title.trim())}.mp3`;

            openAudioEditor({
                title,
                sentence,
                start:    entry.originalStart,
                end:      entry.originalEnd,
                audioSrc,
                player:   new Audio(audioSrc),
                onSave:   () => { renderAudioEditorManager(); }
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
                showNotification('已刪除調整記錄，恢復原始 timestamp', 'success');
                renderAudioEditorManager();
            }
        });
    });
}

function escapeAttr(str) {
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── 匯出 / 匯入 ───────────────────────────────────────────────

/**
 * 匯出所有音檔調整記錄為 JSON 備份檔
 */
function exportAudioAdjustments() {
    const adj = loadAudioAdjustments();
    const totalTitles = Object.keys(adj).length;
    let totalEntries = 0;
    Object.values(adj).forEach(t => { totalEntries += Object.keys(t).length; });

    if (totalEntries === 0) {
        showNotification('目前沒有任何調整記錄可匯出', 'warning');
        return;
    }

    const payload = {
        type: 'audioAdjustments',
        version: '1.0',
        exportDate: new Date().toISOString(),
        stats: { titles: totalTitles, entries: totalEntries },
        adjustments: adj
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `audio-adjustments-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification(`✓ 已匯出 ${totalEntries} 筆調整記錄`, 'success');
}

/**
 * 匯入音檔調整記錄（合併，不覆蓋現有）
 * @param {File} file
 */
function importAudioAdjustments(file) {
    const reader = new FileReader();

    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);

            // 格式驗證
            if (data.type !== 'audioAdjustments' || !data.adjustments) {
                throw new Error('檔案格式不正確，請選擇音檔調整記錄的匯出檔');
            }

            const incoming = data.adjustments;
            const existing = loadAudioAdjustments();

            let addedCount   = 0;
            let skippedCount = 0;

            // 合併策略：existing 優先（不覆蓋已有調整），只新增沒有的條目
            Object.keys(incoming).forEach(title => {
                if (!existing[title]) existing[title] = {};
                Object.keys(incoming[title]).forEach(sentence => {
                    if (existing[title][sentence]) {
                        skippedCount++;
                    } else {
                        existing[title][sentence] = incoming[title][sentence];
                        addedCount++;
                    }
                });
            });

            saveAudioAdjustments(existing);
            renderAudioEditorManager();

            const msg = addedCount > 0
                ? `✓ 已匯入 ${addedCount} 筆新記錄${skippedCount > 0 ? `（跳過 ${skippedCount} 筆重複）` : ''}`
                : `所有 ${skippedCount} 筆記錄已存在，無需匯入`;
            showNotification(msg, addedCount > 0 ? 'success' : 'info');

        } catch (err) {
            showNotification('匯入失敗：' + err.message, 'error');
            console.error('[AudioEditor] Import error:', err);
        }
    };

    reader.readAsText(file);
}

// ── DOM：總編輯器 View 與 Modal 初始化 ───────────────────────────

/**
 * 建立一個 ✏️ 編輯按鈕，接受與播放按鈕相同的 {title, sentence, start, end, player} 資訊
 * 回傳 HTMLButtonElement
 */
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

// ── Quiz 題目：暫停計時後開啟編輯器 ─────────────────────────────

/**
 * 在 quiz 的各題渲染函數中呼叫，取得調整後的 {start, end}
 * 如果有調整記錄就用調整值，否則用原始值
 */
function getQuizTiming(title, sentence, originalStart, originalEnd) {
    return getAdjustedTiming(title, sentence, originalStart, originalEnd);
}

// ── Note 整合：取得試聽用的調整後時間 ────────────────────────────

/**
 * 在 playSentenceSnippet 中呼叫，取得調整後的 start/end
 * 如果無調整則回傳原始值
 */
function getNoteAdjustedTiming(title, sentence, originalStart, originalEnd) {
    return getAdjustedTiming(title, sentence, originalStart, originalEnd);
}

// ── DOM：總編輯器 View 與 Modal 初始化 ───────────────────────────

// ── DOM 初始化 ────────────────────────────────────────────────
// 注意：go-to-audio-editor 和 back-from-audio-editor-manager 的
// 按鈕綁定已移至 story.js，確保執行順序正確。

// 匯出按鈕
const _aemExportBtn = document.getElementById('aem-export-btn');
if (_aemExportBtn) {
    _aemExportBtn.addEventListener('click', exportAudioAdjustments);
}

// 匯入按鈕 → 觸發隱藏 file input
const _aemImportBtn  = document.getElementById('aem-import-btn');
const _aemImportInput = document.getElementById('aem-import-input');
if (_aemImportBtn && _aemImportInput) {
    _aemImportBtn.addEventListener('click', () => _aemImportInput.click());
    _aemImportInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) importAudioAdjustments(file);
        e.target.value = ''; // 允許重複選同一檔案
    });
}

// Modal 背景點擊關閉
const modal = document.getElementById('audio-editor-modal');
if (modal) {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeAudioEditor();
    });
}

console.log('✅ Audio Editor loaded.');
