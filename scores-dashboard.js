// ============================================================
//  SCORES DASHBOARD — scores-dashboard.js
//
//  包含：
//  1. Session 分數 Dashboard（原 quiz.js 2770行以後）
//  2. Item-level 細粒度記錄系統（單字/句子個別追蹤）
//  3. 文章細節頁（兩層式）
//
//  依賴：quiz.js（需先載入）
//  localStorage keys:
//    - readingChallengeQuizScores  → session 分數（原有）
//    - readingChallengeItemScores  → item 細粒度記錄（新增）
// ============================================================

// ══════════════════════════════════════════════════════════════
//  PART 1 — SESSION SCORE DASHBOARD
//  （從 quiz.js 搬移）
// ══════════════════════════════════════════════════════════════

const SCORE_MODE_META = {
    flashcard:        { icon: '🃏', label: 'Flashcard' },
    cloze:            { icon: '✏️', label: 'Fill in Blank' },
    dictation:        { icon: '🎧', label: 'Dictation' },
    reorder:          { icon: '🔀', label: 'Reorder' },
    'article-listen': { icon: '👂', label: 'Article Listen' },
    'article-cloze':  { icon: '📝', label: 'Article Cloze' },
};
const SCORE_MODES = Object.keys(SCORE_MODE_META);
const REVIEW_DAYS = 7;

// Dashboard state
let _dashFilter   = 'all';
let _dashSortMode = null;
let _dashSortDir  = 'desc';

function openScoresDashboard() {
    _dashFilter   = 'all';
    _dashSortMode = null;
    _dashSortDir  = 'desc';
    renderScoresDashboard();
    showView(document.getElementById('scores-dashboard-view'));
}

function getScoreColor(pct) {
    if (pct >= 0.9) return 'score-green';
    if (pct >= 0.6) return 'score-yellow';
    return 'score-red';
}

function daysSince(dateStr) {
    if (!dateStr) return Infinity;
    const d = new Date(dateStr);
    if (isNaN(d)) return Infinity;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function buildDashboardRows(scores) {
    const storyList = typeof stories !== 'undefined' ? stories : [];
    const titleMajor = {};
    for (const s of storyList) {
        titleMajor[s['標題']] = s['大類'] || 'Uncategorized';
    }

    const allTitles = new Set(storyList.map(s => s['標題']));
    for (const key of Object.keys(scores)) {
        const title = key.split('||')[1];
        if (title) allTitles.add(title);
    }

    const rows = [];
    for (const title of allTitles) {
        const major = titleMajor[title] || 'Other';
        const key   = Object.keys(scores).find(k => k.endsWith('||' + title));
        const entry = key ? scores[key] : {};

        const modeData = {};
        for (const mode of SCORE_MODES) {
            const d = entry[mode];
            if (d) {
                const pct      = d.total > 0 ? d.best / d.total : 0;
                const firstPct = d.total > 0 && d.first != null ? d.first / d.total : null;
                const trend    = firstPct != null ? pct - firstPct : null;
                const days     = daysSince(d.lastDate);
                modeData[mode] = { ...d, pct, firstPct, trend, days };
            }
        }

        const hasPractice = Object.keys(modeData).length > 0;
        const needsReview = hasPractice && Object.values(modeData).some(d => d.days >= REVIEW_DAYS);

        rows.push({ title, major, entry, modeData, hasPractice, needsReview });
    }
    return rows;
}

function renderScoresDashboard() {
    const scores  = loadQuizScores();
    const tableEl = document.getElementById('scores-dashboard-table');
    if (!tableEl) return;

    const allRows = buildDashboardRows(scores);

    // ── Summary Strip ──────────────────────────────────────────
    let totalAttempts = 0, perfectCount = 0, bestPctSum = 0, bestPctCount = 0;
    let practicedSet = new Set();
    const modeUsage = {};
    const totalArticles = allRows.length;

    for (const row of allRows) {
        if (row.hasPractice) practicedSet.add(row.title);
        for (const mode of SCORE_MODES) {
            const d = row.modeData[mode];
            if (!d) continue;
            totalAttempts += d.count || 0;
            bestPctSum    += d.pct;
            bestPctCount++;
            if (d.best === d.total && d.total > 0) perfectCount++;
            modeUsage[mode] = (modeUsage[mode] || 0) + (d.count || 0);
        }
    }

    const coveragePct = totalArticles > 0
        ? Math.round(practicedSet.size / totalArticles * 100) + '%' : '—';

    document.getElementById('summary-coverage').textContent      = coveragePct;
    document.getElementById('summary-total-attempts').textContent = totalAttempts;
    document.getElementById('summary-avg-best').textContent       = bestPctCount > 0
        ? Math.round(bestPctSum / bestPctCount * 100) + '%' : '—';
    document.getElementById('summary-perfect-count').textContent  = perfectCount;

    // ── Alert Row ─────────────────────────────────────────────
    const alertRow = document.getElementById('scores-alert-row');
    let alertHtml = '';

    if (Object.keys(modeUsage).length > 0) {
        const leastMode = Object.keys(modeUsage).sort((a, b) => modeUsage[a] - modeUsage[b])[0];
        const meta = SCORE_MODE_META[leastMode];
        alertHtml += `<div class="scores-alert scores-alert-blind">
            💡 最少練習的模式：<strong>${meta.icon} ${meta.label}</strong>（${modeUsage[leastMode]} 次）
        </div>`;
    }

    const reviewCount = allRows.filter(r => r.needsReview).length;
    if (reviewCount > 0) {
        alertHtml += `<div class="scores-alert scores-alert-review">
            🔔 有 <strong>${reviewCount}</strong> 篇文章超過 ${REVIEW_DAYS} 天未練習，建議複習
        </div>`;
    }
    alertRow.innerHTML = alertHtml;

    // ── Filter buttons ────────────────────────────────────────
    document.querySelectorAll('.scores-filter-btn').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.filter === _dashFilter);
    });

    // ── Apply filter & sort ───────────────────────────────────
    let visibleRows = allRows;
    if (_dashFilter === 'practiced') visibleRows = allRows.filter(r => r.hasPractice);
    if (_dashFilter === 'review')    visibleRows = allRows.filter(r => r.needsReview);

    if (_dashSortMode) {
        visibleRows = [...visibleRows].sort((a, b) => {
            const pctA = a.modeData[_dashSortMode]?.pct ?? -1;
            const pctB = b.modeData[_dashSortMode]?.pct ?? -1;
            return _dashSortDir === 'desc' ? pctB - pctA : pctA - pctB;
        });
    }

    // ── Build table HTML ──────────────────────────────────────
    let html = `<div class="scores-table-header">
        <div class="scores-col-article">Article</div>
        ${SCORE_MODES.map(m => {
            const isSorted = _dashSortMode === m;
            const arrow = isSorted ? (_dashSortDir === 'desc' ? ' ↓' : ' ↑') : '';
            return `<div class="scores-col-mode scores-col-sortable${isSorted ? ' is-sorted' : ''}"
                        data-sort-mode="${m}"
                        title="按 ${SCORE_MODE_META[m].label} 排序">
                        ${SCORE_MODE_META[m].icon}${arrow}
                    </div>`;
        }).join('')}
    </div>`;

    if (visibleRows.length === 0) {
        html += `<div class="scores-empty-state">
            ${_dashFilter === 'review' ? '🎉 沒有待複習的文章！' : 'No quiz scores yet. Start practicing!'}
        </div>`;
        tableEl.innerHTML = html;
        bindSortHeaders(tableEl);
        renderItemLevelSummarySection();
        return;
    }

    if (_dashSortMode) {
        html += `<div class="scores-major-group">
            <div class="scores-major-label">排序結果</div>
            ${visibleRows.map(row => buildSessionRowHtml(row)).join('')}
        </div>`;
    } else {
        const majors = [...new Set(visibleRows.map(r => r.major))].sort();
        for (const major of majors) {
            const group = visibleRows.filter(r => r.major === major).sort((a, b) => a.title.localeCompare(b.title));
            html += `<div class="scores-major-group">
                <div class="scores-major-label">${major}</div>
                ${group.map(row => buildSessionRowHtml(row)).join('')}
            </div>`;
        }
    }

    tableEl.innerHTML = html;
    bindSortHeaders(tableEl);

    // ── Render item-level section below ───────────────────────
    renderItemLevelSummarySection();
}

function buildSessionRowHtml(row) {
    const reviewFlag = row.needsReview ? '<span class="scores-review-flag" title="超過 7 天未練習">🔔</span>' : '';
    return `<div class="scores-row${row.needsReview ? ' scores-row-review' : ''}">
        <div class="scores-col-article" title="${row.title}">${reviewFlag}${row.title}</div>
        ${SCORE_MODES.map(mode => {
            const d = row.modeData[mode];
            if (!d) return `<div class="scores-col-mode scores-cell-empty" title="尚未練習"></div>`;

            const pctText    = Math.round(d.pct * 100) + '%';
            const colorClass = getScoreColor(d.pct);
            const daysAgo    = d.days === Infinity ? '—' : d.days === 0 ? '今天' : `${d.days}天前`;

            let trendHtml = '';
            if (d.trend !== null) {
                if (d.trend > 0.05)       trendHtml = `<span class="scores-trend up">↑</span>`;
                else if (d.trend < -0.05) trendHtml = `<span class="scores-trend down">↓</span>`;
                else                      trendHtml = `<span class="scores-trend flat">→</span>`;
            }

            const cellReview = d.days >= REVIEW_DAYS ? ' scores-cell-overdue' : '';
            const firstInfo  = d.firstPct != null
                ? `首次: ${Math.round(d.firstPct * 100)}% → 最佳: ${pctText}`
                : `最佳: ${pctText}`;
            const tooltip = [
                SCORE_MODE_META[mode].label,
                firstInfo,
                `練習次數: ${d.count}`,
                `上次: ${daysAgo}`,
                d.days >= REVIEW_DAYS ? '⚠️ 建議複習！' : ''
            ].filter(Boolean).join('\n');

            return `<div class="scores-col-mode scores-cell ${colorClass}${cellReview}" title="${tooltip}">
                <span class="scores-cell-score">${d.best}/${d.total}</span>
                <span class="scores-cell-pct">${pctText}${trendHtml}</span>
            </div>`;
        }).join('')}
    </div>`;
}

function bindSortHeaders(tableEl) {
    tableEl.querySelectorAll('.scores-col-sortable').forEach(col => {
        col.addEventListener('click', () => {
            const mode = col.dataset.sortMode;
            if (_dashSortMode === mode) {
                if (_dashSortDir === 'desc') _dashSortDir = 'asc';
                else { _dashSortMode = null; _dashSortDir = 'desc'; }
            } else {
                _dashSortMode = mode;
                _dashSortDir  = 'desc';
            }
            renderScoresDashboard();
        });
    });
}

// Filter buttons
document.querySelectorAll('.scores-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        _dashFilter = btn.dataset.filter;
        renderScoresDashboard();
    });
});

// Clear All button
document.getElementById('scores-clear-all-btn')?.addEventListener('click', () => {
    if (!confirm('Clear all quiz score records? This cannot be undone.')) return;
    localStorage.removeItem(QUIZ_SCORES_KEY);
    localStorage.removeItem(ITEM_SCORES_KEY);
    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ quizScores: {}, itemScores: {} }, { merge: true })
          .catch(err => console.error('Score clear error:', err));
    }
    renderScoresDashboard();
});

// ── Home page: "Today's Review" badge ────────────────────────
function renderHomeReviewBadge() {
    const existing = document.getElementById('home-review-banner');
    if (existing) existing.remove();

    const scores = loadQuizScores();
    let reviewCount = 0;
    for (const key of Object.keys(scores)) {
        const entry = scores[key];
        const hasPractice = SCORE_MODES.some(m => entry[m]);
        if (!hasPractice) continue;
        const needsReview = SCORE_MODES.some(m => entry[m] && daysSince(entry[m].lastDate) >= REVIEW_DAYS);
        if (needsReview) reviewCount++;
    }

    if (reviewCount === 0) return;

    const banner = document.createElement('div');
    banner.id = 'home-review-banner';
    banner.className = 'home-review-banner';
    banner.innerHTML = `🔔 <strong>${reviewCount}</strong> 篇文章待複習
        <button id="home-review-goto-btn" class="home-review-btn">查看 →</button>`;
    banner.querySelector('#home-review-goto-btn').addEventListener('click', () => {
        _dashFilter = 'review';
        openScoresDashboard();
    });

    const quizBtn = document.getElementById('go-to-scores');
    if (quizBtn) quizBtn.insertAdjacentElement('afterend', banner);
}

// Override saveQuizScore to track first score
function saveQuizScore(categoryName, titleName, mode, score, total) {
    const scores = loadQuizScores();
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
//  PART 2 — ITEM-LEVEL TRACKER
//  細粒度記錄每個單字/句子的測驗結果
// ══════════════════════════════════════════════════════════════

const ITEM_SCORES_KEY = 'readingChallengeItemScores';

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
            localStorage.setItem(ITEM_SCORES_KEY, JSON.stringify(doc.data().itemScores));
        }
    } catch (e) { console.error('Item scores load error:', e); }
}

window.loadItemScoresFromFirestore = loadItemScoresFromFirestore;

/**
 * 記錄單一題目結果
 * @param {string} categoryName
 * @param {string} titleName
 * @param {string} itemType  'noteWord' | 'noteSentence' | 'articleSentence'
 * @param {string} itemText
 * @param {boolean} isCorrect
 */
function recordItemResult(categoryName, titleName, itemType, itemText, isCorrect) {
    if (!categoryName || !titleName || !itemText) return;

    const data = loadItemScores();
    const key  = `${categoryName}||${titleName}`;
    if (!data[key]) data[key] = { noteWords: {}, noteSentences: {}, articleSentences: {} };
    if (!data[key][itemType]) data[key][itemType] = {};

    const text = itemText.trim();
    if (!data[key][itemType][text]) {
        data[key][itemType][text] = { correct: 0, wrong: 0, firstSeen: _todayStr(), lastSeen: null };
    }

    if (isCorrect) data[key][itemType][text].correct++;
    else           data[key][itemType][text].wrong++;
    data[key][itemType][text].lastSeen = _todayStr();

    saveItemScores(data);
}

function _todayStr() {
    return new Date().toLocaleDateString();
}

// ── Need-practice score calculation ─────────────────────────

/**
 * 需練指數 0–100（越高越需要練習）
 *
 * 未測驗       → 100
 * 有記錄       → 錯誤率 × 70 + 遺忘時間衰減 × 30
 * dayDecay：7天內=0, 7–30天線性增加, 30天以上=100
 */
function calcNeedScore(itemRecord) {
    if (!itemRecord || (itemRecord.correct === 0 && itemRecord.wrong === 0)) {
        return 100;
    }
    const total     = itemRecord.correct + itemRecord.wrong;
    const errorRate = total > 0 ? itemRecord.wrong / total : 0;

    const days = daysSince(itemRecord.lastSeen);
    let dayDecay = 0;
    if (days >= 30)      dayDecay = 1;
    else if (days >= 7)  dayDecay = (days - 7) / 23;

    return Math.round(errorRate * 70 + dayDecay * 30);
}

function getNeedScoreColor(score) {
    if (score >= 80) return 'need-red';
    if (score >= 40) return 'need-yellow';
    return 'need-green';
}

function calcArticleNeedSummary(categoryName, titleName) {
    const data  = loadItemScores();
    const key   = `${categoryName}||${titleName}`;
    const entry = data[key] || {};

    const noteWordItems = Object.values(entry.noteWords     || {});
    const noteSentItems = Object.values(entry.noteSentences || {});
    const allNoteItems  = [...noteWordItems, ...noteSentItems];
    const noteScores    = allNoteItems.map(calcNeedScore);
    const noteUntested  = allNoteItems.filter(i => i.correct === 0 && i.wrong === 0).length;
    const noteTotal     = allNoteItems.length;
    const noteAvg       = noteTotal > 0
        ? Math.round(noteScores.reduce((a, b) => a + b, 0) / noteTotal) : null;

    const artItems   = Object.values(entry.articleSentences || {});
    const artScores  = artItems.map(calcNeedScore);
    const artUntested = artItems.filter(i => i.correct === 0 && i.wrong === 0).length;
    const artTotal   = artItems.length;
    const artAvg     = artTotal > 0
        ? Math.round(artScores.reduce((a, b) => a + b, 0) / artTotal) : null;

    return {
        noteAvg, noteUntested, noteTotal,
        artAvg,  artUntested,  artTotal,
        hasPractice: noteTotal > 0 || artTotal > 0
    };
}

// ── Hook into quiz answer handlers ──────────────────────────

// Cloze (note word)
const _origHandleClozeAnswer = handleClozeAnswer;
window.handleClozeAnswer = function(selected, correct, btn) {
    _origHandleClozeAnswer(selected, correct, btn);
    recordItemResult(
        quizState.categoryName, quizState.titleName,
        'noteWord', correct, selected === correct
    );
};

// Dictation (note sentence)
const _origHandleDictationAnswer = handleDictationAnswer;
window.handleDictationAnswer = function(selected, correct, btn) {
    _origHandleDictationAnswer(selected, correct, btn);
    recordItemResult(
        quizState.categoryName, quizState.titleName,
        'noteSentence', correct, selected === correct
    );
};

// Article Listen
const _origHandleArticleListenAnswer = handleArticleListenAnswer;
window.handleArticleListenAnswer = function(selected, q, btn) {
    _origHandleArticleListenAnswer(selected, q, btn);
    recordItemResult(
        quizState.categoryName, quizState.titleName,
        'articleSentence', q.sentence, selected === q.sentence
    );
};

// Article Cloze
const _origHandleArticleClozeAnswer = handleArticleClozeAnswer;
window.handleArticleClozeAnswer = function(selected, correct, q, btn) {
    _origHandleArticleClozeAnswer(selected, correct, q, btn);
    recordItemResult(
        quizState.categoryName, quizState.titleName,
        'articleSentence', q.sentence, selected.toLowerCase() === correct.toLowerCase()
    );
};

// Reorder — intercept via capture listener
document.getElementById('reorder-check-btn').addEventListener('click', () => {
    setTimeout(() => {
        const last = quizState.answeredQuestions[quizState.answeredQuestions.length - 1];
        if (!last || last._itemTracked) return;
        last._itemTracked = true;
        const itemType = (typeof subpanelSource !== 'undefined' && subpanelSource.reorder === 'article')
            ? 'articleSentence' : 'noteSentence';
        recordItemResult(
            quizState.categoryName, quizState.titleName,
            itemType, last.correct, last.isCorrect
        );
    }, 0);
}, true);

// Flashcard (note word)
document.getElementById('flashcard-correct').addEventListener('click', () => {
    if (quizState.flashSource !== 'note') return;
    const item = quizState.deck[quizState.deckIndex - 1];
    if (item) recordItemResult(quizState.categoryName, quizState.titleName, 'noteWord', item.text, true);
}, true);

document.getElementById('flashcard-wrong').addEventListener('click', () => {
    if (quizState.flashSource !== 'note') return;
    const item = quizState.deck[quizState.deckIndex - 1];
    if (item) recordItemResult(quizState.categoryName, quizState.titleName, 'noteWord', item.text, false);
}, true);

// ══════════════════════════════════════════════════════════════
//  PART 3 — ITEM-LEVEL SUMMARY SECTION（Dashboard 下半部）
// ══════════════════════════════════════════════════════════════

function renderItemLevelSummarySection() {
    const container = document.getElementById('item-level-summary-section');
    if (!container) return;

    const itemData  = loadItemScores();
    const storyList = typeof stories !== 'undefined' ? stories : [];

    // Build title → { major, cat } map
    const titleMap = {};
    storyList.forEach(s => {
        titleMap[s['標題']] = {
            major: s['大類'] || 'Uncategorized',
            cat:   s['分類']?.[0] || 'Uncategorized'
        };
    });
    Object.keys(itemData).forEach(key => {
        const [cat, title] = key.split('||');
        if (title && !titleMap[title]) {
            titleMap[title] = { major: 'Other', cat };
        }
    });

    // Build rows — only articles with item data
    const rows = Object.entries(titleMap)
        .map(([title, info]) => {
            const summary = calcArticleNeedSummary(info.cat, title);
            return { title, major: info.major, categoryName: info.cat, summary };
        })
        .filter(r => r.summary.hasPractice)
        .sort((a, b) => {
            const aScore = a.summary.noteAvg ?? a.summary.artAvg ?? 0;
            const bScore = b.summary.noteAvg ?? b.summary.artAvg ?? 0;
            return bScore - aScore;
        });

    if (rows.length === 0) {
        container.innerHTML = `<div class="item-section-empty">
            <p>📝 完成任何測驗後，這裡會顯示每篇文章的細部學習狀態</p>
        </div>`;
        return;
    }

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

    container.querySelectorAll('.item-article-row').forEach(row => {
        row.addEventListener('click', () => {
            openDetailView(row.dataset.cat, row.dataset.title);
        });
    });
}

function buildItemRowHtml(row) {
    const { title, categoryName, summary } = row;
    const { noteAvg, noteTotal, artAvg, artTotal } = summary;

    function scoreChip(avg, total, label) {
        if (total === 0) {
            return `<div class="item-score-chip chip-none">
                <span class="chip-label">${label}</span>
                <span class="chip-val">—</span>
            </div>`;
        }
        if (avg === null) {
            return `<div class="item-score-chip chip-untested">
                <span class="chip-label">${label}</span>
                <span class="chip-val">⬜</span>
            </div>`;
        }
        const colorClass = getNeedScoreColor(avg);
        return `<div class="item-score-chip ${colorClass}" title="${label} 平均需練 ${avg}%">
            <span class="chip-label">${label}</span>
            <span class="chip-val">${avg}%</span>
            <div class="chip-bar-wrap"><div class="chip-bar" style="width:${avg}%"></div></div>
        </div>`;
    }

    return `<div class="item-article-row" data-title="${_escHtml(title)}" data-cat="${_escHtml(categoryName)}">
        <div class="item-row-title">${_escHtml(title)}</div>
        <div class="item-row-chips">
            ${scoreChip(noteAvg, noteTotal, '📝 Note')}
            ${scoreChip(artAvg,  artTotal,  '📖 Article')}
        </div>
        <div class="item-row-arrow">→</div>
    </div>`;
}

// ══════════════════════════════════════════════════════════════
//  PART 4 — ARTICLE DETAIL VIEW（兩層式細節頁）
// ══════════════════════════════════════════════════════════════

let detailViewState = {
    categoryName: null,
    titleName:    null,
    tab:          'noteWords',
    sortBy:       'need',
    sortDir:      'desc',
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
            btn.textContent = btn.dataset.label + (sortDir === 'desc' ? ' ↓' : ' ↑');
        } else {
            btn.textContent = btn.dataset.label;
        }
    });

    // Get items for current tab
    const itemMap = entry[tab] || {};
    let items = Object.entries(itemMap).map(([text, rec]) => ({
        text,
        correct:    rec.correct || 0,
        wrong:      rec.wrong   || 0,
        lastSeen:   rec.lastSeen  || null,
        firstSeen:  rec.firstSeen || null,
        needScore:  calcNeedScore(rec),
        hasPractice: (rec.correct + rec.wrong) > 0,
    }));

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
                items.push({ text: t, correct: 0, wrong: 0, lastSeen: null, firstSeen: null, needScore: 100, hasPractice: false });
            }
        });
    }

    // Sort
    items.sort((a, b) => {
        if (sortBy === 'alpha') {
            const va = a.text.toLowerCase(), vb = b.text.toLowerCase();
            return sortDir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
        }
        let va, vb;
        if (sortBy === 'need') {
            va = a.needScore; vb = b.needScore;
        } else { // recent
            va = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
            vb = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
        }
        return sortDir === 'desc' ? vb - va : va - vb;
    });

    // Summary bar
    const tested   = items.filter(i => i.hasPractice).length;
    const untested = items.length - tested;
    const avgNeed  = items.length > 0
        ? Math.round(items.reduce((s, i) => s + i.needScore, 0) / items.length) : 0;

    document.getElementById('detail-summary-bar').innerHTML = `
        <span class="detail-sum-chip">📝 共 ${items.length} 項</span>
        <span class="detail-sum-chip">✅ 已測 ${tested}</span>
        <span class="detail-sum-chip ${untested > 0 ? 'chip-warn' : ''}">⬜ 未測 ${untested}</span>
        <span class="detail-sum-chip ${avgNeed >= 60 ? 'chip-danger' : avgNeed >= 30 ? 'chip-warn' : 'chip-ok'}">
            平均需練 ${avgNeed}%
        </span>
    `;

    // Items list
    const listEl = document.getElementById('detail-items-list');
    if (items.length === 0) {
        listEl.innerHTML = `<div class="detail-empty">
            ${tab === 'noteWords'      ? '此文章尚無筆記單字' :
              tab === 'noteSentences'  ? '此文章尚無筆記句子' :
              '尚無 Article 模式測驗記錄'}
        </div>`;
        return;
    }

    listEl.innerHTML = items.map(item => buildDetailItemHtml(item, tab)).join('');
}

function buildDetailItemHtml(item, tab) {
    const { text, correct, wrong, lastSeen, needScore, hasPractice } = item;
    const colorClass = getNeedScoreColor(needScore);
    const daysAgo    = lastSeen
        ? (daysSince(lastSeen) === 0 ? '今天' : `${daysSince(lastSeen)}天前`)
        : '—';

    const statsHtml = hasPractice
        ? `<span class="detail-stat correct-stat">✓ ${correct}</span>
           <span class="detail-stat wrong-stat">✗ ${wrong}</span>
           <span class="detail-stat days-stat">📅 ${daysAgo}</span>`
        : `<span class="detail-stat untested-stat">未測驗</span>`;

    const isSentence = tab !== 'noteWords';
    const textClass  = isSentence ? 'detail-text-sentence' : 'detail-text-word';

    return `<div class="detail-item ${colorClass}">
        <div class="detail-item-top">
            <div class="detail-need-badge ${colorClass}">${needScore}</div>
            <div class="${textClass}">${_escHtml(text)}</div>
        </div>
        <div class="detail-score-bar-wrap">
            <div class="detail-score-bar ${colorClass}" style="width:${needScore}%"></div>
        </div>
        <div class="detail-item-stats">${statsHtml}</div>
    </div>`;
}

function _escHtml(s) {
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

console.log('✅ Scores Dashboard loaded.');
