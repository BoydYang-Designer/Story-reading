/* Data Manager Module */

// ============================================
// Data Manager Functions
// ============================================

function showDataManager() {
    showView(dataManagerView);
    renderDataManager();
}

function renderDataManager() {
    renderReadingProgressEditor();
    renderLastSessionEditor();
}

// ============================================
// Note Export Functions (to be used in note view)
// ============================================

function exportCurrentNote(categoryKey, storyKey) {
    if (!savedWords[categoryKey] || !savedWords[categoryKey][storyKey]) {
        alert('No notes found for this story.');
        return;
    }
    
    let words = savedWords[categoryKey][storyKey];
    
    // Convert Firestore object format to array if needed
    if (words && typeof words === 'object' && !Array.isArray(words)) {
        words = Object.values(words);
    }
    
    if (!Array.isArray(words) || words.length === 0) {
        alert('No notes found for this story.');
        return;
    }
    
    const categorized = categorizeWords(words);
    
    const data = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        category: categoryKey,
        story: storyKey,
        statistics: {
            totalWords: categorized.words.length,
            totalPhrases: categorized.phrases.length,
            totalSentences: categorized.sentences.length,
            total: words.length
        },
        words: categorized.words.map(item => item.word),
        phrases: categorized.phrases.map(item => item.word),
        sentences: categorized.sentences.map(item => item.word),
        allNotes: words
    };
    
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fileName = `${categoryKey}-${storyKey}-notes-${new Date().toISOString().slice(0, 10)}.json`;
    a.download = fileName.replace(/[^a-z0-9.-]/gi, '_');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    alert('Note exported successfully!');
}

function exportAllNotes() {
    // Normalize savedWords to array format
    const normalizedNotes = {};
    let totalCount = 0;
    
    Object.keys(savedWords).forEach(category => {
        normalizedNotes[category] = {};
        Object.keys(savedWords[category]).forEach(story => {
            let words = savedWords[category][story];
            
            // Convert Firestore object format to array if needed
            if (words && typeof words === 'object' && !Array.isArray(words)) {
                words = Object.values(words);
            }
            
            if (Array.isArray(words) && words.length > 0) {
                const categorized = categorizeWords(words);
                normalizedNotes[category][story] = {
                    statistics: {
                        totalWords: categorized.words.length,
                        totalPhrases: categorized.phrases.length,
                        totalSentences: categorized.sentences.length,
                        total: words.length
                    },
                    words: categorized.words.map(item => item.word),
                    phrases: categorized.phrases.map(item => item.word),
                    sentences: categorized.sentences.map(item => item.word),
                    allNotes: words
                };
                totalCount += words.length;
            }
        });
        
        // Remove empty categories
        if (Object.keys(normalizedNotes[category]).length === 0) {
            delete normalizedNotes[category];
        }
    });
    
    if (totalCount === 0) {
        alert('No notes to export.');
        return;
    }
    
    const data = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        totalNotes: totalCount,
        notes: normalizedNotes
    };
    
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-notes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    alert(`Exported ${totalCount} notes successfully!`);
}

// Helper function to categorize words by type (same logic as in note view)
function categorizeWords(words) {
    const categorized = {
        words: [],
        phrases: [],
        sentences: []
    };

    words.forEach((word, index) => {
        // BUG-A08（data-manager）：word 可能為物件（Firestore 格式）
        const rawWord = typeof word === 'string' ? word : (word?.word || String(word));
        const trimmed = rawWord.trim();
        // BUG-08 修正：過濾空字串，避免空白 Note 被誤計入統計
        if (!trimmed) return;

        // BUG-A16 修正：偵測是否含有 CJK 字元（中文/日文/韓文）
        // 若有 CJK 字元，以字元數判斷長短；否則以英文空格分詞數判斷
        const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(trimmed);

        let lengthUnit;
        if (hasCJK) {
            // 中文以字元總數判斷（含夾雜英文）
            // 去除空格後的總字元數
            lengthUnit = trimmed.replace(/\s+/g, '').length;
        } else {
            // 英文以空格分詞數判斷
            lengthUnit = trimmed.split(/\s+/).length;
        }

        if (lengthUnit <= 1) {
            categorized.words.push({ word: trimmed, index });
        } else if (lengthUnit <= 5) {
            categorized.phrases.push({ word: trimmed, index });
        } else {
            categorized.sentences.push({ word: trimmed, index });
        }
    });

    return categorized;
}

/**
 * BUG-A12 修正：以內容而非物件參考去除重複
 * 支援字串格式與物件格式（{ word: '...' }）
 * @param {Array} arr  要去重的陣列
 * @returns {Array}  去重後的陣列
 */
function _deduplicateWords(arr) {
    const map = new Map();
    arr.forEach(item => {
        const key = typeof item === 'string' ? item : (item?.word || JSON.stringify(item));
        if (!map.has(key)) {
            map.set(key, item);
        }
    });
    return [...map.values()];
}

// ============================================
// Reading Progress Editor
// ============================================

function renderReadingProgressEditor() {
    if (!readingProgressEditor) return;
    
    readingProgressEditor.innerHTML = '';
    
    const progressData = localStorage.getItem(SUB_CATEGORY_SESSION_KEY);
    if (!progressData) {
        readingProgressEditor.innerHTML = '<div class="empty-state">No reading progress data.</div>';
        return;
    }
    
    try {
        const progress = JSON.parse(progressData);
        
        if (Object.keys(progress).length === 0) {
            readingProgressEditor.innerHTML = '<div class="empty-state">No reading progress data.</div>';
            return;
        }
        
        Object.keys(progress).forEach(key => {
            const item = document.createElement('div');
            item.className = 'data-item';
            
            const header = document.createElement('div');
            header.className = 'data-item-header';
            header.textContent = key;
            item.appendChild(header);
            
            const content = document.createElement('div');
            content.className = 'data-item-content';
            content.textContent = JSON.stringify(progress[key], null, 2);
            item.appendChild(content);
            
            const actions = document.createElement('div');
            actions.className = 'data-item-actions';
            
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.className = 'secondary';
            deleteBtn.addEventListener('click', () => {
                if (confirm(`Delete progress for "${key}"?`)) {
                    delete progress[key];
                    localStorage.setItem(SUB_CATEGORY_SESSION_KEY, JSON.stringify(progress));
                    renderReadingProgressEditor();
                }
            });
            
            actions.appendChild(deleteBtn);
            item.appendChild(actions);
            
            readingProgressEditor.appendChild(item);
        });
    } catch (e) {
        readingProgressEditor.innerHTML = '<div class="empty-state">Error parsing progress data.</div>';
    }
}

// ============================================
// Last Session Editor
// ============================================

function renderLastSessionEditor() {
    if (!lastSessionEditor) return;
    
    lastSessionEditor.innerHTML = '';
    
    const sessionData = localStorage.getItem(LAST_SESSION_KEY);
    if (!sessionData) {
        lastSessionEditor.innerHTML = '<div class="empty-state">No last session data.</div>';
        return;
    }
    
    try {
        const session = JSON.parse(sessionData);
        
        const item = document.createElement('div');
        item.className = 'data-item';
        
        const header = document.createElement('div');
        header.className = 'data-item-header';
        header.textContent = 'Last Session';
        item.appendChild(header);
        
        const content = document.createElement('div');
        content.className = 'data-item-content';
        content.textContent = JSON.stringify(session, null, 2);
        item.appendChild(content);
        
        const actions = document.createElement('div');
        actions.className = 'data-item-actions';
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Clear';
        deleteBtn.className = 'secondary';
        deleteBtn.addEventListener('click', () => {
            if (confirm('Clear last session data?')) {
                localStorage.removeItem(LAST_SESSION_KEY);
                renderLastSessionEditor();
            }
        });
        
        actions.appendChild(deleteBtn);
        item.appendChild(actions);
        
        lastSessionEditor.appendChild(item);
    } catch (e) {
        lastSessionEditor.innerHTML = '<div class="empty-state">Error parsing session data.</div>';
    }
}

// ============================================
// Export / Import Functions
// ============================================

function exportAllData() {
    // Normalize savedWords to array format
    const normalizedSavedWords = {};
    
    Object.keys(savedWords).forEach(category => {
        normalizedSavedWords[category] = {};
        Object.keys(savedWords[category]).forEach(story => {
            let words = savedWords[category][story];
            
            // Convert Firestore object format to array if needed
            if (words && typeof words === 'object' && !Array.isArray(words)) {
                words = Object.values(words);
            }
            
            // Ensure it's an array
            normalizedSavedWords[category][story] = Array.isArray(words) ? words : [];
        });
    });
    
    const data = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        savedWords: normalizedSavedWords,
        readingProgress: {},
        lastSession: null
    };
    
    // Get reading progress
    const progressData = localStorage.getItem(SUB_CATEGORY_SESSION_KEY);
    if (progressData) {
        try {
            data.readingProgress = JSON.parse(progressData);
        } catch (e) {
            console.error('Error parsing reading progress:', e);
        }
    }
    
    // Get last session
    const sessionData = localStorage.getItem(LAST_SESSION_KEY);
    if (sessionData) {
        try {
            data.lastSession = JSON.parse(sessionData);
        } catch (e) {
            console.error('Error parsing last session:', e);
        }
    }
    
    // Create and download file
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reading-challenge-data-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    alert('Data exported successfully!');
}

function importData(file) {
    const reader = new FileReader();
    
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            // Validate data structure
            if (!data.version) {
                throw new Error('Invalid data format: missing version');
            }
            
            // BUG-07 修正：exportDate 可能不存在，避免顯示 "undefined"
            const dateStr = data.exportDate
                ? new Date(data.exportDate).toLocaleString()
                : '（未知日期）';
            const confirmMsg = `Import data from ${dateStr}?\n\nThis will:\n- Merge saved words\n- Replace reading progress\n- Replace last session\n\nContinue?`;
            
            if (!confirm(confirmMsg)) {
                return;
            }
            
            // B-03 修正：匯入後使用 parseFirestoreData 轉成正確的 Set 格式
            // 原本用陣列合併，與 savedWords 的 { words: Set, phrases: Set, sentences: Set } 格式不符
            if (data.savedWords) {
                // 先把匯入資料轉成正確格式
                const importedParsed = parseFirestoreData(data.savedWords);

                // 逐一合併到現有 savedWords
                Object.keys(importedParsed).forEach(category => {
                    if (!savedWords[category]) {
                        savedWords[category] = {};
                    }
                    Object.keys(importedParsed[category]).forEach(story => {
                        if (!savedWords[category][story]) {
                            // 該篇文章不存在，直接複製一份新的 Set（不共用參考）
                            const src = importedParsed[category][story];
                            savedWords[category][story] = {
                                words:     new Set(src.words),
                                phrases:   new Set(src.phrases),
                                sentences: new Set(src.sentences)
                            };
                        } else {
                            // 該篇文章已存在，用 Set.add 合併，不覆蓋現有資料
                            const src = importedParsed[category][story];
                            const dst = savedWords[category][story];
                            if (src.words)     src.words.forEach(w => dst.words.add(w));
                            if (src.phrases)   src.phrases.forEach(p => dst.phrases.add(p));
                            if (src.sentences) src.sentences.forEach(s => dst.sentences.add(s));
                        }
                    });
                });
                saveWordsToStorage();
            }
            
            // Import reading progress (replace)
            if (data.readingProgress) {
                localStorage.setItem(SUB_CATEGORY_SESSION_KEY, JSON.stringify(data.readingProgress));
            }
            
            // Import last session (replace)
            if (data.lastSession) {
                localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(data.lastSession));
            }
            
            renderDataManager();
            alert('Data imported successfully!');
            
        } catch (e) {
            alert('Error importing data: ' + e.message);
            console.error('Import error:', e);
        }
    };
    
    reader.readAsText(file);
}

function saveWordsToStorage() {
    if (currentUser && !currentUser.isAnonymous) {
        // Save to Firestore
        saveWordsToFirestore();
    } else {
        // BUG-A08 修正：localStorage.setItem 可能因空間不足或隱私模式而拋出錯誤
        try {
            localStorage.setItem(SAVED_WORDS_KEY, JSON.stringify(savedWords));
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
                if (typeof showNotification === 'function') {
                    showNotification('儲存空間已滿，筆記未能存入裝置，請匯出備份', 'error');
                } else {
                    alert('儲存空間已滿，筆記未能存入裝置，請匯出備份');
                }
            } else {
                console.error('[DataManager] localStorage.setItem error:', e);
            }
        }
    }
}

// ============================================
// Event Listeners
// ============================================

if (goToDataManagerBtn) {
    goToDataManagerBtn.addEventListener('click', showDataManager);
}

if (backToHomeFromDataManagerBtn) {
    backToHomeFromDataManagerBtn.addEventListener('click', () => {
        showView(homeView);
        renderHome();
    });
}

if (exportAllDataBtn) {
    exportAllDataBtn.addEventListener('click', exportAllData);
}

if (importDataBtn) {
    importDataBtn.addEventListener('click', () => {
        importDataInput.click();
    });
}

if (importDataInput) {
    importDataInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            importData(file);
        }
        // Reset input so same file can be selected again
        e.target.value = '';
    });
}

// Note export buttons
if (exportCurrentNoteJsonBtn) {
    exportCurrentNoteJsonBtn.addEventListener('click', () => {
        if (noteViewCategory && noteViewTitle) {
            exportCurrentNote(noteViewCategory, noteViewTitle);
        } else {
            alert('Please open a specific story note first.');
        }
    });
}

if (exportAllNotesJsonBtn) {
    exportAllNotesJsonBtn.addEventListener('click', () => {
        exportAllNotes();
    });
}

// ============================================================
//  儲存空間檢視器（分組版 + 清除功能）
// ============================================================

/**
 * 本 App 所有已知的 localStorage key，依分組分類
 * clearable: true 表示可以安全單獨清除（不影響核心資料）
 * clearable: false 表示重要資料，清除前需警告
 */
const STORAGE_GROUPS = [
    {
        id: 'note',
        icon: '📝',
        title: 'Note 筆記',
        colorClass: 'storage-group-header--note',
        desc: '你手動儲存的單字、片語、句子筆記。',
        keys: [
            { key: 'readingChallengeSavedWordsV2', label: 'Note 單字資料', clearable: false },
            { key: 'readingChallengeCustomArticles', label: '自訂文章', clearable: false },
        ]
    },
    {
        id: 'quiz',
        icon: '🎯',
        title: '測驗 & 分數',
        colorClass: 'storage-group-header--quiz',
        desc: '各單字的熟悉度、Quiz 作答分數記錄。',
        keys: [
            { key: 'readingChallengeItemScores',         label: '熟悉度分數',         clearable: true },
            { key: 'readingChallengeQuizScores',         label: 'Quiz 分數（舊格式）', clearable: true },
            { key: 'readingChallengeArticleSentTotals',  label: '文章句子統計',        clearable: true },
        ]
    },
    {
        id: 'system',
        icon: '⚙️',
        title: '系統 & 播放記錄',
        colorClass: 'storage-group-header--system',
        desc: '閱讀進度、上次播放位置、音檔調整記錄。',
        keys: [
            { key: 'readingChallengeLastSession',         label: '最後播放記錄',   clearable: true },
            { key: 'readingChallengeSubCategorySessions', label: '子分類進度',     clearable: true },
            { key: 'audioAdjustments',                    label: '音檔時間調整',   clearable: true },
        ]
    },
];

// 本 App 所有已知 key 的 flat set（用來識別「其他」）
const APP_KNOWN_KEYS = new Set(
    STORAGE_GROUPS.flatMap(g => g.keys.map(k => k.key))
);

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

/** 讀取所有 localStorage，回傳 { totalBytes, byKey: Map<key, bytes> } */
function calcStorageUsage() {
    const byKey = new Map();
    let totalBytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const val = localStorage.getItem(key) || '';
        const bytes = (key.length + val.length) * 2;
        byKey.set(key, bytes);
        totalBytes += bytes;
    }
    return { totalBytes, byKey };
}

/** 建立一列明細 DOM */
function buildDetailRow(label, bytes, totalBytes, key, clearable, canDelete) {
    const pct = totalBytes > 0 ? Math.min(100, (bytes / totalBytes) * 100) : 0;
    const row = document.createElement('div');
    row.className = 'storage-detail-item';
    row.dataset.key = key;

    row.innerHTML = `
        <span class="storage-detail-name" title="${key}">${label}</span>
        <div class="storage-detail-bar-wrap">
            <div class="storage-detail-bar" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <span class="storage-detail-size">${formatBytes(bytes)}</span>
        ${canDelete ? `<button class="storage-item-clear-btn" data-key="${key}" data-label="${label}" data-clearable="${clearable}">刪除</button>` : '<span></span>'}
    `;
    return row;
}

/** 建立一個分組區塊 DOM */
function buildGroupSection(group, byKey, totalBytes) {
    // 只顯示實際存在的 key
    const existing = group.keys.filter(k => byKey.has(k.key));
    if (existing.length === 0) return null;

    const groupBytes = existing.reduce((sum, k) => sum + (byKey.get(k.key) || 0), 0);

    const section = document.createElement('div');
    section.className = 'storage-group';
    section.dataset.groupId = group.id;

    // Header
    const header = document.createElement('div');
    header.className = `storage-group-header ${group.colorClass}`;
    header.innerHTML = `
        <div class="storage-group-title">
            <span class="storage-group-icon">${group.icon}</span>
            <span>${group.title}</span>
            <span class="storage-group-total">${formatBytes(groupBytes)}</span>
        </div>
    `;

    // 判斷此分組是否有可清除的 key
    const clearableKeys = existing.filter(k => k.clearable);
    if (clearableKeys.length > 0) {
        const clearAllBtn = document.createElement('button');
        clearAllBtn.className = 'storage-clear-btn';
        clearAllBtn.textContent = '🗑 清除可刪項目';
        clearAllBtn.addEventListener('click', () => {
            const names = clearableKeys.map(k => k.label).join('、');
            if (!confirm(`確定要清除「${names}」嗎？\n\n⚠️ 這些測驗分數和記錄將無法復原。`)) return;
            clearableKeys.forEach(k => localStorage.removeItem(k.key));
            renderStorageViewer();
            if (typeof showNotification === 'function') showNotification(`已清除 ${group.title} 的可刪項目`, 'info');
        });
        header.appendChild(clearAllBtn);
    }

    section.appendChild(header);

    // 描述
    const desc = document.createElement('div');
    desc.className = 'storage-group-desc';
    desc.textContent = group.desc;
    section.appendChild(desc);

    // 各項目列
    const list = document.createElement('div');
    list.className = 'storage-detail-list';
    existing.forEach(k => {
        const bytes = byKey.get(k.key) || 0;
        const row = buildDetailRow(k.label, bytes, totalBytes, k.key, k.clearable, k.clearable);
        list.appendChild(row);
    });
    section.appendChild(list);

    return section;
}

function renderStorageViewer() {
    const { totalBytes, byKey } = calcStorageUsage();
    const LIMIT = 5 * 1024 * 1024;
    const pct   = Math.min(100, (totalBytes / LIMIT) * 100);

    // 總用量 bar
    const totalEl   = document.getElementById('storage-total-value');
    const barFill   = document.getElementById('storage-bar-fill');
    const usedLabel = document.getElementById('storage-used-label');
    if (totalEl)   totalEl.textContent   = formatBytes(totalBytes);
    if (usedLabel) usedLabel.textContent = `${formatBytes(totalBytes)} 已用`;
    if (barFill) {
        barFill.style.width = pct + '%';
        barFill.classList.remove('warn', 'danger');
        if (pct >= 90) barFill.classList.add('danger');
        else if (pct >= 70) barFill.classList.add('warn');
    }

    // 本站分組
    const appSections = document.getElementById('storage-app-sections');
    if (appSections) {
        appSections.innerHTML = '';
        STORAGE_GROUPS.forEach(group => {
            const el = buildGroupSection(group, byKey, totalBytes);
            if (el) appSections.appendChild(el);
        });
        if (appSections.children.length === 0) {
            appSections.innerHTML = '<div class="storage-empty-msg">本站目前沒有儲存任何資料。</div>';
        }
    }

    // 其他（非本站）
    const otherKeys = [...byKey.entries()].filter(([k]) => !APP_KNOWN_KEYS.has(k));
    const otherSection = document.getElementById('storage-other-section');
    const otherList    = document.getElementById('storage-other-list');
    const otherTotal   = document.getElementById('storage-other-total');

    if (otherSection && otherList) {
        if (otherKeys.length === 0) {
            otherSection.classList.add('is-hidden');
        } else {
            otherSection.classList.remove('is-hidden');
            const otherBytes = otherKeys.reduce((s, [, b]) => s + b, 0);
            if (otherTotal) otherTotal.textContent = formatBytes(otherBytes);

            otherList.innerHTML = '';
            otherKeys.sort((a, b) => b[1] - a[1]).forEach(([key, bytes]) => {
                const row = buildDetailRow(key, bytes, totalBytes, key, true, true);
                otherList.appendChild(row);
            });
        }
    }

    // 個別刪除按鈕（事件委派）
    const modal = document.getElementById('storage-viewer-modal');
    if (modal) {
        // 移除舊的委派再重新綁（避免重複觸發）
        modal.removeEventListener('click', _storageModalClickHandler);
        modal.addEventListener('click', _storageModalClickHandler);
    }
}

function _storageModalClickHandler(e) {
    const btn = e.target.closest('.storage-item-clear-btn');
    if (!btn) return;
    const key   = btn.dataset.key;
    const label = btn.dataset.label || key;
    if (!confirm(`確定要刪除「${label}」嗎？\n\nkey: ${key}`)) return;
    localStorage.removeItem(key);
    renderStorageViewer();
    if (typeof showNotification === 'function') showNotification(`已刪除：${label}`, 'info');
}

function openStorageViewer() {
    const modal = document.getElementById('storage-viewer-modal');
    if (!modal) return;
    renderStorageViewer();
    modal.classList.remove('is-hidden');
}

function closeStorageViewer() {
    const modal = document.getElementById('storage-viewer-modal');
    if (modal) modal.classList.add('is-hidden');
}

// ── 事件綁定 ─────────────────────────────────────────────────
const storageViewerBtn = document.getElementById('storage-viewer-btn');
if (storageViewerBtn) storageViewerBtn.addEventListener('click', openStorageViewer);

const storageViewerClose = document.getElementById('storage-viewer-close');
if (storageViewerClose) storageViewerClose.addEventListener('click', closeStorageViewer);

const storageViewerRefresh = document.getElementById('storage-viewer-refresh');
if (storageViewerRefresh) storageViewerRefresh.addEventListener('click', renderStorageViewer);

// 「其他」全部清除
const clearOtherBtn = document.getElementById('storage-clear-other-btn');
if (clearOtherBtn) {
    clearOtherBtn.addEventListener('click', () => {
        const { byKey } = calcStorageUsage();
        const otherKeys = [...byKey.keys()].filter(k => !APP_KNOWN_KEYS.has(k));
        if (otherKeys.length === 0) return;
        if (!confirm(`確定要清除全部 ${otherKeys.length} 個非本站 key 嗎？\n\n這些資料與本 App 無關，可安全刪除。`)) return;
        otherKeys.forEach(k => localStorage.removeItem(k));
        renderStorageViewer();
        if (typeof showNotification === 'function') showNotification(`已清除 ${otherKeys.length} 個非本站項目`, 'info');
    });
}

// 點擊背景關閉
const storageViewerOverlay = document.getElementById('storage-viewer-modal');
if (storageViewerOverlay) {
    storageViewerOverlay.addEventListener('click', (e) => {
        if (e.target === storageViewerOverlay) closeStorageViewer();
    });
}
