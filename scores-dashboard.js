// ============================================================
//  SCORES DASHBOARD — scores-dashboard.js  (重構版)
//
//  架構：
//  1. 分類瀏覽層：大類 → 分類（可折疊），列出文章 + 熟悉度
//  2. 文章細節頁：單字 / 句子的細粒度學習結果
//  3. 熟悉度排序：昇冪 / 降冪
//
//  依賴：quiz.js（需先載入）
//  localStorage keys:
//    - readingChallengeItemScores  → item 細粒度記錄
//    - readingChallengeQuizScores  → session 分數（仍保留寫入，但不顯示於此 Dashboard）
// ============================================================

// ══════════════════════════════════════════════════════════════
//  SHARED UTILITIES
// ══════════════════════════════════════════════════════════════

function daysSince(dateStr) {
    if (!dateStr) return Infinity;
    const d = new Date(dateStr);
    if (isNaN(d)) return Infinity;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function _todayStr() {
    return new Date().toLocaleDateString();
}

function _escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ══════════════════════════════════════════════════════════════
//  ITEM-LEVEL TRACKER（細粒度記錄）
// ══════════════════════════════════════════════════════════════

const ITEM_SCORES_KEY = 'readingChallengeItemScores';
const ART_SENT_TOTAL_KEY = 'readingChallengeArticleSentTotals';

// ── Article 句子總數快取（含未測驗）──────────────────────────
// 結構：{ "categoryName||titleName": { total: N, updatedAt: "date" } }

function loadArticleSentTotals() {
    try { return JSON.parse(localStorage.getItem(ART_SENT_TOTAL_KEY) || '{}'); }
    catch (e) { return {}; }
}

function saveArticleSentTotals(data) {
    localStorage.setItem(ART_SENT_TOTAL_KEY, JSON.stringify(data));
}

/**
 * 取得文章句子總數（0 表示尚未快取）
 */
function _getArticleSentenceTotal(categoryName, titleName) {
    const cache = loadArticleSentTotals();
    const key   = `${categoryName}||${titleName}`;
    return cache[key]?.total || 0;
}

/**
 * 進入 Detail View 時呼叫，fetch Timestamp 取得句子總數並快取
 * 每次進入 Detail View 都更新一次
 */
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

// ── 舊格式清理 ───────────────────────────────────────────────
/**
 * 移除每個 item record 上的頂層 correct / wrong 欄位（舊格式殘留）
 *
 * 舊版系統直接將 correct/wrong 存在 record 頂層，無法判斷來源。
 * 現行系統以 source-based 格式（fc/fcplus/reorder/dictation/articleListen）計算熟悉度，
 * 頂層的舊格式欄位不參與任何計算，反而造成混淆，一律移除。
 *
 * 處理邏輯：
 *   - 混合格式（舊+新並存）→ 只移除頂層 correct/wrong，保留 source 資料
 *   - 純舊格式（只有頂層、無任何 source）→ 整筆刪除，視為未測驗
 *
 * @param {object} data  itemScores 完整物件（直接修改並回傳）
 * @returns {object} 清理後的 data
 */
function cleanLegacyFields(data) {
    const sources = ['fc','fcplus','dictation','reorder','articleListen'];
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
        console.log(`[cleanLegacyFields] 清理：移除混合格式頂層欄位 ${removedFields} 筆，移除純舊格式記錄 ${removedRecords} 筆`);
    }
    return data;
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
            // 載入時自動清理舊格式，確保熟悉度計算正確
            // 若有清理到資料，saveItemScores 會同步回 Firestore（一次性，之後不再觸發）
            const cleaned = cleanLegacyFields(doc.data().itemScores);
            localStorage.setItem(ITEM_SCORES_KEY, JSON.stringify(cleaned));
            saveItemScores(cleaned);
        }
    } catch (e) { console.error('Item scores load error:', e); }
}

window.loadItemScoresFromFirestore = loadItemScoresFromFirestore;

/**
 * 記錄單一題目結果
 */
/**
 * 記錄單一題目結果
 * @param {string}  categoryName
 * @param {string}  titleName
 * @param {string}  itemType     'noteWords' | 'noteSentences' | 'articleWords' | 'articleSentences'
 * @param {string}  itemText
 * @param {boolean} isCorrect
 * @param {number}  replayCount  手動重播次數（預設 0）
 * @param {string}  source       來源模式：'fc'|'fcplus'|'dictation'|'reorder'|'articleListen'
 *
 * 加權規則：
 *   noteWords / articleWords    → fc 30%，fcplus 70%
 *   noteSentences               → dictation 30%，reorder 70%
 *   articleSentences            → articleListen 30%，reorder 70%
 */
function recordItemResult(categoryName, titleName, itemType, itemText, isCorrect, replayCount = 0, source = 'fc') {
    if (!categoryName || !titleName || !itemText) return;

    const data = loadItemScores();
    const key  = `${categoryName}||${titleName}`;
    if (!data[key]) data[key] = { noteWords: {}, noteSentences: {}, articleWords: {}, articleSentences: {} };
    if (!data[key][itemType]) data[key][itemType] = {};

    const text = itemText.trim();
    if (!data[key][itemType][text]) {
        data[key][itemType][text] = { fc: null, fcplus: null, dictation: null, reorder: null, articleListen: null, firstSeen: _todayStr(), lastSeen: null };
    }

    const rec = data[key][itemType][text];

    // 確保來源欄位存在
    if (!rec[source]) rec[source] = { correct: 0, wrong: 0 };
    const src = rec[source];

    if (isCorrect) {
        src.correct++;
        if (replayCount > 0) src.wrong += replayCount;
    } else {
        src.wrong++;
    }
    rec.lastSeen = _todayStr();
    if (!rec.firstSeen) rec.firstSeen = _todayStr();

    saveItemScores(data);
}

/**
 * 計算單一 source record 的熟悉度（0–100）
 */
function _calcSourceFam(srcRec) {
    if (!srcRec || (srcRec.correct === 0 && srcRec.wrong === 0)) return null;
    const total     = srcRec.correct + srcRec.wrong;
    const errorRate = total > 0 ? srcRec.wrong / total : 0;
    return Math.round((1 - errorRate) * 100);
}

/**
 * 根據 itemType 計算加權熟悉度（0–100）
 * 只有一個來源有資料時直接用該來源，不強制扣分
 */
function calcWeightedFamiliarity(rec, itemType) {
    if (!rec) return 0;

    let w1Key, w2Key, w1, w2; // w1=30%, w2=70%

    if (itemType === 'noteWords' || itemType === 'articleWords') {
        w1Key = 'fc'; w2Key = 'fcplus'; w1 = 0.3; w2 = 0.7;
    } else if (itemType === 'noteSentences') {
        w1Key = 'dictation'; w2Key = 'reorder'; w1 = 0.3; w2 = 0.7;
    } else if (itemType === 'articleSentences') {
        w1Key = 'articleListen'; w2Key = 'reorder'; w1 = 0.3; w2 = 0.7;
    } else {
        // fallback：舊格式 { correct, wrong }
        return calcFamiliarityLegacy(rec);
    }

    const f1 = _calcSourceFam(rec[w1Key]);
    const f2 = _calcSourceFam(rec[w2Key]);

    if (f1 !== null && f2 !== null) return Math.round(f1 * w1 + f2 * w2);
    if (f2 !== null) return f2;
    if (f1 !== null) return f1;
    return 0;
}

/**
 * 舊格式 { correct, wrong } 相容計算（不再用於新資料）
 */
function calcFamiliarityLegacy(rec) {
    if (!rec || (rec.correct === 0 && rec.wrong === 0)) return 0;
    const total     = rec.correct + rec.wrong;
    const errorRate = total > 0 ? rec.wrong / total : 0;
    const days = daysSince(rec.lastSeen);
    let dayDecay = 0;
    if (days >= 30)     dayDecay = 1;
    else if (days >= 7) dayDecay = (days - 7) / 23;
    return Math.round((1 - errorRate) * 70 + (1 - dayDecay) * 30);
}

/**
 * 判斷 rec 是否有任何測驗記錄
 */
function _recHasPractice(rec) {
    if (!rec) return false;
    const sources = ['fc','fcplus','dictation','reorder','articleListen'];
    return sources.some(s => rec[s] && (rec[s].correct + rec[s].wrong) > 0);
}

/**
 * 取得 rec 的總答對/答錯數（所有來源合計）
 */
function _recTotals(rec) {
    if (!rec) return { correct: 0, wrong: 0 };
    const sources = ['fc','fcplus','dictation','reorder','articleListen'];
    let correct = 0, wrong = 0;
    sources.forEach(s => {
        if (rec[s]) { correct += rec[s].correct || 0; wrong += rec[s].wrong || 0; }
    });
    return { correct, wrong };
}

// ── 需練指數 & 熟悉度 ────────────────────────────────────────

/**
 * 需練指數（保留向後相容，供外部呼叫）
 * 新資料請用 calcWeightedFamiliarity
 */
function calcNeedScore(itemRecord) {
    return 100 - calcFamiliarity(itemRecord);
}

/**
 * 熟悉度 0–100（越高代表越熟悉）
 * 新格式：用加權計算；舊格式 { correct, wrong } fallback
 * ⚠️ 此函式不知道 itemType，呼叫方應盡量改用 calcWeightedFamiliarity(rec, itemType)
 */
function calcFamiliarity(itemRecord, itemType) {
    if (!itemRecord) return 0;
    // 新格式偵測：有任一 source key
    const hasNewFormat = ['fc','fcplus','dictation','reorder','articleListen'].some(s => itemRecord[s]);
    if (hasNewFormat && itemType) return calcWeightedFamiliarity(itemRecord, itemType);
    if (hasNewFormat) {
        // 沒有傳 itemType 時嘗試所有來源平均
        const vals = ['fc','fcplus','dictation','reorder','articleListen']
            .map(s => _calcSourceFam(itemRecord[s])).filter(v => v !== null);
        return vals.length > 0 ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
    }
    // 舊格式 fallback
    return calcFamiliarityLegacy(itemRecord);
}

function getNeedScoreColor(score) {
    if (score >= 80) return 'need-red';
    if (score >= 40) return 'need-yellow';
    return 'need-green';
}

function getFamiliarityColor(fam) {
    if (fam >= 60) return 'fam-green';
    if (fam >= 30) return 'fam-yellow';
    return 'fam-red';
}

/**
 * 計算文章的熟悉度摘要
 * 回傳 { famAvg, noteAvg, artAvg, noteTotal, artTotal, hasPractice, totalTested, totalItems }
 */
function calcArticleFamSummary(categoryName, titleName) {
    const data  = loadItemScores();
    const key   = `${categoryName}||${titleName}`;
    const entry = data[key] || {};

    // ── Note：從 savedWords 取得全部項目（含未測驗）──────────
    const noteData = (typeof savedWords !== 'undefined')
        ? (savedWords[categoryName]?.[titleName] || {}) : {};

    const allNoteWords = [
        ...(noteData.words    ? Array.from(noteData.words)    : []),
        ...(noteData.phrases  ? Array.from(noteData.phrases)  : []),
    ].map(t => t.trim()).filter(Boolean);
    const allNoteSents = (noteData.sentences ? Array.from(noteData.sentences) : [])
        .map(t => t.trim()).filter(Boolean);

    const testedNoteWords = entry.noteWords     || {};
    const testedNoteSents = entry.noteSentences || {};

    // 已測驗用加權真實分數，未測驗補 0%
    function scorePool(allTexts, testedMap, itype) {
        return allTexts.map(t => {
            const rec = testedMap[t];
            return rec ? calcWeightedFamiliarity(rec, itype) : 0;
        });
    }

    const noteWordScores = scorePool(allNoteWords, testedNoteWords, 'noteWords');
    const noteSentScores = scorePool(allNoteSents, testedNoteSents, 'noteSentences');

    // 如果 savedWords 是空的但 itemScores 裡有資料（舊資料），fallback
    const fallbackWordItems = Object.values(testedNoteWords);
    const fallbackSentItems = Object.values(testedNoteSents);

    const noteWordFamScores = allNoteWords.length > 0 ? noteWordScores
        : fallbackWordItems.map(r => calcWeightedFamiliarity(r, 'noteWords'));
    const noteSentFamScores = allNoteSents.length > 0 ? noteSentScores
        : fallbackSentItems.map(r => calcWeightedFamiliarity(r, 'noteSentences'));

    const noteWordTotal = allNoteWords.length > 0 ? allNoteWords.length : fallbackWordItems.length;
    const noteSentTotal = allNoteSents.length > 0 ? allNoteSents.length : fallbackSentItems.length;

    const noteWordAvg = noteWordTotal > 0
        ? Math.round(noteWordFamScores.reduce((a, b) => a + b, 0) / noteWordTotal) : null;
    const noteSentAvg = noteSentTotal > 0
        ? Math.round(noteSentFamScores.reduce((a, b) => a + b, 0) / noteSentTotal) : null;

    // Note 整體 = 單字 + 句子平均
    let noteAvg = null;
    if (noteWordAvg !== null && noteSentAvg !== null) noteAvg = Math.round((noteWordAvg + noteSentAvg) / 2);
    else if (noteWordAvg !== null) noteAvg = noteWordAvg;
    else if (noteSentAvg !== null) noteAvg = noteSentAvg;

    const noteTestedWordCount = allNoteWords.length > 0
        ? allNoteWords.filter(t => testedNoteWords[t]).length : fallbackWordItems.filter(i => (i.correct + i.wrong) > 0).length;
    const noteTestedSentCount = allNoteSents.length > 0
        ? allNoteSents.filter(t => testedNoteSents[t]).length : fallbackSentItems.filter(i => (i.correct + i.wrong) > 0).length;

    const noteUntestedWordCount = noteWordTotal - noteTestedWordCount;
    const noteUntestedSentCount = noteSentTotal - noteTestedSentCount;
    const noteTotal = noteWordTotal + noteSentTotal;

    // ── Article ───────────────────────────────────────────────
    const artWordItems    = Object.values(entry.articleWords    || {});
    const artSentItems    = Object.values(entry.articleSentences || {});

    const cachedTotalSents  = _getArticleSentenceTotal(categoryName, titleName);
    const testedSentCount   = artSentItems.length;
    const artSentFamScores  = artSentItems.map(r => calcWeightedFamiliarity(r, 'articleSentences'));
    const untestedSentCount = Math.max(0, cachedTotalSents - testedSentCount);
    const allArtSentFamScores = [...artSentFamScores, ...Array(untestedSentCount).fill(0)];
    const artSentTotal    = testedSentCount + untestedSentCount;

    const artWordTotal    = artWordItems.length;
    const artWordFamScores = artWordItems.map(r => calcWeightedFamiliarity(r, 'articleWords'));
    const artWordAvg      = artWordTotal > 0
        ? Math.round(artWordFamScores.reduce((a, b) => a + b, 0) / artWordTotal) : null;
    const artSentAvg      = artSentTotal > 0
        ? Math.round(allArtSentFamScores.reduce((a, b) => a + b, 0) / artSentTotal) : null;

    let artAvg = null;
    if (artWordAvg !== null && artSentAvg !== null) artAvg = Math.round((artWordAvg + artSentAvg) / 2);
    else if (artWordAvg !== null) artAvg = artWordAvg;
    else if (artSentAvg !== null) artAvg = artSentAvg;
    else if (cachedTotalSents > 0 && testedSentCount === 0) artAvg = 0;

    const artTotal   = artWordTotal + artSentTotal;

    const totalItems  = noteTotal + artTotal;
    const totalTested = noteTestedWordCount + noteTestedSentCount
                      + artWordItems.filter(i => (i.correct + i.wrong) > 0).length
                      + artSentItems.filter(i => (i.correct + i.wrong) > 0).length;

    let famAvg = null;
    if (noteAvg !== null && artAvg !== null) famAvg = Math.round((noteAvg + artAvg) / 2);
    else if (noteAvg !== null) famAvg = noteAvg;
    else if (artAvg  !== null) famAvg = artAvg;

    return {
        famAvg, noteAvg, artAvg,
        noteWordAvg, noteSentAvg,
        noteWordTotal, noteSentTotal,
        noteTestedWordCount, noteUntestedWordCount,
        noteTestedSentCount, noteUntestedSentCount,
        artWordAvg, artSentAvg,
        noteTotal, artTotal,
        artWordTotal, artSentTotal, testedSentCount, untestedSentCount,
        totalItems, totalTested,
        hasPractice: totalItems > 0
    };
}

// ── Legacy: calcArticleNeedSummary（向後相容）──────────────
function calcArticleNeedSummary(categoryName, titleName) {
    const s = calcArticleFamSummary(categoryName, titleName);
    return {
        noteAvg:    s.noteAvg !== null ? 100 - s.noteAvg : null,
        artAvg:     s.artAvg  !== null ? 100 - s.artAvg  : null,
        noteTotal:  s.noteTotal,
        artTotal:   s.artTotal,
        hasPractice: s.hasPractice
    };
}

// ══════════════════════════════════════════════════════════════
//  PART 1 — SCORES DASHBOARD（分類瀏覽層）
// ══════════════════════════════════════════════════════════════

// Dashboard 狀態
let _dashSortDir = 'desc'; // 'desc' = 熟悉度低→高（需要練習的在前），'asc' = 熟悉度高→低

function openScoresDashboard() {
    _dashSortDir = 'desc';
    renderScoresDashboard();
    showView(document.getElementById('scores-dashboard-view'));
}

function renderScoresDashboard() {
    _renderBrowserSection();
    _updateSortBtnUI();
}

// ── 排序按鈕 UI ─────────────────────────────────────────────

function _updateSortBtnUI() {
    const btn = document.getElementById('dash-sort-fam-btn');
    if (!btn) return;
    btn.textContent = _dashSortDir === 'desc'
        ? '熟悉度 ↑（最需練習優先）'
        : '熟悉度 ↓（最熟悉優先）';
    btn.title = '未測驗文章固定排在後方，按字母排列';
    btn.classList.toggle('sort-desc', _dashSortDir === 'desc');
}

// ── 每個分類（cat）的獨立排序狀態 ────────────────────────────
// key = cat name，value = { key: 'note'|'artWord'|'artSent'|'alpha', dir: 'asc'|'desc' }
const _catSortState = {};

function _getCatSort(cat) {
    if (!_catSortState[cat]) _catSortState[cat] = { key: null, dir: 'asc' };
    return _catSortState[cat];
}

function _sortArticlesByCat(articles, cat) {
    const { key, dir } = _getCatSort(cat);

    return [...articles].sort((a, b) => {
        const aTested = a.summary.hasPractice;
        const bTested = b.summary.hasPractice;

        if (key === 'alpha') {
            const cmp = a.title.localeCompare(b.title);
            return dir === 'asc' ? cmp : -cmp;
        }

        // 其他 key：未測驗固定排後（字母），已測驗按選定維度
        if (!aTested && !bTested) return a.title.localeCompare(b.title);
        if (!aTested) return 1;
        if (!bTested) return -1;

        let fa = 0, fb = 0;
        if (key === 'note') {
            fa = a.summary.noteAvg ?? 0;
            fb = b.summary.noteAvg ?? 0;
        } else if (key === 'artWord') {
            fa = a.summary.artWordAvg ?? 0;
            fb = b.summary.artWordAvg ?? 0;
        } else if (key === 'artSent') {
            fa = a.summary.artSentAvg ?? 0;
            fb = b.summary.artSentAvg ?? 0;
        } else {
            // default: overall famAvg
            fa = a.summary.famAvg ?? 0;
            fb = b.summary.famAvg ?? 0;
        }
        return dir === 'asc' ? fa - fb : fb - fa;
    });
}

// ── 瀏覽層渲染 ───────────────────────────────────────────────

function _renderBrowserSection() {
    const container = document.getElementById('scores-browser-section');
    if (!container) return;

    const storyList = typeof stories !== 'undefined' ? stories : [];
    const itemData  = loadItemScores();

    if (storyList.length === 0) {
        container.innerHTML = `<div class="browser-empty">沒有文章資料</div>`;
        return;
    }

    // Build structure: majorMap[major][cat] = [{ title, cat, summary }]
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

    // Also add titles only in itemData but not in storyList
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

            // Compute familiarity for each article
            let articles = rawTitles.map(title => {
                const summary = calcArticleFamSummary(cat, title);
                return { title, cat, summary };
            });

            // Sort using per-cat sort state
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

    // Bind toggles
    container.querySelectorAll('[data-major-toggle]').forEach(h =>
        h.addEventListener('click', () => _toggleSection(h))
    );
    container.querySelectorAll('[data-cat-toggle]').forEach(h =>
        h.addEventListener('click', () => _toggleSection(h))
    );

    // Bind article row clicks
    container.querySelectorAll('.browser-article-row').forEach(row => {
        row.addEventListener('click', () => {
            openDetailView(row.dataset.cat, row.dataset.title);
        });
    });

    // Bind quiz buttons in article rows
    container.querySelectorAll('.browser-quiz-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation(); // 不觸發 openDetailView
            if (typeof openQuiz === 'function') {
                openQuiz(btn.dataset.cat, btn.dataset.title, 'scores');
            }
        });
    });

    // Bind read buttons in article rows
    container.querySelectorAll('.browser-read-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation(); // 不觸發 openDetailView
            _navigateToArticle(btn.dataset.cat, btn.dataset.title);
        });
    });

    // Bind cat sort buttons
    _bindCatSortBtns(container);
}

function _buildCatSortBtns(cat) {
    const { key, dir } = _getCatSort(cat);
    const arrow = dir === 'asc' ? ' ↑' : ' ↓';

    const btns = [
        { k: 'note',    label: '📝 Note',  title: 'Note 整體熟悉度' },
        { k: 'artWord', label: '🃏 單字',   title: 'Article 單字熟悉度' },
        { k: 'artSent', label: '🎧 句子',   title: 'Article 句子熟悉度' },
        { k: 'alpha',   label: 'A–Z',      title: '字母排序' },
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
    // Also from itemData
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

    // Rebuild sort bar + article rows
    const sortBarHtml = `<div class="cat-sort-bar" data-cat="${_escHtml(cat)}">
        <span class="cat-sort-label">排序：</span>
        ${_buildCatSortBtns(cat)}
    </div>`;
    const rowsHtml = articles.map(a => _buildArticleRowHtml(a)).join('');
    body.innerHTML = sortBarHtml + rowsHtml;

    // Re-bind article row clicks
    body.querySelectorAll('.browser-article-row').forEach(row => {
        row.addEventListener('click', () => openDetailView(row.dataset.cat, row.dataset.title));
    });

    // Re-bind quiz buttons
    body.querySelectorAll('.browser-quiz-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            if (typeof openQuiz === 'function') {
                openQuiz(btn.dataset.cat, btn.dataset.title, 'scores');
            }
        });
    });

    // Re-bind read buttons
    body.querySelectorAll('.browser-read-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            _navigateToArticle(btn.dataset.cat, btn.dataset.title);
        });
    });

    // Re-bind sort buttons
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
                state.dir = 'asc'; // 預設昇冪（低熟悉度在前）
            }
            // Rebuild this cat's body
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

function _buildArticleRowHtml(article) {
    const { title, cat, summary } = article;
    const { noteAvg, artWordAvg, artSentAvg,
            noteWordTotal, noteSentTotal, noteTestedWordCount, noteTestedSentCount,
            testedSentCount, untestedSentCount } = summary;

    function famChip(avg, topLabel, subInfo) {
        if (avg === null || avg === undefined) {
            return `<div class="browser-fam-chip chip-untested">
                <span class="chip-top-label">${topLabel}</span>
                <span class="chip-val">—</span>
            </div>`;
        }
        const colorClass = getFamiliarityColor(avg);
        return `<div class="browser-fam-chip ${colorClass}">
            <span class="chip-top-label">${topLabel}</span>
            <span class="chip-val">${avg}%</span>
            ${subInfo ? `<span class="chip-sub">${subInfo}</span>` : ''}
            <div class="chip-bar-wrap"><div class="chip-bar" style="width:${avg}%"></div></div>
        </div>`;
    }

    // Note：已測/總數（單字+句子合計）
    const noteTotalAll  = (noteWordTotal ?? 0) + (noteSentTotal ?? 0);
    const noteTestedAll = (noteTestedWordCount ?? 0) + (noteTestedSentCount ?? 0);
    const noteInfo = noteTotalAll > 0 ? `${noteTestedAll}/${noteTotalAll}項` : '';

    // Article 句子：已測/總數
    const totalSents = (testedSentCount ?? 0) + (untestedSentCount ?? 0);
    const sentInfo   = totalSents > 0 ? `${testedSentCount ?? 0}/${totalSents}句` : '';

    return `<div class="browser-article-row" data-title="${_escHtml(title)}" data-cat="${_escHtml(cat)}">
        <div class="browser-article-main">
            <div class="browser-article-title">${_escHtml(title)}</div>
        </div>
        <div class="browser-article-chips">
            ${famChip(noteAvg,    '📝 Note',  noteInfo)}
            ${famChip(artWordAvg, '🃏 單字')}
            ${famChip(artSentAvg, '🎧 句子',  sentInfo)}
        </div>
        <div class="browser-article-actions">
            <button class="browser-quiz-btn" data-title="${_escHtml(title)}" data-cat="${_escHtml(cat)}" title="進入 Quiz">🎯 Quiz</button>
            <button class="browser-read-btn" data-title="${_escHtml(title)}" data-cat="${_escHtml(cat)}" title="前往文章">📖 閱讀</button>
            <div class="browser-article-arrow">→</div>
        </div>
    </div>`;
}

// ── Sort button binding ───────────────────────────────────────

document.getElementById('dash-sort-fam-btn')?.addEventListener('click', () => {
    _dashSortDir = _dashSortDir === 'desc' ? 'asc' : 'desc';
    renderScoresDashboard();
});

// Clear All button
document.getElementById('scores-clear-all-btn')?.addEventListener('click', () => {
    if (!confirm('⚠️ 清除所有學習記錄？\n\n此操作無法還原，建議先「匯出學習資料」備份。')) return;
    localStorage.removeItem(ITEM_SCORES_KEY);
    if (typeof QUIZ_SCORES_KEY !== 'undefined') localStorage.removeItem(QUIZ_SCORES_KEY);
    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ itemScores: {}, quizScores: {} }, { merge: true })
          .catch(err => console.error('Score clear error:', err));
    }
    renderScoresDashboard();
});

// ── 匯出學習資料 ─────────────────────────────────────────────

document.getElementById('scores-export-btn')?.addEventListener('click', () => {
    exportItemScores();
});

function exportItemScores() {
    const data = loadItemScores();
    const artSentTotals = (() => {
        try { return JSON.parse(localStorage.getItem(ART_SENT_TOTAL_KEY) || '{}'); } catch(e) { return {}; }
    })();

    const exportObj = {
        version: '2.0',
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

    const total = Object.keys(data).length;
    alert(`✅ 匯出成功！\n共 ${total} 篇文章的學習記錄已存檔。`);
}

// ── 匯入學習資料 ─────────────────────────────────────────────

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

            // 基本格式驗證
            if (!obj.itemScores || typeof obj.itemScores !== 'object') {
                alert('❌ 檔案格式錯誤：找不到 itemScores 欄位。\n請確認是否匯入正確的學習資料檔案。');
                return;
            }

            const incoming  = obj.itemScores;
            const incomingKeys = Object.keys(incoming).length;

            const confirmMsg =
                `📥 確認匯入學習資料？\n\n` +
                `檔案資訊：\n` +
                `  • 匯出日期：${obj.exportDate ? obj.exportDate.slice(0,10) : '不明'}\n` +
                `  • 文章筆數：${incomingKeys} 篇\n\n` +
                `匯入方式：合併（相同文章取較高熟悉度的記錄，不覆蓋現有進度）\n\n` +
                `繼續？`;

            if (!confirm(confirmMsg)) return;

            // 合併：逐層深合併，同一個 item 同一個 source 累加 correct/wrong
            const current = loadItemScores();

            Object.keys(incoming).forEach(articleKey => {
                if (!current[articleKey]) {
                    current[articleKey] = incoming[articleKey];
                    return;
                }
                ['noteWords','noteSentences','articleWords','articleSentences'].forEach(itype => {
                    if (!incoming[articleKey][itype]) return;
                    if (!current[articleKey][itype]) {
                        current[articleKey][itype] = incoming[articleKey][itype];
                        return;
                    }
                    Object.keys(incoming[articleKey][itype]).forEach(text => {
                        const inc = incoming[articleKey][itype][text];
                        const cur = current[articleKey][itype][text];
                        if (!cur) {
                            current[articleKey][itype][text] = inc;
                            return;
                        }
                        // 合併各 source
                        ['fc','fcplus','dictation','reorder','articleListen'].forEach(src => {
                            if (!inc[src]) return;
                            if (!cur[src]) { cur[src] = inc[src]; return; }
                            cur[src].correct = (cur[src].correct || 0) + (inc[src].correct || 0);
                            cur[src].wrong   = (cur[src].wrong   || 0) + (inc[src].wrong   || 0);
                        });
                        // 保留較早的 firstSeen，較晚的 lastSeen
                        if (inc.firstSeen && (!cur.firstSeen || inc.firstSeen < cur.firstSeen)) {
                            cur.firstSeen = inc.firstSeen;
                        }
                        if (inc.lastSeen && (!cur.lastSeen || inc.lastSeen > cur.lastSeen)) {
                            cur.lastSeen = inc.lastSeen;
                        }
                    });
                });
            });

            // 合併後清理舊格式，確保計算一致
            cleanLegacyFields(current);
            saveItemScores(current);

            // 若有 articleSentTotals 也一併合併
            if (obj.articleSentTotals && typeof obj.articleSentTotals === 'object') {
                const curTotals = loadArticleSentTotals();
                Object.assign(curTotals, obj.articleSentTotals);
                saveArticleSentTotals(curTotals);
            }

            renderScoresDashboard();
            alert(`✅ 匯入成功！\n已合併 ${incomingKeys} 篇文章的學習記錄。`);

        } catch (err) {
            alert('❌ 匯入失敗：' + err.message);
            console.error('Import error:', err);
        }
    };
    reader.readAsText(file);
}

// Home review badge（保留相容）
function renderHomeReviewBadge() {}

// saveQuizScore（保留向後相容，供 quiz.js 使用）
function saveQuizScore(categoryName, titleName, mode, score, total) {
    if (typeof QUIZ_SCORES_KEY === 'undefined') return;
    const scores = typeof loadQuizScores === 'function' ? loadQuizScores() : {};
    const key = `${categoryName}||${titleName}`;
    if (!scores[key]) scores[key] = {};
    const SCORE_MODE_META = {
        flashcard: {}, cloze: {}, dictation: {}, reorder: {},
        'article-listen': {}, 'article-cloze': {}
    };
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
//  PART 2 — ARTICLE DETAIL VIEW（兩層式細節頁）
// ══════════════════════════════════════════════════════════════

let detailViewState = {
    categoryName: null,
    titleName:    null,
    tab:          'noteWords',
    sortBy:       'fam',      // 'fam' | 'alpha' | 'recent'
    sortDir:      'asc',      // for fam: asc = 低熟悉度優先（需練習）
    fromNote:     false,
};

/**
 * 從 Scores Dashboard / Detail View 導航到文章閱讀頁
 * 邏輯與 resumeLastPlayback 相同，但來源為 scores，不帶 resume time
 */
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

    // ✅ 直接賦值給 story.js 的全域變數（let 宣告，window. 無法修改它）
    // showCategory() 內部用 currentMajorCategory 做大類過濾，必須在呼叫前設好
    currentMajorCategory = major;

    // ✅ 完全複製 showCategory() 內的過濾條件（大類 + 分類雙重過濾 + 排序）
    // 確保算出的 indexInList 與 showCategory() 重建的 currentStoryList index 完全一致
    const storyListForCat = stories
        .filter(item => {
            const matchMajor = (item['大類'] || 'Uncategorized') === major;
            const matchSub   = item['分類']?.map(c => c.trim()).includes(category);
            return matchMajor && matchSub;
        })
        .sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));

    const indexInList = storyListForCat.findIndex(s => s['標題'] === titleName);
    if (indexInList === -1) {
        if (typeof showNotification === 'function') showNotification(`無法定位文章「${titleName}」在分類中的位置。`, 'error');
        return;
    }

    // showCategory() 重建 currentStoryList 後，showPlayback(index) 才能正確找到文章
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

    document.getElementById('detail-view-title').textContent = titleName;
    renderDetailView();
    showView(document.getElementById('item-detail-view'));

    // 背景更新文章句子總數（每次進入都更新）
    await _updateArticleSentenceTotal(categoryName, titleName);
    // 更新後重新渲染（若目前顯示的是 article 相關 tab 才重渲）
    if (detailViewState.tab === 'articleSentences') {
        renderDetailView();
    }
}

function renderDetailView() {
    const { categoryName, titleName, tab, sortBy, sortDir } = detailViewState;
    const data  = loadItemScores();
    const key   = `${categoryName}||${titleName}`;
    const entry = data[key] || {};

    // Tab buttons
    document.querySelectorAll('.detail-tab-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.tab === tab);
    });

    // Sort buttons
    document.querySelectorAll('.detail-sort-btn').forEach(btn => {
        const isActive = btn.dataset.sort === sortBy;
        btn.classList.toggle('is-active', isActive);
        if (isActive) {
            const arrow = sortDir === 'asc' ? ' ↑' : ' ↓';
            btn.textContent = btn.dataset.label + arrow;
        } else {
            btn.textContent = btn.dataset.label;
        }
    });

    // Get items for current tab
    const itemMap = entry[tab] || {};
    let items = Object.entries(itemMap).map(([text, rec]) => {
        const totals = _recTotals(rec);
        return {
            text,
            correct:     totals.correct,
            wrong:       totals.wrong,
            lastSeen:    rec.lastSeen  || null,
            firstSeen:   rec.firstSeen || null,
            famScore:    calcWeightedFamiliarity(rec, tab),
            needScore:   100 - calcWeightedFamiliarity(rec, tab),
            hasPractice: _recHasPractice(rec),
            rec,
        };
    });

    // Add untested items from savedWords (for note tabs)
    if (tab === 'noteWords' || tab === 'noteSentences') {
        const noteData = typeof savedWords !== 'undefined'
            ? (savedWords[categoryName]?.[titleName] || {}) : {};
        const pool = tab === 'noteWords'
            ? [...(noteData.words || []), ...(noteData.phrases || [])]
            : [...(noteData.sentences || [])];
        pool.forEach(text => {
            const t = text.trim();
            if (!itemMap[t]) {
                items.push({ text: t, correct: 0, wrong: 0, lastSeen: null, firstSeen: null,
                             famScore: 0, needScore: 100, hasPractice: false, rec: null });
            }
        });
    }

    // Article 句子 tab：加入未測驗的句子（來自 Timestamp 快取）
    if (tab === 'articleSentences') {
        const cachedTotal = _getArticleSentenceTotal(categoryName, titleName);
        const testedCount = items.length;
        const untestedNeeded = Math.max(0, cachedTotal - testedCount);
        // 加入佔位（未測驗句子不知道具體文字，只加數量提示）
        for (let i = 0; i < untestedNeeded; i++) {
            items.push({
                text: `（未測驗句子 ${testedCount + i + 1}）`,
                correct: 0, wrong: 0, lastSeen: null, firstSeen: null,
                famScore: 0, needScore: 100, hasPractice: false,
                isPlaceholder: true
            });
        }
    }

    // Sort
    items.sort((a, b) => {
        if (sortBy === 'alpha') {
            const va = a.text.toLowerCase(), vb = b.text.toLowerCase();
            return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        }
        if (sortBy === 'recent') {
            const va = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
            const vb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
            return sortDir === 'asc' ? va - vb : vb - va;
        }
        // fam: asc = 低熟悉度在前（最需練習）
        return sortDir === 'asc' ? a.famScore - b.famScore : b.famScore - a.famScore;
    });

    // Summary bar
    const tested   = items.filter(i => i.hasPractice).length;
    const untested = items.length - tested;
    const avgFam   = items.length > 0
        ? Math.round(items.reduce((s, i) => s + i.famScore, 0) / items.length) : 0;
    const famClass = avgFam >= 60 ? 'chip-ok' : avgFam >= 30 ? 'chip-warn' : 'chip-danger';

    document.getElementById('detail-summary-bar').innerHTML = `
        <span class="detail-sum-chip">📝 共 ${items.length} 項</span>
        <span class="detail-sum-chip">✅ 已測 ${tested}</span>
        <span class="detail-sum-chip ${untested > 0 ? 'chip-warn' : ''}">⬜ 未測 ${untested}</span>
        <span class="detail-sum-chip ${famClass}">熟悉度 ${avgFam}%</span>
    `;

    // Items list
    const listEl = document.getElementById('detail-items-list');
    if (items.length === 0) {
        listEl.innerHTML = `<div class="detail-empty">
            ${tab === 'noteWords'        ? '此文章尚無筆記單字' :
              tab === 'noteSentences'    ? '此文章尚無筆記句子' :
              tab === 'articleWords'     ? '尚無 Article 單字測驗記錄（Flashcard/Flashcard+ Article 模式）' :
              '尚無 Article 句子測驗記錄（Dictation/Reorder Article 模式）'}
        </div>`;
        return;
    }

    listEl.innerHTML = items.map(item => buildDetailItemHtml(item, tab)).join('');
}

function buildDetailItemHtml(item, tab) {
    // 未測驗佔位（僅 articleSentences tab 的未知句子）
    if (item.isPlaceholder) {
        return `<div class="detail-item fam-red detail-item-placeholder">
            <div class="detail-item-top">
                <div class="detail-fam-badge fam-red">0%</div>
                <div class="detail-text-sentence detail-placeholder-text">未測驗</div>
            </div>
            <div class="detail-score-bar-wrap">
                <div class="detail-score-bar fam-red" style="width:0%"></div>
            </div>
            <div class="detail-item-stats"><span class="detail-stat untested-stat">未測驗</span></div>
        </div>`;
    }

    const { text, correct, wrong, lastSeen, famScore, hasPractice, rec } = item;

    // Color based on familiarity
    const colorClass = getFamiliarityColor(famScore);
    const daysAgo = lastSeen
        ? (daysSince(lastSeen) === 0 ? '今天' : `${daysSince(lastSeen)}天前`)
        : '—';

    const statsHtml = hasPractice
        ? `<span class="detail-stat correct-stat">✓ ${correct}</span>
           <span class="detail-stat wrong-stat">✗ ${wrong}</span>
           <span class="detail-stat days-stat">📅 ${daysAgo}</span>`
        : `<span class="detail-stat untested-stat">未測驗</span>`;

    // ── 子來源明細 ────────────────────────────────────────────
    let sourceHtml = '';
    if (rec && hasPractice) {
        let sources = [];
        if (tab === 'noteWords' || tab === 'articleWords') {
            sources = [
                { key: 'fc',     label: '🃏 FC',    weight: '30%' },
                { key: 'fcplus', label: '🔤 FC+',   weight: '70%' },
            ];
        } else if (tab === 'noteSentences') {
            sources = [
                { key: 'dictation', label: '🎧 Dictation', weight: '30%' },
                { key: 'reorder',   label: '🔀 Reorder',   weight: '70%' },
            ];
        } else if (tab === 'articleSentences') {
            sources = [
                { key: 'articleListen', label: '📖 Listen', weight: '30%' },
                { key: 'reorder',       label: '🔀 Reorder', weight: '70%' },
            ];
        }
        const srcParts = sources.map(s => {
            const sr = rec[s.key];
            if (!sr || (sr.correct + sr.wrong) === 0) {
                return `<span class="detail-src-chip detail-src-none">${s.label} <em>未測</em></span>`;
            }
            const fam = _calcSourceFam(sr) ?? 0;
            const fc  = getFamiliarityColor(fam);
            return `<span class="detail-src-chip ${fc}">${s.label} ${fam}% <em>${s.weight}</em> ✓${sr.correct} ✗${sr.wrong}</span>`;
        }).join('');
        sourceHtml = `<div class="detail-item-sources">${srcParts}</div>`;
    }

    const isSentence = (tab === 'noteSentences' || tab === 'articleSentences');
    const textClass  = isSentence ? 'detail-text-sentence' : 'detail-text-word';

    return `<div class="detail-item ${colorClass}">
        <div class="detail-item-top">
            <div class="detail-fam-badge ${colorClass}">${famScore}%</div>
            <div class="${textClass}">${_escHtml(text)}</div>
        </div>
        <div class="detail-score-bar-wrap">
            <div class="detail-score-bar ${colorClass}" style="width:${famScore}%"></div>
        </div>
        <div class="detail-item-stats">${statsHtml}</div>
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

document.querySelectorAll('.detail-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        detailViewState.tab = btn.dataset.tab;
        renderDetailView();
    });
});

document.querySelectorAll('.detail-sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (detailViewState.sortBy === btn.dataset.sort) {
            detailViewState.sortDir = detailViewState.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
            detailViewState.sortBy  = btn.dataset.sort;
            // fam 預設 asc（低熟悉度在前），其他預設 desc
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

console.log('✅ Scores Dashboard (重構版) loaded.');

// ══════════════════════════════════════════════════════════════
//  說明面板（? 按鈕）
// ══════════════════════════════════════════════════════════════

function openScoringInfoModal() {
    let modal = document.getElementById('scoring-info-modal');
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

// 點擊背景關閉
document.getElementById('scoring-info-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeScoringInfoModal();
});
