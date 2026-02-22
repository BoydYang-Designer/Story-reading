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
    articleDifficulty: 'mix',  // 'easy' | 'medium' | 'hard' | 'mix'
};

let quizAudioPlayer = new Audio();

// ── Unified snippet player ────────────────────────────────────
// Plays a time-bounded segment of quizAudioPlayer.
// Uses setTimeout as primary stop mechanism (more reliable than timeupdate).
// onStart / onEnd are optional callbacks to update UI.
let _snippetStopTimer = null;
let _snippetTimeUpdateHandler = null;

function playSnippet({ start, end, onStart, onEnd }) {
    // Cancel any running snippet
    if (_snippetStopTimer) {
        clearTimeout(_snippetStopTimer);
        _snippetStopTimer = null;
    }
    if (_snippetTimeUpdateHandler) {
        quizAudioPlayer.removeEventListener('timeupdate', _snippetTimeUpdateHandler);
        _snippetTimeUpdateHandler = null;
    }
    quizAudioPlayer.pause();

    const isMobile = isMobileDevice();
    const bufStart = isMobile ? 0.25 : 0.1;
    const bufEnd   = isMobile ? 1.0  : 0.8;   // timeupdate backup threshold
    const trailMs  = isMobile ? 1000 : 800;    // setTimeout primary stop

    const seekTo  = Math.max(0, start - bufStart);
    const playMs  = (end - start) * 1000 + trailMs;

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

    // Backup: timeupdate — catches cases where seek lands slightly off
    _snippetTimeUpdateHandler = () => {
        if (quizAudioPlayer.currentTime >= end + bufEnd) stopAll();
    };
    quizAudioPlayer.addEventListener('timeupdate', _snippetTimeUpdateHandler);

    quizAudioPlayer.currentTime = seekTo;
    quizAudioPlayer.play().then(() => {
        // Primary: setTimeout based on calculated duration
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
const clozeArea         = document.getElementById('quiz-cloze-area');
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

    const modes = { flashcard: '🃏', cloze: '✏️', dictation: '🎧' };
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

// ── Story Picker (Select Dropdowns) ──────────────────────────

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
        document.getElementById('quiz-scope-this').classList.add('is-active');
        document.getElementById('quiz-scope-all').classList.remove('is-active');
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

function openQuiz(categoryName, titleName) {
    quizState.categoryName = categoryName;
    quizState.titleName    = titleName;
    quizState.scope        = 'this';
    quizState.mode         = null;

    quizTitleEl.textContent    = 'Quiz';
    quizSubtitleEl.textContent = titleName || '';

    renderQuizStatsBar(categoryName, titleName);

    // Reset scope buttons
    document.getElementById('quiz-scope-this').classList.add('is-active');
    document.getElementById('quiz-scope-all').classList.remove('is-active');

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
        // 在選單頁，← Back 回到 note-view
        showView(document.getElementById('note-view'));
    }
});

document.getElementById('quiz-scope-this').addEventListener('click', () => {
    quizState.scope = 'this';
    document.getElementById('quiz-scope-this').classList.add('is-active');
    document.getElementById('quiz-scope-all').classList.remove('is-active');
});

document.getElementById('quiz-scope-all').addEventListener('click', () => {
    quizState.scope = 'all';
    document.getElementById('quiz-scope-all').classList.add('is-active');
    document.getElementById('quiz-scope-this').classList.remove('is-active');
});

// ── Mode Card + Subpanel Logic ────────────────────────────────

// Track which subpanel source is selected per mode
const subpanelSource = { cloze: 'note', dictation: 'note', reorder: 'note' };

// Helper: close all subpanels and un-expand all cards
function closeAllSubpanels() {
    document.querySelectorAll('.quiz-subpanel').forEach(p => p.classList.add('is-hidden'));
    document.querySelectorAll('.quiz-mode-card').forEach(c => c.classList.remove('is-expanded'));
}

// Flashcard: no subpanel, start directly
document.getElementById('quiz-mode-flashcard').addEventListener('click', () => {
    closeAllSubpanels();
    startFlashcard();
});

// Fill in Blank: toggle subpanel
document.getElementById('quiz-mode-cloze').addEventListener('click', () => {
    const panel = document.getElementById('subpanel-cloze');
    const card  = document.getElementById('quiz-mode-cloze');
    const isOpen = !panel.classList.contains('is-hidden');
    closeAllSubpanels();
    if (!isOpen) {
        panel.classList.remove('is-hidden');
        card.classList.add('is-expanded');
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
        // Highlight active source button within this subpanel
        document.querySelectorAll(`.quiz-source-btn[data-mode="${mode}"]`)
            .forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        subpanelSource[mode] = source;
    });
});

// Start buttons inside subpanels
document.getElementById('start-cloze-btn').addEventListener('click', () => {
    if (subpanelSource.cloze === 'article') {
        quizState.articleSubMode = 'cloze';
        startArticleQuiz();
    } else {
        startCloze();
    }
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
    quizMenu.classList.remove('is-hidden');
    quizSession.classList.add('is-hidden');
    quizResult.classList.add('is-hidden');
    renderQuizStatsBar(quizState.categoryName, quizState.titleName);
});

// Go to quiz btn from note view
const goToQuizBtn = document.getElementById('go-to-quiz-btn');
if (goToQuizBtn) {
    goToQuizBtn.addEventListener('click', () => {
        openQuiz(noteViewCategory, noteViewTitle);
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
    clozeArea.classList.add('is-hidden');
    dictationArea.classList.add('is-hidden');
    document.getElementById('quiz-article-listen-area').classList.add('is-hidden');
    document.getElementById('quiz-article-cloze-area').classList.add('is-hidden');
    document.getElementById('quiz-reorder-area').classList.add('is-hidden');

    if (mode === 'flashcard')       flashcardArea.classList.remove('is-hidden');
    if (mode === 'cloze')           clozeArea.classList.remove('is-hidden');
    if (mode === 'dictation')       dictationArea.classList.remove('is-hidden');
    if (mode === 'article-listen')  document.getElementById('quiz-article-listen-area').classList.remove('is-hidden');
    if (mode === 'article-cloze')   document.getElementById('quiz-article-cloze-area').classList.remove('is-hidden');
    if (mode === 'reorder')         document.getElementById('quiz-reorder-area').classList.remove('is-hidden');
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
                    ` : ''}
                    <div class="quiz-review-correct-ans">${item.correct}</div>
                    ${(item.start != null) ? `
                        <button class="quiz-review-play-btn" data-start="${item.start}" data-end="${item.end}" data-title="${item.title}">▶ Listen again</button>
                    ` : (mode !== 'cloze' ? '' : `
                        <button class="quiz-review-play-btn quiz-review-play-word" data-word="${item.correct}">▶ Pronounce</button>
                    `)}
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
                    if (!quizAudioPlayer.src.endsWith(encodeURIComponent(title.trim()) + '.mp3')) {
                        quizAudioPlayer.src = targetSrc;
                        quizAudioPlayer.load();
                    }

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
    else if (mode === 'cloze')       startCloze();
    else if (mode === 'dictation')   startDictation();
    else if (mode === 'reorder')     startReorder(subpanelSource.reorder || 'note');
    else if (mode === 'article-listen' || mode === 'article-cloze') startArticleQuiz();
});

document.getElementById('quiz-retry-wrong-btn').addEventListener('click', () => {
    quizState.retryWrongOnly = true;
    const mode = quizState.mode;
    if (mode === 'cloze')                startClozeRetryWrong();
    else if (mode === 'dictation')       startDictationRetryWrong();
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

function startFlashcard() {
    const items = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);
    const allItems = [
        ...items.words.map(w => ({ text: w, type: 'word' })),
        ...items.phrases.map(p => ({ text: p, type: 'phrase' }))
    ];

    if (allItems.length === 0) {
        if (!quizState.titleName && quizState.scope === 'this') {
            showNotification('Select an article first, or switch to "All Notes".', 'warning');
        } else {
            showNotification('No words or phrases saved yet.', 'warning');
        }
        return;
    }

    quizState.mode      = 'flashcard';
    quizState.deck      = shuffle(allItems);
    quizState.deckIndex = 0;
    quizState.againQueue = [];
    quizState.correct   = 0;
    quizState.wrong     = 0;
    quizState.wrongItems = [];

    showQuizSession('flashcard');
    showFlashcard();
}

function buildFullDeck() {
    return [...quizState.deck, ...quizState.againQueue];
}

function showFlashcard() {
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

    // Find context
    const contextEl = document.getElementById('flashcard-context');
    const ctx = findContextForWord(
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

    // Audio button
    const audioBtn = document.getElementById('flashcard-audio-btn');
    audioBtn.onclick = () => {
        const src = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(item.text.trim())}.mp3`;
        quizAudioPlayer.src = src;
        quizAudioPlayer.play().catch(() => {
            if ('speechSynthesis' in window) {
                const u = new SpeechSynthesisUtterance(item.text);
                u.lang = 'en-US';
                window.speechSynthesis.speak(u);
            }
        });
    };

    // Hide action buttons until flipped
    document.getElementById('flashcard-wrong').style.visibility = 'hidden';
    document.getElementById('flashcard-correct').style.visibility = 'hidden';
}

// Flip card on tap
document.getElementById('flashcard').addEventListener('click', () => {
    const card = document.getElementById('flashcard');
    card.classList.toggle('is-flipped');
    if (card.classList.contains('is-flipped')) {
        document.getElementById('flashcard-wrong').style.visibility = 'visible';
        document.getElementById('flashcard-correct').style.visibility = 'visible';
    }
});

document.getElementById('flashcard-correct').addEventListener('click', () => {
    quizState.correct++;
    quizState.deckIndex++;
    showFlashcard();
});

document.getElementById('flashcard-wrong').addEventListener('click', () => {
    const item = quizState.deck[quizState.deckIndex];
    quizState.wrong++;
    quizState.wrongItems.push(item.text);
    // Add to end of deck to review again
    quizState.deck.push(item);
    quizState.deckIndex++;
    showFlashcard();
});

// ══════════════════════════════════════════════════════════════
//  PHASE 2 — CLOZE (Fill in the Blank)
// ══════════════════════════════════════════════════════════════

function startCloze() {
    const items = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);
    const wordItems = [
        ...items.words.map(w => ({ text: w, type: 'word' })),
        ...items.phrases.map(p => ({ text: p, type: 'phrase' }))
    ];

    if (wordItems.length < 2) {
        showNotification('Need at least 2 words/phrases to start Cloze quiz.', 'warning');
        return;
    }

    // Build questions: find sentence context for each word
    const questions = [];
    for (const item of wordItems) {
        const ctx = findContextForWord(
            item.text.replace(/-/g, ' '),
            quizState.scope === 'this' ? quizState.titleName : null
        );
        if (ctx) {
            questions.push({ word: item.text, sentence: ctx });
        }
    }

    if (questions.length === 0) {
        showNotification('Could not find sentence contexts for your words. Make sure the article content is loaded.', 'warning');
        return;
    }

    quizState.mode        = 'cloze';
    quizState.questions   = shuffle(questions).slice(0, 10);
    quizState.currentIndex = 0;
    quizState.correct     = 0;
    quizState.wrong       = 0;
    quizState.wrongItems  = [];
    quizState.answeredQuestions = [];

    showQuizSession('cloze');
    showClozeQuestion();
}

function showClozeQuestion() {
    if (quizState.currentIndex >= quizState.questions.length) {
        showQuizResult('cloze', quizState.correct,
            quizState.questions.length, quizState.wrongItems);
        return;
    }

    const q = quizState.questions[quizState.currentIndex];
    updateProgress(quizState.currentIndex + 1, quizState.questions.length);

    // Build blanked sentence
    const displayWord = q.word.replace(/-/g, ' ');
    const blanked = q.sentence.replace(
        new RegExp(`(${displayWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
        '<span class="cloze-blank">_____</span>'
    );
    document.getElementById('cloze-sentence').innerHTML = blanked;

    // Build options: correct + 3 distractors from all words
    const allItems = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);
    const pool = [
        ...Array.from(allItems.words),
        ...Array.from(allItems.phrases)
    ].filter(w => w !== q.word);

    const distractors = shuffle(pool).slice(0, 3);
    const options = shuffle([q.word, ...distractors]);

    const optionsEl = document.getElementById('cloze-options');
    optionsEl.innerHTML = '';
    document.getElementById('cloze-feedback').textContent = '';
    document.getElementById('cloze-next').classList.add('is-hidden');

    options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'quiz-option-btn';
        btn.textContent = opt.replace(/-/g, ' ');
        btn.addEventListener('click', () => handleClozeAnswer(opt, q.word, btn));
        optionsEl.appendChild(btn);
    });
}

function handleClozeAnswer(selected, correct, btn) {
    // Disable all buttons
    document.querySelectorAll('#cloze-options .quiz-option-btn').forEach(b => {
        b.disabled = true;
        if (b.textContent === correct.replace(/-/g, ' ')) {
            b.classList.add('is-correct');
        }
    });

    const feedbackEl = document.getElementById('cloze-feedback');
    const isCorrect = selected === correct;

    if (isCorrect) {
        btn.classList.add('is-correct');
        feedbackEl.textContent = '✓ Correct!';
        feedbackEl.className = 'quiz-feedback correct';
        quizState.correct++;
    } else {
        btn.classList.add('is-wrong');
        feedbackEl.textContent = `✗ Answer: ${correct.replace(/-/g, ' ')}`;
        feedbackEl.className = 'quiz-feedback wrong';
        quizState.wrong++;
        quizState.wrongItems.push(correct);
    }

    // Record for review
    quizState.answeredQuestions.push({
        type: 'word',
        question: quizState.questions[quizState.currentIndex]?.sentence || '',
        selected: selected.replace(/-/g, ' '),
        correct: correct.replace(/-/g, ' '),
        isCorrect,
        start: null,
        end: null,
        title: null
    });

    document.getElementById('cloze-next').classList.remove('is-hidden');
}

document.getElementById('cloze-next').addEventListener('click', () => {
    quizState.currentIndex++;
    showClozeQuestion();
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

    quizState.mode        = 'dictation';
    quizState.questions   = shuffle(questions).slice(0, 10);
    quizState.currentIndex = 0;
    quizState.correct     = 0;
    quizState.wrong       = 0;
    quizState.wrongItems  = [];
    quizState.answeredQuestions = [];

    // Preload audio
    if (title) {
        quizAudioPlayer.src = `audio/${encodeURIComponent(title.trim())}.mp3`;
        quizAudioPlayer.preload = 'auto';
        quizAudioPlayer.load();
    }

    showQuizSession('dictation');
    showDictationQuestion();
}

// (removed — using playSnippet)

function showDictationQuestion() {
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
    if (!q.start) return;
    const playBtn = document.getElementById('dictation-play-btn');
    playSnippet({
        start: q.start, end: q.end,
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

    // All sentences, no difficulty filter
    const pool = tsData.filter(l => l.sentence && l.sentence.trim().length > 3);

    if (pool.length < 2) {
        showNotification('Not enough sentences in this article.', 'warning');
        return;
    }

    // Pick up to 10 questions
    const selected = shuffle(pool).slice(0, 10);
    const questions = selected.map(l => ({
        sentence: l.sentence.trim(),
        start: l.start,
        end: l.end,
        title,
        wordCount: l.sentence.trim().split(/\s+/).length,
    }));

    const subMode = quizState.articleSubMode;
    quizState.mode           = subMode === 'listen' ? 'article-listen' : 'article-cloze';
    quizState.questions      = questions;
    quizState.currentIndex   = 0;
    quizState.correct        = 0;
    quizState.wrong          = 0;
    quizState.wrongItems     = [];
    quizState.answeredQuestions = [];

    // Preload audio
    quizAudioPlayer.src = `audio/${encodeURIComponent(title.trim())}.mp3`;
    quizAudioPlayer.preload = 'auto';
    quizAudioPlayer.load();

    // Close subpanels
    closeAllSubpanels();

    showQuizSession(quizState.mode);

    if (subMode === 'listen') showArticleListenQuestion();
    else showArticleClozeQuestion();
}

// ── Article Listen & Choose ───────────────────────────────────

function showArticleListenQuestion() {
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
    playSnippet({
        start: q.start, end: q.end,
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
}

document.getElementById('article-listen-next').addEventListener('click', () => {
    quizState.currentIndex++;
    showArticleListenQuestion();
});

// ── Article Fill in Blank ─────────────────────────────────────

function showArticleClozeQuestion() {
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

    // Play button
    const clozePlayBtn = document.getElementById('article-cloze-play-btn');
    clozePlayBtn.classList.remove('is-playing-voice');
    clozePlayBtn.querySelector('span').textContent = '▶ Listen to Sentence';
    clozePlayBtn.onclick = () => playArticleAudio(q, clozePlayBtn);

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

function startClozeRetryWrong() {
    const wrongQs = quizState.answeredQuestions.filter(q => !q.isCorrect);
    if (wrongQs.length === 0) return;

    // Rebuild questions from wrong answers
    const questions = wrongQs.map(q => ({
        word: q.correct,
        sentence: q.question
    }));

    quizState.questions   = shuffle(questions);
    quizState.currentIndex = 0;
    quizState.correct     = 0;
    quizState.wrong       = 0;
    quizState.wrongItems  = [];
    quizState.answeredQuestions = [];

    showQuizSession('cloze');
    showClozeQuestion();
}

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
        const pool = shuffle(
            tsData.filter(l => l.sentence && l.sentence.trim().split(/\s+/).length >= 4)
        ).slice(0, 10);
        sentences = pool.map(l => ({
            sentence: l.sentence.trim(),
            start: l.start,
            end: l.end,
            title
        }));

        // Preload audio
        quizAudioPlayer.src = `audio/${encodeURIComponent(title.trim())}.mp3`;
        quizAudioPlayer.preload = 'auto';
        quizAudioPlayer.load();
    } else {
        // From Note — 用 titleName 抓 timestamp，比對句子找 start/end
        const title = quizState.titleName;
        const items = getAllNoteItems(quizState.scope, quizState.categoryName, title);
        const raw = shuffle(
            Array.from(items.sentences || [])
                .filter(s => s.trim().split(/\s+/).length >= 4)
        ).slice(0, 10);

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
            quizAudioPlayer.src = `audio/${encodeURIComponent(title.trim())}.mp3`;
            quizAudioPlayer.preload = 'auto';
            quizAudioPlayer.load();
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

    // Reset UI
    const answerArea = document.getElementById('reorder-answer-area');
    const feedback   = document.getElementById('reorder-feedback');
    const nextBtn    = document.getElementById('reorder-next');

    answerArea.className = 'reorder-answer-area';
    feedback.textContent = '';
    feedback.className   = 'quiz-feedback';
    nextBtn.classList.add('is-hidden');
    document.getElementById('reorder-check-btn').disabled = false;
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
    const playBtn = document.getElementById('reorder-play-btn');
    playSnippet({
        start: q.start, end: q.end,
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

function renderReorderPool() {
    const wordPool = document.getElementById('reorder-word-pool');
    wordPool.innerHTML = '';
    reorderPool.forEach((word, idx) => {
        const btn = document.createElement('button');
        btn.className = 'reorder-word' + (reorderAnswer.some(a => a.idx === idx) ? ' is-used' : '');
        btn.textContent = word;
        btn.dataset.idx = idx;
        btn.addEventListener('click', () => {
            if (reorderChecked) return;
            if (reorderAnswer.some(a => a.idx === idx)) return;
            reorderAnswer.push({ word, idx });
            renderReorderPool();
            renderReorderAnswer();
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
        btn.addEventListener('click', () => {
            if (reorderChecked) return;
            reorderAnswer.splice(pos, 1);
            renderReorderPool();
            renderReorderAnswer();
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
    if (reorderChecked) return;

    const q = quizState.questions[quizState.currentIndex];
    const tokens = tokenize(q.sentence);

    if (reorderAnswer.length < tokens.length) {
        showNotification('Place all words before checking!', 'warning');
        return;
    }

    reorderChecked = true;
    document.getElementById('reorder-check-btn').disabled = true;
    document.getElementById('reorder-clear-btn').disabled  = true;

    const userStr    = normalizeForCheck(reorderAnswer.map(a => a.word));
    const correctStr = normalizeForCheck(tokens);
    const isCorrect  = userStr === correctStr;

    const answerArea = document.getElementById('reorder-answer-area');
    const feedback   = document.getElementById('reorder-feedback');
    const nextBtn    = document.getElementById('reorder-next');

    if (isCorrect) {
        answerArea.classList.add('is-correct');
        feedback.textContent = '✓ Correct!';
        feedback.className   = 'quiz-feedback correct';
        quizState.correct++;
    } else {
        answerArea.classList.add('is-wrong');
        feedback.innerHTML = `✗ Correct order: <em>${q.sentence}</em>`;
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

    nextBtn.classList.remove('is-hidden');
});

document.getElementById('reorder-next').addEventListener('click', () => {
    quizState.currentIndex++;
    showReorderQuestion();
});

console.log('✅ Quiz system loaded.');
