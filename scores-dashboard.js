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
            // B-08 修正：移除自動呼叫 cleanLegacyFields
            // 舊格式清理屬於過渡期工具，不應在每次登入時自動執行並寫回 Firestore
            // 若需要手動清理，可在 DevTools console 執行：cleanLegacyFields(loadItemScores())
            const scores = doc.data().itemScores;
            localStorage.setItem(ITEM_SCORES_KEY, JSON.stringify(scores));
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
        data[key][itemType][text] = { fc: null, fcplus: null, dictation: null, reorder: null, voiceReorder: null, articleListen: null, firstSeen: _todayStr(), lastSeen: null };
    }

    const rec = data[key][itemType][text];

    // 確保來源欄位存在
    if (!rec[source]) rec[source] = { correct: 0, wrong: 0 };
    const src = rec[source];

    // replayCount：每次手動重播代表使用者需要額外幫助，
    // 無論最終答對或答錯，都記錄為額外的 wrong，
    // 讓熟悉度公式反映出「聽幾次才答出來」的困難程度。
    if (isCorrect) {
        src.correct++;
    } else {
        src.wrong++;
    }
    if (replayCount > 0) src.wrong += replayCount;
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
 * 根據 itemType 計算熟悉度（0–100）
 *
 * 計分規則：
 *   noteWords / articleWords
 *     → 只計 fcplus（Spell the word，最高難度）100%
 *
 *   noteSentences
 *     → reorder 70%（Rearrange，難度高）
 *        + dictation 30%（聽音選句，難度低）
 *        若其中一個來源無資料，則由另一個單獨補滿 100%。
 *
 *   articleSentences
 *     → reorder 70%
 *        + articleListen 或 dictation 中較高者（取 max）30%
 *        若其中一個來源無資料，則由另一個單獨補滿 100%。
 *
 * 設計原則：
 *   - 只有「有資料的來源」才參與加權，防止「未測驗 = 0 分」拉低真實成績
 *   - reorder 是難度最高的正式考核，保持最大權重
 *   - dictation / articleListen 難度較低，以較小比重輔助計分
 */
function calcWeightedFamiliarity(rec, itemType) {
    if (!rec) return 0;

    if (itemType === 'noteWords' || itemType === 'articleWords') {
        // 單字：只看 fcplus（Flashcard+ Spell the word）
        const f = _calcSourceFam(rec['fcplus']);
        return f !== null ? f : 0;

    } else if (itemType === 'noteSentences') {
        // BUG-4 FIX: 句子（筆記）：reorder 60% + voiceReorder 20% + dictation 20%
        const fReorder      = _calcSourceFam(rec['reorder']);
        const fVoiceReorder = _calcSourceFam(rec['voiceReorder']);
        const fDictation    = _calcSourceFam(rec['dictation']);

        // 收集有值的分數，動態調整權重
        const scores = [];
        if (fReorder      !== null) scores.push({ val: fReorder,      w: 0.60 });
        if (fVoiceReorder !== null) scores.push({ val: fVoiceReorder, w: 0.20 });
        if (fDictation    !== null) scores.push({ val: fDictation,    w: 0.20 });

        if (scores.length === 0) return 0;
        const totalW = scores.reduce((a, s) => a + s.w, 0);
        return Math.round(scores.reduce((a, s) => a + s.val * (s.w / totalW), 0));

    } else if (itemType === 'articleSentences') {
        // BUG-4 FIX: 句子（文章）：reorder 60% + voiceReorder 20% + max(articleListen, dictation) 20%
        const fReorder      = _calcSourceFam(rec['reorder']);
        const fVoiceReorder = _calcSourceFam(rec['voiceReorder']);
        const fArtListen    = _calcSourceFam(rec['articleListen']);
        const fDictation    = _calcSourceFam(rec['dictation']);

        // 取 articleListen / dictation 中分數較高的作為輔助分
        const fAux = (fArtListen !== null && fDictation !== null)
            ? Math.max(fArtListen, fDictation)
            : (fArtListen !== null ? fArtListen : fDictation);

        const scores = [];
        if (fReorder      !== null) scores.push({ val: fReorder,      w: 0.60 });
        if (fVoiceReorder !== null) scores.push({ val: fVoiceReorder, w: 0.20 });
        if (fAux          !== null) scores.push({ val: fAux,          w: 0.20 });

        if (scores.length === 0) return 0;
        const totalW = scores.reduce((a, s) => a + s.w, 0);
        return Math.round(scores.reduce((a, s) => a + s.val * (s.w / totalW), 0));

    } else {
        // fallback：舊格式 { correct, wrong }
        return calcFamiliarityLegacy(rec);
    }
}

/**
 * 計算口說熟悉度（voiceReorder source）
 * 回傳 0–100，或 null（無資料）
 */
function calcVoiceScore(rec) {
    if (!rec) return null;
    return _calcSourceFam(rec['voiceReorder']);
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
 * 判斷 rec 是否有正式考核記錄
 *
 * 新版：dictation（noteSentences）和 articleListen（articleSentences）
 * 也算正式考核，不再只視為「練習記錄」。
 *
 * 正式考核來源對照表：
 *   noteWords / articleWords     → fcplus
 *   noteSentences                → reorder、dictation
 *   articleSentences             → reorder、articleListen、dictation
 */
function _recHasPractice(rec) {
    if (!rec) return false;
    return (rec['fcplus']        && (rec['fcplus'].correct        + rec['fcplus'].wrong)        > 0)
        || (rec['reorder']       && (rec['reorder'].correct       + rec['reorder'].wrong)       > 0)
        || (rec['voiceReorder']  && (rec['voiceReorder'].correct  + rec['voiceReorder'].wrong)  > 0)
        || (rec['dictation']     && (rec['dictation'].correct     + rec['dictation'].wrong)     > 0)
        || (rec['articleListen'] && (rec['articleListen'].correct + rec['articleListen'].wrong) > 0);
}

/**
 * 取得 rec 的總答對/答錯數（所有來源合計）
 */
function _recTotals(rec) {
    if (!rec) return { correct: 0, wrong: 0 };
    const sources = ['fc','fcplus','dictation','reorder','voiceReorder','articleListen'];
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
    const hasNewFormat = ['fc','fcplus','dictation','reorder','voiceReorder','articleListen'].some(s => itemRecord[s]);
    if (hasNewFormat && itemType) return calcWeightedFamiliarity(itemRecord, itemType);
    if (hasNewFormat) {
        // 沒有傳 itemType 時嘗試所有來源平均
        const vals = ['fc','fcplus','dictation','reorder','voiceReorder','articleListen']
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
        ? allNoteWords.filter(t => {
            const r = testedNoteWords[t];
            return r && r['fcplus'] && (r['fcplus'].correct + r['fcplus'].wrong) > 0;
        }).length
        : fallbackWordItems.filter(i => i['fcplus'] && (i['fcplus'].correct + i['fcplus'].wrong) > 0).length;

    // ▶ 修改：dictation 也算「測驗過」
    const noteTestedSentCount = allNoteSents.length > 0
        ? allNoteSents.filter(t => {
            const r = testedNoteSents[t];
            if (!r) return false;
            return (r['reorder']   && (r['reorder'].correct   + r['reorder'].wrong)   > 0)
                || (r['dictation'] && (r['dictation'].correct + r['dictation'].wrong) > 0);
        }).length
        : fallbackSentItems.filter(i =>
            (i['reorder']   && (i['reorder'].correct   + i['reorder'].wrong)   > 0)
         || (i['dictation'] && (i['dictation'].correct + i['dictation'].wrong) > 0)
        ).length;

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

    // ── 正式考核覆蓋率（只計 fcplus / reorder）────────────────
    // 單字覆蓋率
    const wordTestedTotal = noteTestedWordCount
        + artWordItems.filter(i => i['fcplus'] && (i['fcplus'].correct + i['fcplus'].wrong) > 0).length;
    const wordTotal = noteWordTotal + artWordTotal;

    // ▶ 修改：articleListen / dictation 也算「測驗過」
    const artSentTestedCount = artSentItems.filter(i =>
        (i['reorder']       && (i['reorder'].correct       + i['reorder'].wrong)       > 0)
     || (i['articleListen'] && (i['articleListen'].correct + i['articleListen'].wrong) > 0)
     || (i['dictation']     && (i['dictation'].correct     + i['dictation'].wrong)     > 0)
    ).length;
    const sentTestedTotal = noteTestedSentCount + artSentTestedCount;
    const sentTotal = noteSentTotal + artSentTotal;

    // ── 口說（voiceReorder）──────────────────────────────────
    // 合併 noteSentences + articleSentences 中有 voiceReorder 記錄的項目
    const allSentItems = [
        ...Object.values(entry.noteSentences   || {}),
        ...Object.values(entry.articleSentences || {}),
    ];
    const voiceItems = allSentItems.filter(r =>
        r['voiceReorder'] && (r['voiceReorder'].correct + r['voiceReorder'].wrong) > 0
    );
    const voiceScores   = voiceItems.map(r => _calcSourceFam(r['voiceReorder']) ?? 0);
    const voiceTested   = voiceItems.length;
    const voiceTotal    = allSentItems.length;
    // 未測驗的句子補 0 分，讓分母 = 全部句子數，百分比才正確
    const voiceUntested = Math.max(0, voiceTotal - voiceTested);
    const allVoiceScores = [...voiceScores, ...Array(voiceUntested).fill(0)];
    const voiceAvg      = allVoiceScores.length > 0
        ? Math.round(allVoiceScores.reduce((a, b) => a + b, 0) / allVoiceScores.length) : null;

    const totalItems  = noteTotal + artTotal;
    const totalTested = wordTestedTotal + sentTestedTotal;

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
        // 分開的覆蓋率（只計正式考核：fcplus / reorder）
        wordTestedTotal, wordTotal,
        sentTestedTotal, sentTotal,
        // 口說
        voiceAvg, voiceTested, voiceTotal,
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

    // 文章名排序：直接字母比較，不需 summary 數值
    if (key === 'title') {
        return [...articles].sort((a, b) =>
            dir === 'asc'
                ? a.title.localeCompare(b.title)
                : b.title.localeCompare(a.title)
        );
    }

    return [...articles].sort((a, b) => {
        const _getVal = (summary, k) => {
            if (k === 'word') {
                const na = summary.noteWordAvg, nb = summary.artWordAvg;
                if (na !== null && nb !== null) return Math.round((na + nb) / 2);
                return na ?? nb ?? null;
            }
            if (k === 'sent') {
                const na = summary.noteSentAvg, nb = summary.artSentAvg;
                if (na !== null && nb !== null) return Math.round((na + nb) / 2);
                return na ?? nb ?? null;
            }
            if (k === 'voice') return summary.voiceAvg;
            return summary.famAvg;
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
    // asc = 低熟悉度（fam-red）在前；desc = 高熟悉度在前
    // 文章名排序：asc = A→Z，desc = Z→A
    const arrow = dir === 'asc' ? ' ↓' : ' ↑';

    const btns = [
        { k: 'title', label: '🔤 文章名',   title: '文章名稱 A→Z / Z→A' },
        { k: 'word',  label: '📖 單字',    title: '單字熟悉度（低→高）' },
        { k: 'sent',  label: '📝 句子',    title: '句子熟悉度（低→高）' },
        { k: 'voice', label: '🎙 口說',    title: '口說熟悉度（低→高）' },
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
                // 同一按鈕再點：升降冪切換（asc=低熟悉度↓ → desc=高熟悉度↑）
                state.dir = state.dir === 'asc' ? 'desc' : 'asc';
            } else {
                // 切換新維度：預設 asc（fam-red 最需練習的在最前面）
                state.key = sortKey;
                state.dir = 'asc';
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
    const {
        noteWordAvg, noteSentAvg, artWordAvg, artSentAvg,
        noteWordTotal, noteSentTotal, noteTestedWordCount, noteTestedSentCount,
        testedSentCount, untestedSentCount,
        wordTestedTotal, wordTotal, sentTestedTotal, sentTotal,
        voiceAvg, voiceTested, voiceTotal
    } = summary;

    // ── 計算三欄的平均值 ─────────────────────────────────────
    // 單字欄：Note 單字 + Article 單字 平均
    let wordAvg = null;
    if (noteWordAvg !== null && artWordAvg !== null) wordAvg = Math.round((noteWordAvg + artWordAvg) / 2);
    else if (noteWordAvg !== null) wordAvg = noteWordAvg;
    else if (artWordAvg  !== null) wordAvg = artWordAvg;

    // 句子欄：Note 句子 + Article 句子 平均
    let sentAvg = null;
    if (noteSentAvg !== null && artSentAvg !== null) sentAvg = Math.round((noteSentAvg + artSentAvg) / 2);
    else if (noteSentAvg !== null) sentAvg = noteSentAvg;
    else if (artSentAvg  !== null) sentAvg = artSentAvg;

    // ── 覆蓋率文字 ───────────────────────────────────────────
    const wordCoverage  = wordTotal  > 0 ? `${wordTestedTotal}/${wordTotal}`   : null;
    const sentCoverage  = sentTotal  > 0 ? `${sentTestedTotal}/${sentTotal}`   : null;
    const voiceCoverage = voiceTotal > 0 ? `${voiceTested}/${voiceTotal}` : null;

    function pillarHtml(icon, label, avg, coverage, cssClass) {
        const colorClass = avg !== null ? getFamiliarityColor(avg) : 'chip-untested';
        const valHtml    = avg !== null
            ? `<div class="art-pillar-val ${colorClass}">${avg}%</div>`
            : `<div class="art-pillar-val chip-untested">—</div>`;
        const barHtml    = avg !== null
            ? `<div class="art-pillar-bar-track"><div class="art-pillar-bar ${colorClass}" style="width:${avg}%"></div></div>`
            : `<div class="art-pillar-bar-track"><div class="art-pillar-bar" style="width:0%"></div></div>`;
        const covHtml    = coverage
            ? `<div class="art-pillar-cov">${coverage}</div>`
            : '';
        return `<div class="art-pillar ${cssClass}">
            <div class="art-pillar-label">${icon} ${label}</div>
            ${valHtml}
            ${barHtml}
            ${covHtml}
        </div>`;
    }

    const wordPillar  = pillarHtml('🔤', '單字', wordAvg,  wordCoverage,  'art-pillar-word');
    const sentPillar  = pillarHtml('📝', '句子', sentAvg,  sentCoverage,  'art-pillar-sent');
    const voicePillar = pillarHtml('🎙', '口說', voiceAvg, voiceCoverage, 'art-pillar-voice');

    return `<div class="browser-article-row" data-title="${_escHtml(title)}" data-cat="${_escHtml(cat)}">
        <div class="browser-article-title">${_escHtml(title)}</div>
        <div class="browser-article-pillars">
            ${wordPillar}
            ${sentPillar}
            ${voicePillar}
        </div>
        <div class="browser-article-actions">
            <button class="browser-quiz-btn" data-title="${_escHtml(title)}" data-cat="${_escHtml(cat)}" title="進入 Quiz">🎯</button>
            <button class="browser-read-btn" data-title="${_escHtml(title)}" data-cat="${_escHtml(cat)}" title="前往文章">📖</button>
        </div>
    </div>`;
}

// ── Sort button binding ───────────────────────────────────────

document.getElementById('dash-sort-fam-btn')?.addEventListener('click', () => {
    _dashSortDir = _dashSortDir === 'desc' ? 'asc' : 'desc';
    renderScoresDashboard();
});

// ── 編輯紀錄 入口 ─────────────────────────────────────────────
document.getElementById('scores-clear-all-btn')?.addEventListener('click', () => {
    openEditRecordsPanel();
});

// ══════════════════════════════════════════════════════════════
//  編輯紀錄 面板
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

    document.getElementById('edit-records-organize-btn').addEventListener('click', () => {
        overlay.remove();
        openOrganizePanel();
    });
    document.getElementById('edit-records-clear-btn').addEventListener('click', () => {
        overlay.remove();
        openClearPanel();
    });
}


// ══════════════════════════════════════════════════════════════
//  🔍 整理測驗紀錄
// ══════════════════════════════════════════════════════════════

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

    // Build major options
    const majorOptions = majors.map(m =>
        `<option value="${_escHtml(m)}">${_escHtml(m)}</option>`
    ).join('');

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

            <!-- 範圍選擇 -->
            <div style="margin-bottom:16px;">
                <div style="font-size:0.82em;font-weight:600;color:var(--color-text-light,#888);margin-bottom:8px;">整理範圍</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="org-scope-btn is-active" data-scope="all" style="
                        padding:7px 14px;border-radius:20px;border:1.5px solid var(--color-primary,#4a90d9);
                        background:var(--color-primary,#4a90d9);color:#fff;
                        font-size:0.85em;cursor:pointer;font-weight:600;
                    ">全部整理</button>
                    <button class="org-scope-btn" data-scope="major" style="
                        padding:7px 14px;border-radius:20px;border:1.5px solid var(--color-border,#ddd);
                        background:transparent;color:var(--color-text,#333);
                        font-size:0.85em;cursor:pointer;
                    ">分類整理</button>
                    <button class="org-scope-btn" data-scope="single" style="
                        padding:7px 14px;border-radius:20px;border:1.5px solid var(--color-border,#ddd);
                        background:transparent;color:var(--color-text,#333);
                        font-size:0.85em;cursor:pointer;
                    ">個別整理</button>
                </div>
            </div>

            <!-- 分類選擇（scope=major 時顯示）-->
            <div id="org-major-row" style="display:none;margin-bottom:14px;">
                <select id="org-major-select" style="
                    width:100%;padding:9px 12px;border-radius:10px;
                    border:1.5px solid var(--color-border,#ddd);
                    background:var(--color-bg,#f5f5f5);
                    font-size:0.9em;color:var(--color-text,#333);
                ">
                    <option value="">— 選擇大類 —</option>
                    ${majorOptions}
                </select>
            </div>

            <!-- 文章選擇（scope=single 時顯示）-->
            <div id="org-article-row" style="display:none;margin-bottom:14px;">
                <select id="org-major-select-for-single" style="
                    width:100%;padding:9px 12px;border-radius:10px;
                    border:1.5px solid var(--color-border,#ddd);
                    background:var(--color-bg,#f5f5f5);
                    font-size:0.9em;color:var(--color-text,#333);margin-bottom:8px;
                ">
                    <option value="">— 選擇大類 —</option>
                    ${majorOptions}
                </select>
                <select id="org-cat-select" style="
                    width:100%;padding:9px 12px;border-radius:10px;
                    border:1.5px solid var(--color-border,#ddd);
                    background:var(--color-bg,#f5f5f5);
                    font-size:0.9em;color:var(--color-text,#333);margin-bottom:8px;
                    display:none;
                ">
                    <option value="">— 選擇分類 —</option>
                </select>
                <select id="org-article-select" style="
                    width:100%;padding:9px 12px;border-radius:10px;
                    border:1.5px solid var(--color-border,#ddd);
                    background:var(--color-bg,#f5f5f5);
                    font-size:0.9em;color:var(--color-text,#333);
                    display:none;
                ">
                    <option value="">— 選擇文章 —</option>
                </select>
            </div>

            <!-- 掃描按鈕 -->
            <button id="org-scan-btn" style="
                width:100%;padding:12px;border-radius:12px;border:none;
                background:var(--color-primary,#4a90d9);color:#fff;
                font-size:0.95em;font-weight:700;cursor:pointer;margin-bottom:16px;
            ">🔍 開始掃描</button>

            <!-- 掃描結果 -->
            <div id="org-results-area" style="display:none;">
                <div id="org-results-summary" style="
                    font-size:0.85em;padding:10px 14px;border-radius:10px;
                    background:rgba(0,0,0,0.04);margin-bottom:12px;
                    color:var(--color-text,#333);
                "></div>
                <div id="org-results-list" style="max-height:340px;overflow-y:auto;"></div>
                <div id="org-action-bar" style="
                    display:none;margin-top:14px;
                    display:flex;gap:10px;justify-content:flex-end;
                ">
                    <button id="org-delete-all-btn" style="
                        padding:9px 18px;border-radius:10px;border:none;
                        background:#e05c5c;color:#fff;font-size:0.88em;font-weight:700;cursor:pointer;
                    ">🗑 全部刪除</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // ── Back button ──
    document.getElementById('organize-back-btn').addEventListener('click', () => {
        overlay.remove();
        openEditRecordsPanel();
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // ── Scope buttons ──
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

    // ── Single: cascade selects ──
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

    // ── Scan button ──
    document.getElementById('org-scan-btn').addEventListener('click', async () => {
        const scanBtn = document.getElementById('org-scan-btn');
        scanBtn.textContent = '⏳ 掃描中…';
        scanBtn.disabled = true;

        // Build target article list
        let targets = []; // [{ cat, title }]
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

        // Scan each article
        const orphans = []; // { key, cat, title, type, text }

        for (const { cat, title, key } of targets) {
            const entry = itemData[key];
            if (!entry) continue;

            // Check sentences against timestamp
            let tsData = null;
            if (typeof getTimestampForStory === 'function') {
                try { tsData = await getTimestampForStory(title); } catch(e) {}
            }

            const norm = t => t.trim().replace(/[.,?!'"``""'']/g, '').toLowerCase();

            // noteSentences
            if (entry.noteSentences) {
                const tsSentences = tsData ? new Set(tsData.map(l => norm(l.sentence))) : null;
                Object.keys(entry.noteSentences).forEach(text => {
                    const isOrphan = tsSentences ? !tsSentences.has(norm(text)) : false;
                    if (isOrphan) orphans.push({ key, cat, title, type: 'noteSentences', typeLabel: 'Note 句子', text });
                });
            }

            // articleSentences
            if (entry.articleSentences) {
                const tsSentences = tsData ? new Set(tsData.map(l => norm(l.sentence))) : null;
                Object.keys(entry.articleSentences).forEach(text => {
                    const isOrphan = tsSentences ? !tsSentences.has(norm(text)) : false;
                    if (isOrphan) orphans.push({ key, cat, title, type: 'articleSentences', typeLabel: '文章句子', text });
                });
            }

            // noteWords / articleWords — orphan if story no longer exists
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

        // Render results
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

        summaryEl.innerHTML = `⚠️ 發現 <strong>${orphans.length}</strong> 筆孤立紀錄（測驗記錄中的句子已不存在於 timestamp）`;
        actionBar.style.display = 'flex';

        // Group by title
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
                <button class="org-del-article-btn" data-key="${_escHtml(group.items[0].key)}" style="
                    padding:4px 10px;border-radius:7px;border:none;
                    background:#e05c5c;color:#fff;font-size:0.78em;cursor:pointer;font-weight:600;
                ">全刪</button>
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
                    <button class="org-del-one-btn" style="
                        padding:4px 9px;border-radius:7px;border:none;
                        background:rgba(224,92,92,0.12);color:#c0392b;
                        font-size:0.78em;cursor:pointer;white-space:nowrap;
                    ">刪除</button>
                `;
                section.appendChild(row);
            });

            listEl.appendChild(section);
        });

        // ── Delete one ──
        listEl.querySelectorAll('.org-del-one-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const row  = btn.closest('[data-orphan-key]');
                const key  = row.dataset.orphanKey;
                const type = row.dataset.orphanType;
                const text = row.dataset.orphanText;
                _deleteOrphan(key, type, text);
                row.remove();
                _updateOrgSummary(listEl, summaryEl, actionBar);
            });
        });

        // ── Delete article group ──
        listEl.querySelectorAll('.org-del-article-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const key     = btn.dataset.key;
                const section = btn.closest('div[style*="margin-bottom"]');
                const rows    = section.querySelectorAll('[data-orphan-key]');
                rows.forEach(row => _deleteOrphan(row.dataset.orphanKey, row.dataset.orphanType, row.dataset.orphanText));
                section.remove();
                _updateOrgSummary(listEl, summaryEl, actionBar);
            });
        });

        // ── Delete all ──
        document.getElementById('org-delete-all-btn').addEventListener('click', () => {
            if (!confirm(`確定要刪除全部 ${orphans.length} 筆孤立紀錄？`)) return;
            orphans.forEach(o => _deleteOrphan(o.key, o.type, o.text));
            listEl.innerHTML = '';
            summaryEl.innerHTML = `✅ 已刪除 ${orphans.length} 筆孤立紀錄。`;
            actionBar.style.display = 'none';
        });
    });
}

function _deleteOrphan(key, type, text) {
    const data = loadItemScores();
    if (data[key]?.[type]?.[text]) {
        delete data[key][type][text];
        saveItemScores(data);
    }
}

function _updateOrgSummary(listEl, summaryEl, actionBar) {
    const remaining = listEl.querySelectorAll('[data-orphan-key]').length;
    if (remaining === 0) {
        summaryEl.innerHTML = '✅ 所有孤立紀錄已清除！';
        actionBar.style.display = 'none';
    } else {
        summaryEl.innerHTML = `⚠️ 剩餘 <strong>${remaining}</strong> 筆孤立紀錄`;
    }
}


// ══════════════════════════════════════════════════════════════
//  🗑 清除測驗紀錄
// ══════════════════════════════════════════════════════════════

function openClearPanel() {
    const old = document.getElementById('clear-records-overlay');
    if (old) old.remove();

    const storyList = typeof stories !== 'undefined' ? stories : [];
    const itemData  = loadItemScores();

    const overlay = document.createElement('div');
    overlay.id = 'clear-records-overlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:9100;
        background:rgba(0,0,0,0.5);
        display:flex;align-items:flex-start;justify-content:center;
        padding:20px;overflow-y:auto;
    `;

    // Build tree: major → category → articles
    const majors = [...new Set(storyList.map(s => s['大類'] || 'Uncategorized'))].sort();

    let treeHtml = '';
    majors.forEach(major => {
        const cats = [...new Set(storyList.filter(s => (s['大類']||'Uncategorized') === major).map(s => s['分類']?.[0]||'Uncategorized'))].sort();
        let catHtml = '';
        cats.forEach(cat => {
            const articles = storyList.filter(s => (s['大類']||'Uncategorized') === major && (s['分類']?.[0]||'Uncategorized') === cat).map(s => s['標題']).sort();
            let artHtml = '';
            articles.forEach(title => {
                const key = `${cat}||${title}`;
                const hasData = !!itemData[key];
                const countTotal = hasData ? _countRecords(itemData[key]) : 0;
                artHtml += `
                    <div class="clr-article-row" style="
                        padding:8px 12px 8px 28px;
                        display:flex;align-items:center;gap:8px;
                        border-top:1px solid var(--color-border,#f0f0f0);
                        opacity:${hasData ? '1' : '0.4'};
                    ">
                        <input type="checkbox" class="clr-art-check" data-key="${_escHtml(key)}" data-title="${_escHtml(title)}"
                            ${!hasData ? 'disabled' : ''} style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">
                        <span style="flex:1;font-size:0.88em;">📄 ${_escHtml(title)}</span>
                        ${hasData ? `<span style="font-size:0.75em;color:var(--color-text-light,#999);">${countTotal} 筆</span>` : '<span style="font-size:0.75em;color:var(--color-text-light,#bbb);">無紀錄</span>'}
                    </div>
                `;
            });

            catHtml += `
                <div class="clr-cat-group" style="margin-bottom:4px;">
                    <div class="clr-cat-header" style="
                        padding:7px 12px 7px 16px;
                        display:flex;align-items:center;gap:8px;
                        background:rgba(0,0,0,0.03);cursor:pointer;
                    ">
                        <span class="clr-cat-toggle" style="font-size:0.7em;color:var(--color-text-light,#999);">▼</span>
                        <input type="checkbox" class="clr-cat-check" style="width:15px;height:15px;cursor:pointer;flex-shrink:0;">
                        <span style="font-size:0.88em;font-weight:600;flex:1;">📁 ${_escHtml(cat)}</span>
                    </div>
                    <div class="clr-cat-body">${artHtml}</div>
                </div>
            `;
        });

        treeHtml += `
            <div class="clr-major-group" style="margin-bottom:8px;border:1px solid var(--color-border,#eee);border-radius:12px;overflow:hidden;">
                <div class="clr-major-header" style="
                    padding:10px 14px;background:rgba(0,0,0,0.05);
                    display:flex;align-items:center;gap:8px;cursor:pointer;
                ">
                    <span class="clr-major-toggle" style="font-size:0.7em;color:var(--color-text-light,#999);">▼</span>
                    <input type="checkbox" class="clr-major-check" style="width:16px;height:16px;cursor:pointer;flex-shrink:0;">
                    <span style="font-size:0.95em;font-weight:700;flex:1;">📚 ${_escHtml(major)}</span>
                </div>
                <div class="clr-major-body">${catHtml}</div>
            </div>
        `;
    });

    overlay.innerHTML = `
        <div style="
            background:var(--color-card,#fff);
            border-radius:18px;
            padding:24px 20px 20px;
            max-width:480px;width:100%;
            box-shadow:0 8px 40px rgba(0,0,0,0.22);
            margin:auto;
        ">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
                <span style="font-size:1.3em;">🗑</span>
                <span style="font-size:1.05em;font-weight:700;">清除測驗紀錄</span>
                <button id="clear-back-btn" style="
                    margin-left:auto;padding:6px 14px;border-radius:8px;
                    border:1.5px solid var(--color-border,#ddd);
                    background:transparent;color:var(--color-text,#333);
                    font-size:0.85em;cursor:pointer;
                ">← 返回</button>
            </div>
            <div style="font-size:0.82em;color:var(--color-text-light,#999);margin-bottom:16px;">
                勾選要刪除的文章，或直接點「清除全部」
            </div>

            <!-- 全選 + 清除全部 -->
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--color-border,#eee);">
                <label style="display:flex;align-items:center;gap:6px;font-size:0.88em;cursor:pointer;">
                    <input type="checkbox" id="clr-select-all" style="width:16px;height:16px;"> 全選
                </label>
                <div style="flex:1;"></div>
                <button id="clr-delete-selected-btn" style="
                    padding:8px 16px;border-radius:10px;border:none;
                    background:#e05c5c;color:#fff;font-size:0.85em;font-weight:700;cursor:pointer;
                    opacity:0.4;pointer-events:none;
                " disabled>🗑 刪除勾選</button>
                <button id="clr-delete-all-btn" style="
                    padding:8px 16px;border-radius:10px;border:none;
                    background:#c0392b;color:#fff;font-size:0.85em;font-weight:700;cursor:pointer;
                ">⚠️ 清除全部</button>
            </div>

            <!-- 樹狀清單 -->
            <div id="clr-tree" style="max-height:400px;overflow-y:auto;">
                ${treeHtml || '<div style="padding:20px;text-align:center;color:var(--color-text-light,#999);font-size:0.88em;">尚無測驗紀錄</div>'}
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // ── Back ──
    document.getElementById('clear-back-btn').addEventListener('click', () => {
        overlay.remove();
        openEditRecordsPanel();
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // ── Collapse/expand major ──
    overlay.querySelectorAll('.clr-major-header').forEach(header => {
        header.addEventListener('click', e => {
            if (e.target.type === 'checkbox') return;
            const body   = header.nextElementSibling;
            const toggle = header.querySelector('.clr-major-toggle');
            const hidden = body.style.display === 'none';
            body.style.display = hidden ? '' : 'none';
            toggle.textContent = hidden ? '▼' : '▶';
        });
    });

    // ── Collapse/expand cat ──
    overlay.querySelectorAll('.clr-cat-header').forEach(header => {
        header.addEventListener('click', e => {
            if (e.target.type === 'checkbox') return;
            const body   = header.nextElementSibling;
            const toggle = header.querySelector('.clr-cat-toggle');
            const hidden = body.style.display === 'none';
            body.style.display = hidden ? '' : 'none';
            toggle.textContent = hidden ? '▼' : '▶';
        });
    });

    // ── Major checkbox → check all cats + articles under it ──
    overlay.querySelectorAll('.clr-major-check').forEach(majorChk => {
        majorChk.addEventListener('change', () => {
            const body = majorChk.closest('.clr-major-group').querySelector('.clr-major-body');
            body.querySelectorAll('.clr-art-check:not(:disabled)').forEach(c => c.checked = majorChk.checked);
            body.querySelectorAll('.clr-cat-check').forEach(c => c.checked = majorChk.checked);
            _updateClearDeleteBtn(overlay);
        });
    });

    // ── Cat checkbox → check all articles under it ──
    overlay.querySelectorAll('.clr-cat-check').forEach(catChk => {
        catChk.addEventListener('change', () => {
            const body = catChk.closest('.clr-cat-group').querySelector('.clr-cat-body');
            body.querySelectorAll('.clr-art-check:not(:disabled)').forEach(c => c.checked = catChk.checked);
            _updateClearDeleteBtn(overlay);
        });
    });

    // ── Article checkbox ──
    overlay.querySelectorAll('.clr-art-check').forEach(chk => {
        chk.addEventListener('change', () => _updateClearDeleteBtn(overlay));
    });

    // ── Select all ──
    document.getElementById('clr-select-all').addEventListener('change', function() {
        overlay.querySelectorAll('.clr-art-check:not(:disabled)').forEach(c => c.checked = this.checked);
        overlay.querySelectorAll('.clr-cat-check, .clr-major-check').forEach(c => c.checked = this.checked);
        _updateClearDeleteBtn(overlay);
    });

    // ── Delete selected ──
    document.getElementById('clr-delete-selected-btn').addEventListener('click', () => {
        const checked = [...overlay.querySelectorAll('.clr-art-check:checked')];
        if (checked.length === 0) return;
        if (!confirm(`確定要刪除 ${checked.length} 篇文章的測驗紀錄？\n此操作無法還原。`)) return;
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

    // ── Delete all ──
    document.getElementById('clr-delete-all-btn').addEventListener('click', () => {
        if (!confirm('⚠️ 清除所有學習記錄？\n\n此操作無法還原，建議先「匯出學習資料」備份。')) return;
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
                        ['fc','fcplus','dictation','reorder','voiceReorder','articleListen'].forEach(src => {
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

    let items = [];

    if (tab === 'voiceReorder') {
        // ── 口說 tab：合併 noteSentences + articleSentences
        // 只顯示「有 voiceReorder 紀錄」的句子，未測驗的不列出
        ['noteSentences', 'articleSentences'].forEach(itype => {
            const itemMap = entry[itype] || {};
            Object.entries(itemMap).forEach(([text, rec]) => {
                const vr = rec['voiceReorder'];
                const hasPractice = vr && (vr.correct + vr.wrong) > 0;
                if (!hasPractice) return; // 只顯示有口說紀錄的
                const famScore = _calcSourceFam(vr) ?? 0;
                items.push({
                    text,
                    correct:   vr.correct,
                    wrong:     vr.wrong,
                    lastSeen:  rec.lastSeen  || null,
                    firstSeen: rec.firstSeen || null,
                    famScore,
                    needScore:   100 - famScore,
                    hasPractice: true,
                    rec,
                    _voiceOnly: true,
                });
            });
        });
    } else {
        // ── 一般 tab ─────────────────────────────────────────────
        const itemMap = entry[tab] || {};
        items = Object.entries(itemMap).map(([text, rec]) => {
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
            for (let i = 0; i < untestedNeeded; i++) {
                items.push({
                    text: `（未測驗句子 ${testedCount + i + 1}）`,
                    correct: 0, wrong: 0, lastSeen: null, firstSeen: null,
                    famScore: 0, needScore: 100, hasPractice: false,
                    isPlaceholder: true
                });
            }
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
        if (sortBy === 'untested') {
            // desc = 未測驗優先（hasPractice=false 排前面）
            const ua = a.hasPractice ? 1 : 0;
            const ub = b.hasPractice ? 1 : 0;
            if (ua !== ub) return sortDir === 'desc' ? ua - ub : ub - ua;
            // 同為未測驗或同為已測驗時，按字母排列
            return a.text.toLowerCase().localeCompare(b.text.toLowerCase());
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
        const emptyMsg = {
            noteWords:        '此文章尚無筆記單字',
            noteSentences:    '此文章尚無筆記句子',
            articleWords:     '尚無 Article 單字測驗記錄（Flashcard/Flashcard+ Article 模式）',
            articleSentences: '尚無 Article 句子測驗記錄（Dictation/Reorder Article 模式）',
            voiceReorder:     '尚無口說測驗記錄（Voice Reorder 模式）',
        };
        listEl.innerHTML = `<div class="detail-empty">${emptyMsg[tab] || '尚無資料'}</div>`;
        return;
    }

    listEl.innerHTML = items.map(item => buildDetailItemHtml(item, tab)).join('');
}

/**
 * 計算 item 的出題優先桶（對應 quiz.js weightedSample 的分桶規則）
 * 回傳 { bucket, label, cssClass, effectiveFam, rawFam, daysSince }
 */
function _getItemBucketInfo(rec, itemType) {
    let effectiveFam = null;
    let rawFam = null;
    let days = 0;

    // ── 口說 tab：只看 voiceReorder source ───────────────────
    if (itemType === 'voiceReorder') {
        const vr = rec && rec['voiceReorder'];
        const hasvr = vr && (vr.correct + vr.wrong) > 0;
        if (hasvr) {
            rawFam = _calcSourceFam(vr);
            if (rawFam !== null) {
                const lastSeen = rec.lastSeen || null;
                days = lastSeen
                    ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 86400000)
                    : 0;
                const halfLife   = rawFam >= 70 ? 30 : rawFam >= 40 ? 14 : 7;
                const decayFloor = 15;  // voiceReorder 難度最高，使用較低底板
                const floor      = Math.min(decayFloor, rawFam);
                effectiveFam     = Math.round(floor + (rawFam - floor) * Math.pow(2, -days / halfLife));
            }
        }
        // 口說不影響 quiz 出題，隱藏出題桶顯示
        if (effectiveFam === null) {
            return { bucket: 'A', label: '🆕 未測驗', cssClass: 'bucket-a', effectiveFam: null, rawFam: null, days: 0, hideNote: true };
        }
        return { bucket: '-', label: '🎙 口說紀錄', cssClass: 'bucket-voice', effectiveFam, rawFam, days, hideNote: true };
    }

    // ── 一般 tab：加權熟悉度 + 衰減 ─────────────────────────
    if (rec && _recHasPractice(rec)) {
        rawFam = typeof calcWeightedFamiliarity === 'function'
            ? calcWeightedFamiliarity(rec, itemType)
            : null;

        if (rawFam !== null) {
            const lastSeen = rec.lastSeen || null;
            days = lastSeen
                ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 86400000)
                : 0;
            const halfLife = rawFam >= 70 ? 30 : rawFam >= 40 ? 14 : 7;
            const decayFloor = 20;  // 一般模式底板（與 quiz.js SR_CONFIG.decayFloor 同步）
            const floor = Math.min(decayFloor, rawFam);
            effectiveFam = Math.round(floor + (rawFam - floor) * Math.pow(2, -days / halfLife));
        }
    }

    if (effectiveFam === null) {
        return { bucket: 'A', label: '🆕 未測驗', cssClass: 'bucket-a', effectiveFam: null, rawFam: null, days: 0 };
    } else if (effectiveFam < 40) {
        return { bucket: 'B', label: '💪 需加強', cssClass: 'bucket-b', effectiveFam, rawFam, days };
    } else if (effectiveFam < 70) {
        return { bucket: 'C', label: '📈 進步中', cssClass: 'bucket-c', effectiveFam, rawFam, days };
    } else {
        return { bucket: 'D', label: '✅ 已熟悉', cssClass: 'bucket-d', effectiveFam, rawFam, days };
    }
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

    // ── 出題桶標籤（加權規則整合）────────────────────────────
    const bucketInfo = _getItemBucketInfo(rec, tab);

    let bucketHtml = '';
    if (tab === 'voiceReorder') {
        // 口說 tab：不顯示出題機率，改顯示口說熟悉度摘要
        if (bucketInfo.effectiveFam !== null) {
            const decayNote = (bucketInfo.rawFam !== null && bucketInfo.rawFam !== bucketInfo.effectiveFam)
                ? `<span class="bucket-decay-note">原始 ${bucketInfo.rawFam}% → 衰減後 ${bucketInfo.effectiveFam}% (${bucketInfo.days}天)</span>`
                : `<span class="bucket-decay-note">口說熟悉度 ${bucketInfo.effectiveFam}%</span>`;
            bucketHtml = `<div class="detail-item-bucket">
                <span class="bucket-chip ${bucketInfo.cssClass}">${bucketInfo.label}</span>
                ${decayNote}
            </div>`;
        }
        // 未測驗時不顯示 bucket 區塊
    } else {
        const decayNote = (bucketInfo.rawFam !== null && bucketInfo.rawFam !== bucketInfo.effectiveFam)
            ? `<span class="bucket-decay-note">原始 ${bucketInfo.rawFam}% → 衰減後 ${bucketInfo.effectiveFam}% (${bucketInfo.days}天)</span>`
            : (bucketInfo.effectiveFam !== null
                ? `<span class="bucket-decay-note">有效熟悉度 ${bucketInfo.effectiveFam}%</span>`
                : '');
        bucketHtml = `<div class="detail-item-bucket">
            <span class="bucket-chip ${bucketInfo.cssClass}">${bucketInfo.label}</span>
            ${decayNote}
            <span class="bucket-priority-note">${_bucketPriorityNote(bucketInfo.bucket)}</span>
        </div>`;
    }

    // ── 子來源明細 ────────────────────────────────────────────
    let sourceHtml = '';
    if (rec && hasPractice) {
        let sources = [];
        if (tab === 'noteWords' || tab === 'articleWords') {
            sources = [
                { key: 'fcplus', label: '🔤 FC+',      scoring: true  },
                { key: 'fc',     label: '🃏 FC',        scoring: false },
            ];
        } else if (tab === 'noteSentences') {
            sources = [
                { key: 'reorder',   label: '🔀 Reorder',   scoring: true  },
                { key: 'dictation', label: '🎧 Dictation',  scoring: false },
            ];
        } else if (tab === 'articleSentences') {
            sources = [
                { key: 'reorder',       label: '🔀 Reorder', scoring: true  },
                { key: 'articleListen', label: '📖 Listen',   scoring: false },
            ];
        } else if (tab === 'voiceReorder') {
            sources = [
                { key: 'voiceReorder', label: '🎙 Voice', scoring: true },
            ];
        }
        const srcParts = sources.map(s => {
            const sr = rec[s.key];
            if (!sr || (sr.correct + sr.wrong) === 0) {
                return `<span class="detail-src-chip detail-src-none">${s.label} <em>未測</em></span>`;
            }
            const fam  = _calcSourceFam(sr) ?? 0;
            const fc   = s.scoring ? getFamiliarityColor(fam) : '';
            const note = s.scoring ? '計分' : '練習';
            return `<span class="detail-src-chip ${s.scoring ? fc : 'detail-src-practice'}">${s.label} ${fam}% <em>${note}</em> ✓${sr.correct} ✗${sr.wrong}</span>`;
        }).join('');
        sourceHtml = `<div class="detail-item-sources">${srcParts}</div>`;
    }

    const isSentence = (tab === 'noteSentences' || tab === 'articleSentences' || tab === 'voiceReorder');
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
        ${bucketHtml}
        ${sourceHtml}
    </div>`;
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
            // fam 預設 asc（低熟悉度在前），untested 預設 desc（未測驗在前），其他預設 desc
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

// ── Quiz 結果頁的 Scores 按鈕 ───────────────────────────────
// 若有文章 context，直接跳到該文章的 Detail View；否則開 Dashboard
document.getElementById('quiz-goto-scores-btn')?.addEventListener('click', () => {
    const cat   = (typeof quizState !== 'undefined') ? quizState.categoryName : null;
    const title = (typeof quizState !== 'undefined') ? quizState.titleName    : null;
    if (cat && title && typeof openDetailView === 'function') {
        openDetailView(cat, title);
    } else {
        openScoresDashboard();
    }
});
