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
            
            // Import saved words (merge)
            if (data.savedWords) {
                Object.keys(data.savedWords).forEach(category => {
                    if (!savedWords[category]) {
                        savedWords[category] = {};
                    }
                    Object.keys(data.savedWords[category]).forEach(story => {
                        if (!savedWords[category][story]) {
                            savedWords[category][story] = [];
                        }
                        
                        // Handle both array format (localStorage) and object format (Firestore)
                        let importedWords = data.savedWords[category][story];
                        
                        // If it's a Firestore object format, convert to array
                        if (importedWords && typeof importedWords === 'object' && !Array.isArray(importedWords)) {
                            // Firestore format: { "0": "word1", "1": "word2", ... }
                            importedWords = Object.values(importedWords);
                        }
                        
                        // Make sure it's an array
                        if (!Array.isArray(importedWords)) {
                            console.warn(`Skipping invalid data for ${category}/${story}`);
                            return;
                        }
                        
                        // BUG-A12 修正：改用 _deduplicateWords 以內容去重，
                        // 修正 Set 對物件型 Note 無法正確去重的問題
                        const combined = [...savedWords[category][story], ...importedWords];
                        savedWords[category][story] = _deduplicateWords(combined);
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
//  儲存空間檢視器
// ============================================================

/**
 * 計算 localStorage 中所有 key 的用量
 * UTF-16 編碼：每個字元 2 bytes
 * @returns {{ total: number, items: Array<{key, label, bytes}> }}
 */
function calcStorageUsage() {
    // 友善名稱對照表
    const LABELS = {
        'readingChallengeSavedWordsV2':      '📝 Note 單字資料',
        'readingChallengeLastSession':        '▶ 最後播放記錄',
        'readingChallengeSubCategorySessions':'📂 子分類進度',
        'readingChallengeCustomArticles':     '📄 自訂文章',
        'readingChallengeQuizScores':         '🎯 Quiz 分數（舊格式）',
        'readingChallengeItemScores':         '📊 熟悉度分數',
        'readingChallengeAudioAdjustments':   '🎛 音檔時間調整',
    };

    const items = [];
    let total = 0;

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const val = localStorage.getItem(key) || '';
        // UTF-16: (key.length + val.length) * 2 bytes
        const bytes = (key.length + val.length) * 2;
        total += bytes;
        items.push({
            key,
            label: LABELS[key] || key,
            bytes
        });
    }

    // 依大小降序排列
    items.sort((a, b) => b.bytes - a.bytes);

    return { total, items };
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function renderStorageViewer() {
    const { total, items } = calcStorageUsage();
    const LIMIT = 5 * 1024 * 1024; // 5 MB
    const pct   = Math.min(100, (total / LIMIT) * 100);

    // 總用量
    const totalEl = document.getElementById('storage-total-value');
    const barFill = document.getElementById('storage-bar-fill');
    const usedLabel = document.getElementById('storage-used-label');

    if (totalEl) totalEl.textContent = formatBytes(total);
    if (usedLabel) usedLabel.textContent = `${formatBytes(total)} 已用`;

    if (barFill) {
        barFill.style.width = pct + '%';
        barFill.classList.remove('warn', 'danger');
        if (pct >= 90) barFill.classList.add('danger');
        else if (pct >= 70) barFill.classList.add('warn');
    }

    // 明細列表
    const listEl = document.getElementById('storage-detail-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (items.length === 0) {
        listEl.innerHTML = '<div class="storage-empty-msg">localStorage 目前沒有任何資料。</div>';
        return;
    }

    items.forEach(({ label, bytes }) => {
        const itemPct = total > 0 ? Math.min(100, (bytes / total) * 100) : 0;

        const row = document.createElement('div');
        row.className = 'storage-detail-item';
        row.innerHTML = `
            <span class="storage-detail-name" title="${label}">${label}</span>
            <div class="storage-detail-bar-wrap">
                <div class="storage-detail-bar" style="width:${itemPct.toFixed(1)}%"></div>
            </div>
            <span class="storage-detail-size">${formatBytes(bytes)}</span>
        `;
        listEl.appendChild(row);
    });
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

// 綁定事件
const storageViewerBtn = document.getElementById('storage-viewer-btn');
if (storageViewerBtn) {
    storageViewerBtn.addEventListener('click', openStorageViewer);
}

const storageViewerClose = document.getElementById('storage-viewer-close');
if (storageViewerClose) {
    storageViewerClose.addEventListener('click', closeStorageViewer);
}

const storageViewerRefresh = document.getElementById('storage-viewer-refresh');
if (storageViewerRefresh) {
    storageViewerRefresh.addEventListener('click', renderStorageViewer);
}

// 點擊背景關閉
const storageViewerOverlay = document.getElementById('storage-viewer-modal');
if (storageViewerOverlay) {
    storageViewerOverlay.addEventListener('click', (e) => {
        if (e.target === storageViewerOverlay) closeStorageViewer();
    });
}
