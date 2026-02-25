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

// ── 需練指數 & 熟悉度 ────────────────────────────────────────

/**
 * 需練指數 0–100（越高越需要練習）
 * 熟悉度 = 100 - needScore
 */
function calcNeedScore(itemRecord) {
    if (!itemRecord || (itemRecord.correct === 0 && itemRecord.wrong === 0)) {
        return 100;
    }
    const total     = itemRecord.correct + itemRecord.wrong;
    const errorRate = total > 0 ? itemRecord.wrong / total : 0;
    const days = daysSince(itemRecord.lastSeen);
    let dayDecay = 0;
    if (days >= 30)     dayDecay = 1;
    else if (days >= 7) dayDecay = (days - 7) / 23;
    return Math.round(errorRate * 70 + dayDecay * 30);
}

/**
 * 熟悉度 0–100（越高代表越熟悉）
 */
function calcFamiliarity(itemRecord) {
    return 100 - calcNeedScore(itemRecord);
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

    const noteWordItems = Object.values(entry.noteWords     || {});
    const noteSentItems = Object.values(entry.noteSentences || {});
    const allNoteItems  = [...noteWordItems, ...noteSentItems];
    const noteTotal     = allNoteItems.length;
    const noteFamScores = allNoteItems.map(calcFamiliarity);
    const noteAvg       = noteTotal > 0
        ? Math.round(noteFamScores.reduce((a, b) => a + b, 0) / noteTotal) : null;

    const artItems   = Object.values(entry.articleSentences || {});
    const artTotal   = artItems.length;
    const artFamScores = artItems.map(calcFamiliarity);
    const artAvg     = artTotal > 0
        ? Math.round(artFamScores.reduce((a, b) => a + b, 0) / artTotal) : null;

    const totalItems  = noteTotal + artTotal;
    const totalTested = allNoteItems.filter(i => (i.correct + i.wrong) > 0).length
                      + artItems.filter(i => (i.correct + i.wrong) > 0).length;

    let famAvg = null;
    if (noteAvg !== null && artAvg !== null) famAvg = Math.round((noteAvg + artAvg) / 2);
    else if (noteAvg !== null) famAvg = noteAvg;
    else if (artAvg  !== null) famAvg = artAvg;

    return {
        famAvg, noteAvg, artAvg,
        noteTotal, artTotal,
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
    btn.classList.toggle('sort-desc', _dashSortDir === 'desc');
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

            // Sort by familiarity
            articles.sort((a, b) => {
                const fa = a.summary.famAvg ?? 0;
                const fb = b.summary.famAvg ?? 0;
                // desc = low familiarity first (needs practice)
                return _dashSortDir === 'desc' ? fa - fb : fb - fa;
            });

            const practicedCount = articles.filter(a => a.summary.hasPractice).length;
            const catBadge = practicedCount > 0
                ? `<span class="browser-cat-practiced-badge">${practicedCount}/${articles.length}</span>`
                : `<span class="browser-cat-count-badge">${articles.length}</span>`;

            catsHtml += `
                <div class="browser-cat-group" data-cat="${_escHtml(cat)}">
                    <div class="browser-cat-header" data-cat-toggle>
                        <span class="browser-cat-arrow">▸</span>
                        <span class="browser-cat-name">${_escHtml(cat)}</span>
                        ${catBadge}
                    </div>
                    <div class="browser-cat-body" style="display:none">
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
    const { famAvg, noteAvg, artAvg, hasPractice, totalTested, totalItems } = summary;

    function famChip(avg, label) {
        if (avg === null) {
            return `<div class="browser-fam-chip chip-untested">
                <span class="chip-label">${label}</span>
                <span class="chip-val">—</span>
            </div>`;
        }
        const colorClass = getFamiliarityColor(avg);
        return `<div class="browser-fam-chip ${colorClass}">
            <span class="chip-label">${label}</span>
            <span class="chip-val">${avg}%</span>
            <div class="chip-bar-wrap"><div class="chip-bar" style="width:${avg}%"></div></div>
        </div>`;
    }

    const overallBadge = hasPractice
        ? (famAvg !== null
            ? `<span class="browser-article-fam ${getFamiliarityColor(famAvg)}">${famAvg}%</span>`
            : '')
        : `<span class="browser-article-fam fam-untested">未測驗</span>`;

    return `<div class="browser-article-row" data-title="${_escHtml(title)}" data-cat="${_escHtml(cat)}">
        <div class="browser-article-main">
            <div class="browser-article-title">${_escHtml(title)}</div>
            ${overallBadge}
        </div>
        ${hasPractice ? `<div class="browser-article-chips">
            ${famChip(noteAvg, '📝 Note')}
            ${famChip(artAvg,  '📖 Article')}
        </div>` : ''}
        <div class="browser-article-arrow">→</div>
    </div>`;
}

// ── Sort button binding ───────────────────────────────────────

document.getElementById('dash-sort-fam-btn')?.addEventListener('click', () => {
    _dashSortDir = _dashSortDir === 'desc' ? 'asc' : 'desc';
    renderScoresDashboard();
});

// Clear All button
document.getElementById('scores-clear-all-btn')?.addEventListener('click', () => {
    if (!confirm('清除所有學習記錄？此操作無法還原。')) return;
    localStorage.removeItem(ITEM_SCORES_KEY);
    if (typeof QUIZ_SCORES_KEY !== 'undefined') localStorage.removeItem(QUIZ_SCORES_KEY);
    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ itemScores: {}, quizScores: {} }, { merge: true })
          .catch(err => console.error('Score clear error:', err));
    }
    renderScoresDashboard();
});

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

function openDetailView(categoryName, titleName) {
    detailViewState.categoryName = categoryName;
    detailViewState.titleName    = titleName;
    detailViewState.tab          = 'noteWords';
    detailViewState.sortBy       = 'fam';
    detailViewState.sortDir      = 'asc';

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
            const arrow = sortDir === 'asc' ? ' ↑' : ' ↓';
            btn.textContent = btn.dataset.label + arrow;
        } else {
            btn.textContent = btn.dataset.label;
        }
    });

    // Get items for current tab
    const itemMap = entry[tab] || {};
    let items = Object.entries(itemMap).map(([text, rec]) => ({
        text,
        correct:     rec.correct || 0,
        wrong:       rec.wrong   || 0,
        lastSeen:    rec.lastSeen  || null,
        firstSeen:   rec.firstSeen || null,
        famScore:    calcFamiliarity(rec),
        needScore:   calcNeedScore(rec),
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
                items.push({ text: t, correct: 0, wrong: 0, lastSeen: null, firstSeen: null,
                             famScore: 0, needScore: 100, hasPractice: false });
            }
        });
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
            ${tab === 'noteWords'     ? '此文章尚無筆記單字' :
              tab === 'noteSentences' ? '此文章尚無筆記句子' :
              '尚無 Article 模式測驗記錄'}
        </div>`;
        return;
    }

    listEl.innerHTML = items.map(item => buildDetailItemHtml(item, tab)).join('');
}

function buildDetailItemHtml(item, tab) {
    const { text, correct, wrong, lastSeen, famScore, needScore, hasPractice } = item;

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

    const isSentence = tab !== 'noteWords';
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
