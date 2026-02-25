// ============================================================
//  QUIZ ITEM TRACKER — quiz-item-tracker.js
//  細粒度記錄每個單字/句子的測驗結果，並計算「需練指數」
//  需在 quiz.js 之後載入
// ============================================================

const ITEM_SCORES_KEY = 'readingChallengeItemScores';

// ── Storage helpers ──────────────────────────────────────────

function loadItemScores() {
    try {
        return JSON.parse(localStorage.getItem(ITEM_SCORES_KEY) || '{}');
    } catch (e) { return {}; }
}

function saveItemScores(data) {
    localStorage.setItem(ITEM_SCORES_KEY, JSON.stringify(data));
    // Sync to Firestore
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
            localStorage.setItem(ITEM_SCORES_KEY, JSON.stringify(doc.data().itemScores));
        }
    } catch (e) { console.error('Item scores load error:', e); }
}

// ── Core record function ─────────────────────────────────────

/**
 * 記錄單一題目的結果
 * @param {string} categoryName
 * @param {string} titleName
 * @param {string} itemType  'noteWord' | 'noteSentence' | 'articleSentence'
 * @param {string} itemText  單字或句子原文
 * @param {boolean} isCorrect
 */
function recordItemResult(categoryName, titleName, itemType, itemText, isCorrect) {
    if (!categoryName || !titleName || !itemText) return;

    const data = loadItemScores();
    const key = `${categoryName}||${titleName}`;
    if (!data[key]) data[key] = { noteWords: {}, noteSentences: {}, articleSentences: {} };
    if (!data[key][itemType]) data[key][itemType] = {};

    const item = data[key][itemType];
    const text = itemText.trim();
    if (!item[text]) {
        item[text] = { correct: 0, wrong: 0, firstSeen: _todayStr(), lastSeen: null };
    }

    if (isCorrect) item[text].correct++;
    else           item[text].wrong++;
    item[text].lastSeen = _todayStr();

    saveItemScores(data);
}

function _todayStr() {
    return new Date().toLocaleDateString();
}

// ── Need-practice score calculation ─────────────────────────

/**
 * 計算「需練指數」0–100（越高越需要練習）
 *
 * 未測驗          → 100
 * 有測驗記錄      → 錯誤率 × 70 + 遺忘時間衰減 × 30
 *
 * dayDecay: 7天內=0, 7-30天線性增加, 30天以上=100
 */
function calcNeedScore(itemRecord) {
    if (!itemRecord || (itemRecord.correct === 0 && itemRecord.wrong === 0)) {
        return 100; // 從未測驗
    }

    const total = itemRecord.correct + itemRecord.wrong;
    const errorRate = total > 0 ? itemRecord.wrong / total : 0;

    const days = _daysSince(itemRecord.lastSeen);
    let dayDecay = 0;
    if (days >= 30) {
        dayDecay = 1;
    } else if (days >= 7) {
        dayDecay = (days - 7) / 23; // 7~30天線性
    }

    return Math.round(errorRate * 70 + dayDecay * 30);
}

function _daysSince(dateStr) {
    if (!dateStr) return Infinity;
    const d = new Date(dateStr);
    if (isNaN(d)) return Infinity;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function getNeedScoreColor(score) {
    if (score >= 80) return 'need-red';
    if (score >= 40) return 'need-yellow';
    return 'need-green';
}

function getNeedScoreLabel(score, hasRecord) {
    if (!hasRecord) return '⬜ 未測驗';
    if (score >= 80) return '🔴 高頻出現';
    if (score >= 40) return '🟡 需要練習';
    return '🟢 已掌握';
}

// ── Article-level need score (aggregate) ────────────────────

/**
 * 計算一篇文章的整體需練指數（用於第一層列表）
 * @returns { noteScore, articleScore, noteUntested, noteTotal, articleUntested, articleTotal }
 */
function calcArticleNeedSummary(categoryName, titleName) {
    const data = loadItemScores();
    const key = `${categoryName}||${titleName}`;
    const entry = data[key] || {};

    function summarize(itemMap, extraUntested = 0) {
        const items = Object.values(itemMap || {});
        const scores = items.map(calcNeedScore);
        const untested = items.filter(i => i.correct === 0 && i.wrong === 0).length;
        const total = items.length;
        const avg = total > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / total) : null;
        return { avg, untested, total };
    }

    // Note: words + sentences
    const noteWordItems = Object.values(entry.noteWords || {});
    const noteSentItems = Object.values(entry.noteSentences || {});
    const allNoteItems = [...noteWordItems, ...noteSentItems];
    const noteScores = allNoteItems.map(calcNeedScore);
    const noteUntested = allNoteItems.filter(i => i.correct === 0 && i.wrong === 0).length;
    const noteTotal = allNoteItems.length;
    const noteAvg = noteTotal > 0 ? Math.round(noteScores.reduce((a, b) => a + b, 0) / noteTotal) : null;

    // Article sentences
    const artItems = Object.values(entry.articleSentences || {});
    const artScores = artItems.map(calcNeedScore);
    const artUntested = artItems.filter(i => i.correct === 0 && i.wrong === 0).length;
    const artTotal = artItems.length;
    const artAvg = artTotal > 0 ? Math.round(artScores.reduce((a, b) => a + b, 0) / artTotal) : null;

    return {
        noteAvg, noteUntested, noteTotal,
        artAvg,  artUntested,  artTotal,
        hasPractice: noteTotal > 0 || artTotal > 0
    };
}

// ── Hook into quiz answer handlers ──────────────────────────
// 在每次答題後呼叫 recordItemResult

// 儲存原始 handler 後 monkey-patch
// Cloze (note word)
const _origHandleClozeAnswer = handleClozeAnswer;
window.handleClozeAnswer = function(selected, correct, btn) {
    _origHandleClozeAnswer(selected, correct, btn);
    const isCorrect = selected === correct;
    recordItemResult(
        quizState.categoryName, quizState.titleName,
        'noteWord', correct, isCorrect
    );
};

// Dictation (note sentence)
const _origHandleDictationAnswer = handleDictationAnswer;
window.handleDictationAnswer = function(selected, correct, btn) {
    _origHandleDictationAnswer(selected, correct, btn);
    const isCorrect = selected === correct;
    recordItemResult(
        quizState.categoryName, quizState.titleName,
        'noteSentence', correct, isCorrect
    );
};

// Article Listen
const _origHandleArticleListenAnswer = handleArticleListenAnswer;
window.handleArticleListenAnswer = function(selected, q, btn) {
    _origHandleArticleListenAnswer(selected, q, btn);
    const isCorrect = selected === q.sentence;
    recordItemResult(
        quizState.categoryName, quizState.titleName,
        'articleSentence', q.sentence, isCorrect
    );
};

// Article Cloze — records sentence
const _origHandleArticleClozeAnswer = handleArticleClozeAnswer;
window.handleArticleClozeAnswer = function(selected, correct, q, btn) {
    _origHandleArticleClozeAnswer(selected, correct, q, btn);
    const isCorrect = selected.toLowerCase() === correct.toLowerCase();
    recordItemResult(
        quizState.categoryName, quizState.titleName,
        'articleSentence', q.sentence, isCorrect
    );
};

// Reorder (note or article sentence)
// Already patched in quiz.js via the check button; we intercept answeredQuestions push
// by wrapping reorder check button click after it fires
document.getElementById('reorder-check-btn').addEventListener('click', () => {
    // Only fire after the original handler has set quizState.answeredQuestions
    setTimeout(() => {
        const last = quizState.answeredQuestions[quizState.answeredQuestions.length - 1];
        if (!last || last._itemTracked) return;
        last._itemTracked = true;

        // Determine if this was from note or article
        // reorder source info: subpanelSource.reorder
        const itemType = (typeof subpanelSource !== 'undefined' && subpanelSource.reorder === 'article')
            ? 'articleSentence' : 'noteSentence';

        recordItemResult(
            quizState.categoryName, quizState.titleName,
            itemType, last.correct, last.isCorrect
        );
    }, 0);
}, true); // capture phase so it runs after quiz.js listener

// Flashcard (note word) — only if source is 'note'
document.getElementById('flashcard-correct').addEventListener('click', () => {
    if (quizState.flashSource !== 'note') return;
    const item = quizState.deck[quizState.deckIndex - 1]; // already advanced
    if (item) recordItemResult(quizState.categoryName, quizState.titleName, 'noteWord', item.text, true);
}, true);

document.getElementById('flashcard-wrong').addEventListener('click', () => {
    if (quizState.flashSource !== 'note') return;
    const item = quizState.deck[quizState.deckIndex - 1];
    if (item) recordItemResult(quizState.categoryName, quizState.titleName, 'noteWord', item.text, false);
}, true);

// ══════════════════════════════════════════════════════════════
//  ARTICLE DETAIL VIEW
//  細節頁 — 點擊文章後顯示單字/句子分析
// ══════════════════════════════════════════════════════════════

// State for detail view
let detailViewState = {
    categoryName: null,
    titleName: null,
    tab: 'noteWords',      // 'noteWords' | 'noteSentences' | 'articleSentences'
    sortBy: 'need',        // 'need' | 'alpha' | 'recent'
    sortDir: 'desc',
};

function openDetailView(categoryName, titleName) {
    detailViewState.categoryName = categoryName;
    detailViewState.titleName    = titleName;
    detailViewState.tab          = 'noteWords';
    detailViewState.sortBy       = 'need';
    detailViewState.sortDir      = 'desc';

    document.getElementById('detail-view-title').textContent = titleName;
    renderDetailView();
    showView(document.getElementById('item-detail-view'));
}

function renderDetailView() {
    const { categoryName, titleName, tab, sortBy, sortDir } = detailViewState;
    const data = loadItemScores();
    const key  = `${categoryName}||${titleName}`;
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
            btn.dataset.dir = sortDir;
            btn.textContent = btn.dataset.label + (sortDir === 'desc' ? ' ↓' : ' ↑');
        } else {
            btn.textContent = btn.dataset.label;
        }
    });

    // Get items for current tab
    const itemMap = entry[tab] || {};
    let items = Object.entries(itemMap).map(([text, rec]) => ({
        text,
        correct: rec.correct || 0,
        wrong:   rec.wrong   || 0,
        lastSeen: rec.lastSeen || null,
        firstSeen: rec.firstSeen || null,
        needScore: calcNeedScore(rec),
        hasPractice: (rec.correct + rec.wrong) > 0,
    }));

    // Also add "untested" items from savedWords (for noteWords/noteSentences)
    if (tab === 'noteWords' || tab === 'noteSentences') {
        const noteData = typeof savedWords !== 'undefined'
            ? (savedWords[categoryName]?.[titleName] || {})
            : {};
        const pool = tab === 'noteWords'
            ? [...(noteData.words || []), ...(noteData.phrases || [])]
            : [...(noteData.sentences || [])];

        pool.forEach(text => {
            const t = text.trim();
            if (!itemMap[t]) {
                items.push({ text: t, correct: 0, wrong: 0, lastSeen: null, firstSeen: null, needScore: 100, hasPractice: false });
            }
        });
    }

    // Sort
    items.sort((a, b) => {
        let va, vb;
        if (sortBy === 'need') {
            va = a.needScore; vb = b.needScore;
        } else if (sortBy === 'alpha') {
            va = a.text.toLowerCase(); vb = b.text.toLowerCase();
            return sortDir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
        } else { // recent
            va = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
            vb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
        }
        return sortDir === 'desc' ? vb - va : va - vb;
    });

    // Render
    const listEl = document.getElementById('detail-items-list');
    if (items.length === 0) {
        listEl.innerHTML = `<div class="detail-empty">
            ${tab === 'noteWords' ? '此文章尚無筆記單字' :
              tab === 'noteSentences' ? '此文章尚無筆記句子' :
              '尚無 Article 模式測驗記錄'}
        </div>`;
        return;
    }

    listEl.innerHTML = items.map(item => buildDetailItemHtml(item, tab)).join('');

    // Summary bar
    const tested    = items.filter(i => i.hasPractice).length;
    const untested  = items.length - tested;
    const avgNeed   = items.length > 0
        ? Math.round(items.reduce((s, i) => s + i.needScore, 0) / items.length) : 0;

    document.getElementById('detail-summary-bar').innerHTML = `
        <span class="detail-sum-chip">📝 共 ${items.length} 項</span>
        <span class="detail-sum-chip">✅ 已測 ${tested}</span>
        <span class="detail-sum-chip ${untested > 0 ? 'chip-warn' : ''}">⬜ 未測 ${untested}</span>
        <span class="detail-sum-chip ${avgNeed >= 60 ? 'chip-danger' : avgNeed >= 30 ? 'chip-warn' : 'chip-ok'}">
            平均需練 ${avgNeed}%
        </span>
    `;
}

function buildDetailItemHtml(item, tab) {
    const { text, correct, wrong, lastSeen, needScore, hasPractice } = item;
    const total = correct + wrong;
    const colorClass = getNeedScoreColor(needScore);

    const daysAgo = lastSeen
        ? (_daysSince(lastSeen) === 0 ? '今天' : `${_daysSince(lastSeen)}天前`)
        : '—';

    const scoreBar = `<div class="detail-score-bar-wrap">
        <div class="detail-score-bar ${colorClass}" style="width:${needScore}%"></div>
    </div>`;

    const statsHtml = hasPractice
        ? `<span class="detail-stat correct-stat">✓${correct}</span>
           <span class="detail-stat wrong-stat">✗${wrong}</span>
           <span class="detail-stat days-stat">📅${daysAgo}</span>`
        : `<span class="detail-stat untested-stat">未測驗</span>`;

    const isSentence = tab !== 'noteWords';
    const textClass  = isSentence ? 'detail-text-sentence' : 'detail-text-word';

    return `<div class="detail-item ${colorClass}">
        <div class="detail-item-top">
            <div class="detail-need-badge ${colorClass}">${needScore}</div>
            <div class="${textClass}">${escHtml(text)}</div>
        </div>
        ${scoreBar}
        <div class="detail-item-stats">${statsHtml}</div>
    </div>`;
}

function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Detail view event listeners ──────────────────────────────

document.getElementById('back-from-detail-view').addEventListener('click', () => {
    showView(document.getElementById('scores-dashboard-view'));
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
            detailViewState.sortDir = detailViewState.sortDir === 'desc' ? 'asc' : 'desc';
        } else {
            detailViewState.sortBy  = btn.dataset.sort;
            detailViewState.sortDir = 'desc';
        }
        renderDetailView();
    });
});

// ══════════════════════════════════════════════════════════════
//  ENHANCED SCORES DASHBOARD (第一層 — 文章列表)
// ══════════════════════════════════════════════════════════════

// Override the original renderScoresDashboard to add item-level columns
const _origRenderScoresDashboard = renderScoresDashboard;

function renderScoresDashboard() {
    // Call original (keeps session score table)
    _origRenderScoresDashboard();

    // Render the new item-level summary section below
    renderItemLevelSummarySection();
}

function renderItemLevelSummarySection() {
    const container = document.getElementById('item-level-summary-section');
    if (!container) return;

    const itemData = loadItemScores();
    const storyList = typeof stories !== 'undefined' ? stories : [];

    // Collect all articles that have item scores OR are in stories
    const titleMap = {};
    storyList.forEach(s => {
        const key = `${s['分類']?.[0] || 'Uncategorized'}||${s['標題']}`;
        titleMap[s['標題']] = { major: s['大類'] || 'Uncategorized', cat: s['分類']?.[0] || 'Uncategorized', key };
    });
    Object.keys(itemData).forEach(key => {
        const title = key.split('||')[1];
        if (title && !titleMap[title]) {
            titleMap[title] = { major: 'Other', cat: key.split('||')[0], key };
        }
    });

    // Build rows with item summary
    const rows = Object.entries(titleMap).map(([title, info]) => {
        const categoryName = info.cat;
        const summary = calcArticleNeedSummary(categoryName, title);
        return { title, major: info.major, categoryName, summary, key: info.key };
    }).filter(r => r.summary.hasPractice); // only show articles with any item data

    if (rows.length === 0) {
        container.innerHTML = `<div class="item-section-empty">
            <p>📝 完成任何測驗後，這裡會顯示每篇文章的細部學習狀態</p>
        </div>`;
        return;
    }

    // Sort by highest average need score
    rows.sort((a, b) => {
        const aScore = a.summary.noteAvg ?? a.summary.artAvg ?? 0;
        const bScore = b.summary.noteAvg ?? b.summary.artAvg ?? 0;
        return bScore - aScore;
    });

    // Group by major
    const majors = [...new Set(rows.map(r => r.major))].sort();

    let html = '';
    for (const major of majors) {
        const group = rows.filter(r => r.major === major);
        html += `<div class="item-major-group">
            <div class="item-major-label">${major}</div>
            ${group.map(row => buildItemRowHtml(row)).join('')}
        </div>`;
    }

    container.innerHTML = html;

    // Bind click to open detail view
    container.querySelectorAll('.item-article-row').forEach(row => {
        row.addEventListener('click', () => {
            openDetailView(row.dataset.cat, row.dataset.title);
        });
    });
}

function buildItemRowHtml(row) {
    const { title, categoryName, summary } = row;
    const { noteAvg, noteTotal, noteUntested, artAvg, artTotal, artUntested } = summary;

    function scoreChip(avg, total, untested, label) {
        if (total === 0 && untested === 0) {
            return `<div class="item-score-chip chip-none" title="${label}">
                <span class="chip-label">${label}</span>
                <span class="chip-val">—</span>
            </div>`;
        }
        if (avg === null) {
            return `<div class="item-score-chip chip-untested" title="${label}">
                <span class="chip-label">${label}</span>
                <span class="chip-val">⬜</span>
            </div>`;
        }
        const colorClass = getNeedScoreColor(avg);
        return `<div class="item-score-chip ${colorClass}" title="${label} 平均需練 ${avg}%\n已測${total - untested}/${total}">
            <span class="chip-label">${label}</span>
            <span class="chip-val">${avg}%</span>
            <div class="chip-bar-wrap"><div class="chip-bar" style="width:${avg}%"></div></div>
        </div>`;
    }

    const noteChip = scoreChip(noteAvg, noteTotal, noteUntested, '📝 Note');
    const artChip  = scoreChip(artAvg,  artTotal,  artUntested,  '📖 Article');

    return `<div class="item-article-row" data-title="${escHtml(title)}" data-cat="${escHtml(categoryName)}">
        <div class="item-row-title">${escHtml(title)}</div>
        <div class="item-row-chips">
            ${noteChip}
            ${artChip}
        </div>
        <div class="item-row-arrow">→</div>
    </div>`;
}

// ── Firestore sync on login ──────────────────────────────────
// Expose for story.js to call after auth
window.loadItemScoresFromFirestore = loadItemScoresFromFirestore;

console.log('✅ Quiz Item Tracker loaded.');
