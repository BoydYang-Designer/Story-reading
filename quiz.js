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

// ── Entry Point ───────────────────────────────────────────────

function openQuiz(categoryName, titleName) {
    quizState.categoryName = categoryName;
    quizState.titleName    = titleName;
    quizState.scope        = 'this';
    quizState.mode         = null;

    quizTitleEl.textContent    = 'Quiz';
    quizSubtitleEl.textContent = titleName;

    renderQuizStatsBar(categoryName, titleName);

    // Reset scope buttons
    document.getElementById('quiz-scope-this').classList.add('is-active');
    document.getElementById('quiz-scope-all').classList.remove('is-active');

    // Show/hide dictation based on timestamp availability
    const dictCard = document.getElementById('quiz-mode-dictation');
    if (dictCard) {
        const items = getAllNoteItems('this', categoryName, titleName);
        dictCard.style.opacity = items.sentences.length > 0 ? '1' : '0.4';
        dictCard.dataset.disabled = items.sentences.length > 0 ? '' : 'true';
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

document.getElementById('quiz-mode-flashcard').addEventListener('click', () => {
    startFlashcard();
});

document.getElementById('quiz-mode-cloze').addEventListener('click', () => {
    startCloze();
});

document.getElementById('quiz-mode-dictation').addEventListener('click', () => {
    if (document.getElementById('quiz-mode-dictation').dataset.disabled === 'true') {
        showNotification('No sentences saved for this article yet.', 'warning');
        return;
    }
    startDictation();
});

// Article Quiz mode card
document.getElementById('quiz-mode-article').addEventListener('click', () => {
    const submenu = document.getElementById('article-quiz-submenu');
    const isHidden = submenu.classList.contains('is-hidden');
    submenu.classList.toggle('is-hidden', !isHidden);
    document.getElementById('quiz-mode-article').classList.toggle('is-active-mode', isHidden);
});

// Sub-mode buttons (Listen / Cloze)
document.querySelectorAll('[data-submode]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-submode]').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        quizState.articleSubMode = btn.dataset.submode;
    });
});

// Difficulty buttons
document.querySelectorAll('[data-diff]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-diff]').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        quizState.articleDifficulty = btn.dataset.diff;
    });
});

// Start Article Quiz
document.getElementById('article-quiz-start-btn').addEventListener('click', () => {
    startArticleQuiz();
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

    if (mode === 'flashcard')       flashcardArea.classList.remove('is-hidden');
    if (mode === 'cloze')           clozeArea.classList.remove('is-hidden');
    if (mode === 'dictation')       dictationArea.classList.remove('is-hidden');
    if (mode === 'article-listen')  document.getElementById('quiz-article-listen-area').classList.remove('is-hidden');
    if (mode === 'article-cloze')   document.getElementById('quiz-article-cloze-area').classList.remove('is-hidden');
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
                    const isMobile = isMobileDevice();
                    const bufStart = isMobile ? 0.3 : 0.1;
                    const bufEnd   = isMobile ? 0.4 : 0.05;

                    // Make sure audio src matches
                    const targetSrc = `audio/${encodeURIComponent(title.trim())}.mp3`;
                    if (!quizAudioPlayer.src.endsWith(encodeURIComponent(title.trim()) + '.mp3')) {
                        quizAudioPlayer.src = targetSrc;
                        quizAudioPlayer.load();
                    }

                    btn.textContent = '⏸';
                    quizAudioPlayer.currentTime = Math.max(0, start - bufStart);

                    const stopHandler = function() {
                        if (quizAudioPlayer.currentTime >= end + bufEnd) {
                            quizAudioPlayer.pause();
                            quizAudioPlayer.removeEventListener('timeupdate', stopHandler);
                            btn.textContent = '▶ Listen again';
                        }
                    };
                    quizAudioPlayer.addEventListener('timeupdate', stopHandler);
                    quizAudioPlayer.play().catch(() => {
                        quizAudioPlayer.removeEventListener('timeupdate', stopHandler);
                        btn.textContent = '▶ Listen again';
                    });

                    setTimeout(() => {
                        quizAudioPlayer.removeEventListener('timeupdate', stopHandler);
                        if (!quizAudioPlayer.paused) quizAudioPlayer.pause();
                        btn.textContent = '▶ Listen again';
                    }, (end - start + bufEnd) * 1000 + 300);
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
    else if (mode === 'article-listen' || mode === 'article-cloze') startArticleQuiz();
});

document.getElementById('quiz-retry-wrong-btn').addEventListener('click', () => {
    quizState.retryWrongOnly = true;
    const mode = quizState.mode;
    if (mode === 'cloze')                startClozeRetryWrong();
    else if (mode === 'dictation')       startDictationRetryWrong();
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
        showNotification('No words or phrases saved yet.', 'warning');
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

let dictationStopTimeout = null;

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
    playBtn.classList.add('is-playing-voice');

    const isMobile = isMobileDevice();
    const bufferStart = isMobile ? 0.3 : 0.1;
    const bufferEnd   = isMobile ? 0.4 : 0.05;

    quizAudioPlayer.currentTime = Math.max(0, q.start - bufferStart);

    const stopHandler = function () {
        if (quizAudioPlayer.currentTime >= q.end + bufferEnd) {
            quizAudioPlayer.pause();
            quizAudioPlayer.removeEventListener('timeupdate', stopHandler);
            playBtn.classList.remove('is-playing-voice');
        }
    };
    quizAudioPlayer.addEventListener('timeupdate', stopHandler);

    quizAudioPlayer.play().catch(e => {
        console.error('Dictation play failed:', e);
        playBtn.classList.remove('is-playing-voice');
        quizAudioPlayer.removeEventListener('timeupdate', stopHandler);
    });

    // Backup timeout
    const duration = (q.end - q.start + bufferEnd) * 1000;
    dictationStopTimeout = setTimeout(() => {
        if (!quizAudioPlayer.paused) {
            quizAudioPlayer.pause();
        }
        quizAudioPlayer.removeEventListener('timeupdate', stopHandler);
        playBtn.classList.remove('is-playing-voice');
        dictationStopTimeout = null;
    }, duration + 300);
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
        showNotification('No article selected.', 'error');
        return;
    }

    const tsData = await getTimestampForStory(title);
    if (!tsData || tsData.length === 0) {
        showNotification('Timestamp file not found for this article.', 'error');
        return;
    }

    // Filter by difficulty
    const diff = quizState.articleDifficulty;
    let pool = tsData.filter(l => l.sentence && l.sentence.trim().length > 3);

    if (diff !== 'mix') {
        pool = pool.filter(l => {
            const wc = l.sentence.trim().split(/\s+/).length;
            if (diff === 'easy')   return wc < 8;
            if (diff === 'medium') return wc >= 8 && wc <= 15;
            if (diff === 'hard')   return wc > 15;
        });
    }

    if (pool.length < 2) {
        showNotification(`Not enough ${diff} sentences in this article. Try Mix or another difficulty.`, 'warning');
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

    // Hide article submenu
    document.getElementById('article-quiz-submenu').classList.add('is-hidden');
    document.getElementById('quiz-mode-article').classList.remove('is-active-mode');

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

let articleStopTimeout = null;

function playArticleAudio(q, btn) {
    if (articleStopTimeout) {
        clearTimeout(articleStopTimeout);
        articleStopTimeout = null;
    }

    btn.classList.add('is-playing-voice');
    btn.querySelector('span').textContent = '⏸ Playing...';

    const isMobile = isMobileDevice();
    const bufStart = isMobile ? 0.3 : 0.1;
    const bufEnd   = isMobile ? 0.4 : 0.05;

    quizAudioPlayer.currentTime = Math.max(0, q.start - bufStart);

    const stopHandler = function() {
        if (quizAudioPlayer.currentTime >= q.end + bufEnd) {
            quizAudioPlayer.pause();
            quizAudioPlayer.removeEventListener('timeupdate', stopHandler);
            btn.classList.remove('is-playing-voice');
            btn.querySelector('span').textContent = '▶ Play Again';
        }
    };
    quizAudioPlayer.addEventListener('timeupdate', stopHandler);

    quizAudioPlayer.play().catch(() => {
        quizAudioPlayer.removeEventListener('timeupdate', stopHandler);
        btn.classList.remove('is-playing-voice');
        btn.querySelector('span').textContent = '▶ Play Sentence';
    });

    const duration = (q.end - q.start + bufEnd) * 1000;
    articleStopTimeout = setTimeout(() => {
        quizAudioPlayer.removeEventListener('timeupdate', stopHandler);
        if (!quizAudioPlayer.paused) quizAudioPlayer.pause();
        btn.classList.remove('is-playing-voice');
        btn.querySelector('span').textContent = '▶ Play Again';
        articleStopTimeout = null;
    }, duration + 300);
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

console.log('✅ Quiz system loaded.');
