// ============================================================
//  QUIZ SYSTEM — quiz.js
//  Phase 1: Flashcard | Phase 2: Cloze | Phase 3: Dictation
//  Phase 4: Score Records
// ============================================================

const QUIZ_SCORES_KEY = 'readingChallengeQuizScores';

// ── State ────────────────────────────────────────────────────
let quizState = {
    mode: null,          // 'flashcard' | 'cloze' | 'dictation' | 'article-listen' | 'article-cloze'
    scope: 'this',       // 'this' | 'all'
    categoryName: null,
    titleName: null,
    source: 'home',      // 'home' | 'note' — 記錄從哪裡進入 Quiz
    questions: [],
    currentIndex: 0,
    correct: 0,
    wrong: 0,
    wrongItems: [],
    answeredQuestions: [],
    retryWrongOnly: false,
    // flashcard specific
    deck: [],
    deckIndex: 0,
    againQueue: [],
    // article quiz specific
    articleSubMode: 'listen',  // 'listen' | 'cloze'
    // difficulty & question count — shared across ALL modes
    difficulty: 'mix',         // 'easy' | 'medium' | 'hard' | 'mix'
    questionCount: 10,         // 5 | 10 | 15
};

let quizAudioPlayer = new Audio();

/**
 * 設定 Quiz 的音檔來源，並同時：
 *  1. 設定 quizAudioPlayer.src（供單字發音播放用）
 *  2. 呼叫 WebAudioEngine.preload（供句子片段播放用）
 * @param {string} audioSrc  完整的音檔路徑，e.g. "audio/The Alchemist.mp3"
 */
function _setQuizAudioSrc(audioSrc) {
    // 供 review 單字發音（HTMLAudioElement）使用
    if (!quizAudioPlayer.src.endsWith(encodeURIComponent(audioSrc.split('/').pop()))) {
        quizAudioPlayer.src = audioSrc;
        quizAudioPlayer.preload = 'auto';
        quizAudioPlayer.load();
    }
    // 儲存 src 供 playSnippet 使用（Web Audio Engine 路徑）
    quizAudioPlayer._webaudio_src = audioSrc;
    // 背景預載到 Web Audio Engine（解碼並快取）
    if (typeof WebAudioEngine !== 'undefined' && WebAudioEngine.isSupported()) {
        WebAudioEngine.preload(audioSrc);
    }
}

// ── Replay 計數（用於評分）────────────────────────────────────
// _quizReplayCount : 當前題目手動重播次數（自動播放不算）
// _quizAutoPlayed  : 目前題目是否已完成自動播放（第一次不計）
// _quizIsEditingAudio : 編輯音檔模式中，播放不計入 replay
let _quizReplayCount    = 0;
let _quizAutoPlayed     = false;
let _quizIsEditingAudio = false;

/** 每道新題目出現時重置計數 */
function _resetReplayCount() {
    _quizReplayCount    = 0;
    _quizAutoPlayed     = false;
    _quizIsEditingAudio = false;
}

/** 手動播放時呼叫（自動播放後第一次起才計數）*/
function _trackReplay() {
    if (_quizIsEditingAudio) return; // 編輯模式不計
    if (!_quizAutoPlayed) {
        // 第一次播放視為自動播放，標記後不計入
        _quizAutoPlayed = true;
        return;
    }
    _quizReplayCount++;
}

// ── Unified snippet player ────────────────────────────────────
// Plays a time-bounded segment using Web Audio Engine（精確，手機/PC 一致）
// onStart / onEnd are optional callbacks to update UI.
let _snippetStopTimer = null;
let _snippetTimeUpdateHandler = null;

function playSnippet({ start, end, onStart, onEnd }) {
    // ── 停止任何正在播放的片段 ──────────────────────────────
    if (_snippetStopTimer) {
        clearTimeout(_snippetStopTimer);
        _snippetStopTimer = null;
    }
    if (_snippetTimeUpdateHandler) {
        quizAudioPlayer.removeEventListener('timeupdate', _snippetTimeUpdateHandler);
        _snippetTimeUpdateHandler = null;
    }

    // ── 優先使用 Web Audio Engine ───────────────────────────
    if (typeof WebAudioEngine !== 'undefined' && WebAudioEngine.isSupported()) {
        WebAudioEngine.stop();

        // 取得目前 quiz 的音檔 src（從 quizAudioPlayer.src 讀取，維持相容性）
        // quiz.js 各處在 playSnippet 前都會先設定好 quizAudioPlayer.src
        const src = quizAudioPlayer._webaudio_src || quizAudioPlayer.src;
        if (!src) {
            console.warn('[Quiz] playSnippet: no audio src set');
            if (onEnd) onEnd();
            return;
        }

        if (onStart) onStart();
        WebAudioEngine.playSnippet({
            src,
            start,
            end,
            onEnd:  onEnd  || undefined,
            onError: (err) => {
                console.error('[Quiz] WebAudioEngine error:', err);
                if (onEnd) onEnd();
            }
        });
        return;
    }

    // ── Fallback：舊的 HTMLAudioElement 方式 ────────────────
    quizAudioPlayer.pause();
    const isMobile = isMobileDevice();
    const bufStart = isMobile ? 0.25 : 0.1;
    const bufEnd   = isMobile ? 1.0  : 0.8;
    const trailMs  = isMobile ? 1000 : 800;
    const seekTo   = Math.max(0, start - bufStart);
    const playMs   = (end - start) * 1000 + trailMs;

    const stopAll = () => {
        if (_snippetStopTimer) { clearTimeout(_snippetStopTimer); _snippetStopTimer = null; }
        if (_snippetTimeUpdateHandler) {
            quizAudioPlayer.removeEventListener('timeupdate', _snippetTimeUpdateHandler);
            _snippetTimeUpdateHandler = null;
        }
        quizAudioPlayer.pause();
        if (onEnd) onEnd();
    };

    if (onStart) onStart();
    _snippetTimeUpdateHandler = () => {
        if (quizAudioPlayer.currentTime >= end + bufEnd) stopAll();
    };
    quizAudioPlayer.addEventListener('timeupdate', _snippetTimeUpdateHandler);
    quizAudioPlayer.currentTime = seekTo;
    quizAudioPlayer.play().then(() => {
        _snippetStopTimer = setTimeout(stopAll, playMs);
    }).catch(() => {
        if (_snippetTimeUpdateHandler) {
            quizAudioPlayer.removeEventListener('timeupdate', _snippetTimeUpdateHandler);
            _snippetTimeUpdateHandler = null;
        }
        if (onEnd) onEnd();
    });
}

// ── DOM refs ─────────────────────────────────────────────────
const quizView          = document.getElementById('quiz-view');
const quizMenu          = document.getElementById('quiz-menu');
const quizSession       = document.getElementById('quiz-session');
const quizResult        = document.getElementById('quiz-result');
const quizTitleEl       = document.getElementById('quiz-title');
const quizSubtitleEl    = document.getElementById('quiz-subtitle');
const quizStatsBar      = document.getElementById('quiz-stats-bar');

const flashcardArea     = document.getElementById('quiz-flashcard-area');
const dictationArea     = document.getElementById('quiz-dictation-area');

// ── Helpers ───────────────────────────────────────────────────

function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function weightedSample(pool, n, keyFn, categoryName, titleName) {
    if (!pool || pool.length === 0) return [];
    n = Math.min(n, pool.length);
    let history = {};
    try { history = JSON.parse(localStorage.getItem('quizWordHistory') || '{}'); } catch (e) {}
    const weighted = pool.map(item => {
        const key = keyFn ? keyFn(item) : String(item);
        const h = history[key];
        return { item, weight: h ? 1 + (h.wrong || 0) * 2 : 1 };
    });
    const reservoir = [];
    for (const { item, weight } of weighted) {
        const r = Math.pow(Math.random(), 1 / weight);
        if (reservoir.length < n) {
            reservoir.push({ item, r });
            if (reservoir.length === n) reservoir.sort((a, b) => a.r - b.r);
        } else if (r > reservoir[0].r) {
            reservoir[0] = { item, r };
            reservoir.sort((a, b) => a.r - b.r);
        }
    }
    return shuffle(reservoir.map(e => e.item));
}

function getNoteData(categoryName, titleName) {
    return savedWords[categoryName]?.[titleName] || {
        words: new Set(), phrases: new Set(), sentences: new Set()
    };
}

function getAllNoteItems(scope, categoryName, titleName) {
    const items = { words: [], phrases: [], sentences: [] };

    if (scope === 'this') {
        const data = getNoteData(categoryName, titleName);
        items.words    = Array.from(data.words    || []);
        items.phrases  = Array.from(data.phrases  || []);
        items.sentences = Array.from(data.sentences || []);
    } else {
        for (const cat in savedWords) {
            for (const title in savedWords[cat]) {
                const data = savedWords[cat][title];
                items.words.push(...Array.from(data.words || []));
                items.phrases.push(...Array.from(data.phrases || []));
                items.sentences.push(...Array.from(data.sentences || []));
            }
        }
    }
    return items;
}

// Find sentence context for a word from story content
function findContextForWord(word, storyTitle) {
    if (!storyTitle) return null;
    const story = stories.find(s => s['標題'] === storyTitle);
    if (!story || !story['內文']) return null;

    const content = story['內文'];
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [];
    const lowerWord = word.toLowerCase().replace(/-/g, ' ');

    for (const s of sentences) {
        if (s.toLowerCase().includes(lowerWord)) {
            return s.trim();
        }
    }
    return null;
}

// ── Score Records (Phase 4) ───────────────────────────────────

function loadQuizScores() {
    try {
        return JSON.parse(localStorage.getItem(QUIZ_SCORES_KEY) || '{}');
    } catch (e) { return {}; }
}

function saveQuizScore(categoryName, titleName, mode, score, total) {
    const scores = loadQuizScores();
    const key = `${categoryName}||${titleName}`;
    if (!scores[key]) scores[key] = {};
    if (!scores[key][mode]) scores[key][mode] = { best: 0, last: 0, count: 0 };

    const entry = scores[key][mode];
    // Track first score
    if (entry.count === 0) entry.first = score;
    entry.last  = score;
    entry.best  = Math.max(entry.best, score);
    entry.total = total;
    entry.count++;
    entry.lastDate = new Date().toLocaleDateString();

    localStorage.setItem(QUIZ_SCORES_KEY, JSON.stringify(scores));

    // Sync to Firestore if logged in
    if (typeof currentUser !== 'undefined' && currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ quizScores: scores }, { merge: true })
          .catch(err => console.error('Quiz score save error:', err));
    }
}

function renderQuizStatsBar(categoryName, titleName) {
    const scores = loadQuizScores();
    const key = `${categoryName}||${titleName}`;
    const data = scores[key];
    if (!data) { quizStatsBar.innerHTML = ''; return; }

    const modes = { flashcard: '🃏', dictation: '🎧' };
    let html = '<div class="quiz-stats-row">';
    for (const [mode, icon] of Object.entries(modes)) {
        if (data[mode]) {
            const e = data[mode];
            html += `<div class="quiz-stat-chip">
                ${icon} <strong>${e.best}/${e.total}</strong>
                <span>best</span>
            </div>`;
        }
    }
    html += '</div>';
    quizStatsBar.innerHTML = html;
}

// ── Word-level diff highlight ─────────────────────────────────
/**
 * Compare userAnswer words vs correctAnswer words using LCS.
 * Returns HTML string of correctAnswer with misplaced/missing words in red.
 * @param {string} userAnswer
 * @param {string} correctAnswer
 * @returns {string} HTML
 */
function buildCorrectAnswerWithDiff(userAnswer, correctAnswer) {
    const escHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const normalize = (t) => t.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');

    const correctTokens = (correctAnswer.match(/\S+/g) || []);
    const userTokens    = (userAnswer.match(/\S+/g) || []);

    const normCorrect = correctTokens.map(normalize);
    const normUser    = userTokens.map(normalize);

    // LCS between normUser and normCorrect to find which correct positions are matched
    const m = normUser.length, n = normCorrect.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = normUser[i-1] === normCorrect[j-1]
                ? dp[i-1][j-1] + 1
                : Math.max(dp[i-1][j], dp[i][j-1]);
        }
    }

    // Backtrack: find which correct positions are in the LCS (= matched by user)
    const matchedCorrect = new Array(n).fill(false);
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (normUser[i-1] === normCorrect[j-1]) {
            matchedCorrect[j-1] = true;
            i--; j--;
        } else if (dp[i-1][j] >= dp[i][j-1]) {
            i--;
        } else {
            j--;
        }
    }

    // Build HTML: correct words are normal, unmatched (missing/misplaced) are red
    return correctTokens.map((word, idx) => {
        if (matchedCorrect[idx]) {
            return escHtml(word);
        } else {
            return `<span class="quiz-diff-wrong">${escHtml(word)}</span>`;
        }
    }).join(' ');
}



const selMajor    = document.getElementById('quiz-select-major');
const selCategory = document.getElementById('quiz-select-category');
const selArticle  = document.getElementById('quiz-select-article');

// Populate Major dropdown once
function pickerInitMajors() {
    selMajor.innerHTML = '<option value="">— Select Major —</option>';
    const majors = [...new Set(stories.map(s => s['大類'] || 'Uncategorized'))].sort();
    majors.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        selMajor.appendChild(opt);
    });
}

// Populate Category dropdown based on selected Major
function pickerPopulateCategories(major) {
    selCategory.innerHTML = '<option value="">— Select Category —</option>';
    if (!major) { document.getElementById('quiz-picker-row-category').style.display = 'none'; return; }

    const cats = [...new Set(
        stories
            .filter(s => (s['大類'] || 'Uncategorized') === major)
            .map(s => s['分類']?.[0] || 'Uncategorized')
    )].sort();

    cats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        selCategory.appendChild(opt);
    });
    document.getElementById('quiz-picker-row-category').style.display = '';
    document.getElementById('quiz-picker-row-article').style.display = 'none';
    selArticle.innerHTML = '<option value="">— Select Article —</option>';
}

// Populate Article dropdown based on selected Category — async (checks timestamps)
async function pickerPopulateArticles(major, category) {
    selArticle.innerHTML = '<option value="">Loading…</option>';
    selArticle.disabled = true;
    document.getElementById('quiz-picker-row-article').style.display = '';

    const articlesInCat = stories.filter(s =>
        (s['大類'] || 'Uncategorized') === major &&
        (s['分類']?.[0] || 'Uncategorized') === category
    );

    const tsChecks = await Promise.all(
        articlesInCat.map(async s => {
            const ts = await getTimestampForStory(s['標題']);
            return { title: s['標題'], hasTs: !!(ts && ts.length > 0) };
        })
    );

    selArticle.innerHTML = '<option value="">— Select Article —</option>';
    tsChecks.forEach(({ title, hasTs }) => {
        const opt = document.createElement('option');
        opt.value = title;
        opt.textContent = hasTs ? title : `${title} ⛔`;
        if (!hasTs) opt.dataset.noTs = 'true';
        selArticle.appendChild(opt);
    });
    selArticle.disabled = false;
}

// Apply current select values to quizState
function pickerApplySelection() {
    const title    = selArticle.value;
    const category = selCategory.value;

    if (title) {
        // Check if selected article has no timestamp
        const selectedOpt = selArticle.options[selArticle.selectedIndex];
        if (selectedOpt?.dataset.noTs === 'true') {
            showNotification('No timestamp file for this article. Article Quiz unavailable.', 'warning');
            selArticle.value = '';
            quizState.titleName = null;
            quizSubtitleEl.textContent = '';
            quizStatsBar.innerHTML = '';
            return;
        }
        quizState.titleName    = title;
        quizState.categoryName = category;
        quizState.scope        = 'this';
    } else {
        quizState.titleName = null;
    }

    quizSubtitleEl.textContent = quizState.titleName || '';

    if (quizState.categoryName && quizState.titleName) {
        renderQuizStatsBar(quizState.categoryName, quizState.titleName);
    } else {
        quizStatsBar.innerHTML = '';
    }
}

// Event listeners for the three selects
selMajor.addEventListener('change', () => {
    pickerPopulateCategories(selMajor.value);
    quizState.titleName = null;
    quizSubtitleEl.textContent = '';
    quizStatsBar.innerHTML = '';
});

selCategory.addEventListener('change', () => {
    if (selMajor.value && selCategory.value) {
        pickerPopulateArticles(selMajor.value, selCategory.value);
    }
    quizState.titleName = null;
});

selArticle.addEventListener('change', () => {
    pickerApplySelection();
});

// Pre-select all three levels (called from openQuiz when coming from Story)
async function pickerPreselect(majorName, categoryName, titleName) {
    // Ensure majors are populated
    if (selMajor.options.length <= 1) pickerInitMajors();

    selMajor.value = majorName;
    pickerPopulateCategories(majorName);
    selCategory.value = categoryName;
    await pickerPopulateArticles(majorName, categoryName);
    selArticle.value = titleName;
}

// ── Entry Point ───────────────────────────────────────────────

function openQuiz(categoryName, titleName, source) {
    quizState.categoryName = categoryName;
    quizState.titleName    = titleName;
    quizState.scope        = 'this';
    quizState.mode         = null;
    quizState.source       = source || 'home'; // 記錄來源：'home' 或 'note'

    quizTitleEl.textContent    = 'Quiz';
    quizSubtitleEl.textContent = titleName || '';

    renderQuizStatsBar(categoryName, titleName);

    // Always init major dropdown
    pickerInitMajors();

    if (titleName) {
        // Coming from Story: pre-select all three levels
        const storyObj = stories.find(s => s['標題'] === titleName);
        const major = storyObj?.['大類'] || 'Uncategorized';
        const cat   = storyObj?.['分類']?.[0] || categoryName || 'Uncategorized';
        pickerPreselect(major, cat, titleName);
    } else {
        // Coming from home/note: reset selects
        selMajor.value = '';
        selCategory.innerHTML = '<option value="">— Select Category —</option>';
        selArticle.innerHTML  = '<option value="">— Select Article —</option>';
        document.getElementById('quiz-picker-row-category').style.display = 'none';
        document.getElementById('quiz-picker-row-article').style.display  = 'none';
    }

    quizMenu.classList.remove('is-hidden');
    quizSession.classList.add('is-hidden');
    quizResult.classList.add('is-hidden');

    showView(quizView);
}

// ── Event Listeners: Menu ─────────────────────────────────────

document.getElementById('back-to-note-from-quiz').addEventListener('click', () => {
    quizAudioPlayer.pause();

    // 如果在測驗中或結果頁，← Back 回到選單
    if (!quizSession.classList.contains('is-hidden') ||
        !quizResult.classList.contains('is-hidden')) {
        quizSession.classList.add('is-hidden');
        quizResult.classList.add('is-hidden');
        quizMenu.classList.remove('is-hidden');
        renderQuizStatsBar(quizState.categoryName, quizState.titleName);
    } else {
        // 在選單頁，← Back 依來源決定：首頁 or note-view
        if (quizState.source === 'note') {
            showView(document.getElementById('note-view'));
        } else {
            showView(document.getElementById('home-view'));
        }
    }
});



// ── Mode Card + Subpanel Logic ────────────────────────────────

// Track which subpanel source is selected per mode
const subpanelSource = { flashcard: 'note', dictation: 'note', reorder: 'note', fcplus: 'note' };

// Helper: close all subpanels and un-expand all cards
function closeAllSubpanels() {
    document.querySelectorAll('.quiz-subpanel').forEach(p => p.classList.add('is-hidden'));
    document.querySelectorAll('.quiz-mode-card').forEach(c => c.classList.remove('is-expanded'));
    document.querySelectorAll('.quiz-article-options, .quiz-note-options').forEach(o => o.classList.add('is-hidden'));
}

// Flashcard: toggle subpanel；note 為空時自動預選 From Article
document.getElementById('quiz-mode-flashcard').addEventListener('click', () => {
    const panel = document.getElementById('subpanel-flashcard');
    const card  = document.getElementById('quiz-mode-flashcard');
    const isOpen = !panel.classList.contains('is-hidden');
    closeAllSubpanels();
    if (!isOpen) {
        const items = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);
        const hasNote = items.words.length > 0 || items.phrases.length > 0;
        const preferred = hasNote ? 'note' : 'article';
        subpanelSource.flashcard = preferred;
        document.querySelectorAll('.quiz-source-btn[data-mode="flashcard"]').forEach(b => {
            b.classList.toggle('is-active', b.dataset.source === preferred);
        });
        panel.classList.remove('is-hidden');
        card.classList.add('is-expanded');
    }
});

// Flashcard Start 按鈕
document.getElementById('start-flashcard-btn').addEventListener('click', () => {
    if (subpanelSource.flashcard === 'article') {
        startFlashcardFromArticle();
    } else {
        startFlashcard();
    }
});

// Dictation: toggle subpanel
document.getElementById('quiz-mode-dictation').addEventListener('click', () => {
    const panel = document.getElementById('subpanel-dictation');
    const card  = document.getElementById('quiz-mode-dictation');
    const isOpen = !panel.classList.contains('is-hidden');
    closeAllSubpanels();
    if (!isOpen) {
        panel.classList.remove('is-hidden');
        card.classList.add('is-expanded');
    }
});

// Source buttons inside subpanels
document.querySelectorAll('.quiz-source-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode   = btn.dataset.mode;
        const source = btn.dataset.source;
        document.querySelectorAll(`.quiz-source-btn[data-mode="${mode}"]`)
            .forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        subpanelSource[mode] = source;

        // Show article options only when From Article is selected
        const optEl = document.getElementById(`${mode}-article-options`);
        if (optEl) optEl.classList.toggle('is-hidden', source !== 'article');
        // For note mode, always show note options
        const noteOptEl = document.getElementById(`${mode}-note-options`);
        if (noteOptEl) noteOptEl.classList.toggle('is-hidden', source !== 'note');
    });
});

// ── Difficulty buttons ────────────────────────────────────────
document.querySelectorAll('.quiz-diff-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.mode;
        document.querySelectorAll(`.quiz-diff-btn[data-mode="${mode}"]`)
            .forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        quizState.difficulty = btn.dataset.diff;
    });
});

// ── Question count buttons ────────────────────────────────────
document.querySelectorAll('.quiz-count-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.mode;
        document.querySelectorAll(`.quiz-count-btn[data-mode="${mode}"]`)
            .forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        quizState.questionCount = parseInt(btn.dataset.count, 10);
    });
});

// Reorder: toggle subpanel
document.getElementById('quiz-mode-reorder').addEventListener('click', () => {
    const panel = document.getElementById('subpanel-reorder');
    const card  = document.getElementById('quiz-mode-reorder');
    const isOpen = !panel.classList.contains('is-hidden');
    closeAllSubpanels();
    if (!isOpen) {
        panel.classList.remove('is-hidden');
        card.classList.add('is-expanded');
    }
});

document.getElementById('start-reorder-btn').addEventListener('click', () => {
    startReorder(subpanelSource.reorder || 'note');
});

document.getElementById('start-dictation-btn').addEventListener('click', () => {
    if (subpanelSource.dictation === 'article') {
        quizState.articleSubMode = 'listen';
        startArticleQuiz();
    } else {
        // From Note: check sentences exist
        const items = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);
        if ((items.sentences?.length ?? 0) === 0) {
            showNotification('No sentences saved for this article yet.', 'warning');
            return;
        }
        startDictation();
    }
});

document.getElementById('quiz-exit-btn').addEventListener('click', () => {
    quizAudioPlayer.pause();

    // 判斷是否已有作答紀錄（flashcard 用 correct+wrong，其他用 answeredQuestions）
    const hasAnswered = quizState.answeredQuestions.length > 0 ||
                        quizState.correct > 0 || quizState.wrong > 0;

    if (!hasAnswered) {
        // 未答任何題，直接回選單
        quizMenu.classList.remove('is-hidden');
        quizSession.classList.add('is-hidden');
        quizResult.classList.add('is-hidden');
        renderQuizStatsBar(quizState.categoryName, quizState.titleName);
        return;
    }

    // 有作答紀錄 → 顯示確認對話框
    _showEndQuizConfirm();
});

/** 顯示「提前結束」確認浮層 */
function _showEndQuizConfirm() {
    // 移除舊的（避免重複）
    const old = document.getElementById('quiz-end-confirm-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'quiz-end-confirm-overlay';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:9999;
        background:rgba(0,0,0,0.45);
        display:flex;align-items:center;justify-content:center;
        padding:20px;
    `;

    // 計算已答題數
    let answered, correct;
    if (quizState.mode === 'flashcard' || quizState.mode === 'fcplus') {
        answered = quizState.correct + quizState.wrong;
        correct  = quizState.correct;
    } else {
        answered = quizState.answeredQuestions.length;
        correct  = quizState.answeredQuestions.filter(q => q.isCorrect).length;
    }

    overlay.innerHTML = `
        <div style="background:var(--color-card,#fff);border-radius:16px;padding:28px 24px;max-width:320px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
            <div style="font-size:2em;margin-bottom:8px;">⏹️</div>
            <div style="font-size:1.05em;font-weight:700;margin-bottom:6px;">結束測驗？</div>
            <div style="font-size:0.88em;color:var(--color-text-light,#888);margin-bottom:20px;">
                已完成 <strong>${answered}</strong> 題，答對 <strong>${correct}</strong> 題。<br>
                未作答的題目不列入計分。
            </div>
            <div style="display:flex;gap:12px;justify-content:center;">
                <button id="quiz-end-cancel-btn" style="flex:1;padding:10px 0;border-radius:10px;border:1.5px solid var(--color-border,#ddd);background:transparent;color:var(--color-text,#333);font-size:0.95em;cursor:pointer;">繼續作答</button>
                <button id="quiz-end-confirm-btn" style="flex:1;padding:10px 0;border-radius:10px;border:none;background:#e05c5c;color:#fff;font-size:0.95em;font-weight:700;cursor:pointer;">結束計分</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('quiz-end-cancel-btn').addEventListener('click', () => {
        overlay.remove();
        quizAudioPlayer.play().catch(() => {}); // 嘗試恢復播放（通常不需要）
    });

    document.getElementById('quiz-end-confirm-btn').addEventListener('click', () => {
        overlay.remove();
        _finishQuizEarly();
    });

    // 點擊遮罩關閉
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });
}

/** 提前結束：只計算已作答題目 */
function _finishQuizEarly() {
    quizAudioPlayer.pause();
    quizSession.classList.add('is-hidden');

    const mode = quizState.mode;

    if (mode === 'flashcard' || mode === 'fcplus') {
        // flashcard 類：用 correct/wrong 直接計分
        const total = quizState.correct + quizState.wrong;
        showQuizResult(mode, quizState.correct, total, quizState.wrongItems);
    } else {
        // 其他模式：用 answeredQuestions 計分
        const answered = quizState.answeredQuestions;
        const correct  = answered.filter(q => q.isCorrect).length;
        const total    = answered.length;
        const wrongs   = answered.filter(q => !q.isCorrect).map(q => q.correct);

        // 覆寫 quizState 讓 showQuizResult 正確渲染
        quizState.correct     = correct;
        quizState.wrong       = total - correct;
        quizState.wrongItems  = wrongs;

        showQuizResult(mode, correct, total, wrongs);
    }
}

// Go to quiz btn from note view
const goToQuizBtn = document.getElementById('go-to-quiz-btn');
if (goToQuizBtn) {
    goToQuizBtn.addEventListener('click', () => {
        openQuiz(noteViewCategory, noteViewTitle, 'note');
    });
}

// ── Progress Bar ──────────────────────────────────────────────

function updateProgress(current, total) {
    document.getElementById('quiz-progress-text').textContent = `${current} / ${total}`;
    const pct = total > 0 ? (current / total) * 100 : 0;
    document.getElementById('quiz-progress-fill').style.width = pct + '%';
}

// ── Show Session ──────────────────────────────────────────────

function showQuizSession(mode) {
    quizMenu.classList.add('is-hidden');
    quizResult.classList.add('is-hidden');
    quizSession.classList.remove('is-hidden');

    flashcardArea.classList.add('is-hidden');
    dictationArea.classList.add('is-hidden');
    document.getElementById('quiz-article-listen-area').classList.add('is-hidden');
    document.getElementById('quiz-article-cloze-area').classList.add('is-hidden');
    document.getElementById('quiz-reorder-area').classList.add('is-hidden');
    document.getElementById('quiz-fcplus-area').classList.add('is-hidden');

    if (mode === 'flashcard')       flashcardArea.classList.remove('is-hidden');
    if (mode === 'dictation')       dictationArea.classList.remove('is-hidden');
    if (mode === 'article-listen')  document.getElementById('quiz-article-listen-area').classList.remove('is-hidden');
    if (mode === 'article-cloze')   document.getElementById('quiz-article-cloze-area').classList.remove('is-hidden');
    if (mode === 'reorder')         document.getElementById('quiz-reorder-area').classList.remove('is-hidden');
    if (mode === 'fcplus')          document.getElementById('quiz-fcplus-area').classList.remove('is-hidden');
}

// ── Show Result ───────────────────────────────────────────────

function showQuizResult(mode, correct, total, wrongItems) {
    quizSession.classList.add('is-hidden');
    quizResult.classList.remove('is-hidden');

    // Get last score before saving
    const scores = loadQuizScores();
    const key = `${quizState.categoryName}||${quizState.titleName}`;
    const lastScore = scores[key]?.[mode]?.last ?? null;
    const bestScore = scores[key]?.[mode]?.best ?? 0;

    saveQuizScore(quizState.categoryName, quizState.titleName, mode, correct, total);

    // Emoji & score
    const pct = total > 0 ? correct / total : 0;
    const emoji = pct >= 0.9 ? '🎉' : pct >= 0.7 ? '😊' : pct >= 0.5 ? '🤔' : '💪';
    document.getElementById('quiz-result-emoji').textContent = emoji;
    document.getElementById('quiz-result-number').textContent = `${correct} / ${total}`;

    // Progress bar
    document.getElementById('quiz-result-progress-fill').style.width = (pct * 100) + '%';

    // Compare with last
    const compareEl = document.getElementById('quiz-result-compare');
    if (lastScore !== null && lastScore !== undefined) {
        const diff = correct - lastScore;
        const arrow = diff > 0 ? `↑ +${diff}` : diff < 0 ? `↓ ${diff}` : '→ same';
        const color = diff > 0 ? '#50b86c' : diff < 0 ? '#e05c5c' : '#9a9187';
        compareEl.innerHTML = `<span style="color:${color};font-weight:700;">${arrow}</span> vs last &nbsp;|&nbsp; Best: ${Math.max(bestScore, correct)}/${total}`;
    } else {
        compareEl.innerHTML = `Best: ${correct}/${total}`;
    }

    // Build review list
    const reviewEl = document.getElementById('quiz-result-review');
    reviewEl.innerHTML = '';

    if (quizState.answeredQuestions.length === 0) {
        // Flashcard mode — just show wrong items
        if (wrongItems.length === 0) {
            reviewEl.innerHTML = `<div class="quiz-review-title">Perfect! 🎊</div>`;
        } else {
            reviewEl.innerHTML = `<div class="quiz-review-title">Review these:</div>` +
                wrongItems.map(w => `<div class="quiz-review-item quiz-review-wrong">✗ ${w}</div>`).join('');
        }
    } else {
        // Cloze / Dictation — show full per-question review
        quizState.answeredQuestions.forEach((item, idx) => {
            const div = document.createElement('div');
            div.className = `quiz-review-card ${item.isCorrect ? 'is-correct' : 'is-wrong'}`;

            const icon = item.isCorrect ? '✓' : '✗';

            // Collapsible: wrong = expanded, correct = collapsed
            const isExpanded = !item.isCorrect;

            div.innerHTML = `
                <div class="quiz-review-card-header" data-idx="${idx}">
                    <span class="quiz-review-icon">${icon}</span>
                    <span class="quiz-review-preview">${item.correct.substring(0, 50)}${item.correct.length > 50 ? '…' : ''}</span>
                    <span class="quiz-review-toggle">${isExpanded ? '▲' : '▼'}</span>
                </div>
                <div class="quiz-review-card-body" style="${isExpanded ? '' : 'display:none;'}">
                    ${!item.isCorrect ? `
                        <div class="quiz-review-your-ans">Your answer: <em>${item.selected}</em></div>
                        <div class="quiz-review-correct-ans quiz-review-correct-styled">
                            <span class="quiz-review-correct-label">✓ Correct answer:</span>
                            <span class="quiz-review-correct-text">${buildCorrectAnswerWithDiff(item.selected || '', item.correct)}</span>
                        </div>
                    ` : `
                        <div class="quiz-review-correct-ans quiz-review-correct-styled quiz-review-all-correct">
                            <span class="quiz-review-correct-text">${item.correct}</span>
                        </div>
                    `}
                    ${(item.start != null) ? `
                        <button class="quiz-review-play-btn" data-start="${item.start}" data-end="${item.end}" data-title="${item.title}">▶ Listen again</button>
                    ` : ''}
                </div>
            `;
            reviewEl.appendChild(div);
        });

        // Toggle expand/collapse
        reviewEl.querySelectorAll('.quiz-review-card-header').forEach(header => {
            header.addEventListener('click', () => {
                const body = header.nextElementSibling;
                const toggle = header.querySelector('.quiz-review-toggle');
                const hidden = body.style.display === 'none';
                body.style.display = hidden ? '' : 'none';
                toggle.textContent = hidden ? '▲' : '▼';
            });
        });

        // Play buttons in review
        reviewEl.querySelectorAll('.quiz-review-play-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (btn.dataset.word) {
                    // Word pronunciation
                    const src = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(btn.dataset.word.trim())}.mp3`;
                    quizAudioPlayer.src = src;
                    quizAudioPlayer.play().catch(() => {
                        if ('speechSynthesis' in window) {
                            const u = new SpeechSynthesisUtterance(btn.dataset.word);
                            u.lang = 'en-US';
                            window.speechSynthesis.speak(u);
                        }
                    });
                } else {
                    // Sentence snippet
                    const start = parseFloat(btn.dataset.start);
                    const end   = parseFloat(btn.dataset.end);
                    const title = btn.dataset.title;

                    // Make sure audio src matches
                    const targetSrc = `audio/${encodeURIComponent(title.trim())}.mp3`;
                    _setQuizAudioSrc(targetSrc);

                    playSnippet({
                        start, end,
                        onStart: () => { btn.textContent = '⏸'; },
                        onEnd:   () => { btn.textContent = '▶ Listen again'; }
                    });
                }
            });
        });
    }

    // Add wrong sentences to Note button
    const addToNoteBar = document.getElementById('quiz-add-to-note-bar');
    const wrongSentences = quizState.answeredQuestions.filter(q => !q.isCorrect && q.type === 'sentence');
    const wrongWords = quizState.answeredQuestions.filter(q => !q.isCorrect && q.type !== 'sentence');

    if (wrongSentences.length > 0 || wrongWords.length > 0) {
        const totalWrong = wrongSentences.length + wrongWords.length;
        document.getElementById('quiz-wrong-count-label').textContent = `${totalWrong} wrong item${totalWrong > 1 ? 's' : ''}`;
        addToNoteBar.classList.remove('is-hidden');
    } else {
        addToNoteBar.classList.add('is-hidden');
    }

    // Retry wrong only button visibility
    const retryWrongBtn = document.getElementById('quiz-retry-wrong-btn');
    if (wrongItems.length > 0) {
        retryWrongBtn.style.display = '';
    } else {
        retryWrongBtn.style.display = 'none';
    }
}

document.getElementById('quiz-retry-btn').addEventListener('click', () => {
    quizState.retryWrongOnly = false;
    const mode = quizState.mode;
    if (mode === 'flashcard')        startFlashcard();
    else if (mode === 'dictation')   startDictation();
    else if (mode === 'reorder')     startReorder(subpanelSource.reorder || 'note');
    else if (mode === 'article-listen' || mode === 'article-cloze') startArticleQuiz();
});

document.getElementById('quiz-retry-wrong-btn').addEventListener('click', () => {
    quizState.retryWrongOnly = true;
    const mode = quizState.mode;
    if (mode === 'dictation')       startDictationRetryWrong();
    else if (mode === 'reorder')         startReorderRetryWrong();
    else if (mode === 'article-listen')  startArticleRetryWrong();
    else if (mode === 'article-cloze')   startArticleRetryWrong();
    else {
        quizState.retryWrongOnly = false;
        startFlashcard();
    }
});

document.getElementById('quiz-back-btn').addEventListener('click', () => {
    quizAudioPlayer.pause();
    quizResult.classList.add('is-hidden');
    quizMenu.classList.remove('is-hidden');
    renderQuizStatsBar(quizState.categoryName, quizState.titleName);
});

document.getElementById('quiz-add-wrong-to-note-btn').addEventListener('click', () => {
    const cat = quizState.categoryName;
    const title = quizState.titleName;
    if (!cat || !title) return;

    let added = 0;
    quizState.answeredQuestions.filter(q => !q.isCorrect).forEach(q => {
        addWordToNote(q.correct, cat, title);
        added++;
    });

    showNotification(`${added} item${added > 1 ? 's' : ''} added to Note.`, 'success');
    document.getElementById('quiz-add-to-note-bar').classList.add('is-hidden');
});

// ══════════════════════════════════════════════════════════════
//  PHASE 1 — FLASHCARD
// ══════════════════════════════════════════════════════════════

// ── From Article：從 timestamp 隨機挑難字出題 ──────────────
async function startFlashcardFromArticle() {
    const title = quizState.titleName;
    if (!title) {
        showNotification('Please select an article first.', 'warning');
        return;
    }
    const tsData = await getTimestampForStory(title);
    if (!tsData || tsData.length === 0) {
        showNotification('Timestamp file not found for this article.', 'error');
        return;
    }

    const STOP = new Set(['that','this','with','have','from','they','been','were','when','what',
        'will','your','which','their','there','would','could','should','about','after','before',
        'other','some','than','then','also','into','more','over','just','like','very','well',
        'even','only','said','have','each','word']);

    const pool = [];
    tsData.forEach(line => {
        const words = (line.sentence.match(/\b[a-zA-Z]{4,}\b/g) || [])
            .filter(w => !STOP.has(w.toLowerCase()));
        [...new Set(words.map(w => w.toLowerCase()))].forEach(w => {
            pool.push({ text: w, type: 'word', sentence: line.sentence.trim(), start: line.start, end: line.end });
        });
    });

    if (pool.length === 0) {
        showNotification('Could not extract words from this article.', 'warning');
        return;
    }

    const seen = new Set();
    let deck = shuffle(pool).filter(item => {
        if (seen.has(item.text)) return false;
        seen.add(item.text);
        return true;
    });
    deck = filterByWordDifficulty(deck, quizState.difficulty);
    if (deck.length === 0) {
        showNotification(`No ${quizState.difficulty === 'mix' ? '' : quizState.difficulty + ' '}words found in this article.`, 'warning');
        return;
    }
    deck = deck.slice(0, quizState.questionCount || 10);

    // 預載音檔（同時設定 HTMLAudioElement 與 WebAudioEngine）
    const audioSrc = `audio/${encodeURIComponent(title.trim())}.mp3`;
    _setQuizAudioSrc(audioSrc);

    quizState.mode        = 'flashcard';
    quizState.flashSource = 'article';
    quizState.deck        = deck;
    quizState.deckIndex   = 0;
    quizState.againQueue  = [];
    quizState.correct     = 0;
    quizState.wrong       = 0;
    quizState.wrongItems  = [];

    closeAllSubpanels();
    showQuizSession('flashcard');
    showFlashcard();
}

function startFlashcard() {
    const items = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);
    let allItems = [
        ...items.words.map(w => ({ text: w, type: 'word' })),
        ...items.phrases.map(p => ({ text: p, type: 'phrase' }))
    ];

    // 排除字母數少於 4 的純單字（phrases 不過濾，因含空格）
    allItems = allItems.filter(i => {
        if (i.type === 'phrase') return true;
        const letters = i.text.replace(/[^a-zA-Z]/g, '').length;
        return letters >= 4;
    });

    allItems = filterByWordDifficulty(allItems, quizState.difficulty);

    if (allItems.length === 0) {
        if (!quizState.titleName && quizState.scope === 'this') {
            showNotification('Select an article first, or switch to "All Notes".', 'warning');
        } else {
            showNotification(`No ${quizState.difficulty === 'mix' ? '' : quizState.difficulty + ' '}words or phrases found.`, 'warning');
        }
        return;
    }

    quizState.mode        = 'flashcard';
    quizState.flashSource = 'note';
    quizState.deck        = shuffle(allItems).slice(0, quizState.questionCount || 10);
    quizState.deckIndex   = 0;
    quizState.againQueue  = [];
    quizState.correct     = 0;
    quizState.wrong       = 0;
    quizState.wrongItems  = [];

    closeAllSubpanels();
    showQuizSession('flashcard');
    showFlashcard();
}

function buildFullDeck() {
    return [...quizState.deck, ...quizState.againQueue];
}

function showFlashcard() {
    _resetReplayCount();
    const card = document.getElementById('flashcard');

    // Combine deck + again queue
    const fullDeck = quizState.deck;
    if (quizState.deckIndex >= fullDeck.length) {
        // Done
        showQuizResult('flashcard', quizState.correct,
            quizState.correct + quizState.wrong, quizState.wrongItems);
        return;
    }

    const item = fullDeck[quizState.deckIndex];
    const total = fullDeck.length;
    updateProgress(quizState.deckIndex + 1, total);

    // Reset flip state
    card.classList.remove('is-flipped');

    document.getElementById('flashcard-word').textContent = item.text;

    // Find context — article 模式直接用 item.sentence；note 模式從 story 內文找
    const contextEl = document.getElementById('flashcard-context');
    const ctx = (quizState.flashSource === 'article' && item.sentence)
        ? item.sentence
        : findContextForWord(
            item.text.replace(/-/g, ' '),
            quizState.scope === 'this' ? quizState.titleName : null
          );
    if (ctx) {
        // Highlight the word in context
        const highlighted = ctx.replace(
            new RegExp(`(${item.text.replace(/-/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
            '<mark>$1</mark>'
        );
        contextEl.innerHTML = highlighted;
    } else {
        contextEl.textContent = '(No context found)';
    }

    // ── 正面：單字音檔（GitHub mp3 → speechSynthesis fallback）──
    const audioBtn = document.getElementById('flashcard-audio-btn');

    // 切換卡片時取消上一個 speechSynthesis，避免疊音
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    function _playSpeech() {
        if (!('speechSynthesis' in window)) { audioBtn.classList.remove('is-playing-voice'); return; }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(item.text);
        u.lang  = 'en-US';
        u.onend = () => audioBtn.classList.remove('is-playing-voice');
        audioBtn.classList.add('is-playing-voice');
        window.speechSynthesis.speak(u);
    }

    function _playWordAudio() {
        _trackReplay();
        audioBtn.classList.remove('needs-tap');
        audioBtn.classList.add('is-playing-voice');
        const wordSrc   = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(item.text.trim())}.mp3`;
        const wordAudio = new Audio(wordSrc);
        wordAudio.play().catch(() => {
            audioBtn.classList.remove('is-playing-voice');
            _playSpeech();
        });
        wordAudio.addEventListener('ended', () => {
            audioBtn.classList.remove('is-playing-voice');
        }, { once: true });
    }
    audioBtn.onclick = _playWordAudio;

    // 自動播放 — iOS Safari 非手勢觸發可能被封鎖，偵測後改用 pulse 提示
    const _autoAudio = new Audio(
        `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(item.text.trim())}.mp3`
    );
    _autoAudio.play()
        .then(() => {
            audioBtn.classList.add('is-playing-voice');
            _autoAudio.addEventListener('ended', () => audioBtn.classList.remove('is-playing-voice'), { once: true });
        })
        .catch(() => {
            // GitHub mp3 失敗 → 試 speechSynthesis
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                const _u = new SpeechSynthesisUtterance(item.text);
                _u.lang = 'en-US';
                window.speechSynthesis.speak(_u);
                setTimeout(() => {
                    if (window.speechSynthesis.speaking) {
                        audioBtn.classList.add('is-playing-voice');
                        _u.onend = () => audioBtn.classList.remove('is-playing-voice');
                    } else {
                        // iOS 封鎖 → pulse 提示點擊
                        audioBtn.classList.add('needs-tap');
                    }
                }, 100);
            } else {
                audioBtn.classList.add('needs-tap');
            }
        });

    // ── 背面：整句音檔 + ✏️（async 查 timestamp）────────────
    const backAudioBtn      = document.getElementById('flashcard-back-audio-btn');
    const backEditContainer = document.getElementById('flashcard-back-edit-container');
    if (backAudioBtn) {
        backAudioBtn.classList.remove('is-playing-voice');
        backAudioBtn.disabled = true;
        backAudioBtn.onclick  = null;
    }
    if (backEditContainer) backEditContainer.innerHTML = '';

    const _flashTitle = quizState.scope === 'this' ? quizState.titleName : null;
    const _ctxText    = ctx; // findContextForWord 的結果（純文字句子）

    if (_flashTitle && _ctxText) {
        const _audioSrc = `audio/${encodeURIComponent(_flashTitle.trim())}.mp3`;

        // 確保 quizAudioPlayer 與 WebAudioEngine 指向正確 src
        _setQuizAudioSrc(_audioSrc);

        getTimestampForStory(_flashTitle).then(tsData => {
            if (!tsData || !backAudioBtn) return;
            const _norm = t => t.trim().replace(/[.,?!'"`\u201c\u201d\u2018\u2019]/g, '').toLowerCase();
            const _match = tsData.find(l => _norm(l.sentence) === _norm(_ctxText));
            if (!_match) return;

            // 套用調整後的時間（優先使用已調整記錄）
            const _timing = (typeof getAdjustedTiming === 'function')
                ? getAdjustedTiming(_flashTitle, _ctxText, _match.start, _match.end)
                : { start: _match.start, end: _match.end };

            backAudioBtn.disabled = false;
            backAudioBtn.onclick = () => {
                playSnippet({
                    start: _timing.start, end: _timing.end,
                    onStart: () => backAudioBtn.classList.add('is-playing-voice'),
                    onEnd:   () => backAudioBtn.classList.remove('is-playing-voice')
                });
            };

            // ✏️ 編輯鈕
            if (backEditContainer && typeof createAudioEditBtn === 'function') {
                backEditContainer.innerHTML = '';
                const _editBtn = createAudioEditBtn({
                    title:    _flashTitle,
                    sentence: _ctxText,
                    start:    _match.start,
                    end:      _match.end,
                    audioSrc: _audioSrc,
                    player:   quizAudioPlayer,
                    onSave:   (ns, ne) => {
                        _timing.start = ns;
                        _timing.end   = ne;
                        // 更新編輯鈕狀態
                        _editBtn.innerHTML  = '✏️✓';
                        _editBtn.title      = '已調整（點擊再編輯）';
                        _editBtn.classList.add('is-adjusted');
                    }
                });
                backEditContainer.appendChild(_editBtn);
            }
        }).catch(() => {});
    }

    // Hide action buttons until flipped
    document.getElementById('flashcard-wrong').style.visibility = 'hidden';
    document.getElementById('flashcard-correct').style.visibility = 'hidden';
}

// Flip card on tap
document.getElementById('flashcard').addEventListener('click', (e) => {
    // 點到按鈕不翻牌（正面 ▶、背面 ▶ 和 ✏️ 都不觸發翻牌）
    if (e.target.closest('button')) return;
    const card = document.getElementById('flashcard');
    card.classList.toggle('is-flipped');
    if (card.classList.contains('is-flipped')) {
        document.getElementById('flashcard-wrong').style.visibility = 'visible';
        document.getElementById('flashcard-correct').style.visibility = 'visible';
    }
});

document.getElementById('flashcard-correct').addEventListener('click', () => {
    const _fcItem = quizState.deck[quizState.deckIndex];
    quizState.correct++;
    quizState.deckIndex++;
    if (typeof recordItemResult === 'function' && _fcItem) {
        const _itype = quizState.flashSource === 'article' ? 'articleWords' : 'noteWords';
        recordItemResult(quizState.categoryName, quizState.titleName, _itype, _fcItem.text, true, _quizReplayCount, 'fc');
    }
    showFlashcard();
});

document.getElementById('flashcard-wrong').addEventListener('click', () => {
    const item = quizState.deck[quizState.deckIndex];
    quizState.wrong++;
    quizState.wrongItems.push(item.text);
    // Add to end of deck to review again
    quizState.deck.push(item);
    quizState.deckIndex++;
    if (typeof recordItemResult === 'function' && item) {
        const _itype = quizState.flashSource === 'article' ? 'articleWords' : 'noteWords';
        recordItemResult(quizState.categoryName, quizState.titleName, _itype, item.text, false, _quizReplayCount, 'fc');
    }
    showFlashcard();
});

// ══════════════════════════════════════════════════════════════
//  PHASE 3 — DICTATION (Listen & Choose)
// ══════════════════════════════════════════════════════════════

async function startDictation() {
    const items = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);

    if (items.sentences.length === 0) {
        showNotification('No sentences saved yet.', 'warning');
        return;
    }

    // Need timestamp data
    const title = quizState.scope === 'this' ? quizState.titleName : null;
    let tsData = null;

    if (title) {
        tsData = await getTimestampForStory(title);
        if (!tsData || tsData.length === 0) {
            showNotification('Timestamp file not found for this article. Dictation unavailable.', 'error');
            return;
        }
    }

    // Build questions from saved sentences that have timestamp matches
    const normalize = (t) => t.trim().replace(/[.,?!'\"`""'']/g, '').toLowerCase();
    const questions = [];

    for (const sent of items.sentences) {
        if (tsData) {
            const match = tsData.find(l => normalize(l.sentence) === normalize(sent));
            if (match) {
                questions.push({ sentence: sent, start: match.start, end: match.end, title });
            }
        } else {
            questions.push({ sentence: sent, start: null, end: null, title: null });
        }
    }

    if (questions.length === 0) {
        showNotification('No saved sentences found in the timestamp file.', 'warning');
        return;
    }

    let filteredQ = filterBySentenceDifficulty(questions, quizState.difficulty);
    if (filteredQ.length === 0) {
        showNotification(`No ${quizState.difficulty} sentences found in your notes.`, 'warning');
        return;
    }

    quizState.mode        = 'dictation';
    quizState.questions   = shuffle(filteredQ).slice(0, quizState.questionCount || 10);
    quizState.currentIndex = 0;
    quizState.correct     = 0;
    quizState.wrong       = 0;
    quizState.wrongItems  = [];
    quizState.answeredQuestions = [];

    // Preload audio
    if (title) {
        _setQuizAudioSrc(`audio/${encodeURIComponent(title.trim())}.mp3`);
    }

    showQuizSession('dictation');
    showDictationQuestion();
}

// (removed — using playSnippet)

function showDictationQuestion() {
    _resetReplayCount();
    // Clear any pending stop
    if (dictationStopTimeout) {
        clearTimeout(dictationStopTimeout);
        dictationStopTimeout = null;
    }
    quizAudioPlayer.pause();

    if (quizState.currentIndex >= quizState.questions.length) {
        showQuizResult('dictation', quizState.correct,
            quizState.questions.length, quizState.wrongItems);
        return;
    }

    const q = quizState.questions[quizState.currentIndex];
    updateProgress(quizState.currentIndex + 1, quizState.questions.length);

    // Hint: show word count
    const wordCount = q.sentence.trim().split(/\s+/).length;
    document.getElementById('dictation-hint').textContent = `${wordCount} words`;

// Play button
    const playBtn = document.getElementById('dictation-play-btn');
    playBtn.classList.remove('is-playing-voice');
    playBtn.onclick = () => playDictationAudio(q);

    // ✏️ 音檔編輯按鈕（放在播放按鈕旁）
    const dictEditContainer = document.getElementById('dictation-edit-btn-container');
    if (dictEditContainer) {
        dictEditContainer.innerHTML = '';
        if (q.start != null && q.title) {
            const editBtn = createAudioEditBtn({
                title:    q.title,
                sentence: q.sentence,
                start:    q.start,
                end:      q.end,
                audioSrc: `audio/${encodeURIComponent(q.title.trim())}.mp3`,
                player:   quizAudioPlayer,
                onSave:   () => playDictationAudio(q)
            });
            dictEditContainer.appendChild(editBtn);
        }
    }

    // Build options
    const allSentences = Array.from(
        getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName).sentences
    );
    const distractors = shuffle(allSentences.filter(s => s !== q.sentence)).slice(0, 3);
    const options = shuffle([q.sentence, ...distractors]);

    const optionsEl = document.getElementById('dictation-options');
    optionsEl.innerHTML = '';
    document.getElementById('dictation-feedback').textContent = '';
    document.getElementById('dictation-next').classList.add('is-hidden');

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'quiz-option-btn quiz-option-sentence';
        btn.textContent = opt;
        btn.addEventListener('click', () => handleDictationAnswer(opt, q.sentence, btn));
        optionsEl.appendChild(btn);
    });
}

function playDictationAudio(q) {
    _trackReplay();
    if (!q.start) return;
    const playBtn = document.getElementById('dictation-play-btn');
    // 套用使用者調整後的時間（若無調整則使用原始值）
    const timing = getQuizTiming(q.title, q.sentence, q.start, q.end);
    playSnippet({
        start: timing.start, end: timing.end,
        onStart: () => playBtn.classList.add('is-playing-voice'),
        onEnd:   () => playBtn.classList.remove('is-playing-voice')
    });
}

function handleDictationAnswer(selected, correct, btn) {
    document.querySelectorAll('#dictation-options .quiz-option-btn').forEach(b => {
        b.disabled = true;
        if (b.textContent === correct) b.classList.add('is-correct');
    });

    const feedbackEl = document.getElementById('dictation-feedback');
    const isCorrect = selected === correct;
    const q = quizState.questions[quizState.currentIndex];

    if (isCorrect) {
        btn.classList.add('is-correct');
        feedbackEl.textContent = '✓ Correct!';
        feedbackEl.className = 'quiz-feedback correct';
        quizState.correct++;
    } else {
        btn.classList.add('is-wrong');
        feedbackEl.innerHTML = `✗ Answer: <em>${correct}</em>`;
        feedbackEl.className = 'quiz-feedback wrong';
        quizState.wrong++;
        quizState.wrongItems.push(correct);
    }

    // Record for review
    quizState.answeredQuestions.push({
        type: 'sentence',
        question: correct,
        selected,
        correct,
        isCorrect,
        start: q.start,
        end: q.end,
        title: q.title
    });

    document.getElementById('dictation-next').classList.remove('is-hidden');
    if (typeof recordItemResult === 'function') recordItemResult(quizState.categoryName, quizState.titleName, 'noteSentences', correct, isCorrect, _quizReplayCount, 'dictation');
}

document.getElementById('dictation-next').addEventListener('click', () => {
    quizState.currentIndex++;
    showDictationQuestion();
});

// ── Load quiz scores from Firestore on login ─────────────────
// ══════════════════════════════════════════════════════════════
//  ARTICLE QUIZ — Listen & Choose + Fill in Blank
//  No note needed, directly from Timestamp
// ══════════════════════════════════════════════════════════════

function getDifficultyLabel(wordCount) {
    if (wordCount < 8)  return { label: 'Easy',   color: '#50b86c', diff: 'easy' };
    if (wordCount <= 15) return { label: 'Medium', color: '#f5a623', diff: 'medium' };
    return                     { label: 'Hard',   color: '#e05c5c', diff: 'hard' };
}

// Word/phrase difficulty by character length (strip hyphens for phrases)
function getWordDifficulty(text) {
    const letters = text.replace(/-/g, '').replace(/[^a-zA-Z]/g, '').length;
    if (letters <= 5)  return 'easy';
    if (letters <= 8)  return 'medium';
    return 'hard';
}

// Filter word/phrase items by difficulty setting
function filterByWordDifficulty(items, diff) {
    if (diff === 'mix') return items;
    return items.filter(item => getWordDifficulty(item.text) === diff);
}

// Filter sentence items by difficulty setting
function filterBySentenceDifficulty(items, diff) {
    if (diff === 'mix') return items;
    return items.filter(item => {
        const wc = (item.sentence || item).trim().split(/\s+/).length;
        return getDifficultyLabel(wc).diff === diff;
    });
}

async function startArticleQuiz() {
    const title = quizState.titleName;
    if (!title) {
        showNotification('Please select an article using the dropdowns above.', 'warning');
        return;
    }

    const tsData = await getTimestampForStory(title);
    if (!tsData || tsData.length === 0) {
        showNotification('Timestamp file not found for this article.', 'error');
        return;
    }

    // Filter by difficulty
    const diff = quizState.difficulty || 'mix';
    const allSentences = tsData.filter(l => l.sentence && l.sentence.trim().length > 3);
    const pool = diff === 'mix' ? allSentences : allSentences.filter(l => {
        const wc = l.sentence.trim().split(/\s+/).length;
        return getDifficultyLabel(wc).diff === diff;
    });

    if (pool.length < 2) {
        const diffLabel = diff === 'mix' ? '' : ` (${diff})`;
        showNotification(`Not enough${diffLabel} sentences in this article.`, 'warning');
        return;
    }

    const qCount   = quizState.questionCount || 10;
    const selected = shuffle(pool).slice(0, qCount);
    const questions = selected.map(l => {
        const _sent = l.sentence.trim();
        // 出題前先查是否有調整記錄，有則優先使用
        const _timing = (typeof getAdjustedTiming === 'function')
            ? getAdjustedTiming(title, _sent, l.start, l.end)
            : { start: l.start, end: l.end };
        return {
            sentence:  _sent,
            start:     _timing.start,
            end:       _timing.end,
            origStart: l.start,
            origEnd:   l.end,
            title,
            wordCount: _sent.split(/\s+/).length,
        };
    });

    const subMode = quizState.articleSubMode;
    quizState.mode           = subMode === 'listen' ? 'article-listen' : 'article-cloze';
    quizState.questions      = questions;
    quizState.currentIndex   = 0;
    quizState.correct        = 0;
    quizState.wrong          = 0;
    quizState.wrongItems     = [];
    quizState.answeredQuestions = [];

    // Preload audio
    _setQuizAudioSrc(`audio/${encodeURIComponent(title.trim())}.mp3`);

    // Close subpanels
    closeAllSubpanels();

    showQuizSession(quizState.mode);

    if (subMode === 'listen') showArticleListenQuestion();
    else showArticleClozeQuestion();
}

// ── Article Listen & Choose ───────────────────────────────────

function showArticleListenQuestion() {
    _resetReplayCount();
    if (quizState.currentIndex >= quizState.questions.length) {
        showQuizResult(quizState.mode, quizState.correct,
            quizState.questions.length, quizState.wrongItems);
        return;
    }

    const q = quizState.questions[quizState.currentIndex];
    updateProgress(quizState.currentIndex + 1, quizState.questions.length);

    // Difficulty badge
    const diffInfo = getDifficultyLabel(q.wordCount);
    const badge = document.getElementById('article-diff-badge');
    badge.textContent = diffInfo.label;
    badge.style.background = diffInfo.color;

    // Word count hint
    document.getElementById('article-listen-hint').textContent =
        `${q.wordCount} words`;

// Play button
    const playBtn = document.getElementById('article-play-btn');
    playBtn.classList.remove('is-playing-voice');
    playBtn.onclick = () => playArticleAudio(q, playBtn);

    // ✏️ 音檔編輯按鈕
    const artEditContainer = document.getElementById('article-listen-edit-btn-container');
    if (artEditContainer) {
        artEditContainer.innerHTML = '';
        const editBtn = createAudioEditBtn({
            title:    q.title,
            sentence: q.sentence,
            start:    q.start,
            end:      q.end,
            audioSrc: `audio/${encodeURIComponent(q.title.trim())}.mp3`,
            player:   quizAudioPlayer,
            onSave:   () => playArticleAudio(q, playBtn)
        });
        artEditContainer.appendChild(editBtn);
    }

    // Auto-play first time
    setTimeout(() => playArticleAudio(q, playBtn), 300);

    // Build options: correct + 3 distractors from same pool
    const allSentences = quizState.questions.map(q => q.sentence);
    const extras = tsDataCache[q.title] || [];
    const distPool = shuffle([
        ...allSentences.filter(s => s !== q.sentence),
        ...extras.filter(l => l.sentence && l.sentence.trim() !== q.sentence)
                 .map(l => l.sentence.trim())
    ]);
    const distractors = distPool.slice(0, 3);
    const options = shuffle([q.sentence, ...distractors]);

    const optEl = document.getElementById('article-listen-options');
    optEl.innerHTML = '';
    document.getElementById('article-listen-feedback').textContent = '';
    document.getElementById('article-listen-next').classList.add('is-hidden');

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'quiz-option-btn quiz-option-sentence';
        btn.textContent = opt;
        btn.addEventListener('click', () => handleArticleListenAnswer(opt, q, btn));
        optEl.appendChild(btn);
    });
}

// Cache for timestamp data to avoid re-fetching
const tsDataCache = {};

async function getTimestampForStoryWithCache(title) {
    if (tsDataCache[title]) return tsDataCache[title];
    const data = await getTimestampForStory(title);
    if (data) tsDataCache[title] = data;
    return data;
}

// (removed — using playSnippet)

function playArticleAudio(q, btn) {
    _trackReplay();
    // 套用使用者調整後的時間（若無調整則使用原始值）
    const timing = getQuizTiming(q.title, q.sentence, q.start, q.end);
    playSnippet({
        start: timing.start, end: timing.end,
        onStart: () => {
            btn.classList.add('is-playing-voice');
            btn.querySelector('span').textContent = '⏸ Playing...';
        },
        onEnd: () => {
            btn.classList.remove('is-playing-voice');
            btn.querySelector('span').textContent = '▶ Play Again';
        }
    });
}

function handleArticleListenAnswer(selected, q, btn) {
    document.querySelectorAll('#article-listen-options .quiz-option-btn').forEach(b => {
        b.disabled = true;
        if (b.textContent === q.sentence) b.classList.add('is-correct');
    });

    const isCorrect = selected === q.sentence;
    const feedbackEl = document.getElementById('article-listen-feedback');

    if (isCorrect) {
        btn.classList.add('is-correct');
        feedbackEl.textContent = '✓ Correct!';
        feedbackEl.className = 'quiz-feedback correct';
        quizState.correct++;
    } else {
        btn.classList.add('is-wrong');
        feedbackEl.textContent = '✗ Wrong';
        feedbackEl.className = 'quiz-feedback wrong';
        quizState.wrong++;
        quizState.wrongItems.push(q.sentence);
    }

    quizState.answeredQuestions.push({
        type: 'sentence',
        question: q.sentence,
        selected,
        correct: q.sentence,
        isCorrect,
        start: q.start,
        end: q.end,
        title: q.title
    });

    document.getElementById('article-listen-next').classList.remove('is-hidden');
    if (typeof recordItemResult === 'function') recordItemResult(quizState.categoryName, quizState.titleName, 'articleSentences', q.sentence, isCorrect, _quizReplayCount, 'articleListen');
}

document.getElementById('article-listen-next').addEventListener('click', () => {
    quizState.currentIndex++;
    showArticleListenQuestion();
});

// ── Article Fill in Blank ─────────────────────────────────────

function showArticleClozeQuestion() {
    _resetReplayCount();
    if (quizState.currentIndex >= quizState.questions.length) {
        showQuizResult(quizState.mode, quizState.correct,
            quizState.questions.length, quizState.wrongItems);
        return;
    }

    const q = quizState.questions[quizState.currentIndex];
    updateProgress(quizState.currentIndex + 1, quizState.questions.length);

    // Difficulty badge
    const diffInfo = getDifficultyLabel(q.wordCount);
    const badge = document.getElementById('article-cloze-diff-badge');
    badge.textContent = diffInfo.label;
    badge.style.background = diffInfo.color;

    // Play button — 套用調整後時間
    const clozePlayBtn = document.getElementById('article-cloze-play-btn');
    clozePlayBtn.classList.remove('is-playing-voice');
    clozePlayBtn.querySelector('span').textContent = '▶ Listen to Sentence';
    clozePlayBtn.onclick = () => playArticleAudio(q, clozePlayBtn);

    // ✏️ 編輯鈕
    const _artClozeEditCont = document.getElementById('article-cloze-edit-btn-container');
    if (_artClozeEditCont) {
        _artClozeEditCont.innerHTML = '';
        if (typeof createAudioEditBtn === 'function') {
            const _editBtn = createAudioEditBtn({
                title:    q.title,
                sentence: q.sentence,
                start:    q.start,
                end:      q.end,
                audioSrc: `audio/${encodeURIComponent(q.title.trim())}.mp3`,
                player:   quizAudioPlayer,
                onSave:   () => playArticleAudio(q, clozePlayBtn)
            });
            _artClozeEditCont.appendChild(_editBtn);
        }
    }

    // 自動播放
    setTimeout(() => playArticleAudio(q, clozePlayBtn), 300);

    // Pick a word to blank out from the sentence
    // Prefer longer words (more meaningful)
    const words = q.sentence.match(/\b[a-zA-Z]{4,}\b/g) || q.sentence.split(/\s+/);
    const targetWord = words[Math.floor(Math.random() * words.length)];

    // Build blanked sentence
    const blanked = q.sentence.replace(
        new RegExp(`\\b(${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\b`, 'i'),
        '<span class="cloze-blank">_____</span>'
    );
    document.getElementById('article-cloze-sentence').innerHTML = blanked;

    // Distractors: other words from the pool
    const allWords = quizState.questions
        .flatMap(qi => (qi.sentence.match(/\b[a-zA-Z]{4,}\b/g) || []))
        .filter(w => w.toLowerCase() !== targetWord.toLowerCase());
    const distractors = shuffle([...new Set(allWords)]).slice(0, 3);
    const options = shuffle([targetWord, ...distractors]);

    const optEl = document.getElementById('article-cloze-options');
    optEl.innerHTML = '';
    document.getElementById('article-cloze-feedback').textContent = '';
    document.getElementById('article-cloze-next').classList.add('is-hidden');

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'quiz-option-btn';
        btn.textContent = opt;
        btn.addEventListener('click', () =>
            handleArticleClozeAnswer(opt, targetWord, q, btn)
        );
        optEl.appendChild(btn);
    });
}

function handleArticleClozeAnswer(selected, correct, q, btn) {
    document.querySelectorAll('#article-cloze-options .quiz-option-btn').forEach(b => {
        b.disabled = true;
        if (b.textContent.toLowerCase() === correct.toLowerCase())
            b.classList.add('is-correct');
    });

    const isCorrect = selected.toLowerCase() === correct.toLowerCase();
    const feedbackEl = document.getElementById('article-cloze-feedback');

    if (isCorrect) {
        btn.classList.add('is-correct');
        feedbackEl.textContent = '✓ Correct!';
        feedbackEl.className = 'quiz-feedback correct';
        quizState.correct++;
    } else {
        btn.classList.add('is-wrong');
        feedbackEl.textContent = `✗ Answer: ${correct}`;
        feedbackEl.className = 'quiz-feedback wrong';
        quizState.wrong++;
        quizState.wrongItems.push(correct);
    }

    quizState.answeredQuestions.push({
        type: 'sentence',
        question: q.sentence,
        selected,
        correct,
        isCorrect,
        start: q.start,
        end: q.end,
        title: q.title
    });

    document.getElementById('article-cloze-next').classList.remove('is-hidden');
    // Article Cloze 已停用，不再記錄 itemScore
}

document.getElementById('article-cloze-next').addEventListener('click', () => {
    quizState.currentIndex++;
    showArticleClozeQuestion();
});

// ── Article Retry Wrong ───────────────────────────────────────

function startArticleRetryWrong() {
    const wrongQs = quizState.answeredQuestions.filter(q => !q.isCorrect);
    if (wrongQs.length === 0) return;

    quizState.questions = shuffle(wrongQs.map(q => ({
        sentence: q.correct,
        start: q.start,
        end: q.end,
        title: q.title,
        wordCount: q.correct.split(/\s+/).length,
    })));
    quizState.currentIndex   = 0;
    quizState.correct        = 0;
    quizState.wrong          = 0;
    quizState.wrongItems     = [];
    quizState.answeredQuestions = [];

    showQuizSession(quizState.mode);
    if (quizState.mode === 'article-listen') showArticleListenQuestion();
    else showArticleClozeQuestion();
}

// ── Retry Wrong Only ──────────────────────────────────────────

function startDictationRetryWrong() {
    const wrongQs = quizState.answeredQuestions.filter(q => !q.isCorrect);
    if (wrongQs.length === 0) return;

    const questions = wrongQs.map(q => ({
        sentence: q.correct,
        start: q.start,
        end: q.end,
        title: q.title
    }));

    quizState.questions   = shuffle(questions);
    quizState.currentIndex = 0;
    quizState.correct     = 0;
    quizState.wrong       = 0;
    quizState.wrongItems  = [];
    quizState.answeredQuestions = [];

    showQuizSession('dictation');
    showDictationQuestion();
}

function startReorderRetryWrong() {
    const wrongQs = quizState.answeredQuestions.filter(q => !q.isCorrect);
    if (wrongQs.length === 0) return;

    quizState.questions        = shuffle(wrongQs.map(q => ({ sentence: q.correct })));
    quizState.currentIndex     = 0;
    quizState.correct          = 0;
    quizState.wrong            = 0;
    quizState.wrongItems       = [];
    quizState.answeredQuestions = [];

    showQuizSession('reorder');
    showReorderQuestion();
}

async function loadQuizScoresFromFirestore() {
    if (typeof currentUser === 'undefined' || !currentUser) return;
    try {
        const doc = await db.collection('userNotes').doc(currentUser.uid).get();
        if (doc.exists && doc.data().quizScores) {
            localStorage.setItem(QUIZ_SCORES_KEY, JSON.stringify(doc.data().quizScores));
        }
    } catch (e) {
        console.error('Quiz scores load error:', e);
    }
}

// Hook into Firebase auth state change
const _origOnAuthStateChanged = firebase.auth().onAuthStateChanged.bind(firebase.auth());
// We patch loadQuizScoresFromFirestore into showAppView instead
// by calling it after login in story.js's onAuthStateChanged

// ══════════════════════════════════════════════════════════════
//  REORDER QUIZ
// ══════════════════════════════════════════════════════════════

async function startReorder(source) {
    let sentences = [];

    if (source === 'article') {
        const title = quizState.titleName;
        if (!title) {
            showNotification('Please select an article using the dropdowns above.', 'warning');
            return;
        }
        const tsData = await getTimestampForStory(title);
        if (!tsData || tsData.length === 0) {
            showNotification('Timestamp file not found for this article.', 'error');
            return;
        }
        const diff = quizState.difficulty;
        const rawPool = tsData.filter(l => {
            if (!l.sentence || l.sentence.trim().split(/\s+/).length < 4) return false;
            if (diff === 'mix') return true;
            return getDifficultyLabel(l.sentence.trim().split(/\s+/).length).diff === diff;
        });
        if (rawPool.length === 0) {
            showNotification(`No ${diff === 'mix' ? '' : diff + ' '}sentences found in this article.`, 'warning');
            return;
        }
        const pool = shuffle(rawPool).slice(0, quizState.questionCount || 10);
        sentences = pool.map(l => ({
            sentence: l.sentence.trim(),
            start: l.start,
            end: l.end,
            title
        }));

        // Preload audio
        _setQuizAudioSrc(`audio/${encodeURIComponent(title.trim())}.mp3`);
    } else {
        // From Note — 用 titleName 抓 timestamp，比對句子找 start/end
        const title = quizState.titleName;
        const items = getAllNoteItems(quizState.scope, quizState.categoryName, title);
        const diff = quizState.difficulty;
        const allNoteSents = Array.from(items.sentences || [])
            .filter(s => s.trim().split(/\s+/).length >= 4);
        const filteredNoteSents = diff === 'mix' ? allNoteSents : allNoteSents.filter(s => {
            const wc = s.trim().split(/\s+/).length;
            return getDifficultyLabel(wc).diff === diff;
        });
        if (filteredNoteSents.length === 0) {
            showNotification(`No ${diff === 'mix' ? '' : diff + ' '}sentences in your notes.`, 'warning');
            return;
        }
        const raw = shuffle(filteredNoteSents).slice(0, quizState.questionCount || 10);

        if (raw.length === 0) {
            showNotification('No sentences saved yet. Add sentences to your note first.', 'warning');
            return;
        }

        // Try to match each note sentence against timestamp data
        let tsData = null;
        if (title) {
            tsData = await getTimestampForStory(title);
        }

        sentences = raw.map(s => {
            const trimmed = s.trim();
            let start = null, end = null, matchTitle = null;
            if (tsData) {
                const match = tsData.find(l =>
                    l.sentence && l.sentence.trim().toLowerCase() === trimmed.toLowerCase()
                );
                if (match) { start = match.start; end = match.end; matchTitle = title; }
            }
            return { sentence: trimmed, start, end, title: matchTitle };
        });

        // Preload audio if we have a title
        if (title) {
            _setQuizAudioSrc(`audio/${encodeURIComponent(title.trim())}.mp3`);
        }
    }

    if (sentences.length === 0) {
        showNotification('Not enough sentences to start Reorder quiz.', 'warning');
        return;
    }

    quizState.mode             = 'reorder';
    quizState.questions        = sentences;
    quizState.currentIndex     = 0;
    quizState.correct          = 0;
    quizState.wrong            = 0;
    quizState.wrongItems       = [];
    quizState.answeredQuestions = [];

    closeAllSubpanels();
    showQuizSession('reorder');
    showReorderQuestion();
}

// ── Reorder state ─────────────────────────────────────────────
let reorderAnswer  = [];   // word tokens in answer area (in order)
let reorderPool    = [];   // all shuffled tokens for current question
let reorderChecked = false;
let reorderFirstWord = '';  // 第一個單字
let reorderLastWord = '';   // 最後一個單字

function tokenize(sentence) {
    // Split keeping punctuation attached to words (e.g. "Hello," stays together)
    return sentence.match(/\S+/g) || [];
}

function normalizeForCheck(tokens) {
    return tokens.map(t =>
        t.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
    ).join(' ');
}

function showReorderQuestion() {
    _resetReplayCount();
    if (quizState.currentIndex >= quizState.questions.length) {
        showQuizResult('reorder', quizState.correct,
            quizState.questions.length, quizState.wrongItems);
        return;
    }

    const q = quizState.questions[quizState.currentIndex];
    updateProgress(quizState.currentIndex + 1, quizState.questions.length);

    reorderAnswer  = [];
    reorderChecked = false;

    // Tokenize and shuffle — ensure it's actually shuffled
    const tokens = tokenize(q.sentence);
    let shuffled;
    do { shuffled = shuffle([...tokens]); }
    while (tokens.length > 1 && shuffled.join(' ') === tokens.join(' '));
    reorderPool = shuffled;
    
    // 記錄第一個和最後一個單字
    reorderFirstWord = tokens[0];
    reorderLastWord = tokens[tokens.length - 1];
    
    // 顯示提示
    const hintEl = document.getElementById('reorder-hint');
    if (hintEl && tokens.length > 0) {
        hintEl.textContent = `Hint: Start with "${reorderFirstWord}" and end with "${reorderLastWord}"`;
        hintEl.style.display = 'block';
    }

    // Play button: always visible, disabled if no timestamp
    const playBtn = document.getElementById('reorder-play-btn');
    playBtn.classList.remove('is-hidden');
    playBtn.classList.remove('is-playing-voice');
    playBtn.querySelector('span:last-child').textContent = 'Play Sentence';

if (q.start != null) {
        playBtn.disabled = false;
        playBtn.style.opacity = '';
        playBtn.onclick = () => playReorderAudio(q);
    } else {
        playBtn.disabled = true;
        playBtn.style.opacity = '0.35';
        playBtn.onclick = null;
    }

    // ✏️ 音檔編輯按鈕
    const reorderEditContainer = document.getElementById('reorder-edit-btn-container');
    if (reorderEditContainer) {
        reorderEditContainer.innerHTML = '';
        if (q.start != null && q.title) {
            const editBtn = createAudioEditBtn({
                title:    q.title,
                sentence: q.sentence,
                start:    q.start,
                end:      q.end,
                audioSrc: `audio/${encodeURIComponent(q.title.trim())}.mp3`,
                player:   quizAudioPlayer,
                onSave:   () => playReorderAudio(q)
            });
            reorderEditContainer.appendChild(editBtn);
        }
    }

    // Reset UI
    const answerArea = document.getElementById('reorder-answer-area');
    const feedback   = document.getElementById('reorder-feedback');

    answerArea.className = 'reorder-answer-area';
    feedback.textContent = '';
    feedback.className   = 'quiz-feedback';

    _reorderClearHighlight();

    // Reset Check button (may have been transformed into Next)
    const checkBtn = document.getElementById('reorder-check-btn');
    checkBtn.textContent = 'Check ✓';
    checkBtn.classList.remove('quiz-btn-next-mode');
    checkBtn.classList.add('quiz-btn-correct');
    checkBtn.disabled = false;
    document.getElementById('reorder-clear-btn').disabled = false;

    renderReorderPool();
    renderReorderAnswer();

    // Auto-play if timestamp available
    if (q.start != null) {
        setTimeout(() => playReorderAudio(q), 150);
    }
}

// (removed — using playSnippet)

function playReorderAudio(q) {
    _trackReplay();
    const playBtn = document.getElementById('reorder-play-btn');
    // 套用使用者調整後的時間（若無調整則使用原始值）
    const timing = getQuizTiming(q.title, q.sentence, q.start, q.end);
    playSnippet({
        start: timing.start, end: timing.end,
        onStart: () => {
            playBtn.classList.add('is-playing-voice');
            playBtn.querySelector('span:last-child').textContent = 'Playing…';
        },
        onEnd: () => {
            playBtn.classList.remove('is-playing-voice');
            playBtn.querySelector('span:last-child').textContent = 'Play Sentence';
        }
    });
}

// ── Drag state ────────────────────────────────────────────────
let _drag = {
    active: false, ghost: null, source: null,
    poolIdx: null, answerPos: null, word: null,
    startX: 0, startY: 0, moved: false,
    originEl: null,
};
const DRAG_THRESHOLD = 6;

function _dragStart(e, source, poolIdx, answerPos, word) {
    if (reorderChecked) return;
    const point = e.touches ? e.touches[0] : e;
    _drag.startX = point.clientX;
    _drag.startY = point.clientY;
    _drag.source = source;
    _drag.poolIdx = poolIdx;
    _drag.answerPos = answerPos;
    _drag.word = word;
    _drag.active = false;
    _drag.moved = false;
    _drag.originEl = e.currentTarget;

    const ghost = document.createElement('div');
    ghost.className = 'reorder-word reorder-drag-ghost';
    ghost.textContent = word;
    ghost.style.display = 'none';
    document.body.appendChild(ghost);
    _drag.ghost = ghost;
}

function _dragMove(e) {
    if (!_drag.ghost) return;
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - _drag.startX;
    const dy = point.clientY - _drag.startY;

    if (!_drag.active && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        _drag.active = true;
        _drag.moved  = true;
        _drag.ghost.style.display = '';
        if (_drag.originEl) _drag.originEl.classList.add('is-dragging');
        _updateInsertIndicator(point.clientX, point.clientY);
    }
    if (_drag.active) {
        e.preventDefault();
        _drag.ghost.style.left = (point.clientX - _drag.ghost.offsetWidth / 2) + 'px';
        _drag.ghost.style.top  = (point.clientY - _drag.ghost.offsetHeight / 2) + 'px';
        _updateInsertIndicator(point.clientX, point.clientY);
    }
}

function _dragEnd(e) {
    if (!_drag.ghost) return;
    const point = e.changedTouches ? e.changedTouches[0] : e;

    if (_drag.active) {
        const insertPos = _getInsertPosition(point.clientX, point.clientY);
        _removeInsertIndicator();
        _drag.ghost.remove();
        _drag.ghost = null;

        if (insertPos !== null) {
            // 放開在答案區內 → 插入到指定位置
            if (_drag.source === 'answer') {
                reorderAnswer.splice(_drag.answerPos, 1);
                // 若插入位置在刪除點之後，需補正
                const finalPos = insertPos > _drag.answerPos ? insertPos - 1 : insertPos;
                reorderAnswer.splice(finalPos, 0, { word: _drag.word, idx: _drag.poolIdx ?? _drag.answerPos });
            } else {
                reorderAnswer.splice(insertPos, 0, { word: _drag.word, idx: _drag.poolIdx });
            }
        } else if (_drag.source === 'answer') {
            // 放開在答案區外 → 退回單字池（移除即可，renderReorderPool 會重新顯示）
            reorderAnswer.splice(_drag.answerPos, 1);
        }
        _drag.active = false;
    } else {
        // 點擊（未拖移）：保留原本點擊行為
        _drag.ghost.remove();
        _drag.ghost = null;
        _drag.active = false;

        if (_drag.source === 'pool') {
            const idx = _drag.poolIdx;
            if (reorderAnswer.some(a => a.idx === idx)) return;
            reorderAnswer.push({ word: _drag.word, idx });
        } else {
            reorderAnswer.splice(_drag.answerPos, 1);
        }
    }

    renderReorderPool();
    renderReorderAnswer();
    _drag = { active: false, ghost: null, source: null, poolIdx: null, answerPos: null, word: null, startX: 0, startY: 0, moved: false, originEl: null };
}

function _getInsertPosition(clientX, clientY) {
    const answerArea = document.getElementById('reorder-answer-area');
    const areaRect = answerArea.getBoundingClientRect();
    if (clientX < areaRect.left - 40 || clientX > areaRect.right + 40 ||
        clientY < areaRect.top  - 40 || clientY > areaRect.bottom + 40) {
        return null;
    }
    const btns = [...answerArea.querySelectorAll('.reorder-word.in-answer')];
    if (btns.length === 0) return 0;

    // 分組成「行」（依 top 值的接近程度分組）
    const rows = [];
    let currentRow = [];
    let currentRowTop = null;
    const ROW_TOLERANCE = 10; // px 差距內視為同一行

    for (let i = 0; i < btns.length; i++) {
        const rect = btns[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (currentRowTop === null || Math.abs(midY - currentRowTop) <= ROW_TOLERANCE) {
            currentRow.push({ idx: i, rect });
            if (currentRowTop === null) currentRowTop = midY;
        } else {
            rows.push(currentRow);
            currentRow = [{ idx: i, rect }];
            currentRowTop = midY;
        }
    }
    if (currentRow.length) rows.push(currentRow);

    // 找到游標最接近的那一行（依 Y 距離）
    let bestRow = rows[0];
    let bestRowDist = Infinity;
    for (const row of rows) {
        const rowTop = row[0].rect.top;
        const rowBottom = row[0].rect.bottom;
        let dist;
        if (clientY < rowTop) dist = rowTop - clientY;
        else if (clientY > rowBottom) dist = clientY - rowBottom;
        else dist = 0;
        if (dist < bestRowDist) {
            bestRowDist = dist;
            bestRow = row;
        }
    }

    // 在該行中，依 X 軸決定插入位置
    for (const { idx, rect } of bestRow) {
        if (clientX < rect.left + rect.width / 2) return idx;
    }
    // 插入到該行最後一個元素之後
    return bestRow[bestRow.length - 1].idx + 1;
}

let _insertIndicatorEl = null;

function _updateInsertIndicator(clientX, clientY) {
    const answerArea = document.getElementById('reorder-answer-area');
    const pos = _getInsertPosition(clientX, clientY);
    if (pos === null) { _removeInsertIndicator(); _clearNeighborHighlight(); answerArea.classList.remove('drag-over'); return; }
    answerArea.classList.add('drag-over');
    if (!_insertIndicatorEl) {
        _insertIndicatorEl = document.createElement('div');
        _insertIndicatorEl.className = 'reorder-insert-indicator';
    }
    const btns = [...answerArea.querySelectorAll('.reorder-word.in-answer')];
    if (btns.length === 0 || pos >= btns.length) {
        answerArea.appendChild(_insertIndicatorEl);
    } else {
        answerArea.insertBefore(_insertIndicatorEl, btns[pos]);
    }

    // 標記左右相鄰單字搖晃，讓使用者在手指遮住時也能感知插入位置
    _clearNeighborHighlight();
    const leftBtn  = btns[pos - 1] ?? null;
    const rightBtn = btns[pos]     ?? null;
    if (leftBtn)  leftBtn.classList.add('is-neighbor-left');
    if (rightBtn) rightBtn.classList.add('is-neighbor-right');
}

function _clearNeighborHighlight() {
    const answerArea = document.getElementById('reorder-answer-area');
    if (!answerArea) return;
    answerArea.querySelectorAll('.is-neighbor-left, .is-neighbor-right').forEach(el => {
        el.classList.remove('is-neighbor-left', 'is-neighbor-right');
    });
}

function _removeInsertIndicator() {
    const answerArea = document.getElementById('reorder-answer-area');
    if (answerArea) answerArea.classList.remove('drag-over');
    if (_insertIndicatorEl && _insertIndicatorEl.parentNode) {
        _insertIndicatorEl.parentNode.removeChild(_insertIndicatorEl);
    }
    _insertIndicatorEl = null;
    _clearNeighborHighlight();
}

// 全域事件：拖移離開按鈕後仍可追蹤
document.addEventListener('pointermove', (e) => { if (_drag.ghost) _dragMove(e); }, { passive: false });
document.addEventListener('pointerup',   (e) => { if (_drag.ghost) _dragEnd(e); });
document.addEventListener('touchmove',   (e) => { if (_drag.ghost && _drag.active) e.preventDefault(); }, { passive: false });

function renderReorderPool() {
    const wordPool = document.getElementById('reorder-word-pool');
    wordPool.innerHTML = '';

    const availableWords = reorderPool.filter((word, idx) =>
        !reorderAnswer.some(a => a.idx === idx)
    );
    if (availableWords.length === 0) {
        wordPool.innerHTML = '<div style="padding: 12px; color: var(--color-text-light); text-align: center; font-size: 0.9em;">All words selected ✓</div>';
        wordPool.style.minHeight = '40px';
        return;
    }
    wordPool.style.minHeight = 'auto';

    // 按字母排序顯示（保留原始 idx 供 reorderAnswer 追蹤）
    const sortedEntries = reorderPool
        .map((word, idx) => ({ word, idx }))
        .sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));

    sortedEntries.forEach(({ word, idx }) => {
        const isUsed = reorderAnswer.some(a => a.idx === idx);
        const btn = document.createElement('button');
        btn.className = 'reorder-word';
        if (isUsed) btn.classList.add('is-used');

        const nw = word.toLowerCase().replace(/[.,?!'"`“”‘’]/g, '');
        const nf = reorderFirstWord.toLowerCase().replace(/[.,?!'"`“”‘’]/g, '');
        const nl = reorderLastWord.toLowerCase().replace(/[.,?!'"`“”‘’]/g, '');
        if (nw === nf || nw === nl) btn.classList.add('is-hint-word');

        btn.textContent = word;
        btn.dataset.idx = idx;
        btn.addEventListener('pointerdown', (e) => {
            if (reorderChecked || isUsed) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            _dragStart(e, 'pool', idx, null, word);
        });
        wordPool.appendChild(btn);
    });
}

function renderReorderAnswer() {
    const answerArea = document.getElementById('reorder-answer-area');
    answerArea.innerHTML = '';

    if (reorderAnswer.length === 0) {
        answerArea.innerHTML = '<span class="reorder-placeholder" style="color:var(--color-text-light);font-size:0.85em;padding:4px 6px">Tap words below to build the sentence…</span>';
        return;
    }

    reorderAnswer.forEach((item, pos) => {
        const btn = document.createElement('button');
        btn.className = 'reorder-word in-answer';
        btn.textContent = item.word;
        btn.addEventListener('pointerdown', (e) => {
            if (reorderChecked) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            _dragStart(e, 'answer', item.idx, pos, item.word);
        });
        answerArea.appendChild(btn);
    });
}
document.getElementById('reorder-clear-btn').addEventListener('click', () => {
    if (reorderChecked) return;
    reorderAnswer = [];
    renderReorderPool();
    renderReorderAnswer();
});

document.getElementById('reorder-check-btn').addEventListener('click', () => {
    if (reorderChecked) {
        // Button has become "Next →" — advance to next question
        quizState.currentIndex++;
        showReorderQuestion();
        return;
    }

    const q = quizState.questions[quizState.currentIndex];
    const tokens = tokenize(q.sentence);

    if (reorderAnswer.length < tokens.length) {
        showNotification('Place all words before checking!', 'warning');
        return;
    }

    reorderChecked = true;
    document.getElementById('reorder-clear-btn').disabled  = true;

    const userStr    = normalizeForCheck(reorderAnswer.map(a => a.word));
    const correctStr = normalizeForCheck(tokens);
    const isCorrect  = userStr === correctStr;

    const answerArea = document.getElementById('reorder-answer-area');
    const feedback   = document.getElementById('reorder-feedback');

    if (isCorrect) {
        answerArea.classList.add('is-correct');
        feedback.textContent = '✓ Correct!';
        feedback.className   = 'quiz-feedback correct';
        quizState.correct++;
    } else {
        answerArea.classList.add('is-wrong');

        // LCS diff — find which user words are NOT part of the longest common subsequence
        // so only truly wrong/misplaced words get highlighted red
        const userTokens    = reorderAnswer.map(a => normalizeForCheck([a.word]));
        const correctTokens = tokens.map(t => normalizeForCheck([t]));

        // Build LCS table
        const m = userTokens.length, n = correctTokens.length;
        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                dp[i][j] = userTokens[i - 1] === correctTokens[j - 1]
                    ? dp[i - 1][j - 1] + 1
                    : Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }

        // Backtrack to find which user positions are in the LCS (= correct)
        const inLCS = new Array(m).fill(false);
        let i = m, j = n;
        while (i > 0 && j > 0) {
            if (userTokens[i - 1] === correctTokens[j - 1]) {
                inLCS[i - 1] = true;
                i--; j--;
            } else if (dp[i - 1][j] >= dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }

        // Apply red highlight only to words NOT in LCS
        const answerButtons = answerArea.querySelectorAll('.reorder-word');
        answerButtons.forEach((btn, idx) => {
            if (!inLCS[idx]) btn.classList.add('is-incorrect');
        });

        const userAnswerStr = reorderAnswer.map(a => a.word).join(' ');
        feedback.innerHTML = `✗ Correct order: <em class="quiz-review-correct-styled">${buildCorrectAnswerWithDiff(userAnswerStr, q.sentence)}</em>`;
        feedback.className = 'quiz-feedback wrong';
        quizState.wrong++;
        quizState.wrongItems.push(q.sentence);
    }

    quizState.answeredQuestions.push({
        type: 'sentence',
        question: q.sentence,
        selected: reorderAnswer.map(a => a.word).join(' '),
        correct: q.sentence,
        isCorrect
    });
    if (typeof recordItemResult === 'function') {
        const _rtype = (typeof subpanelSource !== 'undefined' && subpanelSource.reorder === 'article') ? 'articleSentences' : 'noteSentences';
        recordItemResult(quizState.categoryName, quizState.titleName, _rtype, q.sentence, isCorrect, _quizReplayCount, 'reorder');
    }

    // Transform Check button → Next button
    const checkBtn = document.getElementById('reorder-check-btn');
    checkBtn.textContent = 'Next →';
    checkBtn.classList.remove('quiz-btn-correct');
    checkBtn.classList.add('quiz-btn-next-mode');
    checkBtn.disabled = false;
    checkBtn.dataset.mode = 'next';
});

// ── Reorder Keyboard Shortcuts ────────────────────────────────
// Space  = Play audio
// Letter = Cycle highlight through pool words starting with that letter
// Enter  = Select highlighted word → if none highlighted, Check / Next
// Escape = Clear highlight

// Track which pool word is currently highlighted by keyboard
let _reorderKeyHighlightIdx = null;   // idx into reorderPool
let _reorderKeyLetter       = '';     // last pressed letter
let _reorderKeyCandidates   = [];     // filtered pool idxs for that letter
let _reorderKeyCyclePos     = -1;     // position in _reorderKeyCandidates

function _reorderClearHighlight() {
    _reorderKeyHighlightIdx = null;
    _reorderKeyLetter       = '';
    _reorderKeyCandidates   = [];
    _reorderKeyCyclePos     = -1;
    document.querySelectorAll('#reorder-word-pool .reorder-word.is-key-highlight')
        .forEach(el => el.classList.remove('is-key-highlight'));
}

function _reorderCycleLetter(letter) {
    // Build candidate list: available (not used) pool words starting with letter
    const candidates = [];
    reorderPool.forEach((word, idx) => {
        if (reorderAnswer.some(a => a.idx === idx)) return; // already placed
        const clean = word.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (clean.startsWith(letter)) candidates.push(idx);
    });

    if (candidates.length === 0) {
        _reorderClearHighlight();
        return;
    }

    // If same letter as before → advance cycle; otherwise start fresh
    if (letter === _reorderKeyLetter) {
        _reorderKeyCyclePos = (_reorderKeyCyclePos + 1) % candidates.length;
    } else {
        _reorderKeyLetter     = letter;
        _reorderKeyCandidates = candidates;
        _reorderKeyCyclePos   = 0;
    }
    _reorderKeyCandidates = candidates; // refresh (pool may have changed)

    const targetIdx = candidates[_reorderKeyCyclePos];
    _reorderKeyHighlightIdx = targetIdx;

    // Apply highlight to DOM
    document.querySelectorAll('#reorder-word-pool .reorder-word').forEach(el => {
        const elIdx = parseInt(el.dataset.idx, 10);
        el.classList.toggle('is-key-highlight', elIdx === targetIdx);
        if (elIdx === targetIdx) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
}

function _reorderSelectHighlighted() {
    if (_reorderKeyHighlightIdx === null) return;
    const idx  = _reorderKeyHighlightIdx;
    const word = reorderPool[idx];
    if (!word) return;
    if (reorderAnswer.some(a => a.idx === idx)) return; // already placed

    reorderAnswer.push({ word, idx });
    _reorderClearHighlight();
    renderReorderPool();
    renderReorderAnswer();
}

document.addEventListener('keydown', (e) => {
    const reorderArea = document.getElementById('quiz-reorder-area');
    if (!reorderArea || reorderArea.classList.contains('is-hidden')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
        e.preventDefault();
        const playBtn = document.getElementById('reorder-play-btn');
        if (playBtn && !playBtn.disabled && !playBtn.classList.contains('is-hidden')) {
            playBtn.click();
        }
    } else if (e.code === 'Escape') {
        e.preventDefault();
        _reorderClearHighlight();
    } else if (e.code === 'Enter') {
        e.preventDefault();
        if (reorderChecked) {
            document.getElementById('reorder-check-btn').click();
            return;
        }
        if (_reorderKeyHighlightIdx !== null) {
            _reorderSelectHighlighted();
        } else {
            const checkBtn = document.getElementById('reorder-check-btn');
            if (checkBtn && !checkBtn.disabled) checkBtn.click();
        }
    } else if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        if (reorderChecked) return;
        e.preventDefault();
        _reorderCycleLetter(e.key.toLowerCase());
    } else if (e.code === 'Backspace') {
        if (reorderChecked || reorderAnswer.length === 0) return;
        e.preventDefault();
        reorderAnswer.pop();
        _reorderClearHighlight();
        renderReorderPool();
        renderReorderAnswer();
    }
});

console.log('✅ Quiz system loaded.');

// ── Audio Editor Flag（編輯期間不計 replay）──────────────────
// 在 audio-editor.js 載入後，包裝 open/close 設定 flag
window.addEventListener('load', () => {
    if (typeof openAudioEditor === 'function') {
        const _origOpen = openAudioEditor;
        window.openAudioEditor = function(opts) {
            _quizIsEditingAudio = true;
            return _origOpen(opts);
        };
    }
    if (typeof closeAudioEditor === 'function') {
        const _origClose = closeAudioEditor;
        window.closeAudioEditor = function() {
            _quizIsEditingAudio = false;
            return _origClose();
        };
    }
});

// ══════════════════════════════════════════════════════════════
//  FLASHCARD+ MODE
//  正面填字 → 提交 → 翻牌看答案 → 下一題（在背面）
// ══════════════════════════════════════════════════════════════

// ── Subpanel & Start ─────────────────────────────────────────

document.getElementById('quiz-mode-fcplus').addEventListener('click', () => {
    const panel = document.getElementById('subpanel-fcplus');
    const card  = document.getElementById('quiz-mode-fcplus');
    const isOpen = !panel.classList.contains('is-hidden');
    closeAllSubpanels();
    if (!isOpen) {
        const items = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);
        const hasNote = items.words.length > 0 || items.phrases.length > 0;
        const preferred = hasNote ? 'note' : 'article';
        subpanelSource.fcplus = preferred;
        document.querySelectorAll('.quiz-source-btn[data-mode="fcplus"]').forEach(b => {
            b.classList.toggle('is-active', b.dataset.source === preferred);
        });
        const noteOpts    = document.getElementById('fcplus-note-options');
        const articleOpts = document.getElementById('fcplus-article-options');
        if (preferred === 'note') {
            noteOpts?.classList.remove('is-hidden');
            articleOpts?.classList.add('is-hidden');
        } else {
            articleOpts?.classList.remove('is-hidden');
            noteOpts?.classList.add('is-hidden');
        }
        panel.classList.remove('is-hidden');
        card.classList.add('is-expanded');
    }
});

document.querySelectorAll('.quiz-source-btn[data-mode="fcplus"]').forEach(btn => {
    btn.addEventListener('click', () => {
        subpanelSource.fcplus = btn.dataset.source;
        document.querySelectorAll('.quiz-source-btn[data-mode="fcplus"]').forEach(b =>
            b.classList.toggle('is-active', b === btn)
        );
        const noteOpts    = document.getElementById('fcplus-note-options');
        const articleOpts = document.getElementById('fcplus-article-options');
        if (btn.dataset.source === 'note') {
            noteOpts?.classList.remove('is-hidden');
            articleOpts?.classList.add('is-hidden');
        } else {
            articleOpts?.classList.remove('is-hidden');
            noteOpts?.classList.add('is-hidden');
        }
    });
});

document.getElementById('start-fcplus-btn').addEventListener('click', () => {
    if (subpanelSource.fcplus === 'article') {
        startFcplusFromArticle();
    } else {
        startFcplus();
    }
});

// ── State ─────────────────────────────────────────────────────

let _fcplusSubmitted  = false; // 是否已提交答案
let _fcplusIsCorrect  = false; // 本題是否答對
let _fcplusFlipped    = false; // 是否已翻到背面
let _fcplusAfterFlip  = false; // 是否已翻回正面（查看結果）
let _fcplusItem       = null;  // 當前題目 item

// ── Start from Note ───────────────────────────────────────────

function startFcplus() {
    const items = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);
    let allItems = [
        ...items.words.map(w => ({ text: w, type: 'word' })),
        ...items.phrases.map(p => ({ text: p, type: 'phrase' }))
    ].filter(i => {
        // 排除 1 個字母以下、純標點、或含空格超過 1 段（phrase 整體判斷字母數）
        const clean = i.text.replace(/[^a-zA-Z]/g, '');
        return clean.length >= 2;
    }).filter(i => {
        // 額外排除純單字字母數少於 4 的（phrases 不過濾）
        if (i.type === 'phrase') return true;
        const letters = i.text.replace(/[^a-zA-Z]/g, '').length;
        return letters >= 4;
    });

    allItems = filterByWordDifficulty(allItems, quizState.difficulty);

    if (allItems.length === 0) {
        showNotification('No suitable words found. Add words to your note first.', 'warning');
        return;
    }

    quizState.mode        = 'fcplus';
    quizState.flashSource = 'note';
    quizState.deck        = weightedSample(allItems, quizState.questionCount || 10,
                                item => item.text, quizState.categoryName, quizState.titleName);
    quizState.deckIndex   = 0;
    quizState.correct     = 0;
    quizState.wrong       = 0;
    quizState.wrongItems  = [];

    closeAllSubpanels();
    showQuizSession('fcplus');
    showFcplusCard();
}

// ── Start from Article ────────────────────────────────────────

async function startFcplusFromArticle() {
    const title = quizState.titleName;
    if (!title) {
        showNotification('Please select an article using the dropdowns above.', 'warning');
        return;
    }

    const tsData = await getTimestampForStory(title);

    const STOP = new Set(['that','this','with','have','from','they','been','were','when','what',
        'will','your','which','their','there','would','could','should','about','after','before',
        'other','some','than','then','also','into','more','over','just','like','very','well',
        'even','only','said','have','each','word']);

    const pool = [];
    if (tsData) {
        tsData.forEach(line => {
            const words = (line.sentence.match(/\b[a-zA-Z]{4,}\b/g) || [])
                .filter(w => !STOP.has(w.toLowerCase()));
            [...new Set(words.map(w => w.toLowerCase()))].forEach(w => {
                pool.push({ text: w, type: 'word', sentence: line.sentence.trim(),
                            start: line.start, end: line.end });
            });
        });
    }

    if (pool.length === 0) {
        showNotification('Could not extract words from this article.', 'warning');
        return;
    }

    const seen = new Set();
    let deck = shuffle(pool).filter(item => {
        if (seen.has(item.text)) return false;
        seen.add(item.text);
        return true;
    });
    deck = filterByWordDifficulty(deck, quizState.difficulty);
    deck = weightedSample(deck, quizState.questionCount || 10,
                          item => item.text, quizState.categoryName, title);

    if (deck.length === 0) {
        showNotification('No words found for selected difficulty.', 'warning');
        return;
    }

    const audioSrc = `audio/${encodeURIComponent(title.trim())}.mp3`;
    _setQuizAudioSrc(audioSrc);

    quizState.mode        = 'fcplus';
    quizState.flashSource = 'article';
    quizState.deck        = deck;
    quizState.deckIndex   = 0;
    quizState.correct     = 0;
    quizState.wrong       = 0;
    quizState.wrongItems  = [];

    closeAllSubpanels();
    showQuizSession('fcplus');
    showFcplusCard();
}

// ── Show Card ─────────────────────────────────────────────────

async function showFcplusCard() {
    _resetReplayCount();
    _fcplusSubmitted = false;
    _fcplusIsCorrect = false;
    _fcplusFlipped   = false;
    _fcplusAfterFlip = false;

    const deck = quizState.deck;
    if (quizState.deckIndex >= deck.length) {
        showQuizResult('fcplus', quizState.correct,
            quizState.correct + quizState.wrong, quizState.wrongItems);
        return;
    }

    const item = deck[quizState.deckIndex];
    _fcplusItem = item;
    updateProgress(quizState.deckIndex + 1, deck.length);

    // Reset card state
    const card = document.getElementById('fcplus-card');
    card.classList.remove('is-flipped', 'fcplus-flipped-back');
    _showFcplusFront();

    // Build letter inputs
    _buildFcplusLetters(item.text);

    // Sentence display
    const ctx = (quizState.flashSource === 'article' && item.sentence)
        ? item.sentence
        : findContextForWord(item.text.replace(/-/g, ' '),
            quizState.scope === 'this' ? quizState.titleName : null);

    const sentEl = document.getElementById('fcplus-sentence');
    if (ctx) {
        const blanked = ctx.replace(
            new RegExp(`\\b${item.text.replace(/-/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
            '_'.repeat(item.text.length)
        );
        sentEl.textContent = blanked;
    } else {
        sentEl.textContent = '';
    }

    // Back side context
    const ctxEl = document.getElementById('fcplus-context');
    if (ctx) {
        const highlighted = ctx.replace(
            new RegExp(`(${item.text.replace(/-/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
            '<mark class="fcplus-wrong-mark" id="fcplus-back-mark">$1</mark>'
        );
        ctxEl.innerHTML = highlighted;
    } else {
        ctxEl.textContent = item.text;
    }

    // Back audio
    const backAudioBtn      = document.getElementById('fcplus-back-audio-btn');
    const backEditContainer = document.getElementById('fcplus-back-edit-container');
    backAudioBtn.disabled = true;
    backAudioBtn.onclick  = null;
    if (backEditContainer) backEditContainer.innerHTML = '';

    const flashTitle = quizState.scope === 'this' ? quizState.titleName : null;
    if (flashTitle && ctx) {
        const audioSrc   = `audio/${encodeURIComponent(flashTitle.trim())}.mp3`;
        _setQuizAudioSrc(audioSrc);
        try {
            const tsData = await getTimestampForStory(flashTitle);
            if (tsData) {
                const norm  = t => t.trim().replace(/[.,?!'"`\u201c\u201d\u2018\u2019]/g, '').toLowerCase();
                const match = tsData.find(l => norm(l.sentence) === norm(ctx));
                if (match) {
                    const timing = (typeof getAdjustedTiming === 'function')
                        ? getAdjustedTiming(flashTitle, ctx, match.start, match.end)
                        : { start: match.start, end: match.end };

                    backAudioBtn.disabled = false;
                    backAudioBtn.onclick = () => {
                        playSnippet({
                            start: timing.start, end: timing.end,
                            onStart: () => backAudioBtn.classList.add('is-playing-voice'),
                            onEnd:   () => backAudioBtn.classList.remove('is-playing-voice')
                        });
                    };

                    if (backEditContainer && typeof createAudioEditBtn === 'function') {
                        const editBtn = createAudioEditBtn({
                            title: flashTitle, sentence: ctx,
                            start: match.start, end: match.end,
                            audioSrc, player: quizAudioPlayer,
                            onSave: (ns, ne) => { timing.start = ns; timing.end = ne; }
                        });
                        backEditContainer.appendChild(editBtn);
                    }
                }
            }
        } catch (e) {}
    }

    // Front audio (word pronunciation)
    _setupFcplusFrontAudio(item);
}

// ── Build letter input boxes ──────────────────────────────────

function _buildFcplusLetters(word) {
    const container = document.getElementById('fcplus-letters');
    container.innerHTML = '';

    // Split into chars; hyphens are fixed display
    const chars = word.split('');

    chars.forEach((ch, i) => {
        if (ch === '-') {
            // Hyphen: fixed label
            const sep = document.createElement('span');
            sep.className = 'fcplus-hyphen';
            sep.textContent = '-';
            container.appendChild(sep);
        } else {
            const isFirst = (i === 0) || (chars[i-1] === '-' && i === chars.findIndex((c,j) => j >= i && c !== '-'));
            const isLast  = (i === chars.length - 1) || (chars[i+1] === '-' && i === [...chars].reverse().findIndex((c,j) => j >= chars.length - 1 - i && c !== '-') );

            // Recalculate first/last letter of each word segment
            // Simple: first letter if i===0 or chars[i-1]==='-'
            // Last letter if i===chars.length-1 or chars[i+1]==='-'
            const isSegFirst = i === 0 || chars[i - 1] === '-';
            const isSegLast  = i === chars.length - 1 || chars[i + 1] === '-';
            const isHint     = isSegFirst || isSegLast;

            // All letters are inputs; hint positions show semi-transparent placeholder
            const inp = document.createElement('input');
            inp.type      = 'text';
            inp.maxLength = 1;
            inp.className = isHint
                ? 'fcplus-letter-input fcplus-letter-hint-input'
                : 'fcplus-letter-input';
            inp.dataset.idx  = i;
            inp.dataset.char = ch.toLowerCase();
            if (isHint) inp.placeholder = ch.toLowerCase();
            inp.autocomplete   = 'off';
            inp.autocorrect    = 'off';
            inp.autocapitalize = 'off';
            inp.spellcheck     = false;

            inp.addEventListener('input', _fcplusHandleInput);
            inp.addEventListener('keydown', _fcplusHandleKeydown);
            container.appendChild(inp);
        }
    });

    _checkFcplusAllFilled();

    // Auto-focus the first input (which is the first hint input)
    const firstInput = container.querySelector('.fcplus-letter-input');
    if (firstInput) firstInput.focus();
}

function _getAllFcplusInputs() {
    return Array.from(document.getElementById('fcplus-letters').querySelectorAll('.fcplus-letter-input'));
}

function _fcplusHandleInput(e) {
    const inp   = e.currentTarget;
    const val   = inp.value.replace(/[^a-zA-Z]/g, '').slice(-1);
    inp.value   = val;
    if (val) {
        // Move to next input
        const inputs = _getAllFcplusInputs();
        const idx    = inputs.indexOf(inp);
        if (idx < inputs.length - 1) inputs[idx + 1].focus();
    }
    _checkFcplusAllFilled();
}

function _fcplusHandleKeydown(e) {
    if (e.key === 'Backspace') {
        const inp    = e.currentTarget;
        const inputs = _getAllFcplusInputs();
        const idx    = inputs.indexOf(inp);
        if (inp.value === '' && idx > 0) {
            inputs[idx - 1].value = '';
            inputs[idx - 1].focus();
            _checkFcplusAllFilled();
            e.preventDefault();
        }
    }
}

function _checkFcplusAllFilled() {
    const inputs  = _getAllFcplusInputs();
    const allFilled = inputs.length > 0 && inputs.every(i => i.value.trim() !== '');
    const submitBtn = document.getElementById('fcplus-submit-btn');
    submitBtn.classList.toggle('is-hidden', !allFilled);
}

// ── Front audio setup ─────────────────────────────────────────

function _setupFcplusFrontAudio(item) {
    const audioBtn = document.getElementById('fcplus-audio-btn');
    if (!audioBtn) return;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    function _playSpeech() {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(item.text);
        u.lang  = 'en-US';
        u.onend = () => audioBtn.classList.remove('is-playing-voice');
        audioBtn.classList.add('is-playing-voice');
        window.speechSynthesis.speak(u);
    }

    function _playWord() {
        if (!_fcplusSubmitted) _trackReplay(); // 提交後不計懲罰
        audioBtn.classList.add('is-playing-voice');
        const src  = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(item.text.trim())}.mp3`;
        const au   = new Audio(src);
        au.play().catch(() => { audioBtn.classList.remove('is-playing-voice'); _playSpeech(); });
        au.addEventListener('ended', () => audioBtn.classList.remove('is-playing-voice'), { once: true });
    }
    audioBtn.onclick = _playWord;

    // Also wire result-side audio btn
    const resultBtn = document.getElementById('fcplus-audio-btn-result');
    if (resultBtn) resultBtn.onclick = () => {
        // After submit, no penalty
        audioBtn.classList.add('is-playing-voice');
        const src  = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(item.text.trim())}.mp3`;
        const au   = new Audio(src);
        au.play().catch(_playSpeech);
        au.addEventListener('ended', () => audioBtn.classList.remove('is-playing-voice'), { once: true });
    };

    // Auto-play first time
    const autoAu = new Audio(
        `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(item.text.trim())}.mp3`
    );
    autoAu.play().then(() => {
        audioBtn.classList.add('is-playing-voice');
        autoAu.addEventListener('ended', () => audioBtn.classList.remove('is-playing-voice'), { once: true });
    }).catch(() => {
        if ('speechSynthesis' in window) {
            const u = new SpeechSynthesisUtterance(item.text);
            u.lang = 'en-US';
            window.speechSynthesis.speak(u);
        }
    });
}

// ── Submit ────────────────────────────────────────────────────

document.getElementById('fcplus-submit-btn').addEventListener('click', () => {
    if (_fcplusSubmitted) return;
    _fcplusSubmitted = true;

    const inputs = _getAllFcplusInputs();
    const word   = _fcplusItem.text;
    let   correct = true;

    inputs.forEach(inp => {
        const typed   = inp.value.toLowerCase();
        const expected = inp.dataset.char;
        if (typed !== expected) {
            correct = false;
            inp.classList.add('fcplus-letter-wrong');
        } else {
            inp.classList.add('fcplus-letter-correct');
        }
        inp.disabled = true;
    });

    _fcplusIsCorrect = correct;

    // Record score
    if (typeof recordItemResult === 'function') {
        const itemType = quizState.flashSource === 'article' ? 'articleWords' : 'noteWords';
        recordItemResult(quizState.categoryName, quizState.titleName,
            itemType, word, correct, _quizReplayCount, 'fcplus');
    }

    if (correct) {
        quizState.correct++;
    } else {
        quizState.wrong++;
        quizState.wrongItems.push(word);
        // Mark back-side word red
        const mark = document.getElementById('fcplus-back-mark');
        if (mark) mark.classList.add('fcplus-back-wrong');
    }

    // Hide submit, show flip hint
    document.getElementById('fcplus-submit-btn').classList.add('is-hidden');
    document.getElementById('fcplus-flip-hint').classList.remove('is-hidden');
});

// ── Card flip ─────────────────────────────────────────────────

document.getElementById('fcplus-card').addEventListener('click', (e) => {
    // 排除按鈕與輸入框
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.fcplus-result-next-btn')) return;
    if (!_fcplusSubmitted) return;

    const card = document.getElementById('fcplus-card');

    if (!_fcplusFlipped) {
        _fcplusFlipped = true;
        card.classList.add('fcplus-flipped-back');
        _showFcplusBack();
    } else if (!_fcplusAfterFlip) {
        _fcplusAfterFlip = true;
        card.classList.remove('fcplus-flipped-back');
        _showFcplusFrontResult();
        
        // 隱藏背面的 Next，避免重複
        const backNext = document.getElementById('fcplus-next-btn');
        if (backNext) backNext.style.display = 'none';
    }
    // 已在結果正面時不再翻卡
});

function _showFcplusFront() {
    document.querySelector('.fcplus-front').classList.remove('is-hidden');
    document.getElementById('fcplus-front-result').classList.add('is-hidden');
    document.querySelector('.fcplus-back').classList.add('is-hidden');
}

function _showFcplusBack() {
    document.querySelector('.fcplus-front').classList.add('is-hidden');
    document.getElementById('fcplus-front-result').classList.add('is-hidden');
    document.querySelector('.fcplus-back').classList.remove('is-hidden');
}

function _showFcplusFrontResult() {
    document.querySelector('.fcplus-front').classList.add('is-hidden');
    document.querySelector('.fcplus-back').classList.add('is-hidden');
    const resultEl = document.getElementById('fcplus-front-result');
    resultEl.classList.remove('is-hidden');

    // ==================== 原有重建結果顯示 ====================
    const word   = _fcplusItem.text;
    const inputs = _getAllFcplusInputs(); // still in DOM, disabled

    // Result letters row
    const resultLetters = document.getElementById('fcplus-result-letters');
    resultLetters.innerHTML = '';
    word.split('').forEach((ch, i) => {
        if (ch === '-') {
            const sep = document.createElement('span');
            sep.className   = 'fcplus-hyphen';
            sep.textContent = '-';
            resultLetters.appendChild(sep);
            return;
        }
        const isSegFirst = i === 0 || word[i - 1] === '-';
        const isSegLast  = i === word.length - 1 || word[i + 1] === '-';
        const isHint     = isSegFirst || isSegLast;

        const span = document.createElement('span');
        if (isHint) {
            span.className   = 'fcplus-letter-hint';
            span.textContent = ch.toLowerCase();
        } else {
            const inp = inputs.find(el => parseInt(el.dataset.idx) === i);
            const typed    = inp ? inp.value.toLowerCase() : '';
            const expected = ch.toLowerCase();
            span.className   = typed === expected
                ? 'fcplus-result-letter correct'
                : 'fcplus-result-letter wrong';
            span.textContent = typed || '_';
        }
        resultLetters.appendChild(span);
    });

    // Correct answer row
    const correctEl = document.getElementById('fcplus-correct-answer');
    correctEl.textContent = _fcplusIsCorrect ? '✓ Correct!' : `Answer: ${word}`;
    correctEl.className   = _fcplusIsCorrect
        ? 'fcplus-correct-answer is-correct'
        : 'fcplus-correct-answer is-wrong';

    // Sentence (same as front)
    const ctx = document.getElementById('fcplus-sentence').textContent;
    document.getElementById('fcplus-sentence-result').textContent = ctx;

    // ==================== 新增：結果正面「下一題」按鈕 ====================
    let nextBtn = document.getElementById('fcplus-result-next-btn');
    if (!nextBtn) {
        nextBtn = document.createElement('button');
        nextBtn.id = 'fcplus-result-next-btn';
        nextBtn.textContent = '下一題 →';
        nextBtn.className = 'quiz-next-btn fcplus-result-next-btn';
        resultEl.appendChild(nextBtn);
    }
    nextBtn.style.display = 'block';

    nextBtn.onclick = () => {
        quizState.deckIndex++;
        showFcplusCard();
    };
    // =================================================================
}

// ── Next button (on back) ─────────────────────────────────────

document.getElementById('fcplus-next-btn').addEventListener('click', () => {
    quizState.deckIndex++;
    showFcplusCard();
});

// ── Keyboard shortcuts for Flashcard+ ────────────────────────
document.addEventListener('keydown', (e) => {
    const fcArea = document.getElementById('quiz-fcplus-area');
    if (!fcArea || fcArea.classList.contains('is-hidden')) return;

    if (e.code === 'Space') {
        e.preventDefault();
        const backAudio   = document.getElementById('fcplus-back-audio-btn');
        const resultAudio = document.getElementById('fcplus-audio-btn-result');
        const frontAudio  = document.getElementById('fcplus-audio-btn');
        if (_fcplusFlipped && !_fcplusAfterFlip && backAudio && !backAudio.disabled) {
            backAudio.click();
        } else if (_fcplusAfterFlip && resultAudio) {
            resultAudio.click();
        } else if (frontAudio) {
            frontAudio.click();
        }
        return;
    }

    if (e.code === 'Backspace' && !_fcplusSubmitted) {
        if (document.activeElement && document.activeElement.classList.contains('fcplus-letter-input')) return;
        e.preventDefault();
        const inputs = _getAllFcplusInputs();
        for (let i = inputs.length - 1; i >= 0; i--) {
            if (inputs[i].value !== '') {
                inputs[i].value = '';
                inputs[i].focus();
                _checkFcplusAllFilled();
                break;
            }
        }
        return;
    }

    if (e.code === 'Enter') {
        e.preventDefault();
        if (!_fcplusSubmitted) {
            const submitBtn = document.getElementById('fcplus-submit-btn');
            if (submitBtn && !submitBtn.classList.contains('is-hidden')) submitBtn.click();
            return;
        }
        if (!_fcplusFlipped) { document.getElementById('fcplus-card').click(); return; }
        if (!_fcplusAfterFlip) { document.getElementById('fcplus-card').click(); return; }
        quizState.deckIndex++;
        showFcplusCard();
    }
});

console.log('✅ Flashcard+ loaded.');
