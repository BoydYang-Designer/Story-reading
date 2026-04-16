// ============================================================
//  SCORES DASHBOARD — scores-dashboard.js  (四欄重構版)
//
//  架構：四個完全獨立的 tab，互不加權：
//    單字 (noteWords)   → fcplus 100%
//    D   (Dictation)    → dictation 100%
//    R   (Reorder)      → reorder 100%
//    VR  (Voice Reorder)→ voiceReorder 100%
//
//  Dashboard 文章列表顯示四欄分數（方案 A）
//  出題桶各自獨立，per-source lastSeen 支援
//
//  依賴：quiz.js（需先載入）
// ============================================================

// ══════════════════════════════════════════════════════════════
//  SHARED UTILITIES
// ══════════════════════════════════════════════════════════════

function daysSince(dateStr) {
    if (!dateStr) return Infinity;
    let d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        d = new Date(dateStr);
    } else {
        d = new Date(dateStr.replace(/年|月/g, '-').replace(/日/g, ''));
    }
    if (isNaN(d)) return Infinity;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function _todayStr() {
    return new Date().toISOString().split('T')[0];
}

// 統一的句子正規化函式（與 quiz.js 同步）
function normSentence(t) {
    return t.trim()
            .replace(/[.,?!'"`\u201c\u201d\u2018\u2019;:（）【】「」]/g, '')
            .toLowerCase();
}

function _escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ══════════════════════════════════════════════════════════════
//  STORAGE
// ══════════════════════════════════════════════════════════════

const ITEM_SCORES_KEY    = 'readingChallengeItemScores';
const ART_SENT_TOTAL_KEY = 'readingChallengeArticleSentTotals';

function loadArticleSentTotals() {
    try { return JSON.parse(localStorage.getItem(ART_SENT_TOTAL_KEY) || '{}'); }
    catch (e) { return {}; }
}

function saveArticleSentTotals(data) {
    localStorage.setItem(ART_SENT_TOTAL_KEY, JSON.stringify(data));
}

function _getArticleSentenceTotal(categoryName, titleName) {
    const cache = loadArticleSentTotals();
    const key   = `${categoryName}||${titleName}`;
    return cache[key]?.total || 0;
}

async function _updateArticleSentenceTotal(categoryName, titleName) {
    if (typeof getTimestampForStory !== 'function') return;
    try {
        const tsData = await getTimestampForStory(titleName);
        const total  = tsData ? tsData.length : 0;
        const cache  = loadArticleSentTotals();
        const key    = `${categoryName}||${titleName}`;
        cache[key]   = { total, updatedAt: _todayStr() };
        saveArticleSentTotals(cache);
    } catch (e) { console.error('Article sent total update error:', e); }
}

function loadItemScores() {
    try {
        return JSON.parse(localStorage.getItem(ITEM_SCORES_KEY) || '{}');
    } catch (e) { return {}; }
}

function saveItemScores(data) {
    localStorage.setItem(ITEM_SCORES_KEY, JSON.stringify(data));
    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ itemScores: data }, { merge: true })
          .catch(err => console.error('Item score save error:', err));
    }
}

async function loadItemScoresFromFirestore() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    try {
        const doc = await db.collection('userNotes').doc(currentUser.uid).get();
        if (doc.exists && doc.data().itemScores) {
            const scores = doc.data().itemScores;
            localStorage.setItem(ITEM_SCORES_KEY, JSON.stringify(scores));
        }
    } catch (e) { console.error('Item scores load error:', e); }
}

window.loadItemScoresFromFirestore = loadItemScoresFromFirestore;

// ══════════════════════════════════════════════════════════════
//  LEGACY CLEANUP
// ══════════════════════════════════════════════════════════════

function cleanLegacyFields(data) {
    const sources = ['fc','fcplus','dictation','reorder','voiceReorder','articleListen'];
    let removedFields = 0, removedRecords = 0;

    Object.keys(data).forEach(articleKey => {
        ['noteWords','noteSentences','articleWords','articleSentences'].forEach(itype => {
            const items = data[articleKey]?.[itype];
            if (!items) return;
            Object.keys(items).forEach(text => {
                const rec = items[text];
                if (!rec || typeof rec !== 'object') return;
                const hasTopLevel  = 'correct' in rec || 'wrong' in rec;
                if (!hasTopLevel) return;
                const hasNewFormat = sources.some(s => rec[s] != null);
                if (hasNewFormat) {
                    delete rec.correct;
                    delete rec.wrong;
                    removedFields++;
                } else {
                    delete items[text];
                    removedRecords++;
                }
            });
        });
    });

    if (removedFields > 0 || removedRecords > 0) {
        console.log(`[cleanLegacyFields] 清理：${removedFields} 混合欄位，${removedRecords} 純舊格式記錄`);
    }
    return data;
}

// ══════════════════════════════════════════════════════════════
//  RECORD ITEM RESULT
// ══════════════════════════════════════════════════════════════

/**
 * 記錄單一題目結果
 * source: 'fc' | 'fcplus' | 'dictation' | 'reorder' | 'voiceReorder' | 'articleListen'
 *
 * 新版：每個 source 儲存自己的 lastSeen（per-source decay）
 */
function recordItemResult(categoryName, titleName, itemType, itemText, isCorrect, replayCount = 0, source = 'fc') {
    if (!categoryName || !titleName || !itemText) return;

    const data = loadItemScores();
    const key  = `${categoryName}||${titleName}`;
    if (!data[key]) data[key] = { noteWords: {}, noteSentences: {}, articleWords: {}, articleSentences: {} };
    if (!data[key][itemType]) data[key][itemType] = {};

    let storageText;
    if (source === 'voiceReorder' || itemType === 'noteSentences' || itemType === 'articleSentences') {
        storageText = normSentence(itemText);
    } else {
        storageText = itemText.trim();
    }

    if (!data[key][itemType][storageText]) {
        data[key][itemType][storageText] = {
            fc: null, fcplus: null, dictation: null,
            reorder: null, voiceReorder: null, articleListen: null,
            firstSeen: _todayStr(), lastSeen: null
        };
    }

    const rec = data[key][itemType][storageText];

    // 確保來源欄位存在（含 per-source lastSeen）
    if (!rec[source]) rec[source] = { correct: 0, wrong: 0, lastSeen: null };
    const src = rec[source];

    if (isCorrect) {
        src.correct++;
    } else {
        src.wrong++;
    }
    if (replayCount > 0) src.wrong += replayCount;

    // per-source lastSeen
    src.lastSeen = _todayStr();

    // 全域 lastSeen（向後相容 + summary 用）
    rec.lastSeen = _todayStr();
    if (!rec.firstSeen) rec.firstSeen = _todayStr();

    saveItemScores(data);

    if (typeof renderScoresDashboard === 'function') {
        const scoresView = document.getElementById('scores-dashboard-view');
        if (scoresView && !scoresView.classList.contains('is-hidden')) {
            renderScoresDashboard();
        }
    }
}

// ══════════════════════════════════════════════════════════════
//  四個獨立計分函式（各 100%，互不影響）
// ══════════════════════════════════════════════════════════════

/**
 * 計算單一 source 的熟悉度（0–100），使用 per-source lastSeen 做衰減
 * @param {object} srcRec  - rec[source]，例如 rec['reorder']
 * @param {string} sourceKey - 'voiceReorder' 時使用較低底板
 * @returns {{ rawFam: number|null, effectiveFam: number|null, days: number }}
 */
function _calcSourceFamWithDecay(srcRec, sourceKey) {
    if (!srcRec || (srcRec.correct + srcRec.wrong) === 0) {
        return { rawFam: null, effectiveFam: null, days: 0 };
    }

    const total  = srcRec.correct + srcRec.wrong;
    const rawFam = Math.round((srcRec.correct / total) * 100);

    // per-source lastSeen 優先，fallback 到 global lastSeen
    const lastSeenStr = srcRec.lastSeen || null;
    const days = lastSeenStr
        ? Math.floor((Date.now() - new Date(lastSeenStr).getTime()) / 86400000)
        : 0;

    // VR 難度最高，底板較低（15 vs 20）
    const baseFloor = (sourceKey === 'voiceReorder') ? 15 : 20;
    const floor     = Math.min(baseFloor, rawFam);

    // 艾賓浩斯半衰期
    const halfLife = rawFam >= 70 ? 30 : rawFam >= 40 ? 14 : 7;
    const effectiveFam = Math.round(floor + (rawFam - floor) * Math.pow(2, -days / halfLife));

    return { rawFam, effectiveFam, days };
}

/** 單字熟悉度：只看 fcplus */
function calcWordFam(rec) {
    return _calcSourceFamWithDecay(rec?.['fcplus'], 'fcplus');
}

/** Dictation 熟悉度：只看 dictation */
function calcDictationFam(rec) {
    return _calcSourceFamWithDecay(rec?.['dictation'], 'dictation');
}

/** Reorder 熟悉度：只看 reorder */
function calcReorderFam(rec) {
    return _calcSourceFamWithDecay(rec?.['reorder'], 'reorder');
}

/** Voice Reorder 熟悉度：只看 voiceReorder */
function calcVoiceReorderFam(rec) {
    return _calcSourceFamWithDecay(rec?.['voiceReorder'], 'voiceReorder');
}

/**
 * 根據 tab 名稱取得對應的計分函式與 source key
 */
function _getTabConfig(tab) {
    switch (tab) {
        case 'noteWords':     return { fn: calcWordFam,        sourceKey: 'fcplus',       label: '單字' };
        case 'dictation':     return { fn: calcDictationFam,   sourceKey: 'dictation',    label: 'Dictation' };
        case 'reorder':       return { fn: calcReorderFam,     sourceKey: 'reorder',      label: 'Reorder' };
        case 'voiceReorder':  return { fn: calcVoiceReorderFam,sourceKey: 'voiceReorder', label: 'Voice Reorder' };
        default:              return { fn: calcWordFam,        sourceKey: 'fcplus',       label: '單字' };
    }
}

// ══════════════════════════════════════════════════════════════
//  FAMILIARITY COLOR
// ══════════════════════════════════════════════════════════════

function getFamiliarityColor(fam) {
    if (fam >= 60) return 'fam-green';
    if (fam >= 30) return 'fam-yellow';
    return 'fam-red';
}

const STALE_DAYS = 14;

function getItemColorClass(hasPractice, famScore, lastSeen) {
    if (!hasPractice) return 'fam-red';
    const days = lastSeen ? daysSince(lastSeen) : Infinity;
    if (days > STALE_DAYS) {
        return famScore >= 30 ? 'fam-yellow' : 'fam-red';
    }
    return getFamiliarityColor(famScore);
}

// ══════════════════════════════════════════════════════════════
//  ARTICLE FAM SUMMARY（四欄版）
// ══════════════════════════════════════════════════════════════

/**
 * 計算文章的四欄熟悉度摘要
 * 回傳 { wordAvg, dictAvg, reorderAvg, voiceAvg,
 *         wordTested, wordTotal, dictTested, dictTotal,
 *         reorderTested, reorderTotal, voiceTested, voiceTotal,
 *         hasPractice }
 */
function calcArticleFamSummary(categoryName, titleName) {
    const data  = loadItemScores();
    const key   = `${categoryName}||${titleName}`;
    const entry = data[key] || {};

    // ── 單字：noteWords + articleWords，只看 fcplus ──────────
    const noteWords = Object.values(entry.noteWords     || {});
    const artWords  = Object.values(entry.articleWords  || {});
    const allWords  = [...noteWords, ...artWords];

    // 補入 savedWords 未測驗單字（計 0 分）
    let wordTotal = allWords.length;
    if (typeof savedWords !== 'undefined') {
        const noteData  = savedWords[categoryName]?.[titleName] || {};
        const poolWords = [...(noteData.words || []), ...(noteData.phrases || [])].map(t => t.trim()).filter(Boolean);
        const testedMap = entry.noteWords || {};
        poolWords.forEach(t => {
            if (!testedMap[t]) wordTotal++; // 未測驗單字也計入分母
        });
        // 若 savedWords 有資料，以 savedWords 長度為準
        if (poolWords.length > 0) wordTotal = Math.max(poolWords.length, allWords.length);
    }

    const wordScores  = allWords.map(r => calcWordFam(r).effectiveFam ?? 0);
    const wordTested  = allWords.filter(r => r?.fcplus && (r.fcplus.correct + r.fcplus.wrong) > 0).length;
    const wordUntested= Math.max(0, wordTotal - wordTested);
    const allWordScores = [...wordScores, ...Array(wordUntested).fill(0)];
    const wordAvg = wordTotal > 0
        ? Math.round(allWordScores.reduce((a, b) => a + b, 0) / wordTotal) : null;

    // ── 句子類型：noteSentences + articleSentences ───────────
    const noteSents = Object.values(entry.noteSentences    || {});
    const artSents  = Object.values(entry.articleSentences || {});
    const allSents  = [...noteSents, ...artSents];

    // 用 Timestamp 快取總數做分母（含未測驗句子）
    const cachedTotal   = _getArticleSentenceTotal(categoryName, titleName);
    const sentBaseTotal = Math.max(allSents.length, cachedTotal);

    // Dictation
    const dictScores  = allSents.map(r => calcDictationFam(r).effectiveFam ?? 0);
    const dictTested  = allSents.filter(r => r?.dictation && (r.dictation.correct + r.dictation.wrong) > 0).length;
    const dictUntested= Math.max(0, sentBaseTotal - dictTested);
    const allDictScores = [...dictScores, ...Array(dictUntested).fill(0)];
    const dictAvg = sentBaseTotal > 0
        ? Math.round(allDictScores.reduce((a, b) => a + b, 0) / sentBaseTotal) : null;

    // Reorder
    const reorderScores  = allSents.map(r => calcReorderFam(r).effectiveFam ?? 0);
    const reorderTested  = allSents.filter(r => r?.reorder && (r.reorder.correct + r.reorder.wrong) > 0).length;
    const reorderUntested= Math.max(0, sentBaseTotal - reorderTested);
    const allReorderScores = [...reorderScores, ...Array(reorderUntested).fill(0)];
    const reorderAvg = sentBaseTotal > 0
        ? Math.round(allReorderScores.reduce((a, b) => a + b, 0) / sentBaseTotal) : null;

    // Voice Reorder
    const voiceScores  = allSents.map(r => calcVoiceReorderFam(r).effectiveFam ?? 0);
    const voiceTested  = allSents.filter(r => r?.voiceReorder && (r.voiceReorder.correct + r.voiceReorder.wrong) > 0).length;
    const voiceUntested= Math.max(0, sentBaseTotal - voiceTested);
    const allVoiceScores = [...voiceScores, ...Array(voiceUntested).fill(0)];
    const voiceAvg = sentBaseTotal > 0
        ? Math.round(allVoiceScores.reduce((a, b) => a + b, 0) / sentBaseTotal) : null;

    const hasPractice = wordTested > 0 || dictTested > 0 || reorderTested > 0 || voiceTested > 0;

    return {
        wordAvg,   wordTested,   wordTotal,
        dictAvg,   dictTested,   dictTotal:    sentBaseTotal,
        reorderAvg,reorderTested,reorderTotal: sentBaseTotal,
        voiceAvg,  voiceTested,  voiceTotal:   sentBaseTotal,
        hasPractice,
        // 向後相容（清除面板用）
        famAvg: wordAvg
    };
}

// 向後相容（saveQuizScore 等地方可能呼叫）
function calcFamiliarity(rec, itemType) {
    if (!rec) return 0;
    switch(itemType) {
        case 'noteWords': case 'articleWords':
            return calcWordFam(rec).effectiveFam ?? 0;
        case 'noteSentences': case 'articleSentences':
            return calcReorderFam(rec).effectiveFam ?? calcDictationFam(rec).effectiveFam ?? 0;
        default:
            return calcWordFam(rec).effectiveFam ?? 0;
    }
}

function calcNeedScore(rec, itemType) {
    return 100 - calcFamiliarity(rec, itemType);
}

// ══════════════════════════════════════════════════════════════
//  PART 1 — SCORES DASHBOARD
// ══════════════════════════════════════════════════════════════

let _dashSortDir = 'desc';

function openScoresDashboard() {
    _dashSortDir = 'desc';
    renderScoresDashboard();
    showView(document.getElementById('scores-dashboard-view'));
}

function renderScoresDashboard() {
    _renderBrowserSection();
    _updateSortBtnUI();
}

function _updateSortBtnUI() {
    const btn = document.getElementById('dash-sort-fam-btn');
    if (!btn) return;
    btn.textContent = _dashSortDir === 'desc'
        ? '熟悉度 ↑（最需練習優先）'
        : '熟悉度 ↓（最熟悉優先）';
    btn.title = '未測驗文章固定排在後方，按字母排列';
    btn.classList.toggle('sort-desc', _dashSortDir === 'desc');
}

const _catSortState = {};

function _getCatSort(cat) {
    if (!_catSortState[cat]) _catSortState[cat] = { key: null, dir: 'asc' };
    return _catSortState[cat];
}

function _sortArticlesByCat(articles, cat) {
    const { key, dir } = _getCatSort(cat);

    if (key === 'title') {
        return [...articles].sort((a, b) =>
            dir === 'asc'
                ? a.title.localeCompare(b.title)
                : b.title.localeCompare(a.title)
        );
    }

    return [...articles].sort((a, b) => {
        const _getVal = (summary, k) => {
            if (k === 'word')    return summary.wordAvg;
            if (k === 'dict')    return summary.dictAvg;
            if (k === 'reorder') return summary.reorderAvg;
            if (k === 'voice')   return summary.voiceAvg;
            if (k === 'untested') {
                return (summary.wordTotal    - summary.wordTested)
                     + (summary.dictTotal    - summary.dictTested)
                     + (summary.reorderTotal - summary.reorderTested)
                     + (summary.voiceTotal   - summary.voiceTested);
            }
            return summary.wordAvg;
        };

        if (!key) return a.title.localeCompare(b.title);

        const fa = _getVal(a.summary, key);
        const fb = _getVal(b.summary, key);

        if (fa === null && fb === null) return a.title.localeCompare(b.title);
        if (fa === null) return 1;
        if (fb === null) return -1;

        return dir === 'asc' ? fa - fb : fb - fa;
    });
}

function _renderBrowserSection() {
    const container = document.getElementById('scores-browser-section');
    if (!container) return;

    const storyList = typeof stories !== 'undefined' ? stories : [];
    const itemData  = loadItemScores();

    if (storyList.length === 0) {
        container.innerHTML = `<div class="browser-empty">沒有文章資料</div>`;
        return;
    }

    const majorMap = {};
    storyList.forEach(s => {
        const major = s['大類'] || 'Uncategorized';
        const cats  = Array.isArray(s['分類']) && s['分類'].length > 0
            ? s['分類'] : ['Uncategorized'];
        const cat   = cats[0];
        if (!majorMap[major]) majorMap[major] = {};
        if (!majorMap[major][cat]) majorMap[major][cat] = [];
        majorMap[major][cat].push(s['標題']);
    });

    Object.keys(itemData).forEach(key => {
        const [cat, title] = key.split('||');
        if (!title) return;
        const found = storyList.find(s => s['標題'] === title);
        if (!found) {
            const major = 'Other';
            if (!majorMap[major]) majorMap[major] = {};
            if (!majorMap[major][cat]) majorMap[major][cat] = [];
            if (!majorMap[major][cat].includes(title)) majorMap[major][cat].push(title);
        }
    });

    const majors = Object.keys(majorMap).sort();
    let html = '';

    for (const major of majors) {
        const cats = Object.keys(majorMap[major]).sort();
        let catsHtml = '';

        for (const cat of cats) {
            const rawTitles = majorMap[major][cat];

            let articles = rawTitles.map(title => {
                const summary = calcArticleFamSummary(cat, title);
                return { title, cat, summary };
            });

            articles = _sortArticlesByCat(articles, cat);

            const practicedCount = articles.filter(a => a.summary.hasPractice).length;
            const catBadge = practicedCount > 0
                ? `<span class="browser-cat-practiced-badge">${practicedCount}/${articles.length}</span>`
                : `<span class="browser-cat-count-badge">${articles.length}</span>`;

            const catKey = _escHtml(cat);
            catsHtml += `
                <div class="browser-cat-group" data-cat="${catKey}">
                    <div class="browser-cat-header" data-cat-toggle>
                        <span class="browser-cat-arrow">▸</span>
                        <span class="browser-cat-name">${_escHtml(cat)}</span>
                        ${catBadge}
                    </div>
                    <div class="browser-cat-body" style="display:none">
                        <div class="cat-sort-bar" data-cat="${catKey}">
                            <span class="cat-sort-label">排序：</span>
                            ${_buildCatSortBtns(cat)}
                        </div>
                        ${articles.map(a => _buildArticleRowHtml(a)).join('')}
                    </div>
                </div>`;
        }

        html += `
            <div class="browser-major-group">
                <div class="browser-major-header" data-major-toggle>
                    <span class="browser-major-arrow">▸</span>
                    <span class="browser-major-name">${_escHtml(major)}</span>
                    <span class="browser-major-count">${Object.values(majorMap[major]).flat().length} 篇</span>
                </div>
                <div class="browser-major-body" style="display:none">
                    ${catsHtml}
                </div>
            </div>`;
    }

    container.innerHTML = html || `<div class="browser-empty">沒有文章資料</div>`;

    container.querySelectorAll('[data-major-toggle]').forEach(h =>
        h.addEventListener('click', () => _toggleSection(h))
    );
    container.querySelectorAll('[data-cat-toggle]').forEach(h =>
        h.addEventListener('click', () => _toggleSection(h))
    );
    container.querySelectorAll('.browser-article-row').forEach(row => {
        row.addEventListener('click', () => {
            openDetailView(row.dataset.cat, row.dataset.title);
        });
    });
    _bindCatSortBtns(container);
}

function _buildCatSortBtns(cat) {
    const { key, dir } = _getCatSort(cat);
    const arrow = dir === 'asc' ? ' ↓' : ' ↑';

    const btns = [
        { k: 'title',    label: '🔤 文章名',  title: '文章名稱 A→Z / Z→A' },
        { k: 'word',     label: '詞',          title: '單字熟悉度' },
        { k: 'dict',     label: 'D',           title: 'Dictation 熟悉度' },
        { k: 'reorder',  label: 'R',           title: 'Reorder 熟悉度' },
        { k: 'voice',    label: 'VR',          title: 'Voice Reorder 熟悉度' },
        { k: 'untested', label: '❓ 未測驗',   title: '未測驗題數（多→少）' },
    ];

    return btns.map(b => {
        const isActive = key === b.k;
        return `<button class="cat-sort-btn${isActive ? ' is-active' : ''}"
            data-sort-cat="${_escHtml(cat)}" data-sort-key="${b.k}"
            title="${b.title}">${b.label}${isActive ? arrow : ''}</button>`;
    }).join('');
}

function _rebuildCatBody(catGroupEl, cat) {
    const storyList = typeof stories !== 'undefined' ? stories : [];
    const rawTitles = [];
    storyList.forEach(s => {
        const cats = Array.isArray(s['分類']) && s['分類'].length > 0
            ? s['分類'] : ['Uncategorized'];
        if (cats[0] === cat) rawTitles.push(s['標題']);
    });
    const itemData = loadItemScores();
    Object.keys(itemData).forEach(k => {
        const [c, t] = k.split('||');
        if (c === cat && t && !rawTitles.includes(t)) rawTitles.push(t);
    });

    let articles = rawTitles.map(title => {
        const summary = calcArticleFamSummary(cat, title);
        return { title, cat, summary };
    });
    articles = _sortArticlesByCat(articles, cat);

    const body = catGroupEl.querySelector('.browser-cat-body');
    if (!body) return;

    const sortBarHtml = `<div class="cat-sort-bar" data-cat="${_escHtml(cat)}">
        <span class="cat-sort-label">排序：</span>
        ${_buildCatSortBtns(cat)}
    </div>`;
    const rowsHtml = articles.map(a => _buildArticleRowHtml(a)).join('');
    body.innerHTML = sortBarHtml + rowsHtml;

    body.querySelectorAll('.browser-article-row').forEach(row => {
        row.addEventListener('click', () => openDetailView(row.dataset.cat, row.dataset.title));
    });
    _bindCatSortBtns(body);
}

function _bindCatSortBtns(container) {
    container.querySelectorAll('.cat-sort-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const cat     = btn.dataset.sortCat;
            const sortKey = btn.dataset.sortKey;
            const state   = _getCatSort(cat);
            if (state.key === sortKey) {
                state.dir = state.dir === 'asc' ? 'desc' : 'asc';
            } else {
                state.key = sortKey;
                state.dir = sortKey === 'untested' ? 'desc' : 'asc';
            }
            const catGroup = btn.closest('.browser-cat-group');
            if (catGroup) _rebuildCatBody(catGroup, cat);
        });
    });
}

function _toggleSection(header) {
    const body  = header.nextElementSibling;
    const arrow = header.querySelector('.browser-major-arrow, .browser-cat-arrow');
    const isCollapsed = body.style.display === 'none';
    body.style.display = isCollapsed ? '' : 'none';
    if (arrow) arrow.textContent = isCollapsed ? '▾' : '▸';
}

// ── 文章 Row HTML（四欄 Pillar）─────────────────────────────

function _buildArticleRowHtml(article) {
    const { title, cat, summary } = article;
    const {
        wordAvg,    wordTested,    wordTotal,
        dictAvg,    dictTested,    dictTotal,
        reorderAvg, reorderTested, reorderTotal,
        voiceAvg,   voiceTested,   voiceTotal,
    } = summary;

    const wordCov    = wordTotal    > 0 ? `${wordTested}/${wordTotal}`       : null;
    const dictCov    = dictTotal    > 0 ? `${dictTested}/${dictTotal}`       : null;
    const reorderCov = reorderTotal > 0 ? `${reorderTested}/${reorderTotal}` : null;
    const voiceCov   = voiceTotal   > 0 ? `${voiceTested}/${voiceTotal}`     : null;

    function pillarHtml(label, avg, coverage, cssExtra) {
        const colorClass = avg !== null ? getFamiliarityColor(avg) : 'chip-untested';
        const valHtml = avg !== null
            ? `<div class="art-pillar-val ${colorClass}">${avg}%</div>`
            : `<div class="art-pillar-val chip-untested">—</div>`;
        const barHtml = avg !== null
            ? `<div class="art-pillar-bar-track"><div class="art-pillar-bar ${colorClass}" style="width:${avg}%"></div></div>`
            : `<div class="art-pillar-bar-track"><div class="art-pillar-bar" style="width:0%"></div></div>`;
        const covHtml = coverage
            ? `<div class="art-pillar-cov">${coverage}</div>` : '';
        return `<div class="art-pillar ${cssExtra}">
            <div class="art-pillar-label">${label}</div>
            ${valHtml}${barHtml}${covHtml}
        </div>`;
    }

    const wordPillar    = pillarHtml('詞',  wordAvg,    wordCov,    'art-pillar-word');
    const dictPillar    = pillarHtml('D',   dictAvg,    dictCov,    'art-pillar-dict');
    const reorderPillar = pillarHtml('R',   reorderAvg, reorderCov, 'art-pillar-reorder');
    const voicePillar   = pillarHtml('VR',  voiceAvg,   voiceCov,   'art-pillar-voice');

    return `<div class="browser-article-row" data-title="${_escHtml(title)}" data-cat="${_escHtml(cat)}">
        <div class="browser-article-title">${_escHtml(title)}</div>
        <div class="browser-article-pillars browser-article-pillars-4">
            ${wordPillar}${dictPillar}${reorderPillar}${voicePillar}
        </div>
    </div>`;
}

document.getElementById('dash-sort-fam-btn')?.addEventListener('click', () => {
    _dashSortDir = _dashSortDir === 'desc' ? 'asc' : 'desc';
    renderScoresDashboard();
});

document.getElementById('scores-clear-all-btn')?.addEventListener('click', () => {
    openEditRecordsPanel();
});

// ══════════════════════════════════════════════════════════════
//  編輯紀錄 / 整理 / 清除面板（原版保留，僅 summary 呼叫改動）
// ══════════════════════════════════════════════════════════════

function openEditRecordsPanel() {
    const old = document.getElementById('edit-records-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'edit-records-overlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:9000;
        background:rgba(0,0,0,0.5);
        display:flex;align-items:center;justify-content:center;
        padding:20px;
    `;

    overlay.innerHTML = `
        <div id="edit-records-panel" style="
            background:var(--color-card,#fff);
            border-radius:18px;
            padding:28px 24px 24px;
            max-width:360px;width:100%;
            box-shadow:0 8px 40px rgba(0,0,0,0.22);
            text-align:center;
        ">
            <div style="font-size:1.6em;margin-bottom:6px;">✏️</div>
            <div style="font-size:1.1em;font-weight:700;margin-bottom:6px;">編輯紀錄</div>
            <div style="font-size:0.85em;color:var(--color-text-light,#888);margin-bottom:24px;">
                選擇要執行的操作
            </div>
            <div style="display:flex;flex-direction:column;gap:12px;">
                <button id="edit-records-organize-btn" style="
                    padding:14px 16px;border-radius:12px;border:none;
                    background:var(--color-primary,#4a90d9);color:#fff;
                    font-size:0.95em;font-weight:700;cursor:pointer;
                    display:flex;align-items:center;justify-content:center;gap:8px;
                ">
                    <span>🔍</span><span>整理測驗紀錄</span>
                </button>
                <div style="font-size:0.78em;color:var(--color-text-light,#999);margin-top:-6px;margin-bottom:4px;">
                    比對 timestamp，找出內容有落差的孤立紀錄
                </div>
                <button id="edit-records-clear-btn" style="
                    padding:14px 16px;border-radius:12px;border:none;
                    background:#e05c5c;color:#fff;
                    font-size:0.95em;font-weight:700;cursor:pointer;
                    display:flex;align-items:center;justify-content:center;gap:8px;
                ">
                    <span>🗑</span><span>清除測驗紀錄</span>
                </button>
                <div style="font-size:0.78em;color:var(--color-text-light,#999);margin-top:-6px;">
                    刪除全部或指定文章的測驗紀錄
                </div>
            </div>
            <button id="edit-records-close-btn" style="
                margin-top:20px;padding:9px 24px;border-radius:10px;
                border:1.5px solid var(--color-border,#ddd);
                background:transparent;color:var(--color-text,#333);
                font-size:0.9em;cursor:pointer;
            ">取消</button>
        </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById('edit-records-close-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('edit-records-organize-btn').addEventListener('click', () => { overlay.remove(); openOrganizePanel(); });
    document.getElementById('edit-records-clear-btn').addEventListener('click', () => { overlay.remove(); openClearPanel(); });
}

function openOrganizePanel() {
    const old = document.getElementById('organize-overlay');
    if (old) old.remove();

    const storyList = typeof stories !== 'undefined' ? stories : [];
    const majors = [...new Set(storyList.map(s => s['大類'] || 'Uncategorized'))].sort();
    const overlay = document.createElement('div');
    overlay.id = 'organize-overlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:9100;
        background:rgba(0,0,0,0.5);
        display:flex;align-items:flex-start;justify-content:center;
        padding:20px;overflow-y:auto;
    `;

    const majorOptions = majors.map(m => `<option value="${_escHtml(m)}">${_escHtml(m)}</option>`).join('');

    overlay.innerHTML = `
        <div id="organize-panel" style="
            background:var(--color-card,#fff);
            border-radius:18px;
            padding:24px 20px 20px;
            max-width:480px;width:100%;
            box-shadow:0 8px 40px rgba(0,0,0,0.22);
            margin:auto;
        ">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
                <span style="font-size:1.3em;">🔍</span>
                <span style="font-size:1.05em;font-weight:700;">整理測驗紀錄</span>
                <button id="organize-back-btn" style="
                    margin-left:auto;padding:6px 14px;border-radius:8px;
                    border:1.5px solid var(--color-border,#ddd);
                    background:transparent;color:var(--color-text,#333);
                    font-size:0.85em;cursor:pointer;
                ">← 返回</button>
            </div>
            <div style="font-size:0.85em;color:var(--color-text-light,#777);margin-bottom:18px;line-height:1.5;">
                比對 timestamp 實際內容，找出測驗紀錄中已不存在的孤立句子。
            </div>
            <div style="margin-bottom:16px;">
                <div style="font-size:0.82em;font-weight:600;color:var(--color-text-light,#888);margin-bottom:8px;">整理範圍</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="org-scope-btn is-active" data-scope="all" style="padding:7px 14px;border-radius:20px;border:1.5px solid var(--color-primary,#4a90d9);background:var(--color-primary,#4a90d9);color:#fff;font-size:0.85em;cursor:pointer;font-weight:600;">全部整理</button>
                    <button class="org-scope-btn" data-scope="major" style="padding:7px 14px;border-radius:20px;border:1.5px solid var(--color-border,#ddd);background:transparent;color:var(--color-text,#333);font-size:0.85em;cursor:pointer;">分類整理</button>
                    <button class="org-scope-btn" data-scope="single" style="padding:7px 14px;border-radius:20px;border:1.5px solid var(--color-border,#ddd);background:transparent;color:var(--color-text,#333);font-size:0.85em;cursor:pointer;">個別整理</button>
                </div>
            </div>
            <div id="org-major-row" style="display:none;margin-bottom:14px;">
                <select id="org-major-select" style="width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid var(--color-border,#ddd);background:var(--color-bg,#f5f5f5);font-size:0.9em;color:var(--color-text,#333);">
                    <option value="">— 選擇大類 —</option>${majorOptions}
                </select>
            </div>
            <div id="org-article-row" style="display:none;margin-bottom:14px;">
                <select id="org-major-select-for-single" style="width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid var(--color-border,#ddd);background:var(--color-bg,#f5f5f5);font-size:0.9em;color:var(--color-text,#333);margin-bottom:8px;">
                    <option value="">— 選擇大類 —</option>${majorOptions}
                </select>
                <select id="org-cat-select" style="width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid var(--color-border,#ddd);background:var(--color-bg,#f5f5f5);font-size:0.9em;color:var(--color-text,#333);margin-bottom:8px;display:none;">
                    <option value="">— 選擇分類 —</option>
                </select>
                <select id="org-article-select" style="width:100%;padding:9px 12px;border-radius:10px;border:1.5px solid var(--color-border,#ddd);background:var(--color-bg,#f5f5f5);font-size:0.9em;color:var(--color-text,#333);display:none;">
                    <option value="">— 選擇文章 —</option>
                </select>
            </div>
            <button id="org-scan-btn" style="width:100%;padding:12px;border-radius:12px;border:none;background:var(--color-primary,#4a90d9);color:#fff;font-size:0.95em;font-weight:700;cursor:pointer;margin-bottom:16px;">🔍 開始掃描</button>
            <div id="org-results-area" style="display:none;">
                <div id="org-results-summary" style="font-size:0.85em;padding:10px 14px;border-radius:10px;background:rgba(0,0,0,0.04);margin-bottom:12px;color:var(--color-text,#333);"></div>
                <div id="org-results-list" style="max-height:340px;overflow-y:auto;"></div>
                <div id="org-action-bar" style="display:none;margin-top:14px;display:flex;gap:10px;justify-content:flex-end;">
                    <button id="org-delete-all-btn" style="padding:9px 18px;border-radius:10px;border:none;background:#e05c5c;color:#fff;font-size:0.88em;font-weight:700;cursor:pointer;">🗑 全部刪除</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('organize-back-btn').addEventListener('click', () => { overlay.remove(); openEditRecordsPanel(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    let currentScope = 'all';
    overlay.querySelectorAll('.org-scope-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            overlay.querySelectorAll('.org-scope-btn').forEach(b => {
                b.style.background = 'transparent';
                b.style.color = 'var(--color-text,#333)';
                b.style.borderColor = 'var(--color-border,#ddd)';
            });
            btn.style.background = 'var(--color-primary,#4a90d9)';
            btn.style.color = '#fff';
            btn.style.borderColor = 'var(--color-primary,#4a90d9)';
            currentScope = btn.dataset.scope;
            document.getElementById('org-major-row').style.display   = currentScope === 'major'  ? '' : 'none';
            document.getElementById('org-article-row').style.display = currentScope === 'single' ? '' : 'none';
            document.getElementById('org-results-area').style.display = 'none';
        });
    });

    const storyList2 = typeof stories !== 'undefined' ? stories : [];
    document.getElementById('org-major-select-for-single').addEventListener('change', function() {
        const major = this.value;
        const catSel = document.getElementById('org-cat-select');
        const artSel = document.getElementById('org-article-select');
        catSel.innerHTML = '<option value="">— 選擇分類 —</option>';
        artSel.innerHTML = '<option value="">— 選擇文章 —</option>';
        artSel.style.display = 'none';
        if (!major) { catSel.style.display = 'none'; return; }
        const cats = [...new Set(storyList2.filter(s => (s['大類']||'Uncategorized') === major).map(s => s['分類']?.[0]||'Uncategorized'))].sort();
        cats.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o); });
        catSel.style.display = '';
    });
    document.getElementById('org-cat-select').addEventListener('change', function() {
        const major = document.getElementById('org-major-select-for-single').value;
        const cat = this.value;
        const artSel = document.getElementById('org-article-select');
        artSel.innerHTML = '<option value="">— 選擇文章 —</option>';
        if (!cat) { artSel.style.display = 'none'; return; }
        const arts = storyList2.filter(s => (s['大類']||'Uncategorized') === major && (s['分類']?.[0]||'Uncategorized') === cat).map(s => s['標題']).sort();
        arts.forEach(t => { const o = document.createElement('option'); o.value = t; o.textContent = t; artSel.appendChild(o); });
        artSel.style.display = '';
    });

    document.getElementById('org-scan-btn').addEventListener('click', async () => {
        const scanBtn = document.getElementById('org-scan-btn');
        scanBtn.textContent = '⏳ 掃描中…';
        scanBtn.disabled = true;

        let targets = [];
        const itemData = loadItemScores();

        if (currentScope === 'all') {
            Object.keys(itemData).forEach(k => {
                const [cat, title] = k.split('||');
                if (title) targets.push({ cat, title, key: k });
            });
        } else if (currentScope === 'major') {
            const major = document.getElementById('org-major-select').value;
            if (!major) { scanBtn.textContent = '🔍 開始掃描'; scanBtn.disabled = false; showNotification('請先選擇大類', 'warning'); return; }
            Object.keys(itemData).forEach(k => {
                const [cat, title] = k.split('||');
                if (!title) return;
                const s = storyList2.find(s => s['標題'] === title);
                if (s && (s['大類']||'Uncategorized') === major) targets.push({ cat, title, key: k });
            });
        } else {
            const title = document.getElementById('org-article-select').value;
            if (!title) { scanBtn.textContent = '🔍 開始掃描'; scanBtn.disabled = false; showNotification('請先選擇文章', 'warning'); return; }
            const cat = document.getElementById('org-cat-select').value;
            const key = `${cat}||${title}`;
            if (itemData[key]) targets.push({ cat, title, key });
        }

        if (targets.length === 0) {
            scanBtn.textContent = '🔍 開始掃描';
            scanBtn.disabled = false;
            document.getElementById('org-results-area').style.display = '';
            document.getElementById('org-results-summary').textContent = '此範圍內沒有測驗紀錄。';
            document.getElementById('org-results-list').innerHTML = '';
            document.getElementById('org-action-bar').style.display = 'none';
            return;
        }

        const orphans = [];
        const norm = t => t.trim().replace(/[.,?!'"``""'']/g, '').toLowerCase();

        for (const { cat, title, key } of targets) {
            const entry = itemData[key];
            if (!entry) continue;
            let tsData = null;
            if (typeof getTimestampForStory === 'function') {
                try { tsData = await getTimestampForStory(title); } catch(e) {}
            }
            const tsSentences = tsData ? new Set(tsData.map(l => norm(l.sentence))) : null;

            ['noteSentences','articleSentences'].forEach(itype => {
                if (!entry[itype]) return;
                const typeLabel = itype === 'noteSentences' ? 'Note 句子' : '文章句子';
                Object.keys(entry[itype]).forEach(text => {
                    const isOrphan = tsSentences ? !tsSentences.has(norm(text)) : false;
                    if (isOrphan) orphans.push({ key, cat, title, type: itype, typeLabel, text });
                });
            });

            const storyExists = storyList2.some(s => s['標題'] === title);
            if (!storyExists) {
                ['noteWords','articleWords'].forEach(itype => {
                    if (!entry[itype]) return;
                    const typeLabel = itype === 'noteWords' ? 'Note 單字' : '文章單字';
                    Object.keys(entry[itype]).forEach(text => {
                        orphans.push({ key, cat, title, type: itype, typeLabel, text });
                    });
                });
            }
        }

        scanBtn.textContent = '🔍 開始掃描';
        scanBtn.disabled = false;

        document.getElementById('org-results-area').style.display = '';
        const summaryEl = document.getElementById('org-results-summary');
        const listEl    = document.getElementById('org-results-list');
        const actionBar = document.getElementById('org-action-bar');

        if (orphans.length === 0) {
            summaryEl.innerHTML = '✅ 沒有發現孤立紀錄，所有測驗記錄與 timestamp 一致！';
            listEl.innerHTML = '';
            actionBar.style.display = 'none';
            return;
        }

        summaryEl.innerHTML = `⚠️ 發現 <strong>${orphans.length}</strong> 筆孤立紀錄`;
        actionBar.style.display = 'flex';

        const grouped = {};
        orphans.forEach(o => {
            if (!grouped[o.key]) grouped[o.key] = { title: o.title, cat: o.cat, items: [] };
            grouped[o.key].items.push(o);
        });

        listEl.innerHTML = '';
        Object.values(grouped).forEach(group => {
            const section = document.createElement('div');
            section.style.cssText = 'margin-bottom:14px;border:1px solid var(--color-border,#eee);border-radius:12px;overflow:hidden;';
            const header = document.createElement('div');
            header.style.cssText = 'padding:10px 14px;background:rgba(0,0,0,0.04);display:flex;align-items:center;gap:8px;';
            header.innerHTML = `
                <span style="font-size:0.9em;font-weight:700;flex:1;">📄 ${_escHtml(group.title)}</span>
                <span style="font-size:0.78em;color:#e05c5c;font-weight:600;">${group.items.length} 筆</span>
                <button class="org-del-article-btn" data-key="${_escHtml(group.items[0].key)}" style="padding:4px 10px;border-radius:7px;border:none;background:#e05c5c;color:#fff;font-size:0.78em;cursor:pointer;font-weight:600;">全刪</button>
            `;
            section.appendChild(header);
            group.items.forEach(orphan => {
                const row = document.createElement('div');
                row.style.cssText = 'padding:8px 14px;display:flex;align-items:flex-start;gap:8px;border-top:1px solid var(--color-border,#eee);';
                row.dataset.orphanKey  = orphan.key;
                row.dataset.orphanType = orphan.type;
                row.dataset.orphanText = orphan.text;
                row.innerHTML = `
                    <span style="font-size:0.72em;padding:2px 7px;border-radius:10px;background:rgba(224,92,92,0.12);color:#c0392b;white-space:nowrap;margin-top:2px;">${_escHtml(orphan.typeLabel)}</span>
                    <span style="font-size:0.83em;flex:1;line-height:1.5;color:var(--color-text,#333);">${_escHtml(orphan.text)}</span>
                    <button class="org-del-item-btn" style="flex-shrink:0;padding:3px 8px;border-radius:6px;border:none;background:rgba(224,92,92,0.1);color:#c0392b;font-size:0.75em;cursor:pointer;">刪</button>
                `;
                section.appendChild(row);
            });
            listEl.appendChild(section);
        });

        // Delete single item
        listEl.querySelectorAll('.org-del-item-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const row  = btn.closest('[data-orphan-key]');
                const key  = row.dataset.orphanKey;
                const type = row.dataset.orphanType;
                const text = row.dataset.orphanText;
                const d = loadItemScores();
                if (d[key]?.[type]?.[text]) {
                    delete d[key][type][text];
                    saveItemScores(d);
                    row.remove();
                    showNotification('已刪除 1 筆孤立紀錄', 'success');
                }
            });
        });

        // Delete by article
        listEl.querySelectorAll('.org-del-article-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key = btn.dataset.key;
                const d = loadItemScores();
                if (d[key]) {
                    ['noteSentences','articleSentences','noteWords','articleWords'].forEach(itype => {
                        // Only delete orphan items, not all
                        const section = btn.closest('[style*="margin-bottom:14px"]');
                        if (section) {
                            section.querySelectorAll('[data-orphan-key]').forEach(row => {
                                if (row.dataset.orphanKey === key) {
                                    const t = row.dataset.orphanType;
                                    const tx = row.dataset.orphanText;
                                    if (d[key]?.[t]?.[tx]) delete d[key][t][tx];
                                }
                            });
                        }
                    });
                    saveItemScores(d);
                    btn.closest('[style*="margin-bottom:14px"]')?.remove();
                    showNotification(`已刪除文章的孤立紀錄`, 'success');
                }
            });
        });

        // Delete all orphans
        document.getElementById('org-delete-all-btn').addEventListener('click', () => {
            if (!confirm(`確定刪除所有 ${orphans.length} 筆孤立紀錄？`)) return;
            const d = loadItemScores();
            orphans.forEach(o => {
                if (d[o.key]?.[o.type]?.[o.text]) delete d[o.key][o.type][o.text];
            });
            saveItemScores(d);
            renderScoresDashboard();
            overlay.remove();
            showNotification(`已刪除 ${orphans.length} 筆孤立紀錄`, 'success');
        });
    });
}

function openClearPanel() {
    const old = document.getElementById('clear-overlay');
    if (old) old.remove();

    const storyList = typeof stories !== 'undefined' ? stories : [];
    const itemData  = loadItemScores();

    const overlay = document.createElement('div');
    overlay.id = 'clear-overlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:9100;
        background:rgba(0,0,0,0.5);
        display:flex;align-items:flex-start;justify-content:center;
        padding:20px;overflow-y:auto;
    `;

    // Build article list grouped by major/cat
    const majorMap = {};
    storyList.forEach(s => {
        const major = s['大類'] || 'Uncategorized';
        const cat   = s['分類']?.[0] || 'Uncategorized';
        if (!majorMap[major]) majorMap[major] = {};
        if (!majorMap[major][cat]) majorMap[major][cat] = [];
        majorMap[major][cat].push(s['標題']);
    });
    Object.keys(itemData).forEach(k => {
        const [cat, title] = k.split('||');
        if (!title) return;
        const found = storyList.find(s => s['標題'] === title);
        if (!found) {
            if (!majorMap['Other']) majorMap['Other'] = {};
            if (!majorMap['Other'][cat]) majorMap['Other'][cat] = [];
            if (!majorMap['Other'][cat].includes(title)) majorMap['Other'][cat].push(title);
        }
    });

    let articlesHtml = '';
    Object.keys(majorMap).sort().forEach(major => {
        Object.keys(majorMap[major]).sort().forEach(cat => {
            majorMap[major][cat].sort().forEach(title => {
                const key = `${cat}||${title}`;
                const hasData = !!itemData[key];
                const count = hasData ? _countRecords(itemData[key]) : 0;
                articlesHtml += `
                    <div class="clr-article-row" style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--color-border,#eee);">
                        <input type="checkbox" class="clr-art-check" data-key="${_escHtml(key)}" ${!hasData ? 'disabled' : ''} style="flex-shrink:0;">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.83em;font-weight:600;color:var(--color-text,#333);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${_escHtml(title)}</div>
                            <div style="font-size:0.72em;color:var(--color-text-light,#888);">${_escHtml(cat)} · ${hasData ? count + ' 筆記錄' : '無記錄'}</div>
                        </div>
                    </div>`;
            });
        });
    });

    overlay.innerHTML = `
        <div style="background:var(--color-card,#fff);border-radius:18px;padding:24px 20px 20px;max-width:480px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.22);margin:auto;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
                <span style="font-size:1.3em;">🗑</span>
                <span style="font-size:1.05em;font-weight:700;">清除測驗紀錄</span>
                <button id="clr-back-btn" style="margin-left:auto;padding:6px 14px;border-radius:8px;border:1.5px solid var(--color-border,#ddd);background:transparent;color:var(--color-text,#333);font-size:0.85em;cursor:pointer;">← 返回</button>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                <input type="checkbox" id="clr-select-all">
                <label for="clr-select-all" style="font-size:0.85em;font-weight:600;">全選</label>
                <button id="clr-delete-selected-btn" disabled style="margin-left:auto;padding:7px 16px;border-radius:8px;border:none;background:#e05c5c;color:#fff;font-size:0.85em;font-weight:700;cursor:pointer;opacity:0.4;pointer-events:none;">🗑 刪除勾選</button>
                <button id="clr-delete-all-btn" style="padding:7px 16px;border-radius:8px;border:none;background:#c0392b;color:#fff;font-size:0.85em;font-weight:700;cursor:pointer;">全部清除</button>
            </div>
            <div style="max-height:400px;overflow-y:auto;">${articlesHtml}</div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('clr-back-btn').addEventListener('click', () => { overlay.remove(); openEditRecordsPanel(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.clr-art-check').forEach(chk => {
        chk.addEventListener('change', () => _updateClearDeleteBtn(overlay));
    });
    document.getElementById('clr-select-all').addEventListener('change', function() {
        overlay.querySelectorAll('.clr-art-check:not(:disabled)').forEach(c => c.checked = this.checked);
        _updateClearDeleteBtn(overlay);
    });
    document.getElementById('clr-delete-selected-btn').addEventListener('click', () => {
        const checked = [...overlay.querySelectorAll('.clr-art-check:checked')];
        if (checked.length === 0) return;
        if (!confirm(`確定要刪除 ${checked.length} 篇文章的測驗紀錄？`)) return;
        const data = loadItemScores();
        checked.forEach(chk => {
            delete data[chk.dataset.key];
            chk.closest('.clr-article-row').style.opacity = '0.3';
            chk.disabled = true;
            chk.checked  = false;
        });
        saveItemScores(data);
        _syncClearToFirestore(data);
        _updateClearDeleteBtn(overlay);
        showNotification(`已刪除 ${checked.length} 篇文章的測驗紀錄。`, 'success');
        renderScoresDashboard();
    });
    document.getElementById('clr-delete-all-btn').addEventListener('click', () => {
        if (!confirm('⚠️ 清除所有學習記錄？\n此操作無法還原。')) return;
        localStorage.removeItem(ITEM_SCORES_KEY);
        if (typeof QUIZ_SCORES_KEY !== 'undefined') localStorage.removeItem(QUIZ_SCORES_KEY);
        _syncClearToFirestore({});
        overlay.remove();
        renderScoresDashboard();
        showNotification('已清除所有測驗紀錄。', 'success');
    });
}

function _countRecords(entry) {
    let n = 0;
    ['noteWords','noteSentences','articleWords','articleSentences'].forEach(t => {
        if (entry[t]) n += Object.keys(entry[t]).length;
    });
    return n;
}

function _updateClearDeleteBtn(overlay) {
    const count  = overlay.querySelectorAll('.clr-art-check:checked').length;
    const btn    = document.getElementById('clr-delete-selected-btn');
    const allChk = document.getElementById('clr-select-all');
    const total  = overlay.querySelectorAll('.clr-art-check:not(:disabled)').length;
    btn.disabled = count === 0;
    btn.style.opacity       = count > 0 ? '1' : '0.4';
    btn.style.pointerEvents = count > 0 ? 'auto' : 'none';
    btn.textContent = count > 0 ? `🗑 刪除勾選（${count}）` : '🗑 刪除勾選';
    allChk.indeterminate = count > 0 && count < total;
    allChk.checked       = total > 0 && count === total;
}

function _syncClearToFirestore(data) {
    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ itemScores: data, quizScores: {} }, { merge: true })
          .catch(err => console.error('Score clear error:', err));
    }
}

// ── 匯出 / 匯入 ───────────────────────────────────────────────

document.getElementById('scores-export-btn')?.addEventListener('click', () => exportItemScores());

function exportItemScores() {
    const data = loadItemScores();
    const artSentTotals = loadArticleSentTotals();
    const exportObj = {
        version: '3.0',
        exportDate: new Date().toISOString(),
        exportedBy: (typeof currentUser !== 'undefined' && currentUser)
            ? (currentUser.email || currentUser.uid) : 'unknown',
        itemScores: data,
        articleSentTotals: artSentTotals
    };
    const json = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `learning-scores-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    alert(`✅ 匯出成功！共 ${Object.keys(data).length} 篇文章的學習記錄。`);
}

document.getElementById('scores-import-btn')?.addEventListener('click', () => {
    document.getElementById('scores-import-input')?.click();
});

document.getElementById('scores-import-input')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    importItemScores(file);
    e.target.value = '';
});

function importItemScores(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const obj = JSON.parse(e.target.result);
            if (!obj.itemScores || typeof obj.itemScores !== 'object') {
                alert('❌ 檔案格式錯誤：找不到 itemScores 欄位。');
                return;
            }
            const incoming    = obj.itemScores;
            const incomingKeys = Object.keys(incoming).length;
            if (!confirm(`📥 確認匯入 ${incomingKeys} 篇文章的學習記錄？\n匯入方式：合併（累加 correct/wrong）`)) return;

            const current = loadItemScores();
            Object.keys(incoming).forEach(articleKey => {
                if (!current[articleKey]) { current[articleKey] = incoming[articleKey]; return; }
                ['noteWords','noteSentences','articleWords','articleSentences'].forEach(itype => {
                    if (!incoming[articleKey][itype]) return;
                    if (!current[articleKey][itype]) { current[articleKey][itype] = incoming[articleKey][itype]; return; }
                    Object.keys(incoming[articleKey][itype]).forEach(text => {
                        const inc = incoming[articleKey][itype][text];
                        const cur = current[articleKey][itype][text];
                        if (!cur) { current[articleKey][itype][text] = inc; return; }
                        ['fc','fcplus','dictation','reorder','voiceReorder','articleListen'].forEach(src => {
                            if (!inc[src]) return;
                            if (!cur[src]) { cur[src] = inc[src]; return; }
                            cur[src].correct = (cur[src].correct || 0) + (inc[src].correct || 0);
                            cur[src].wrong   = (cur[src].wrong   || 0) + (inc[src].wrong   || 0);
                            // 合併 per-source lastSeen（取較晚的）
                            if (inc[src].lastSeen && (!cur[src].lastSeen || inc[src].lastSeen > cur[src].lastSeen)) {
                                cur[src].lastSeen = inc[src].lastSeen;
                            }
                        });
                        if (inc.firstSeen && (!cur.firstSeen || inc.firstSeen < cur.firstSeen)) cur.firstSeen = inc.firstSeen;
                        if (inc.lastSeen  && (!cur.lastSeen  || inc.lastSeen  > cur.lastSeen))  cur.lastSeen  = inc.lastSeen;
                    });
                });
            });

            cleanLegacyFields(current);
            saveItemScores(current);

            if (obj.articleSentTotals && typeof obj.articleSentTotals === 'object') {
                const curTotals = loadArticleSentTotals();
                Object.assign(curTotals, obj.articleSentTotals);
                saveArticleSentTotals(curTotals);
            }

            renderScoresDashboard();
            alert(`✅ 匯入成功！已合併 ${incomingKeys} 篇文章的學習記錄。`);
        } catch (err) {
            alert('❌ 匯入失敗：' + err.message);
            console.error('Import error:', err);
        }
    };
    reader.readAsText(file);
}

function renderHomeReviewBadge() {}

function saveQuizScore(categoryName, titleName, mode, score, total) {
    if (typeof QUIZ_SCORES_KEY === 'undefined') return;
    const scores = typeof loadQuizScores === 'function' ? loadQuizScores() : {};
    const key = `${categoryName}||${titleName}`;
    if (!scores[key]) scores[key] = {};
    if (!scores[key][mode]) scores[key][mode] = { best: 0, last: 0, count: 0 };
    const entry = scores[key][mode];
    if (entry.count === 0) entry.first = score;
    entry.last  = score;
    entry.best  = Math.max(entry.best, score);
    entry.total = total;
    entry.count++;
    entry.lastDate = new Date().toLocaleDateString();
    localStorage.setItem(QUIZ_SCORES_KEY, JSON.stringify(scores));
    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ quizScores: scores }, { merge: true })
          .catch(err => console.error('Quiz score save error:', err));
    }
}

// ══════════════════════════════════════════════════════════════
//  PART 2 — ARTICLE DETAIL VIEW（四 tab）
// ══════════════════════════════════════════════════════════════

let detailViewState = {
    categoryName: null,
    titleName:    null,
    tab:          'noteWords',    // 'noteWords' | 'dictation' | 'reorder' | 'voiceReorder'
    sortBy:       'fam',          // 'fam' | 'alpha' | 'recent' | 'untested' | 'wrong'
    sortDir:      'asc',
    fromNote:     false,
    _tsData:      null,
    modeFilter:   'all',          // 'all' | 'untested' | 'practiced'（適用所有 tab）
};

function _navigateToArticle(categoryName, titleName) {
    if (typeof stories === 'undefined' || !stories.length) {
        if (typeof showNotification === 'function') showNotification('文章資料尚未載入，請稍後再試。', 'warning');
        return;
    }
    const story = stories.find(s => s['標題'] === titleName);
    if (!story) {
        if (typeof showNotification === 'function') showNotification(`找不到文章「${titleName}」。`, 'error');
        return;
    }
    const category = story['分類']?.[0] || categoryName;
    const major    = story['大類'] || 'Uncategorized';
    currentMajorCategory = major;
    const storyListForCat = stories
        .filter(item => {
            const matchMajor = (item['大類'] || 'Uncategorized') === major;
            const matchSub   = item['分類']?.map(c => c.trim()).includes(category);
            return matchMajor && matchSub;
        })
        .sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));
    const indexInList = storyListForCat.findIndex(s => s['標題'] === titleName);
    if (indexInList === -1) {
        if (typeof showNotification === 'function') showNotification(`無法定位文章「${titleName}」。`, 'error');
        return;
    }
    if (typeof showCategory === 'function' && typeof showPlayback === 'function') {
        showCategory(category);
        showPlayback(indexInList, 0);
    }
}

async function openDetailView(categoryName, titleName) {
    detailViewState.categoryName = categoryName;
    detailViewState.titleName    = titleName;
    detailViewState.tab          = 'noteWords';
    detailViewState.sortBy       = 'fam';
    detailViewState.sortDir      = 'asc';
    detailViewState._tsData      = null;
    detailViewState.modeFilter   = 'all';

    document.getElementById('detail-view-title').textContent = titleName;
    showView(document.getElementById('item-detail-view'));
    renderDetailView();

    // 載入 Timestamp（D / R / VR tab 需要）
    if (typeof getTimestampForStory === 'function') {
        const listEl = document.getElementById('detail-items-list');
        document.getElementById('detail-ts-loading')?.remove();
        const banner = document.createElement('div');
        banner.id = 'detail-ts-loading';
        banner.className = 'detail-ts-loading-banner';
        banner.textContent = '⏳ 載入 Timestamp 中…';
        listEl?.parentElement?.insertBefore(banner, listEl);

        try {
            detailViewState._tsData = await getTimestampForStory(titleName);
            await _updateArticleSentenceTotal(categoryName, titleName);
        } catch (e) {
            console.error('Timestamp load error:', e);
            detailViewState._tsData = null;
        }

        document.getElementById('detail-ts-loading')?.remove();

        // 若目前在句子相關 tab，重新渲染
        if (['dictation','reorder','voiceReorder'].includes(detailViewState.tab)) {
            renderDetailView();
        }
    }
}

function renderDetailView() {
    const { categoryName, titleName, tab, sortBy, sortDir, modeFilter } = detailViewState;
    const data  = loadItemScores();
    const key   = `${categoryName}||${titleName}`;
    const entry = data[key] || {};

    // Tab buttons
    document.querySelectorAll('.detail-tab-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.tab === tab);
    });

    // 篩選列：所有 tab 都顯示
    const filterBar = document.getElementById('detail-mode-filter-bar');
    if (filterBar) {
        filterBar.classList.remove('is-hidden');
        filterBar.querySelectorAll('.detail-mode-filter-btn').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.filter === modeFilter);
        });
    }

    // Sort buttons
    document.querySelectorAll('.detail-sort-btn').forEach(btn => {
        const isActive = btn.dataset.sort === sortBy;
        btn.classList.toggle('is-active', isActive);
        if (isActive) {
            btn.textContent = btn.dataset.label + (sortDir === 'asc' ? ' ↑' : ' ↓');
        } else {
            btn.textContent = btn.dataset.label;
        }
    });

    const tabCfg = _getTabConfig(tab);
    let items = [];

    if (tab === 'noteWords') {
        // ── 單字 tab ──────────────────────────────────────────
        const itemMap = entry['noteWords'] || {};
        items = Object.entries(itemMap).map(([text, rec]) => {
            const { effectiveFam, rawFam, days } = calcWordFam(rec);
            const famScore = effectiveFam ?? 0;
            const hasPractice = !!(rec?.fcplus && (rec.fcplus.correct + rec.fcplus.wrong) > 0);
            const lastSeen = rec?.fcplus?.lastSeen || rec?.lastSeen || null;
            return {
                text, rec, famScore, rawFam, days,
                hasPractice, lastSeen,
                correct: rec?.fcplus?.correct || 0,
                wrong:   rec?.fcplus?.wrong   || 0,
            };
        });

        // 補入 savedWords 未測驗單字
        if (typeof savedWords !== 'undefined') {
            const noteData = savedWords[categoryName]?.[titleName] || {};
            const pool = [...(noteData.words || []), ...(noteData.phrases || [])];
            pool.forEach(text => {
                const t = text.trim();
                if (!itemMap[t]) {
                    items.push({ text: t, rec: null, famScore: 0, rawFam: null, days: 0,
                                 hasPractice: false, lastSeen: null, correct: 0, wrong: 0 });
                }
            });
        }

    } else {
        // ── 句子 tab（dictation / reorder / voiceReorder）───────
        const tsData = detailViewState._tsData;
        const sourceKey = tabCfg.sourceKey;

        // 合併 noteSentences + articleSentences 的 map
        const mergedMap = {};
        ['noteSentences', 'articleSentences'].forEach(itype => {
            Object.entries(entry[itype] || {}).forEach(([text, rec]) => {
                const k = normSentence(text);
                if (!mergedMap[k]) {
                    mergedMap[k] = { rec: JSON.parse(JSON.stringify(rec)), text };
                } else {
                    // 合併同一句子在不同 itype 中的記錄
                    const sources = ['fc','fcplus','dictation','reorder','voiceReorder','articleListen'];
                    sources.forEach(s => {
                        if (!rec[s]) return;
                        if (!mergedMap[k].rec[s]) mergedMap[k].rec[s] = { correct: 0, wrong: 0, lastSeen: null };
                        mergedMap[k].rec[s].correct += rec[s].correct || 0;
                        mergedMap[k].rec[s].wrong   += rec[s].wrong   || 0;
                        if (rec[s].lastSeen && (!mergedMap[k].rec[s].lastSeen || rec[s].lastSeen > mergedMap[k].rec[s].lastSeen)) {
                            mergedMap[k].rec[s].lastSeen = rec[s].lastSeen;
                        }
                    });
                    if (rec.lastSeen && (!mergedMap[k].rec.lastSeen || rec.lastSeen > mergedMap[k].rec.lastSeen)) {
                        mergedMap[k].rec.lastSeen = rec.lastSeen;
                    }
                }
            });
        });

        const buildItem = (sentence, rec) => {
            const srcRec   = rec?.[sourceKey] || null;
            const { effectiveFam, rawFam, days } = _calcSourceFamWithDecay(srcRec, sourceKey);
            const famScore    = effectiveFam ?? 0;
            const hasPractice = !!(srcRec && (srcRec.correct + srcRec.wrong) > 0);
            const lastSeen    = srcRec?.lastSeen || rec?.lastSeen || null;
            return {
                text: sentence, rec,
                famScore, rawFam, days, hasPractice, lastSeen,
                correct: srcRec?.correct || 0,
                wrong:   srcRec?.wrong   || 0,
            };
        };

        if (tsData && tsData.length > 0) {
            tsData.forEach(line => {
                const sentence = line.sentence?.trim();
                if (!sentence) return;
                const found = mergedMap[normSentence(sentence)];
                items.push(buildItem(sentence, found?.rec || null));
            });
        } else {
            // Timestamp 未載入：只顯示已有記錄的句子
            Object.values(mergedMap).forEach(({ text, rec }) => {
                items.push(buildItem(text, rec));
            });
        }
    }

    // ── 篩選 ───────────────────────────────────────────────────
    let filteredItems = items;
    if (modeFilter === 'untested') {
        filteredItems = items.filter(i => !i.hasPractice);
    } else if (modeFilter === 'practiced') {
        filteredItems = items.filter(i => i.hasPractice);
    }

    // ── 排序 ───────────────────────────────────────────────────
    filteredItems.sort((a, b) => {
        if (sortBy === 'alpha') {
            const va = a.text.toLowerCase(), vb = b.text.toLowerCase();
            return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        if (sortBy === 'recent') {
            const va = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
            const vb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
            return sortDir === 'asc' ? va - vb : vb - va;
        }
        if (sortBy === 'untested') {
            const ua = a.hasPractice ? 1 : 0;
            const ub = b.hasPractice ? 1 : 0;
            if (ua !== ub) return sortDir === 'desc' ? ua - ub : ub - ua;
            return a.text.toLowerCase().localeCompare(b.text.toLowerCase());
        }
        if (sortBy === 'wrong') {
            const wa = a.wrong || 0, wb = b.wrong || 0;
            if (wa !== wb) return sortDir === 'desc' ? wb - wa : wa - wb;
            return a.famScore - b.famScore;
        }
        return sortDir === 'asc' ? a.famScore - b.famScore : b.famScore - a.famScore;
    });

    // ── Summary bar ─────────────────────────────────────────────
    const tested   = filteredItems.filter(i => i.hasPractice).length;
    const untested = filteredItems.length - tested;
    const avgFam   = filteredItems.length > 0
        ? Math.round(filteredItems.reduce((s, i) => s + i.famScore, 0) / filteredItems.length) : 0;
    const famClass = avgFam >= 60 ? 'chip-ok' : avgFam >= 30 ? 'chip-warn' : 'chip-danger';

    const filterLabel = modeFilter !== 'all'
        ? ` <span class="detail-sum-chip chip-filter">篩選中：${filteredItems.length} / ${items.length}</span>`
        : '';

    document.getElementById('detail-summary-bar').innerHTML = `
        <span class="detail-sum-chip">共 ${items.length} 項</span>
        <span class="detail-sum-chip">✅ 已測 ${tested}</span>
        <span class="detail-sum-chip ${untested > 0 ? 'chip-warn' : ''}">⬜ 未測 ${untested}</span>
        <span class="detail-sum-chip ${famClass}">熟悉度 ${avgFam}%</span>
        ${filterLabel}
    `;

    // ── Items list ──────────────────────────────────────────────
    const listEl = document.getElementById('detail-items-list');
    if (filteredItems.length === 0) {
        const emptyMsg = modeFilter !== 'all'
            ? '沒有符合篩選條件的項目'
            : (tab === 'noteWords'
                ? '此文章尚無筆記單字'
                : (detailViewState._tsData
                    ? `此文章所有句子均未進行 ${tabCfg.label} 測驗`
                    : '載入 Timestamp 後將顯示所有句子'));
        listEl.innerHTML = `<div class="detail-empty">${emptyMsg}</div>`;
        return;
    }

    listEl.innerHTML = filteredItems.map(item => buildDetailItemHtml(item, tab)).join('');
}

// ── 出題桶（各 tab 獨立）───────────────────────────────────────

function _getItemBucketInfo(item, tab) {
    const { famScore, rawFam, days, hasPractice } = item;

    if (!hasPractice) {
        return { bucket: 'A', label: '🆕 未測驗', cssClass: 'bucket-a', effectiveFam: null };
    }

    const effectiveFam = famScore; // 已含衰減

    if (tab === 'voiceReorder') {
        // VR 不影響 quiz 出題，顯示紀錄標籤
        return { bucket: '-', label: '🎙 口說紀錄', cssClass: 'bucket-voice', effectiveFam, rawFam, days };
    }

    if (effectiveFam < 40)  return { bucket: 'B', label: '💪 需加強', cssClass: 'bucket-b', effectiveFam, rawFam, days };
    if (effectiveFam < 70)  return { bucket: 'C', label: '📈 進步中', cssClass: 'bucket-c', effectiveFam, rawFam, days };
    return                         { bucket: 'D', label: '✅ 已熟悉', cssClass: 'bucket-d', effectiveFam, rawFam, days };
}

function _bucketPriorityNote(bucket) {
    switch (bucket) {
        case 'A': return '出題機率 ★★★★★ (95%)';
        case 'B': return '出題機率 ★★★★☆ (剩餘×70%)';
        case 'C': return '出題機率 ★★★☆☆ (剩餘×20%)';
        case 'D': return '出題機率 ★☆☆☆☆ (剩餘×5%)';
        default:  return '';
    }
}

// ── 每個 item 的 HTML ──────────────────────────────────────────

function buildDetailItemHtml(item, tab) {
    const { text, famScore, hasPractice, lastSeen, correct, wrong, rawFam, days } = item;

    const colorClass = getItemColorClass(hasPractice, famScore, lastSeen);
    const daysAgo = lastSeen
        ? (daysSince(lastSeen) === 0 ? '今天' : `${daysSince(lastSeen)}天前`)
        : '—';

    const statsHtml = hasPractice
        ? `<span class="detail-stat correct-stat">✓ ${correct}</span>
           <span class="detail-stat wrong-stat">✗ ${wrong}</span>
           <span class="detail-stat days-stat">📅 ${daysAgo}</span>`
        : `<span class="detail-stat untested-stat">未測驗</span>`;

    // 衰減資訊
    const bucketInfo = _getItemBucketInfo(item, tab);

    let bucketHtml = '';
    if (hasPractice) {
        const decayNote = (rawFam !== null && rawFam !== bucketInfo.effectiveFam)
            ? `<span class="bucket-decay-note">原始 ${rawFam}% → 衰減後 ${bucketInfo.effectiveFam}% (${days}天)</span>`
            : (bucketInfo.effectiveFam !== null
                ? `<span class="bucket-decay-note">有效熟悉度 ${bucketInfo.effectiveFam}%</span>`
                : '');

        if (tab === 'voiceReorder') {
            bucketHtml = `<div class="detail-item-bucket">
                <span class="bucket-chip ${bucketInfo.cssClass}">${bucketInfo.label}</span>
                ${decayNote}
            </div>`;
        } else {
            bucketHtml = `<div class="detail-item-bucket">
                <span class="bucket-chip ${bucketInfo.cssClass}">${bucketInfo.label}</span>
                ${decayNote}
                <span class="bucket-priority-note">${_bucketPriorityNote(bucketInfo.bucket)}</span>
            </div>`;
        }
    }

    const isSentence = tab !== 'noteWords';
    const textClass  = isSentence ? 'detail-text-sentence' : 'detail-text-word';

    // source chip（單一來源，直接顯示）
    const tabCfg = _getTabConfig(tab);
    let sourceHtml = '';
    if (hasPractice) {
        const fam  = famScore;
        const fc   = getFamiliarityColor(fam);
        sourceHtml = `<div class="detail-item-sources">
            <span class="detail-src-chip ${fc}">${tabCfg.label} ${fam}% ✓${correct} ✗${wrong}</span>
        </div>`;
    }

    return `<div class="detail-item ${colorClass}">
        <div class="detail-item-top">
            <div class="detail-fam-badge ${colorClass}">${famScore}%</div>
            <div class="${textClass}">${_escHtml(text)}</div>
        </div>
        <div class="detail-score-bar-wrap">
            <div class="detail-score-bar ${colorClass}" style="width:${famScore}%"></div>
        </div>
        <div class="detail-item-stats">${statsHtml}</div>
        ${bucketHtml}
        ${sourceHtml}
    </div>`;
}

// ── Detail view event listeners ──────────────────────────────

document.getElementById('back-from-detail-view')?.addEventListener('click', () => {
    if (detailViewState.fromNote) {
        detailViewState.fromNote = false;
        showView(document.getElementById('note-view'));
    } else {
        showView(document.getElementById('scores-dashboard-view'));
    }
});

document.getElementById('detail-view-quiz-btn')?.addEventListener('click', () => {
    const { categoryName, titleName } = detailViewState;
    if (categoryName && titleName && typeof openQuiz === 'function') {
        openQuiz(categoryName, titleName, 'scores');
    }
});

document.getElementById('detail-view-read-btn')?.addEventListener('click', () => {
    const { categoryName, titleName } = detailViewState;
    if (!categoryName || !titleName) return;
    if (typeof _navigateToArticle === 'function') {
        _navigateToArticle(categoryName, titleName);
    }
});

// 四個 tab 按鈕
document.querySelectorAll('.detail-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        detailViewState.tab       = btn.dataset.tab;
        detailViewState.modeFilter = 'all';
        renderDetailView();
    });
});

// 篩選按鈕（全部 tab 共用）
document.getElementById('detail-mode-filter-bar')?.querySelectorAll('.detail-mode-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        detailViewState.modeFilter = btn.dataset.filter;
        renderDetailView();
    });
});

document.querySelectorAll('.detail-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (detailViewState.sortBy === btn.dataset.sort) {
            detailViewState.sortDir = detailViewState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            detailViewState.sortBy  = btn.dataset.sort;
            detailViewState.sortDir = btn.dataset.sort === 'fam' ? 'asc' : 'desc';
        }
        renderDetailView();
    });
});

// ── Note 頁入口 ───────────────────────────────────────────────

document.getElementById('note-learning-status-btn')?.addEventListener('click', () => {
    const cat   = typeof noteViewCategory !== 'undefined' ? noteViewCategory : null;
    const title = typeof noteViewTitle    !== 'undefined' ? noteViewTitle    : null;
    if (!cat || !title) {
        showNotification('請先選擇一篇文章的 Note', 'warning');
        return;
    }
    openDetailViewFromNote(cat, title);
});

function openDetailViewFromNote(categoryName, titleName) {
    detailViewState.fromNote = true;
    openDetailView(categoryName, titleName);
}

// ── Quiz 結果頁的 Scores 按鈕 ─────────────────────────────────
document.getElementById('quiz-goto-scores-btn')?.addEventListener('click', () => {
    const cat   = (typeof quizState !== 'undefined') ? quizState.categoryName : null;
    const title = (typeof quizState !== 'undefined') ? quizState.titleName    : null;
    if (cat && title && typeof openDetailView === 'function') {
        openDetailView(cat, title);
    } else {
        openScoresDashboard();
    }
});

// ══════════════════════════════════════════════════════════════
//  說明面板
// ══════════════════════════════════════════════════════════════

function openScoringInfoModal() {
    const modal = document.getElementById('scoring-info-modal');
    if (!modal) return;
    modal.classList.remove('is-hidden');
    modal.classList.add('is-visible');
}

function closeScoringInfoModal() {
    const modal = document.getElementById('scoring-info-modal');
    if (!modal) return;
    modal.classList.remove('is-visible');
    modal.classList.add('is-hidden');
}

document.getElementById('scoring-info-btn')?.addEventListener('click', openScoringInfoModal);
document.getElementById('scoring-info-close')?.addEventListener('click', closeScoringInfoModal);
document.getElementById('scoring-info-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeScoringInfoModal();
});

// ══════════════════════════════════════════════════════════════
//  QUIZ.JS 向後相容介面
// ══════════════════════════════════════════════════════════════

/**
 * quiz.js 的 calcEffectiveFamiliarity 與 weightedSample 需要知道
 * 各 source 的有效熟悉度。提供統一介面。
 *
 * quizSource: 'fcplus' | 'dictation' | 'reorder' | 'voiceReorder'
 */
function calcEffectiveFamiliarityBySource(rec, sourceKey) {
    return _calcSourceFamWithDecay(rec?.[sourceKey], sourceKey);
}

// 讓 quiz.js 的 weightedSample 可以直接呼叫
window.calcEffectiveFamiliarityBySource = calcEffectiveFamiliarityBySource;

// _recHasPractice：向後相容，供 quiz.js weightedSample 檢查用
function _recHasPractice(rec) {
    if (!rec) return false;
    return ['fc','fcplus','dictation','reorder','voiceReorder','articleListen'].some(s =>
        rec[s] && (rec[s].correct + rec[s].wrong) > 0
    );
}

// calcWeightedFamiliarity：向後相容，quiz.js calcEffectiveFamiliarity 備用路徑呼叫
function calcWeightedFamiliarity(rec, itemType) {
    return calcFamiliarity(rec, itemType);
}

console.log('✅ Scores Dashboard (四欄重構版 v3) loaded.');
