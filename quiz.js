// ============================================================
//  QUIZ SYSTEM — quiz.js
//  Phase 1: Flashcard | Phase 2: Cloze | Phase 3: Dictation
//  Phase 4: Score Records
// ============================================================

// 統一的句子正規化函式（與 scores-dashboard.js 共用，解決 Voice Reorder key 不一致問題）
// 若 scores-dashboard.js 已定義則使用其版本，否則使用本地版本
if (typeof normSentence === 'undefined') {
    var normSentence = function(t) {
        return t.trim()
                .replace(/[.,?!'"`“”‘’;:（）【】「」]/g, '')
                .toLowerCase();
    };
}


const QUIZ_SCORES_KEY = 'readingChallengeQuizScores';
// TTS_PREF_KEY 已移除：發音改為兩層自動降級（GitHub MP3 → Web Speech）

// ── 上次測驗記錄（Book / Chapter 自動預選）──────────────────────────────────
const QUIZ_LAST_SESSION_KEY = 'readingChallengeQuizLastSession';

/**
 * 儲存上次測驗的 book / chapter 選擇
 * @param {string} major      大類
 * @param {string} category   分類
 * @param {string} title      文章標題
 */
function _saveQuizLastSession(major, category, title) {
    if (!major || !category || !title) return;
    const payload = { major, category, title, savedAt: Date.now() };
    try {
        localStorage.setItem(QUIZ_LAST_SESSION_KEY, JSON.stringify(payload));
    } catch (e) {}
    // 若已登入，同步寫入 Firestore（跨裝置 / 跨登入同步）
    try {
        if (typeof currentUser !== 'undefined' && currentUser &&
            typeof db !== 'undefined' && db) {
            db.collection('userNotes').doc(currentUser.uid)
              .set({ quizLastSession: payload }, { merge: true })
              .catch(err => console.warn('[Quiz] Firestore quizLastSession save error:', err));
        }
    } catch (e) {}
}

/**
 * 讀取上次測驗的 book / chapter 選擇
 * @returns {{ major:string, category:string, title:string } | null}
 */
function _loadQuizLastSession() {
    try {
        const raw = localStorage.getItem(QUIZ_LAST_SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

// ── 共用發音系統（兩層降級）─────────────────────────────────────────────────
// 層級一：GitHub audio_files MP3（自有字典，最快最穩）
// 層級二：Web Speech API（瀏覽器合成語音，最後保底）
// ─────────────────────────────────────────────────────────────────────────────

// ── AudioContext 全域解鎖（iOS Chrome 必要）────────────────────────────────
// 第一次用戶觸碰時預先建立並 resume AudioContext，確保後續所有播放都能正常運作。
// 同時解鎖 WebAudioEngine（背面句子音訊）與 _quizAudioCtx（單字音訊）。
// 此監聽器只執行一次，執行後自動移除。
(function _installAudioCtxUnlocker() {
    const _unlock = () => {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        // 解鎖 quiz 單字發音用的 AudioContext
        if (!window._quizAudioCtx || window._quizAudioCtx.state === 'closed') {
            window._quizAudioCtx = new AC();
        }
        if (window._quizAudioCtx.state === 'suspended') {
            window._quizAudioCtx.resume().catch(() => {});
        }
        // 解鎖 WebAudioEngine（背面句子/Article 音訊）的 AudioContext
        if (typeof WebAudioEngine !== 'undefined' && WebAudioEngine.isSupported()) {
            WebAudioEngine.unlock();
        }
        document.removeEventListener('touchstart', _unlock, true);
        document.removeEventListener('touchend',   _unlock, true);
        document.removeEventListener('click',      _unlock, true);
    };
    document.addEventListener('touchstart', _unlock, true);
    document.addEventListener('touchend',   _unlock, true);
    document.addEventListener('click',      _unlock, true);
})();

// ── 頁面重新可見時自動 resume AudioContext（切換 app/分頁再回來的修復）────────
// 瀏覽器在頁面進入背景時會自動 suspend AudioContext，
// 導致回到頁面後音量極小或無聲。每次 visible 時主動 resume。
// 同時顯示 Toast 讓使用者知道音訊恢復狀態，避免困惑。
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;

    // 只在測驗進行中才顯示 toast（避免干擾閱讀頁）
    const _quizSessionEl = document.getElementById('quiz-session');
    const isInQuiz = _quizSessionEl && !_quizSessionEl.classList.contains('is-hidden');

    if (isInQuiz) _showResumeToast('resuming');

    const resumePromises = [];

    // resume _quizAudioCtx
    if (window._quizAudioCtx && window._quizAudioCtx.state === 'suspended') {
        resumePromises.push(window._quizAudioCtx.resume().catch(() => {}));
    }
    // resume WebAudioEngine 的 AudioContext（若有暴露 unlock/resume 介面）
    if (typeof WebAudioEngine !== 'undefined' && WebAudioEngine.isSupported()) {
        if (typeof WebAudioEngine.resume === 'function') {
            resumePromises.push(WebAudioEngine.resume().catch(() => {}));
        } else if (typeof WebAudioEngine.unlock === 'function') {
            WebAudioEngine.unlock();
        }
    }

    // 全部 resume 完成後顯示「已就緒」
    if (isInQuiz) {
        Promise.all(resumePromises).then(() => {
            _showResumeToast('ready');
        });
    }
});

// ── 返回提示 Toast ────────────────────────────────────────────────────────────
// 切換 app 再回來時，短暫顯示音訊恢復狀態，讓使用者清楚目前狀況。
// 「恢復中」橘色條可點擊，手動觸發 iOS AudioContext unlock（手勢內解鎖）。
let _resumeToastEl    = null;
let _resumeToastTimer = null;

function _showResumeToast(state) {
    // 建立元素（只建一次，之後重複使用）
    if (!_resumeToastEl) {
        _resumeToastEl = document.createElement('div');
        _resumeToastEl.id = 'quiz-resume-toast';
        Object.assign(_resumeToastEl.style, {
            position:      'fixed',
            bottom:        '88px',
            left:          '50%',
            transform:     'translateX(-50%)',
            padding:       '9px 20px',
            borderRadius:  '22px',
            fontSize:      '0.88rem',
            fontWeight:    '600',
            zIndex:        '2000',
            opacity:       '0',
            transition:    'opacity 0.2s ease',
            whiteSpace:    'nowrap',
            boxShadow:     '0 2px 10px rgba(0,0,0,0.18)',
            cursor:        'pointer',
            userSelect:    'none',
        });

        // 點擊 toast → 在使用者手勢內強制 unlock（iOS Chrome 必要）
        _resumeToastEl.addEventListener('click', () => {
            if (window._quizAudioCtx) {
                window._quizAudioCtx.resume().catch(() => {});
            }
            if (typeof WebAudioEngine !== 'undefined' && WebAudioEngine.isSupported()) {
                if (typeof WebAudioEngine.resume === 'function') {
                    WebAudioEngine.resume().catch(() => {});
                } else if (typeof WebAudioEngine.unlock === 'function') {
                    WebAudioEngine.unlock();
                }
            }
            // 顯示點擊成功回饋
            _resumeToastEl.textContent = '🔊 已解鎖，可繼續作答';
            _resumeToastEl.style.background = '#e8f5e9';
            _resumeToastEl.style.color      = '#2e7d32';
            _resumeToastEl.style.border     = '1px solid #a5d6a7';
            clearTimeout(_resumeToastTimer);
            _resumeToastTimer = setTimeout(() => {
                _resumeToastEl.style.opacity = '0';
            }, 1500);
        });

        document.body.appendChild(_resumeToastEl);
    }

    clearTimeout(_resumeToastTimer);

    if (state === 'resuming') {
        // 恢復中：橘色，不自動消失，等 ready 才換（也可點擊手動解鎖）
        _resumeToastEl.textContent = '⏳ 音訊恢復中… 點我可手動解鎖';
        _resumeToastEl.style.background = '#fff3e0';
        _resumeToastEl.style.color      = '#e65100';
        _resumeToastEl.style.border     = '1px solid #ffcc80';
        _resumeToastEl.style.opacity    = '1';
    } else {
        // 就緒：綠色，1.8 秒後自動淡出
        _resumeToastEl.textContent = '✅ 音訊已就緒，繼續作答吧！';
        _resumeToastEl.style.background = '#e8f5e9';
        _resumeToastEl.style.color      = '#2e7d32';
        _resumeToastEl.style.border     = '1px solid #a5d6a7';
        _resumeToastEl.style.opacity    = '1';
        _resumeToastTimer = setTimeout(() => {
            _resumeToastEl.style.opacity = '0';
        }, 1800);
    }
}

// ════════════════════════════════════════════════════════════
//  SUCCESS SOUND — 答對音效（Web Audio API 合成，無需外部音檔）
// ════════════════════════════════════════════════════════════

/**
 * 播放答對音效（三音上升ding）
 * 使用 Web Audio API 合成，不需要外部音檔
 * @param {'correct'|'perfect'} type  correct=單題答對, perfect=全部答對
 */
function _playSuccessSound(type = 'correct') {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    // 優先用已解鎖的 _quizAudioCtx，若無則建立一個
    let ctx = window._quizAudioCtx;
    if (!ctx || ctx.state === 'closed') {
        try { ctx = new AC(); } catch (e) { return; }
    }
    if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
        console.warn('[Quiz Audio] AudioContext still suspended before play — user may not have interacted with the page yet (iOS limitation).');
    }

    // 音符序列：correct = 兩音，perfect = 三音
    const notes = type === 'perfect'
        ? [{ freq: 523.25, t: 0 }, { freq: 659.25, t: 0.12 }, { freq: 783.99, t: 0.24 }]   // C5 E5 G5
        : [{ freq: 659.25, t: 0 }, { freq: 783.99, t: 0.12 }];                               // E5 G5

    const now = ctx.currentTime;
    notes.forEach(({ freq, t }) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + t);
        gain.gain.setValueAtTime(0, now + t);
        gain.gain.linearRampToValueAtTime(0.22, now + t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.28);
        osc.start(now + t);
        osc.stop(now + t + 0.30);
    });
}

// ════════════════════════════════════════════════════════════
//  WRONG SOUND — 答錯音效（Web Audio API 合成，無需外部音檔）
// ════════════════════════════════════════════════════════════

/**
 * 播放答錯音效（低沉短促的 buzz）
 * 使用 Web Audio API 合成，不需要外部音檔
 */
function _playWrongSound() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    let ctx = window._quizAudioCtx;
    if (!ctx || ctx.state === 'closed') {
        try { ctx = new AC(); } catch (e) { return; }
    }
    if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
        console.warn('[Quiz Audio] AudioContext still suspended before play — user may not have interacted with the page yet (iOS limitation).');
    }

    const now = ctx.currentTime;

    // 低沉下降音（D4 → C4），輕微 vibrato 感
    const notes = [
        { freq: 293.66, t: 0 },    // D4
        { freq: 261.63, t: 0.10 }, // C4
    ];

    notes.forEach(({ freq, t }) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + t);
        gain.gain.setValueAtTime(0, now + t);
        gain.gain.linearRampToValueAtTime(0.18, now + t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.22);
        osc.start(now + t);
        osc.stop(now + t + 0.25);
    });
}

// ── 單字播放用 generation counter（防止舊的 async 呼叫搶佔新播放）──────────
let _quizPlayWordGen = 0;

/**
 * Quiz 共用單字發音函式（兩層降級）
 * @param {string} word               要播放的單字
 * @param {HTMLElement|null} btn      播放按鈕（可選），播放中加 is-playing-voice，結束後移除
 * @param {Function|null} onEnd       播放結束 callback（可選）
 */
async function _quizPlayWord(word, btn = null, onEnd = null) {
    const clean = word.trim().toLowerCase().replace(/^[.,?!:;'"]+|[.,?!:;'"]+$/g, '');
    if (!clean) { if (onEnd) onEnd(); return; }

    // 每次呼叫遞增 generation；若 async 過程中 generation 已改變，代表有新播放請求
    // 舊呼叫應靜默中止，避免雙重播放或按鈕狀態錯亂
    const myGen = ++_quizPlayWordGen;
    const isStale = () => myGen !== _quizPlayWordGen;

    // iOS Chrome Fix: 在手勢堆疊內同步建立並 resume AudioContext。
    // 若等到 await fetch() 之後才 resume，iOS 已離開手勢堆疊，resume 靜默失敗。
    const _AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (_AudioCtx) {
        if (!window._quizAudioCtx || window._quizAudioCtx.state === 'closed') {
            window._quizAudioCtx = new _AudioCtx();
        }
        if (window._quizAudioCtx.state === 'suspended') {
            window._quizAudioCtx.resume().catch(() => {});
        }
    }

    const BASE = 'https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/';

    // 層級三：Web Speech TTS（Chrome for iOS 有已知靜音 bug，作為最後保底）
    function _tts() {
        if (isStale()) return;
        if (!('speechSynthesis' in window)) { if (btn) btn.classList.remove('is-playing-voice'); if (onEnd) onEnd(); return; }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(clean);
        u.lang = 'en-US';
        u.rate = 0.9;
        u.onend = () => { if (btn) btn.classList.remove('is-playing-voice'); if (onEnd) onEnd(); };
        u.onerror = () => { if (btn) btn.classList.remove('is-playing-voice'); if (onEnd) onEnd(); };
        if (btn) btn.classList.add('is-playing-voice');
        window.speechSynthesis.speak(u);
        // Chrome for iOS: speechSynthesis 常靜音，偵測後移除按鈕狀態
        setTimeout(() => {
            if (btn && !window.speechSynthesis.speaking) {
                btn.classList.remove('is-playing-voice');
                if (onEnd) onEnd();
            }
        }, 600);
    }

    // 層級二：fetch → AudioContext decode（解決 Chrome iOS new Audio() 跨域靜音問題）
    async function _fetchAndPlay(src) {
        try {
            const resp = await fetch(src);
            if (!resp.ok) return false;
            if (isStale()) return true; // 已被新請求取代，靜默中止（回傳 true 阻止 TTS）
            const arrayBuf = await resp.arrayBuffer();
            if (isStale()) return true;
            // AudioContext 已在手勢堆疊內建立並 resume，這裡直接取用
            const ctx = window._quizAudioCtx;
            if (!ctx) return false;
            if (ctx.state === 'suspended') await ctx.resume();
            if (isStale()) return true;
            const decoded = await ctx.decodeAudioData(arrayBuf);
            if (isStale()) return true;
            // 停止上一個仍在播放的 source（若有）
            if (window._quizCurrentSource) {
                try { window._quizCurrentSource.stop(); } catch (_) {}
            }
            const source = ctx.createBufferSource();
            window._quizCurrentSource = source;
            source.buffer = decoded;
            source.connect(ctx.destination);
            if (btn) btn.classList.add('is-playing-voice');
            if (typeof showAudioSourceHint === 'function') showAudioSourceHint('mp3');
            source.start(0);
            source.onended = () => {
                if (window._quizCurrentSource === source) window._quizCurrentSource = null;
                if (btn) btn.classList.remove('is-playing-voice');
                if (onEnd) onEnd();
            };
            return true;
        } catch (e) {
            return false;
        }
    }

    // 層級一：GitHub MP3（大寫首字 / 小寫 兩候選）
    const capitalized = clean.charAt(0).toUpperCase() + clean.slice(1);
    const candidates = [...new Set([capitalized, clean])];

    for (const candidate of candidates) {
        if (isStale()) return; // 已被新請求取代
        const src = BASE + encodeURIComponent(candidate) + '.mp3';
        const ok = await _fetchAndPlay(src);
        if (ok) return;
    }

    // 所有 MP3 候選失敗 → TTS 保底
    if (isStale()) return;
    if (typeof showAudioSourceHint === 'function') showAudioSourceHint('tts');
    _tts();
}


// ── State ────────────────────────────────────────────────────
let quizState = {
    mode: null,          // 'flashcard' | 'cloze' | 'dictation' | 'article-listen' | 'article-cloze'
    scope: 'this',       // 固定為 'this'（All Notes 功能已移除）
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
    againCountMap: {},   // FC-01 FIX: tracks how many times each item has been re-queued
    // article quiz specific
    articleSubMode: 'listen',  // 'listen' | 'cloze'
    // difficulty & question count — shared across ALL modes
    difficulty: 'easy',        // 'easy' | 'medium' | 'hard' | 'mix' (legacy, kept for sentence/article modes)
    selectedCefrLevels: new Set(['a1a2', 'b1b2', 'c1c2']), // multi-select CEFR for Words & Phrases modes
    selectedDifficulties: new Set(['easy']), // multi-select for Dictation & Reorder — 預設只選 easy
    questionCount: 10,         // 5 | 10 (UI 支援的選項)
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

// ── 目前卡片的播放函式（供 Space 鍵直接呼叫，繞過按鈕 focus）──
// Flashcard
let _fcPlayWord = null;   // 正面：播單字
let _fcPlayBack = null;   // 背面：播句子
let _fcIsFlipped = false; // 是否已翻到背面（給非同步音訊設定用）
// Flashcard+
let _fcpPlayWord = null;  // 正面：播單字
let _fcpPlayBack = null;  // 背面：播句子
let _fcpIsFlipped = false; // 是否已翻到背面（給非同步音訊設定用）

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

function playSnippet({ start, end, onStart, onEnd, onLoading }) {
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
        const src = quizAudioPlayer._webaudio_src;
        if (!src) {
            console.warn('[Quiz] playSnippet: no audio src set');
            if (onEnd) onEnd();
            return;
        }

        // onLoading 在送出請求時立即呼叫（表示可能需要下載）
        // onStart  在音訊實際開始播放時才呼叫
        if (onLoading) onLoading();
        WebAudioEngine.playSnippet({
            src,
            start,
            end,
            onStart: onStart || undefined,
            onEnd:   onEnd   || undefined,
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

// ── 間隔重複參數設定（可依需求調整）────────────────────────────
const SR_CONFIG = {
    // 記憶底板：即使再久沒複習，有效熟悉度最多只降到這個值。
    // 代表「學過就是學過，不會完全忘記」。建議範圍：15–30。
    // 降低至 20（原 30）：避免剛學完的題因底板過高直接進桶 B 持續重複出題，
    // 給使用者一段時間鞏固後再複習。
    decayFloor: 20,

    // Voice Reorder 難度最高，底板再低一些（15），
    // 讓使用者需要真正熟練才能跳出桶 B。
    decayFloorVoiceReorder: 15,

    // 艾賓浩斯半衰期（天）：熟悉度越高記得越久
    halfLifeHigh: 30,   // 原始熟悉度 ≥ 70%
    halfLifeMid:  14,   // 原始熟悉度 40–69%
    halfLifeLow:   7,   // 原始熟悉度 < 40%

    // 已測驗題的桶加權（剩餘 5% 配額的分配比例）
    weightNeedWork: 0.70,   // 桶 B：有效熟悉度 < 40%
    weightOk:       0.20,   // 桶 C：有效熟悉度 40–69%
    weightFamiliar: 0.05,   // 桶 D：有效熟悉度 ≥ 70%

    // 未測驗題（桶 A）保證佔出題比例
    // 0.95 = 只要有未測驗題，95% 的題數保證從桶 A 取
    untestedFillRatio: 0.95,
};

/**
 * 計算題目的「有效熟悉度」（已考慮時間衰減，但有記憶底板）
 *
 * 衰減公式（帶底板）：
 *   effectiveFam = floor + (rawFam - floor) × 2^(-days / halfLife)
 *   → days=0 時：effectiveFam = rawFam（剛測完，完整保留）
 *   → days→∞ 時：effectiveFam → floor（最多衰減到底板，不再下降）
 *   → 學過的題永遠比未測驗（null）更優先
 *
 * @param {object} rec       - itemScores 中的題目紀錄
 * @param {string} itemType  - 'noteSentences' | 'articleSentences' | ...
 * @param {string} [quizSource] - 'voiceReorder' 時使用較低底板（15 vs 20）
 */
function calcEffectiveFamiliarity(rec, itemType, quizSource) {
    // 決定要看哪個 source
    // itemType 對應關係：
    //   noteWords / articleWords    → fcplus
    //   noteSentences               → reorder（預設）或 dictation
    //   articleSentences            → reorder（預設）或 dictation
    //   直接傳 quizSource 時優先使用 quizSource
    let sourceKey = quizSource;
    if (!sourceKey) {
        if (itemType === 'noteWords' || itemType === 'articleWords') {
            sourceKey = 'fcplus';
        } else {
            sourceKey = 'reorder';
        }
    }

    // 取得 per-source 記錄
    const srcRec = rec?.[sourceKey];
    if (!srcRec || (srcRec.correct + srcRec.wrong) === 0) {
        return { rawFam: null, effectiveFam: null, daysSince: Infinity };
    }

    const total  = srcRec.correct + srcRec.wrong;
    const rawFam = Math.round((srcRec.correct / total) * 100);

    // per-source lastSeen（新版），fallback 到 global lastSeen
    const lastSeenStr = srcRec.lastSeen || rec?.lastSeen || null;
    const days = lastSeenStr
        ? Math.floor((Date.now() - new Date(lastSeenStr).getTime()) / 86400000)
        : 0;

    // 艾賓浩斯半衰期
    let halfLife;
    if (rawFam >= 70)      halfLife = SR_CONFIG.halfLifeHigh;
    else if (rawFam >= 40) halfLife = SR_CONFIG.halfLifeMid;
    else                   halfLife = SR_CONFIG.halfLifeLow;

    // VR 使用較低底板（15），其餘 20
    const baseFloor = (sourceKey === 'voiceReorder')
        ? SR_CONFIG.decayFloorVoiceReorder
        : SR_CONFIG.decayFloor;

    const floor = Math.min(baseFloor, rawFam);
    const decayFactor = Math.pow(2, -days / halfLife);
    const effectiveFam = Math.round(floor + (rawFam - floor) * decayFactor);

    return { rawFam, effectiveFam, daysSince: days };
}

/**
 * 分桶優先抽題（間隔重複版，per-source 版）
 *
 * quizSource 決定查哪個 source 的記錄：
 *   flashcard/flashcard+ → 'fcplus'
 *   dictation            → 'dictation'
 *   reorder              → 'reorder'
 *   voiceReorder         → 'voiceReorder'
 *
 * 未測驗判斷：rec[quizSource] 無資料 → 桶 A
 */
function weightedSample(pool, n, keyFn, categoryName, titleName, itemType, quizSource) {
    if (!pool || pool.length === 0) return [];
    n = Math.min(n, pool.length);

    let itemScores = {};
    try { itemScores = JSON.parse(localStorage.getItem('readingChallengeItemScores') || '{}'); } catch (e) {}

    const storeKey    = `${categoryName}||${titleName}`;
    const typeDataMap = (itemScores[storeKey] && itemType)
        ? (itemScores[storeKey][itemType] || {})
        : {};

    // 決定 sourceKey（與 calcEffectiveFamiliarity 保持一致）
    let sourceKey = quizSource;
    if (!sourceKey) {
        sourceKey = (itemType === 'noteWords' || itemType === 'articleWords') ? 'fcplus' : 'reorder';
    }

    const bucketA = []; // 從未測驗（此 source 無資料）
    const bucketB = []; // 有效熟悉度 < 40%
    const bucketC = []; // 有效熟悉度 40–69%
    const bucketD = []; // 有效熟悉度 ≥ 70%

    const _isSentenceType = (itemType === 'noteSentences' || itemType === 'articleSentences');

    for (const item of pool) {
        const rawText = keyFn ? keyFn(item) : String(item);
        const text = _isSentenceType
            ? (typeof normSentence === 'function'
                ? normSentence(rawText)
                : rawText.trim().replace(/[.,?!'"`\u201c\u201d\u2018\u2019;:（）【】「」]/g, '').toLowerCase())
            : rawText;

        const rec = typeDataMap[text] || null;

        // 只看此 source 的記錄
        const srcRec = rec?.[sourceKey];
        const hasSrcData = !!(srcRec && (srcRec.correct + srcRec.wrong) > 0);

        if (!hasSrcData) {
            // 未測驗此 source → 桶 A
            bucketA.push(item);
        } else {
            const { effectiveFam } = calcEffectiveFamiliarity(rec, itemType, sourceKey);
            if (effectiveFam === null)   bucketA.push(item);
            else if (effectiveFam < 40)  bucketB.push(item);
            else if (effectiveFam < 70)  bucketC.push(item);
            else                         bucketD.push(item);
        }
    }

    const wantFromA = Math.min(bucketA.length, Math.ceil(n * SR_CONFIG.untestedFillRatio));
    const remaining = n - wantFromA;

    function weightedPickFromBuckets(buckets, weights, totalWant) {
        if (totalWant <= 0) return [];
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let allocs = weights.map(w => Math.round(totalWant * w / totalWeight));
        let diff = totalWant - allocs.reduce((a, b) => a + b, 0);
        for (let i = 0; diff !== 0; i = (i + 1) % allocs.length) {
            if (diff > 0 && allocs[i] < buckets[i].length) { allocs[i]++; diff--; }
            if (diff < 0 && allocs[i] > 0)                 { allocs[i]--; diff++; }
        }
        const result = [];
        for (let i = 0; i < buckets.length; i++) {
            result.push(...shuffle(buckets[i]).slice(0, Math.min(allocs[i], buckets[i].length)));
        }
        const shortage = totalWant - result.length;
        if (shortage > 0) {
            const extras = [];
            for (let i = 0; i < buckets.length; i++) {
                extras.push(...buckets[i].slice(Math.min(allocs[i], buckets[i].length)));
            }
            result.push(...shuffle(extras).slice(0, shortage));
        }
        return result;
    }

    const fromA   = shuffle(bucketA).slice(0, wantFromA);
    const fromBCD = weightedPickFromBuckets(
        [bucketB, bucketC, bucketD],
        [SR_CONFIG.weightNeedWork, SR_CONFIG.weightOk, SR_CONFIG.weightFamiliar],
        remaining
    );

    const total = [...fromA, ...fromBCD];
    if (total.length < n) {
        const used = new Set(total);
        total.push(...shuffle(pool.filter(item => !used.has(item))).slice(0, n - total.length));
    }

    return shuffle(total.slice(0, n));
}

function getNoteData(categoryName, titleName) {
    return savedWords[categoryName]?.[titleName] || {
        words: new Set(), phrases: new Set(), sentences: new Set()
    };
}

function getAllNoteItems(scope, categoryName, titleName) {
    const items = { words: [], phrases: [], sentences: [] };
    const data = getNoteData(categoryName, titleName);
    // 包含 noteTitle，方便 Flashcard 翻卡時查對應文章 mp3
    items.words     = Array.from(data.words     || []).map(w => typeof w === 'string' ? { text: w, noteTitle: titleName, noteCat: categoryName } : w);
    items.phrases   = Array.from(data.phrases   || []).map(p => typeof p === 'string' ? { text: p, noteTitle: titleName, noteCat: categoryName } : p);
    items.sentences = Array.from(data.sentences || []);
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

        // ── 記錄本次選擇（供下次進入 Quiz 自動預選）──────────
        const _stObjPick = stories.find(s => s['標題'] === title);
        const _majorPick = _stObjPick?.['大類'] || 'Uncategorized';
        _saveQuizLastSession(_majorPick, category, title);
    } else {
        quizState.titleName = null;
    }

    quizSubtitleEl.textContent = quizState.titleName || '';

    if (quizState.categoryName && quizState.titleName) {
        renderQuizStatsBar(quizState.categoryName, quizState.titleName);
    } else {
        quizStatsBar.innerHTML = '';
    }

    // FIX BUG-02：切換文章時清除舊的 tsDataCache，防止干擾選項跨文章污染
    if (quizState.titleName) {
        Object.keys(tsDataCache).forEach(k => {
            if (k !== quizState.titleName) delete tsDataCache[k];
        });
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
    // ── FIX: 自動預選後必須呼叫 pickerApplySelection，
    //         否則 quizState.titleName 仍為 null，導致無法開始測驗
    pickerApplySelection();
}

// ── 難易度說明：展開 / 收合 ──────────────────────────────────
(function _initDiffToggle() {
    const btn  = document.getElementById('quiz-diff-toggle');
    const body = document.getElementById('quiz-diff-body');
    if (!btn || !body) return;
    btn.addEventListener('click', () => {
        const isOpen = !body.classList.contains('is-hidden');
        body.classList.toggle('is-hidden', isOpen);
        btn.setAttribute('aria-expanded', String(!isOpen));
        btn.classList.toggle('is-open', !isOpen);
    });
})();

// ── 出題權重說明：展開 / 收合 ─────────────────────────────────
(function _initWeightToggle() {
    const btn  = document.getElementById('quiz-weight-toggle');
    const body = document.getElementById('quiz-weight-body');
    if (!btn || !body) return;
    btn.addEventListener('click', () => {
        const isOpen = !body.classList.contains('is-hidden');
        body.classList.toggle('is-hidden', isOpen);
        btn.setAttribute('aria-expanded', String(!isOpen));
        btn.classList.toggle('is-open', !isOpen);
    });
})();

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
        // Coming from home/note: try to restore last session, otherwise reset selects
        const _lastSess = _loadQuizLastSession();
        if (_lastSess && _lastSess.major && _lastSess.category && _lastSess.title) {
            const _storyExists = stories.find(s => s['標題'] === _lastSess.title);
            if (_storyExists) {
                pickerPreselect(_lastSess.major, _lastSess.category, _lastSess.title);
            } else {
                selMajor.value = '';
                selCategory.innerHTML = '<option value="">— Select Category —</option>';
                selArticle.innerHTML  = '<option value="">— Select Article —</option>';
                document.getElementById('quiz-picker-row-category').style.display = 'none';
                document.getElementById('quiz-picker-row-article').style.display  = 'none';
            }
        } else {
            selMajor.value = '';
            selCategory.innerHTML = '<option value="">— Select Category —</option>';
            selArticle.innerHTML  = '<option value="">— Select Article —</option>';
            document.getElementById('quiz-picker-row-category').style.display = 'none';
            document.getElementById('quiz-picker-row-article').style.display  = 'none';
        }
    }

    quizMenu.classList.remove('is-hidden');
    quizSession.classList.add('is-hidden');
    quizResult.classList.add('is-hidden');

    // Sync CEFR multi-select button states on open (default: all active)
    // _syncCefrButtons is defined after this function; safe to call since
    // openQuiz is only invoked via user interaction, after all JS has parsed.
    setTimeout(() => {
        _syncCefrButtons('flashcard');
        _syncCefrButtons('fcplus');
        // Sync sentence difficulty buttons (dictation / reorder / voice-reorder)
        // 預設 easy 已選，確保 UI 與 quizState.selectedDifficulties 同步
        _syncDiffButtons('dictation');
        _syncDiffButtons('reorder');
        _syncDiffButtons('voice-reorder');
    }, 0);

    showView(quizView);
}

// ── Event Listeners: Menu ─────────────────────────────────────

// Quiz Menu 頂部的「← Back」：依來源回到上一頁（note / scores / story / home）
document.getElementById('back-to-home-from-quiz-menu').addEventListener('click', () => {
    quizAudioPlayer.pause();
    if (quizState.source === 'note') {
        showView(document.getElementById('note-view'));
    } else if (quizState.source === 'scores') {
        if (quizState.categoryName && quizState.titleName) {
            if (typeof openDetailView === 'function') {
                openDetailView(quizState.categoryName, quizState.titleName);
            } else {
                showView(document.getElementById('scores-dashboard-view'));
            }
        } else {
            showView(document.getElementById('scores-dashboard-view'));
        }
    } else if (quizState.source === 'story') {
        showView(document.getElementById('playback-view'));
    } else {
        showView(document.getElementById('home-view'));
    }
});

// Quiz Session 進度列的「← Back」：永遠只回到 Quiz Menu
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
        // 已在選單頁（理論上不會觸發，因為選單頁用 back-to-home-from-quiz-menu）
        showView(document.getElementById('home-view'));
    }
});



// ── Mode Card + Subpanel Logic ────────────────────────────────

/**
 * 展開 subpanel 時的預設值設定
 * - source 預設 'article'
 * - 難度：CEFR 模式只選 a1a2；Diff 模式只選 easy
 * - 題數：預設 5 題
 */
function _applySubpanelDefaults(mode) {
    // ── Source: 預設 article ──────────────────────────────────
    subpanelSource[mode] = 'article';
    document.querySelectorAll(`.quiz-source-btn[data-mode="${mode}"]`).forEach(b => {
        b.classList.toggle('is-active', b.dataset.source === 'article');
    });
    const articleOpts = document.getElementById(`${mode}-article-options`);
    const noteOpts    = document.getElementById(`${mode}-note-options`);
    articleOpts?.classList.remove('is-hidden');
    noteOpts?.classList.add('is-hidden');

    // ── Difficulty ───────────────────────────────────────────
    if (_CEFR_MODES.has(mode)) {
        quizState.selectedCefrLevels = new Set(['a1a2']);
        _syncCefrButtons(mode);
    } else if (_DIFF_MODES.has(mode)) {
        quizState.selectedDifficulties = new Set(['easy']);
        quizState.difficulty = 'easy';
        _syncDiffButtons(mode);
    }

    // ── Question count: 預設 5 題 ────────────────────────────
    quizState.questionCount = 5;
    document.querySelectorAll(`.quiz-count-btn[data-mode="${mode}"]`).forEach(b => {
        b.classList.toggle('is-active', b.dataset.count === '5');
    });
}

// Track which subpanel source is selected per mode
const subpanelSource = { flashcard: 'note', dictation: 'note', reorder: 'note', fcplus: 'note', 'voice-reorder': 'note' };

// ── Fix #6: Quiz available question count preview ─────────────────────────────
function updateQuizAvailableCount(mode) {
    const counterId = `quiz-available-${mode}`;
    const container = document.getElementById(counterId);
    if (!container) return;
    const textEl = container.querySelector('.quiz-available-text');
    if (!textEl) return;

    const startBtnId = {
        'flashcard': 'start-flashcard-btn',
        'fcplus': 'start-fcplus-btn',
        'dictation': 'start-dictation-btn',
        'reorder': 'start-reorder-btn',
        'voice-reorder': 'start-voice-reorder-btn'
    }[mode];
    const startBtn = document.getElementById(startBtnId);

    // If source is 'article', questions come from the article itself — always available
    const currentSource = subpanelSource[mode] || 'note';
    if (currentSource === 'article') {
        textEl.textContent = '📖 Questions drawn from the selected article';
        textEl.className = 'quiz-available-text has-questions';
        if (startBtn) startBtn.disabled = false;
        return;
    }

    // Source is 'note' — check how many note items exist
    try {
        const items = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);
        let count = 0;
        if (mode === 'flashcard' || mode === 'fcplus') {
            count = (items.words || []).length + (items.phrases || []).length;
        } else if (mode === 'dictation' || mode === 'reorder' || mode === 'voice-reorder') {
            count = (items.sentences || []).length;
        }

        if (count === 0) {
            textEl.textContent = '📝 No questions yet — read an article and tap words to add to Note first';
            textEl.className = 'quiz-available-text no-questions';
            if (startBtn) startBtn.disabled = true;
        } else {
            textEl.textContent = `📝 ${count} question${count !== 1 ? 's' : ''} available from Note`;
            textEl.className = 'quiz-available-text has-questions';
            if (startBtn) startBtn.disabled = false;
        }
    } catch (e) {
        textEl.textContent = '';
        if (startBtn) startBtn.disabled = false;
    }
}

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
        _applySubpanelDefaults('flashcard');
        panel.classList.remove('is-hidden');
        card.classList.add('is-expanded');
        updateQuizAvailableCount('flashcard');
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
        _applySubpanelDefaults('dictation');
        panel.classList.remove('is-hidden');
        card.classList.add('is-expanded');
        updateQuizAvailableCount('dictation');
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

        // Update available count to reflect new source selection
        updateQuizAvailableCount(mode);
    });
});

// ── Difficulty / CEFR buttons ─────────────────────────────────
// • Flashcard & Flashcard+ modes  → multi-select CEFR (A1-A2 / B1-B2 / C1-C2)
//   Uses existing .quiz-diff-btn with data-diff="easy|medium|hard|mix"
//   Maps:  easy → a1a2 | medium → b1b2 | hard → c1c2 | mix → all three
// • All other modes (dictation, cloze…) → original single-select behaviour
// ─────────────────────────────────────────────────────────────

// CEFR keys used in flashcard/fcplus HTML buttons (data-diff values)
const _CEFR_KEYS = new Set(['a1a2', 'b1b2', 'c1c2']);
// Modes that use CEFR multi-select
const _CEFR_MODES = new Set(['flashcard', 'fcplus']);
// Modes that use sentence difficulty multi-select (easy/medium/hard)
const _DIFF_MODES = new Set(['dictation', 'reorder', 'voice-reorder']);
const _DIFF_KEYS  = new Set(['easy', 'medium', 'hard']);

/** Re-render all diff-btn active states for a given mode based on selectedCefrLevels */
function _syncCefrButtons(mode) {
    document.querySelectorAll(`.quiz-diff-btn[data-mode="${mode}"]`).forEach(b => {
        const diff = b.dataset.diff;
        if (diff === 'mix') {
            // "Mix" is active only when all three levels are selected
            b.classList.toggle('is-active', quizState.selectedCefrLevels.size === 3);
        } else if (_CEFR_KEYS.has(diff)) {
            // data-diff is already the CEFR key (a1a2 / b1b2 / c1c2)
            b.classList.toggle('is-active', quizState.selectedCefrLevels.has(diff));
        }
    });
}

/** Re-render all diff-btn active states for dictation/reorder based on selectedDifficulties */
function _syncDiffButtons(mode) {
    document.querySelectorAll(`.quiz-diff-btn[data-mode="${mode}"]`).forEach(b => {
        const diff = b.dataset.diff;
        // FIX BUG-06：移除 mix 按鈕邏輯（無對應 HTML 按鈕，功能已移除）
        if (_DIFF_KEYS.has(diff)) {
            b.classList.toggle('is-active', quizState.selectedDifficulties.has(diff));
        }
    });
}

document.querySelectorAll('.quiz-diff-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.mode;
        const diff = btn.dataset.diff;

        // ── CEFR multi-select path (Flashcard & Flashcard+) ──────
        if (_CEFR_MODES.has(mode)) {
            if (diff === 'mix') {
                quizState.selectedCefrLevels = new Set(['a1a2', 'b1b2', 'c1c2']);
            } else if (_CEFR_KEYS.has(diff)) {
                if (quizState.selectedCefrLevels.has(diff)) {
                    if (quizState.selectedCefrLevels.size > 1) {
                        quizState.selectedCefrLevels.delete(diff);
                    }
                } else {
                    quizState.selectedCefrLevels.add(diff);
                }
            }
            _syncCefrButtons(mode);
            return;
        }

        // ── Sentence difficulty multi-select path (Dictation & Reorder) ──────
        if (_DIFF_MODES.has(mode)) {
            // FIX BUG-06：移除 mix 分支（無對應 HTML 按鈕）
            if (_DIFF_KEYS.has(diff)) {
                if (quizState.selectedDifficulties.has(diff)) {
                    // Deselect — but keep at least one selected
                    if (quizState.selectedDifficulties.size > 1) {
                        quizState.selectedDifficulties.delete(diff);
                    }
                } else {
                    quizState.selectedDifficulties.add(diff);
                }
            }
            // Sync legacy difficulty string for article mode fallback
            quizState.difficulty = quizState.selectedDifficulties.size === 3 ? 'mix'
                : [...quizState.selectedDifficulties][0];
            _syncDiffButtons(mode);
            return;
        }

        // ── Original single-select path (other modes) ──────
        document.querySelectorAll(`.quiz-diff-btn[data-mode="${mode}"]`)
            .forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        quizState.difficulty = diff;
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
        _applySubpanelDefaults('reorder');
        panel.classList.remove('is-hidden');
        card.classList.add('is-expanded');
        updateQuizAvailableCount('reorder');
    }
});

document.getElementById('start-reorder-btn').addEventListener('click', () => {
    startReorder(subpanelSource.reorder || 'note');
});

// Voice Reorder: toggle subpanel
document.getElementById('quiz-mode-voice-reorder').addEventListener('click', () => {
    const panel = document.getElementById('subpanel-voice-reorder');
    const card  = document.getElementById('quiz-mode-voice-reorder');
    const isOpen = !panel.classList.contains('is-hidden');
    closeAllSubpanels();
    if (!isOpen) {
        _applySubpanelDefaults('voice-reorder');
        panel.classList.remove('is-hidden');
        card.classList.add('is-expanded');
        updateQuizAvailableCount('voice-reorder');
    }
});

document.getElementById('start-voice-reorder-btn').addEventListener('click', () => {
    startVoiceReorder(subpanelSource['voice-reorder'] || 'note');
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

// initTtsToggleBtn 已移除：A/B 切換按鈕不再需要

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
    document.getElementById('quiz-voice-reorder-area').classList.add('is-hidden'); // FIX BUG-01

    if (mode === 'flashcard')       flashcardArea.classList.remove('is-hidden');
    if (mode === 'dictation')       dictationArea.classList.remove('is-hidden');
    if (mode === 'article-listen')  document.getElementById('quiz-article-listen-area').classList.remove('is-hidden');
    if (mode === 'article-cloze')   document.getElementById('quiz-article-cloze-area').classList.remove('is-hidden');
    if (mode === 'reorder')         document.getElementById('quiz-reorder-area').classList.remove('is-hidden');
    if (mode === 'fcplus')          document.getElementById('quiz-fcplus-area').classList.remove('is-hidden');
    // voice-reorder 由 startVoiceReorder() 內的 _vrHideAllAreas() + remove('is-hidden') 負責
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

    // 全對音效
    if (pct >= 1.0) _playSuccessSound('perfect');

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
        // Flashcard mode — show wrong items with word audio button
        if (wrongItems.length === 0) {
            reviewEl.innerHTML = `<div class="quiz-review-title">Perfect! 🎊</div>`;
        } else {
            reviewEl.innerHTML = `<div class="quiz-review-title">Review these:</div>`;
            wrongItems.forEach(w => {
                const div = document.createElement('div');
                div.className = 'quiz-review-item quiz-review-wrong quiz-review-fc-wrong';
                div.innerHTML = `
                    <span class="quiz-review-fc-word">✗ ${w}</span>
                    <button class="quiz-review-play-btn quiz-review-play-word" data-word="${w}" title="Play pronunciation">▶</button>
                `;
                reviewEl.appendChild(div);
            });
            // Bind word audio buttons
            reviewEl.querySelectorAll('.quiz-review-play-word').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const word = btn.dataset.word;
                    btn.textContent = '⏸';
                    _quizPlayWord(word, null, () => { btn.textContent = '▶'; });
                });
            });
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
                    // Word pronunciation — 三層降級
                    const word = btn.dataset.word;
                    _quizPlayWord(word, btn);
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
    else if (mode === 'fcplus') {                              // FC-02 FIX
        if (quizState.flashSource === 'article') startFcplusFromArticle();
        else startFcplus();
    }
    else if (mode === 'dictation')   startDictation();
    else if (mode === 'reorder')       startReorder(subpanelSource.reorder || 'note');
    else if (mode === 'voice-reorder') startVoiceReorder(subpanelSource['voice-reorder'] || 'note');
    else if (mode === 'article-listen' || mode === 'article-cloze') startArticleQuiz();
});

document.getElementById('quiz-retry-wrong-btn').addEventListener('click', () => {
    quizState.retryWrongOnly = true;
    const mode = quizState.mode;
    if (mode === 'dictation')            startDictationRetryWrong();
    else if (mode === 'reorder')         startReorderRetryWrong();
    else if (mode === 'voice-reorder')   _vrStartRetryWrong();
    else if (mode === 'article-listen')  startArticleRetryWrong();
    else if (mode === 'article-cloze')   startArticleRetryWrong();
    else if (mode === 'fcplus') {        // FC-03 FIX: use FC+ instead of plain Flashcard
        if (quizState.flashSource === 'article') startFcplusFromArticle();
        else startFcplus();
    }
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
    const cat   = quizState.categoryName;
    const title = quizState.titleName;

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
    const tsData = await getTimestampForStoryWithCache(title) // BUG-10 FIX;
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
    deck = filterByWordDifficulty(deck); // CEFR multi-select
    if (deck.length === 0) {
        showNotification('No words found for the selected CEFR level(s). Try selecting more levels.', 'warning');
        return;
    }
    deck = weightedSample(deck, quizState.questionCount || 10,
                    item => item.text, quizState.categoryName, title, 'articleWords');

    // 預載音檔（同時設定 HTMLAudioElement 與 WebAudioEngine）
    const audioSrc = `audio/${encodeURIComponent(title.trim())}.mp3`;
    _setQuizAudioSrc(audioSrc);

    quizState.mode          = 'flashcard';
    quizState.flashSource   = 'article';
    quizState.deck          = deck;
    quizState.deckIndex     = 0;
    quizState.againQueue    = [];
    quizState.againCountMap = {};  // FC-01 FIX
    quizState.correct       = 0;
    quizState.wrong         = 0;
    quizState.wrongItems    = [];

    closeAllSubpanels();
    showQuizSession('flashcard');
    showFlashcard();
}

function startFlashcard() {
    const items = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);
    let allItems = [
        ...items.words.map(w => typeof w === 'string' ? { text: w, type: 'word' } : { ...w, type: 'word' }),
        ...items.phrases.map(p => typeof p === 'string' ? { text: p, type: 'phrase' } : { ...p, type: 'phrase' })
    ];

    // 排除字母數少於 4 的純單字（phrases 不過濾，因含空格）
    allItems = allItems.filter(i => {
        if (i.type === 'phrase') return true;
        const letters = i.text.replace(/[^a-zA-Z]/g, '').length;
        return letters >= 4;
    });

    allItems = filterByWordDifficulty(allItems); // CEFR multi-select

    if (allItems.length === 0) {
        showNotification('No words or phrases found for the selected CEFR level(s). Try selecting more levels.', 'warning');
        return;
    }

    quizState.mode          = 'flashcard';
    quizState.flashSource   = 'note';
    quizState.deck          = weightedSample(allItems, quizState.questionCount || 10,
                                item => item.text, quizState.categoryName, quizState.titleName, 'noteWords');
    quizState.deckIndex     = 0;
    quizState.againQueue    = [];
    quizState.againCountMap = {};  // FC-01 FIX
    quizState.correct       = 0;
    quizState.wrong         = 0;
    quizState.wrongItems    = [];

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
    // 重置播放列：顯示正面播放，隱藏背面播放
    const _fo = document.getElementById('fc-front-play');
    const _bo = document.getElementById('fc-back-play');
    if (_fo) { _fo.classList.remove('is-hidden'); }
    if (_bo) { _bo.classList.add('is-hidden'); }

    document.getElementById('flashcard-word').textContent = item.text;

    // Find context — article 模式直接用 item.sentence；note 模式從 story 內文找
    const contextEl = document.getElementById('flashcard-context');
    // 決定背面音檔要用的文章 title：
    //   article 模式 → quizState.titleName（固定來自同一篇）
    //   note 模式 → item.noteTitle（各 item 帶來源文章）或用 titleName
    const _ctxTitle = quizState.flashSource === 'article'
        ? quizState.titleName
        : (item.noteTitle || quizState.titleName); // scope 永遠是 'this'
    const ctx = (quizState.flashSource === 'article' && item.sentence)
        ? item.sentence
        : findContextForWord(item.text.replace(/-/g, ' '), _ctxTitle);
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

    function _playWordAudio() {
        // Flashcard 模式：播放不計入 replayCount，不影響熟悉度扣分
        audioBtn.classList.remove('needs-tap');
        _quizPlayWord(item.text, audioBtn);
    }
    audioBtn.onclick = _playWordAudio;
    _fcPlayWord = _playWordAudio;  // Space 鍵直接呼叫
    _fcPlayBack = null;            // 背面音訊尚未設定，先清空
    _fcIsFlipped = false;          // 重置翻面狀態

    // 自動播放（三層降級；iOS Safari 非手勢觸發可能被封鎖，偵測後改用 pulse 提示）
    _quizPlayWord(item.text, audioBtn, () => {
        // 若播完後按鈕還顯示 needs-tap 就移除
        audioBtn.classList.remove('needs-tap');
    });
    // iOS 封鎖偵測：等待 async fetch 完成後才顯示 pulse 提示（3s 給慢速網路足夠時間）
    setTimeout(() => {
        if (!audioBtn.classList.contains('is-playing-voice') &&
            !window.speechSynthesis?.speaking) {
            audioBtn.classList.add('needs-tap');
        }
    }, 3000);

    // ── 背面：整句音檔 + ✏️ ────────────────────────────────────
    const backAudioBtn      = document.getElementById('flashcard-back-audio-btn');
    const backEditContainer = document.getElementById('flashcard-back-edit-container');
    if (backAudioBtn) {
        backAudioBtn.classList.remove('is-playing-voice');
        backAudioBtn.disabled = true;
        backAudioBtn.onclick  = null;
    }
    if (backEditContainer) backEditContainer.innerHTML = '';

    const _flashTitle = _ctxTitle;
    const _ctxText    = ctx;

    if (_flashTitle && _ctxText) {
        const _audioSrc = `audio/${encodeURIComponent(_flashTitle.trim())}.mp3`;
        _setQuizAudioSrc(_audioSrc);

        const _setupBackAudio = (rawStart, rawEnd) => {
            if (rawStart == null) return;
            const _timing = (typeof getAdjustedTiming === 'function')
                ? getAdjustedTiming(_flashTitle, _ctxText, rawStart, rawEnd)
                : { start: rawStart, end: rawEnd };

            backAudioBtn.disabled = false;
            backAudioBtn.onclick = () => {
                // Flashcard 模式：播放不計入 replayCount，不影響熟悉度扣分
                playSnippet({
                    start: _timing.start, end: _timing.end,
                    onStart: () => backAudioBtn.classList.add('is-playing-voice'),
                    onEnd:   () => backAudioBtn.classList.remove('is-playing-voice')
                });
            };
            _fcPlayBack = backAudioBtn.onclick; // Space 鍵直接呼叫
            if (_fcIsFlipped) _fcPlayBack();   // 若已翻面（音訊稍晚就緒）立即播

            if (backEditContainer && typeof createAudioEditBtn === 'function') {
                backEditContainer.innerHTML = '';
                const _editBtn = createAudioEditBtn({
                    title:    _flashTitle,
                    sentence: _ctxText,
                    start:    rawStart,
                    end:      rawEnd,
                    audioSrc: _audioSrc,
                    player:   quizAudioPlayer,
                    onSave:   (ns, ne) => {
                        _timing.start = ns; _timing.end = ne;
                        _editBtn.innerHTML = '✏️✓';
                        _editBtn.title     = '已調整（點擊再編輯）';
                        _editBtn.classList.add('is-adjusted');
                    }
                });
                backEditContainer.appendChild(_editBtn);
            }
        };

        // Article 模式：item 直接帶 start/end，無需再查 timestamp
        if (quizState.flashSource === 'article' && item.start != null) {
            _setupBackAudio(item.start, item.end);
        } else {
            // Note 模式：查 timestamp 找句子對應時間
            getTimestampForStoryWithCache(_flashTitle).then(tsData => { // BUG-10 FIX
                if (!tsData || !backAudioBtn) return;
                const _norm = t => t.trim().replace(/[.,?!'"`“”‘’]/g, '').toLowerCase();
                const _match = tsData.find(l => _norm(l.sentence) === _norm(_ctxText));
                if (_match) _setupBackAudio(_match.start, _match.end);
            }).catch(() => {});
        }
    }

    // Hide action buttons until flipped
    document.getElementById('flashcard-wrong').style.visibility = 'hidden';
    document.getElementById('flashcard-correct').style.visibility = 'hidden';
}

// Flip card on tap — 按鈕已在卡片 DOM 外，整張卡片點擊都翻牌
document.getElementById('flashcard').addEventListener('click', () => {
    const card     = document.getElementById('flashcard');
    const frontOvl = document.getElementById('fc-front-play');
    const backOvl  = document.getElementById('fc-back-play');
    const backBtn  = document.getElementById('flashcard-back-audio-btn');
    card.classList.toggle('is-flipped');
    if (card.classList.contains('is-flipped')) {
        // 翻到背面：顯示背面播放，恢復背面按鈕（若有音檔由 _setupBackAudio 控制）
        if (frontOvl) frontOvl.classList.add('is-hidden');
        if (backOvl)  backOvl.classList.remove('is-hidden');
        if (backBtn && _fcPlayBack) backBtn.disabled = false; // 有音檔才啟用
        document.getElementById('flashcard-wrong').style.visibility = 'visible';
        document.getElementById('flashcard-correct').style.visibility = 'visible';
        _fcIsFlipped = true;
        if (_fcPlayBack) _fcPlayBack();
    } else {
        // 翻回正面：顯示正面播放，強制 disable 背面按鈕，確保空白鍵不誤播句子
        if (frontOvl) frontOvl.classList.remove('is-hidden');
        if (backOvl)  backOvl.classList.add('is-hidden');
        if (backBtn)  backBtn.disabled = true;
        _fcIsFlipped = false;
        // 翻回正面後自動重播單字發音，Space 鍵也恢復播單字
        if (_fcPlayWord) _fcPlayWord();
    }
});

document.getElementById('flashcard-correct').addEventListener('click', () => {
    const _fcItem = quizState.deck[quizState.deckIndex];
    quizState.correct++;
    quizState.deckIndex++;
    _playSuccessSound('correct');
    if (typeof recordItemResult === 'function' && _fcItem) {
        const _itype = quizState.flashSource === 'article' ? 'articleWords' : 'noteWords';
        recordItemResult(quizState.categoryName, quizState.titleName, _itype, _fcItem.text, true, 0, 'fc');
    }
    showFlashcard();
});

document.getElementById('flashcard-wrong').addEventListener('click', () => {
    const item = quizState.deck[quizState.deckIndex];
    quizState.wrong++;
    _playWrongSound();
    // BUG-07 FIX: 同一個字只記錄一次，避免 re-queue 後結果頁重複顯示
    if (!quizState.wrongItems.includes(item.text)) {
        quizState.wrongItems.push(item.text);
    }

    // FC-01 FIX: 每張卡最多 re-queue 2 次，防止無限循環
    const _againKey = item.text;
    const _againCount = (quizState.againCountMap[_againKey] || 0) + 1;
    quizState.againCountMap[_againKey] = _againCount;
    if (_againCount <= 2) {
        quizState.deck.push(item);
    }

    quizState.deckIndex++;
    if (typeof recordItemResult === 'function' && item) {
        const _itype = quizState.flashSource === 'article' ? 'articleWords' : 'noteWords';
        recordItemResult(quizState.categoryName, quizState.titleName, _itype, item.text, false, 0, 'fc');
    }
    showFlashcard();
});

// ── Flashcard Keyboard Shortcuts ─────────────────────────────
// Space = 正面播單字 / 背面播句子（直接呼叫函式，不依賴按鈕 focus）
// Enter = 翻牌
document.addEventListener('keydown', (e) => {
    const fcArea = document.getElementById('quiz-flashcard-area');
    if (!fcArea || fcArea.classList.contains('is-hidden')) return;

    if (e.code === 'Space') {
        e.preventDefault();
        const card = document.getElementById('flashcard');
        const isFlipped = card && card.classList.contains('is-flipped');
        if (isFlipped) {
            if (_fcPlayBack) _fcPlayBack();
        } else {
            if (_fcPlayWord) _fcPlayWord();
        }
        return;
    }

    if (e.code === 'Enter') {
        e.preventDefault();
        document.getElementById('flashcard').click();
    }
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
    const title = quizState.titleName; // scope 永遠是 'this'
    let tsData = null;

    if (title) {
        tsData = await getTimestampForStoryWithCache(title) // BUG-10 FIX;
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
        const sel = quizState.selectedDifficulties;
        const diffLabel = (!sel || sel.size === 3) ? 'matching' : [...sel].join('/');
        showNotification(`No ${diffLabel} sentences found in your notes.`, 'warning');
        return;
    }

    quizState.mode        = 'dictation';
    quizState.questions   = weightedSample(filteredQ, quizState.questionCount || 10,
                                item => item.sentence, quizState.categoryName, quizState.titleName, 'noteSentences');
    quizState.currentIndex = 0;
    quizState.correct     = 0;
    quizState.wrong       = 0;
    quizState.wrongItems  = [];
    quizState.answeredQuestions = [];

    // ── 記錄本次測驗選擇（供下次進入 Quiz 自動預選）──────────
    if (quizState.titleName && quizState.categoryName) {
        const _stObj = stories.find(s => s['標題'] === quizState.titleName);
        const _major = _stObj?.['大類'] || 'Uncategorized';
        _saveQuizLastSession(_major, quizState.categoryName, quizState.titleName);
    }

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

    // Hint: show word count（idle 狀態顯示）
    const wordCount = q.sentence.trim().split(/\s+/).length;
    _setAudioStatusHint('dictation-hint', 'idle', `${wordCount} words`);

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

    // 每題開始時重置鍵盤預選狀態
    if (typeof _dictResetKeyIndex === 'function') _dictResetKeyIndex();
}

/**
 * Dictation / Article-Listen 模式：更新 hint 區域為音訊狀態提示
 * @param {string} hintId   hint 元素 id
 * @param {string} state    'idle' | 'loading' | 'playing'
 * @param {string} idleText idle 時顯示的文字（如字數提示）
 */
function _setAudioStatusHint(hintId, state, idleText = '') {
    const el = document.getElementById(hintId);
    if (!el) return;
    if (state === 'loading') {
        el.innerHTML = '<span class="quiz-audio-status-icon is-spin">⏳</span> <span class="quiz-audio-status-text">載入音檔中…</span>';
        el.className = (el.className.replace(/quiz-audio-status--\S+/g, '').trim()) + ' quiz-audio-status--loading';
    } else if (state === 'playing') {
        el.innerHTML = '<span class="quiz-audio-status-icon">🔊</span> <span class="quiz-audio-status-text">播放中，請仔細聆聽</span>';
        el.className = (el.className.replace(/quiz-audio-status--\S+/g, '').trim()) + ' quiz-audio-status--playing';
    } else {
        el.textContent = idleText;
        el.className = el.className.replace(/quiz-audio-status--\S+/g, '').trim();
    }
}

function playDictationAudio(q) {
    _trackReplay();
    if (!q.start) return;
    const playBtn = document.getElementById('dictation-play-btn');
    const spanEl  = playBtn.querySelector('span:last-child') || playBtn;
    const _setLabel = (txt) => { if (spanEl !== playBtn) spanEl.textContent = txt; };
    // 套用使用者調整後的時間（若無調整則使用原始值）
    const timing = getQuizTiming(q.title, q.sentence, q.start, q.end);
    const _wordCount = q.sentence ? q.sentence.trim().split(/\s+/).length : 0;
    const _idleHint = _wordCount ? `${_wordCount} words` : '';
    playSnippet({
        start: timing.start, end: timing.end,
        onLoading: () => {
            _setAudioStatusHint('dictation-hint', 'loading');
            playBtn.classList.add('is-loading-audio');
            playBtn.classList.remove('is-playing-voice');
            _setLabel('⏳ 載入中…');
        },
        onStart: () => {
            _setAudioStatusHint('dictation-hint', 'playing');
            playBtn.classList.remove('is-loading-audio');
            playBtn.classList.add('is-playing-voice');
            _setLabel('🔊 播放中…');
        },
        onEnd: () => {
            _setAudioStatusHint('dictation-hint', 'idle', _idleHint);
            playBtn.classList.remove('is-playing-voice', 'is-loading-audio');
            _setLabel('▶ 重播');
        }
    });
}

function handleDictationAnswer(selected, correct, btn) {
    document.querySelectorAll('#dictation-options .quiz-option-btn').forEach(b => {
        b.disabled = true;
        if (b.textContent.toLowerCase() === correct.toLowerCase()) b.classList.add('is-correct'); // BUG-01 FIX: 大小寫不敏感，與 isCorrect 判斷一致
    });

    const feedbackEl = document.getElementById('dictation-feedback');
    // FIX: 改用不分大小寫比對，與按鈕高亮邏輯（toLowerCase）保持一致
    const isCorrect = selected.toLowerCase() === correct.toLowerCase();
    const q = quizState.questions[quizState.currentIndex];

    if (isCorrect) {
        btn.classList.add('is-correct');
        feedbackEl.textContent = '✓ Correct!';
        feedbackEl.className = 'quiz-feedback correct';
        quizState.correct++;
        _playSuccessSound('correct');
    } else {
        btn.classList.add('is-wrong');
        feedbackEl.innerHTML = `✗ Answer: <em>${correct}</em>`;
        feedbackEl.className = 'quiz-feedback wrong';
        quizState.wrong++;
        _playWrongSound();
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
    // FIX BUG-03：依出題來源判斷 itemType（article 來源應記入 articleSentences）
    if (typeof recordItemResult === 'function') {
        const _dtype = (subpanelSource.dictation === 'article') ? 'articleSentences' : 'noteSentences';
        recordItemResult(quizState.categoryName, quizState.titleName, _dtype, correct, isCorrect, _quizReplayCount, 'dictation');
    }
}

document.getElementById('dictation-next').addEventListener('click', () => {
    quizState.currentIndex++;
    showDictationQuestion();
});

// ══════════════════════════════════════════════════════════════
//  DICTATION / ARTICLE-LISTEN  KEYBOARD NAVIGATION
//  作用範圍：quiz-dictation-area（From Note）
//           quiz-article-listen-area（From Article）
//  ↑ / ↓  : 預選答案（highlight option btn）
//  Enter  : 提交已預選答案 / 前往下一題
//  Space  : 重播 MP3
// ══════════════════════════════════════════════════════════════

// 目前鍵盤預選的選項 index（-1 = 未選）
let _dictKeyIndex = -1;

/**
 * 取得目前作用中的 dictation / article-listen 區域資訊
 * 回傳 null 表示兩個區域都不在作用中
 * @returns {{ optSel:string, nextId:string, playId:string } | null}
 */
function _dictGetActiveAreaInfo() {
    const dictArea    = document.getElementById('quiz-dictation-area');
    const artListArea = document.getElementById('quiz-article-listen-area');

    if (dictArea && !dictArea.classList.contains('is-hidden')) {
        return {
            optSel: '#dictation-options .quiz-option-btn',
            nextId: 'dictation-next',
            playId: 'dictation-play-btn',
        };
    }
    if (artListArea && !artListArea.classList.contains('is-hidden')) {
        return {
            optSel: '#article-listen-options .quiz-option-btn',
            nextId: 'article-listen-next',
            playId: 'article-play-btn',
        };
    }
    return null;
}

/** 更新目前作用區域的 keyboard-focused 樣式 */
function _dictUpdateKeyHighlight() {
    const info = _dictGetActiveAreaInfo();
    if (!info) return;
    const btns = document.querySelectorAll(info.optSel);
    btns.forEach((b, i) => {
        b.classList.toggle('is-keyboard-focused', i === _dictKeyIndex);
    });
}

/** 在每題開始時重置鍵盤選取狀態 */
function _dictResetKeyIndex() {
    _dictKeyIndex = -1;
    _dictUpdateKeyHighlight();
}

document.addEventListener('keydown', (e) => {
    // 若有文字輸入框取得 focus，不攔截
    if (document.activeElement && ['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;

    const info = _dictGetActiveAreaInfo();
    if (!info) return;   // 兩個區域都沒顯示 → 不處理

    const btns        = Array.from(document.querySelectorAll(info.optSel));
    const nextBtn     = document.getElementById(info.nextId);
    const playBtn     = document.getElementById(info.playId);
    const nextVisible = nextBtn && !nextBtn.classList.contains('is-hidden');

    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        if (btns.length === 0) return;
        if (btns[0]?.disabled) return;   // 已答題，箭頭無效

        if (e.code === 'ArrowDown') {
            _dictKeyIndex = (_dictKeyIndex + 1) % btns.length;
        } else {
            _dictKeyIndex = (_dictKeyIndex - 1 + btns.length) % btns.length;
        }
        _dictUpdateKeyHighlight();
        btns[_dictKeyIndex]?.scrollIntoView({ block: 'nearest' });

    } else if (e.code === 'Enter') {
        e.preventDefault();
        if (nextVisible) {
            nextBtn.click();   // 已答題 → 下一題
        } else if (_dictKeyIndex >= 0 && btns[_dictKeyIndex] && !btns[_dictKeyIndex].disabled) {
            btns[_dictKeyIndex].click();   // 預選中的選項 → 提交
        }

    } else if (e.code === 'Space') {
        e.preventDefault();
        if (playBtn && !playBtn.disabled) playBtn.click();   // 重播 MP3
    }
});

// ── Load quiz scores from Firestore on login ─────────────────
// ══════════════════════════════════════════════════════════════
//  ARTICLE QUIZ — Listen & Choose + Fill in Blank
//  No note needed, directly from Timestamp
// ══════════════════════════════════════════════════════════════

function getDifficultyLabel(wordCount) {
    if (wordCount <= 8)  return { label: 'Easy',   color: '#50b86c', diff: 'easy' };
    if (wordCount <= 15) return { label: 'Medium', color: '#f5a623', diff: 'medium' };
    return                     { label: 'Hard',   color: '#e05c5c', diff: 'hard' };
}

// Word difficulty via Oxford CEFR lookup
function getWordDifficulty(text) {
    const word = text.toLowerCase().trim();
    const level = (typeof OXFORD_CEFR !== 'undefined') ? OXFORD_CEFR[word] : null;
    if (!level) return null; // 不在 Oxford 表裡的詞
    if (level === 'a1' || level === 'a2') return 'a1a2';
    if (level === 'b1' || level === 'b2') return 'b1b2';
    return 'c1c2';
}

// Filter word/phrase items by CEFR multi-select (selectedCefrLevels)
// Falls back to legacy diff string only if called with an explicit diff argument.
function filterByWordDifficulty(items, diff) {
    // ── Legacy / sentence modes: diff is a string ('mix','easy','medium','hard') ──
    if (typeof diff === 'string') {
        if (diff === 'mix') return items;
        // Map legacy easy/medium/hard → CEFR group for sentence-difficulty callers
        // (Words & Phrases callers now pass undefined and use selectedCefrLevels)
        const legacyMap = { easy: 'a1a2', medium: 'b1b2', hard: 'c1c2' };
        const target = legacyMap[diff] || diff; // if already a cefr key, use directly
        return items.filter(item => {
            const d = getWordDifficulty(item.text);
            return d === null || d === target; // null = 查不到 → 保留
        });
    }

    // ── New path: use quizState.selectedCefrLevels (Set) ──
    const levels = quizState.selectedCefrLevels;
    // If all three selected, return everything (same as mix)
    if (!levels || levels.size === 0 || levels.size === 3) return items;
    return items.filter(item => {
        const d = getWordDifficulty(item.text);
        return d === null || levels.has(d); // null = 查不到 → 保留
    });
}

// Filter sentence items by difficulty setting
function filterBySentenceDifficulty(items, diff) {
    // ── New path: use quizState.selectedDifficulties (Set) if all three not selected ──
    const sel = quizState.selectedDifficulties;
    if (sel && sel.size > 0 && sel.size < 3) {
        return items.filter(item => {
            const wc = (item.sentence || item).trim().split(/\s+/).length;
            return sel.has(getDifficultyLabel(wc).diff);
        });
    }
    // Legacy / fallback: string-based single-select
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

    const tsData = await getTimestampForStoryWithCache(title) // BUG-05+BUG-10 FIX: 填充 tsDataCache 讓干擾選項 fallback 生效;
    if (!tsData || tsData.length === 0) {
        showNotification('Timestamp file not found for this article.', 'error');
        return;
    }

    // Filter by difficulty
    const sel = quizState.selectedDifficulties;
    const allSentences = tsData.filter(l => l.sentence && l.sentence.trim().length > 3);
    const pool = (!sel || sel.size === 0 || sel.size === 3) ? allSentences : allSentences.filter(l => {
        const wc = l.sentence.trim().split(/\s+/).length;
        return sel.has(getDifficultyLabel(wc).diff);
    });

    if (pool.length < 2) {
        const diffLabel = (!sel || sel.size === 3) ? '' : ` (${[...sel].join('/')})`;
        showNotification(`Not enough${diffLabel} sentences in this article.`, 'warning');
        return;
    }

    const qCount = quizState.questionCount || 10;

    // FIX: 改用 weightedSample 取代純隨機 shuffle().slice()，
    // 讓 article-listen（Dictation From Article）也享有間隔重複——
    // 熟悉的句子少出，未測驗或答錯的句子優先出題，與其他模式行為一致。
    const allMappedPool = pool.map(l => ({
        sentence:  l.sentence.trim(),
        start:     l.start,
        end:       l.end,
        title,
        wordCount: l.sentence.trim().split(/\s+/).length,
    }));
    const sampledPool = weightedSample(
        allMappedPool,
        qCount,
        item => item.sentence,
        quizState.categoryName,
        title,
        'articleSentences'
    );

    const questions = sampledPool.map(l => {
        // 出題前先查是否有調整記錄，有則優先使用
        const _timing = (typeof getAdjustedTiming === 'function')
            ? getAdjustedTiming(title, l.sentence, l.start, l.end)
            : { start: l.start, end: l.end };
        return {
            sentence:  l.sentence,
            start:     _timing.start,
            end:       _timing.end,
            origStart: l.start,
            origEnd:   l.end,
            title,
            wordCount: l.wordCount,
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

    // Word count hint（idle 狀態顯示）
    _setAudioStatusHint('article-listen-hint', 'idle', `${q.wordCount} words`);

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

    // Build options: correct + 3 smart distractors
    const distractors = generateSmartDistractors(q.sentence, 3);
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

    // 每題開始時重置鍵盤預選狀態（與 dictation 共用）
    if (typeof _dictResetKeyIndex === 'function') _dictResetKeyIndex();
}

// Cache for timestamp data to avoid re-fetching within same quiz session
// BUG FIX: 不再永久快取，改為呼叫 story.js 的 getTimestampForStory（已有 cache-busting）
// tsDataCache 只做 session 內的暫存（加快同一場 quiz 的重複查詢）
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
    const spanEl = btn ? (btn.querySelector('span:last-child') || btn.querySelector('span') || btn) : null;
    const _setLabel = (txt) => { if (spanEl && spanEl !== btn) spanEl.textContent = txt; };
    // 偵測目前是哪種 quiz 模式，選對應的 hint id
    const _hintId = document.getElementById('quiz-article-listen-area') &&
                    !document.getElementById('quiz-article-listen-area').classList.contains('is-hidden')
                    ? 'article-listen-hint' : null; // article-cloze 沒有固定 hint 元素，不更新
    const _wc = q.sentence ? q.sentence.trim().split(/\s+/).length : 0;
    playSnippet({
        start: timing.start, end: timing.end,
        onLoading: () => {
            if (btn) { btn.classList.add('is-loading-audio'); btn.classList.remove('is-playing-voice'); }
            _setLabel('⏳ 載入中…');
            if (_hintId) _setAudioStatusHint(_hintId, 'loading');
        },
        onStart: () => {
            if (btn) { btn.classList.remove('is-loading-audio'); btn.classList.add('is-playing-voice'); }
            _setLabel('🔊 播放中…');
            if (_hintId) _setAudioStatusHint(_hintId, 'playing');
        },
        onEnd: () => {
            if (btn) { btn.classList.remove('is-playing-voice', 'is-loading-audio'); }
            _setLabel('▶ Play Again');
            if (_hintId) _setAudioStatusHint(_hintId, 'idle', _wc ? `${_wc} words` : '');
        }
    });
}

// ── Smart Distractor Engine ───────────────────────────────────
// Generates n distractors for a sentence using local rules (no API needed).
// Each distractor applies ONE random mutation so the difference is subtle.

const _SOUND_ALIKES = {
    // verb confusions
    'walked': ['woke','worked','talked'], 'runs': ['ruins','rains','runs'],
    'said': ['set','sad','stayed'], 'told': ['tolled','tall','toiled'],
    'went': ['bent','meant','sent'], 'came': ['game','name','same'],
    'made': ['paid','laid','fade'], 'took': ['look','book','cook'],
    'gave': ['cave','save','wave'], 'found': ['sound','bound','round'],
    'left': ['loft','lift','lest'], 'felt': ['belt','melt','dealt'],
    'knew': ['new','true','through'], 'saw': ['raw','law','draw'],
    'kept': ['crept','swept','wept'], 'stood': ['should','would','could'],
    'heard': ['herd','hard','hurt'], 'thought': ['taught','bought','sought'],
    'brought': ['taught','bought','sought'], 'caught': ['taught','bought','sought'],
    'lost': ['last','lust','list'], 'met': ['set','bet','net'],
    'held': ['help','helm','belt'], 'read': ['lead','dead','head'],
    'told': ['cold','bold','fold'], 'sold': ['cold','bold','fold'],
    // prepositions / particles
    'into': ['onto','unto','out of'], 'onto': ['into','out of','up to'],
    'through': ['throughout','thorough','threw'], 'across': ['around','along','above'],
    'beside': ['besides','behind','below'], 'between': ['beneath','beyond','before'],
    'toward': ['towards','backward','forward'], 'against': ['along','across','about'],
    'within': ['without','beneath','beyond'], 'beyond': ['behind','below','beside'],
    'along': ['alone','aloft','among'], 'among': ['along','above','around'],
    'despite': ['because of','instead of','in spite'], 'except': ['expect','accept','effect'],
    // articles / determiners
    'the': ['a','this','that'], 'a': ['the','an','any'], 'an': ['a','the','any'],
    'this': ['the','that','these'], 'that': ['this','those','the'],
    'these': ['those','this','the'], 'those': ['these','that','the'],
    'some': ['any','much','many'], 'any': ['some','every','no'],
    'every': ['each','any','some'], 'each': ['every','any','some'],
    'many': ['much','some','more'], 'much': ['many','more','most'],
    'more': ['most','less','fewer'], 'most': ['more','least','many'],
    'few': ['some','little','less'], 'little': ['few','less','small'],
    'both': ['all','each','either'], 'either': ['neither','both','any'],
    // adjective/adverb pairs
    'slowly': ['quickly','softly','surely'], 'quickly': ['slowly','quietly','firmly'],
    'quietly': ['quickly','loudly','softly'], 'loudly': ['quietly','proudly','clearly'],
    'carefully': ['carlessly','carelessly','casually'], 'suddenly': ['already','finally','usually'],
    'finally': ['suddenly','usually','already'], 'already': ['still','always','finally'],
    'always': ['never','often','still'], 'never': ['always','often','ever'],
    'often': ['always','rarely','seldom'], 'usually': ['sometimes','rarely','always'],
    'still': ['yet','already','again'], 'just': ['only','even','still'],
    'only': ['just','even','also'], 'even': ['only','just','still'],
    'very': ['quite','rather','fairly'], 'quite': ['very','rather','fairly'],
    'rather': ['quite','very','fairly'], 'really': ['truly','very','quite'],
    // common nouns (sound-alike or near)
    'their': ['there','they\'re','the'], 'there': ['their','they\'re','here'],
    'its': ['it\'s','his','our'], 'your': ['you\'re','our','their'],
    'one': ['once','own','on'], 'two': ['too','to','through'],
    'new': ['knew','now','not'], 'here': ['there','hear','were'],
    'hear': ['here','near','dear'], 'where': ['were','wear','there'],
    'were': ['where','we\'re','here'], 'buy': ['by','bye','but'],
    'right': ['write','light','might'], 'write': ['right','white','quite'],
    'whole': ['hole','hold','sole'], 'hole': ['whole','hold','mole'],
    'high': ['hire','hide','hike'], 'see': ['say','sea','seem'],
    'know': ['now','show','low'], 'show': ['know','slow','flow'],
    'people': ['person','pupil','purple'], 'world': ['word','would','worse'],
    'place': ['face','pace','space'], 'time': ['dime','lime','rhyme'],
    'life': ['wife','like','line'], 'hand': ['band','land','sand'],
    'part': ['past','path','park'], 'side': ['hide','ride','wide'],
    'face': ['place','race','base'], 'night': ['light','might','sight'],
    'day': ['say','way','pay'], 'way': ['day','say','pay'],
    'man': ['can','ran','tan'], 'woman': ['woolen','woken','woven'],
    'child': ['mild','wild','filed'], 'back': ['pack','rack','lack'],
    'old': ['told','cold','bold'], 'long': ['song','gong','tong'],
    'great': ['grey','grade','greet'], 'good': ['food','mood','wood'],
    'little': ['litter','lithe','title'], 'own': ['one','down','town'],
    'same': ['some','came','game'], 'name': ['same','game','came'],
};

// Tense / morphological variants
const _MORPH_MAP = {
    // irregular past → base / present
    'was': ['is','were','be'], 'were': ['was','are','be'],
    'had': ['has','have','having'], 'has': ['had','have','having'],
    'did': ['does','do','doing'], 'went': ['go','goes','going'],
    'came': ['come','comes','coming'], 'took': ['take','takes','taking'],
    'gave': ['give','gives','giving'], 'found': ['find','finds','finding'],
    'made': ['make','makes','making'], 'told': ['tell','tells','telling'],
    'said': ['say','says','saying'], 'left': ['leave','leaves','leaving'],
    'felt': ['feel','feels','feeling'], 'knew': ['know','knows','knowing'],
    'saw': ['see','sees','seeing'], 'stood': ['stand','stands','standing'],
    'heard': ['hear','hears','hearing'], 'thought': ['think','thinks','thinking'],
    'brought': ['bring','brings','bringing'], 'caught': ['catch','catches','catching'],
    'bought': ['buy','buys','buying'], 'taught': ['teach','teaches','teaching'],
    'sought': ['seek','seeks','seeking'], 'kept': ['keep','keeps','keeping'],
    'held': ['hold','holds','holding'], 'met': ['meet','meets','meeting'],
    'lost': ['lose','loses','losing'], 'paid': ['pay','pays','paying'],
    'read': ['read','reads','reading'],  // note: past/present homograph
    'led': ['lead','leads','leading'], 'built': ['build','builds','building'],
    'spent': ['spend','spends','spending'], 'sent': ['send','sends','sending'],
    'bent': ['bend','bends','bending'], 'lent': ['lend','lends','lending'],
    'meant': ['mean','means','meaning'], 'dealt': ['deal','deals','dealing'],
};

// Prepositions & conjunctions swap pool
const _PREP_ALTS = ['in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
                    'into', 'onto', 'up', 'down', 'over', 'under', 'through',
                    'about', 'between', 'among', 'behind', 'before', 'after',
                    'above', 'below', 'around', 'along', 'across', 'toward'];
const _PREPS_SET  = new Set(_PREP_ALTS);
const _CONJ_SET   = new Set(['and','but','or','so','yet','nor','for',
                              'although','though','because','since','if',
                              'when','while','until','unless','after','before']);

/**
 * Given a sentence, return `n` distractor sentences using local rules.
 * Each distractor applies exactly ONE mutation from a randomly chosen strategy.
 */
function generateSmartDistractors(sentence, n) {
    const tokens = sentence.match(/\S+/g) || [];
    if (tokens.length < 3) {
        // Too short — fall back to simple character swap
        return _fallbackDistractors(sentence, n);
    }

    // Strategy functions: each returns a mutated sentence or null if not applicable
    const strategies = [
        _mutSoundAlike,
        _mutMorph,
        _mutSwapPrep,
        _mutDropWord,
        _mutAddWord,
        _mutSwapAdjacentWords,
    ];

    const results = [];
    const seen = new Set([sentence.toLowerCase()]);
    const maxAttempts = n * 20;
    let attempts = 0;

    while (results.length < n && attempts < maxAttempts) {
        attempts++;
        // Pick a random strategy
        const strategy = strategies[Math.floor(Math.random() * strategies.length)];
        const candidate = strategy(tokens, sentence);
        if (!candidate) continue;
        const key = candidate.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(candidate);
    }

    // If still not enough, pad with classic "other sentence" fallback
    if (results.length < n) {
        const allSentences = quizState.questions.map(q => q.sentence);
        const extras = (tsDataCache[quizState.titleName] || []).map(l => l.sentence?.trim()).filter(Boolean);
        const fallbackPool = shuffle([...allSentences, ...extras].filter(s => {
            const k = s?.toLowerCase().trim();
            return k && !seen.has(k) && s !== sentence;
        }));
        for (const s of fallbackPool) {
            if (results.length >= n) break;
            results.push(s);
            seen.add(s.toLowerCase().trim());
        }
    }

    return results.slice(0, n);
}

/** Rebuild sentence from (possibly modified) token array, preserving original spacing style */
function _rebuildSentence(origSentence, newTokens) {
    // Simple: join with spaces. Preserve trailing punctuation if original had it.
    const origTokens = origSentence.match(/\S+/g) || [];
    const lastOrig = origTokens[origTokens.length - 1] || '';
    const lastNew  = newTokens[newTokens.length - 1] || '';
    // If original ends with punctuation and the last token differs, transfer punctuation
    const trailingPunct = lastOrig.match(/[.!?,;:]+$/)?.[0] || '';
    let joined = newTokens.join(' ');
    if (trailingPunct && !lastNew.endsWith(trailingPunct)) {
        // Remove trailing punct from last token if it already has one, then add correct
        joined = newTokens.slice(0, -1).join(' ') + ' ' +
                 lastNew.replace(/[.!?,;:]+$/, '') + trailingPunct;
    }
    return joined;
}

/** Strip punctuation from token for lookup, return [clean, suffix] */
function _stripPunct(token) {
    const m = token.match(/^([a-zA-Z''-]+)([^a-zA-Z]*)$/);
    if (m) return [m[1], m[2]];
    return [token, ''];
}

// ── Mutation strategies ───────────────────────────────────────

/** Replace one word with a sound-alike */
function _mutSoundAlike(tokens) {
    const candidates = [];
    tokens.forEach((tok, i) => {
        const [word, punct] = _stripPunct(tok);
        const alts = _SOUND_ALIKES[word.toLowerCase()];
        if (alts) candidates.push({ i, word, punct, alts });
    });
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const alt  = pick.alts[Math.floor(Math.random() * pick.alts.length)];
    // Preserve original capitalisation
    const altWord = (pick.word[0] === pick.word[0].toUpperCase() && pick.word[0] !== pick.word[0].toLowerCase())
        ? alt.charAt(0).toUpperCase() + alt.slice(1)
        : alt;
    const newTokens = [...tokens];
    newTokens[pick.i] = altWord + pick.punct;
    return newTokens.join(' ');
}

/** Replace an irregular-form word with a different tense/form */
function _mutMorph(tokens) {
    const candidates = [];
    tokens.forEach((tok, i) => {
        const [word, punct] = _stripPunct(tok);
        const alts = _MORPH_MAP[word.toLowerCase()];
        if (alts) candidates.push({ i, word, punct, alts });
    });
    if (candidates.length === 0) return null;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    const alt  = pick.alts[Math.floor(Math.random() * pick.alts.length)];
    const altWord = (pick.word[0] === pick.word[0].toUpperCase() && pick.word[0] !== pick.word[0].toLowerCase())
        ? alt.charAt(0).toUpperCase() + alt.slice(1)
        : alt;
    const newTokens = [...tokens];
    newTokens[pick.i] = altWord + pick.punct;
    return newTokens.join(' ');
}

/** Swap a preposition with a different one */
function _mutSwapPrep(tokens) {
    const candidates = [];
    tokens.forEach((tok, i) => {
        const [word] = _stripPunct(tok);
        if (_PREPS_SET.has(word.toLowerCase())) candidates.push(i);
    });
    if (candidates.length === 0) return null;
    const idx   = candidates[Math.floor(Math.random() * candidates.length)];
    const [word, punct] = _stripPunct(tokens[idx]);
    const pool  = _PREP_ALTS.filter(p => p !== word.toLowerCase());
    const alt   = pool[Math.floor(Math.random() * pool.length)];
    const newTokens = [...tokens];
    newTokens[idx] = alt + punct;
    return newTokens.join(' ');
}

/** Drop one non-critical word (not first/last, not verb-of-sentence heuristic) */
function _mutDropWord(tokens) {
    if (tokens.length < 5) return null;
    // Can drop articles, prepositions, adverbs (not first/last 2 tokens)
    const droppable = [];
    const dropSet = new Set([..._PREPS_SET, ..._CONJ_SET,
        'a','an','the','very','quite','rather','just','only','even',
        'also','too','already','still','yet','so','really','truly']);
    for (let i = 1; i < tokens.length - 1; i++) {
        const [w] = _stripPunct(tokens[i]);
        if (dropSet.has(w.toLowerCase())) droppable.push(i);
    }
    if (droppable.length === 0) return null;
    const idx = droppable[Math.floor(Math.random() * droppable.length)];
    const newTokens = [...tokens.slice(0, idx), ...tokens.slice(idx + 1)];
    return newTokens.join(' ');
}

/** Insert an extra small word right after an article/preposition (natural position) */
function _mutAddWord(tokens) {
    if (tokens.length < 3) return null;
    const insertWords = ['very','just','still','already','quite','also','even','really'];
    // Find positions after a verb or adjective (not before first/last token)
    const goodPositions = [];
    for (let i = 1; i < tokens.length - 1; i++) {
        const [w] = _stripPunct(tokens[i]);
        // Insert after verbs ending in -ed/-ing, or before nouns/adjectives
        if (/ed$|ing$|ly$/.test(w.toLowerCase())) goodPositions.push(i + 1);
    }
    const pos = goodPositions.length > 0
        ? goodPositions[Math.floor(Math.random() * goodPositions.length)]
        : 1 + Math.floor(Math.random() * (tokens.length - 2));
    const word = insertWords[Math.floor(Math.random() * insertWords.length)];
    const newTokens = [...tokens.slice(0, pos), word, ...tokens.slice(pos)];
    return newTokens.join(' ');
}

/** Swap two adjacent (non-first, non-last) content words */
function _mutSwapAdjacentWords(tokens) {
    if (tokens.length < 4) return null;
    // Find pairs where both are content words (not articles/preps)
    const skipSet = new Set([..._PREPS_SET, ..._CONJ_SET,
        'a','an','the','is','are','was','were','be','been','being',
        'i','he','she','it','we','they','you','me','him','her','us','them']);
    const pairs = [];
    for (let i = 1; i < tokens.length - 2; i++) {
        const [w1] = _stripPunct(tokens[i]);
        const [w2] = _stripPunct(tokens[i + 1]);
        if (!skipSet.has(w1.toLowerCase()) && !skipSet.has(w2.toLowerCase())) {
            pairs.push(i);
        }
    }
    if (pairs.length === 0) return null;
    const idx = pairs[Math.floor(Math.random() * pairs.length)];
    const newTokens = [...tokens];
    [newTokens[idx], newTokens[idx + 1]] = [newTokens[idx + 1], newTokens[idx]];
    return newTokens.join(' ');
}

/** Last-resort: minor character-level tweak */
function _fallbackDistractors(sentence, n) {
    // BUG-09 FIX: 用 seen Set 過濾，避免產生與正確答案相同或互相重複的干擾選項
    const results = [];
    const seen = new Set([sentence.toLowerCase().trim()]);
    const words = sentence.split(' ');
    let attempt = 0;
    while (results.length < n && attempt < n * 10) {
        const idx = 1 + (attempt % Math.max(1, words.length - 2));
        const shifted = [...words];
        const w = shifted.splice(idx, 1)[0];
        shifted.splice(Math.max(0, idx - 1), 0, w);
        const candidate = shifted.join(' ');
        const key = candidate.toLowerCase().trim();
        if (!seen.has(key)) {
            seen.add(key);
            results.push(candidate);
        }
        attempt++;
    }
    return results;
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
        _playSuccessSound('correct');
    } else {
        btn.classList.add('is-wrong');
        feedbackEl.textContent = '✗ Wrong';
        feedbackEl.className = 'quiz-feedback wrong';
        quizState.wrong++;
        _playWrongSound();
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
    const targetWord = words[Math.floor(Math.random() * words.length)].toLowerCase(); // BUG-02 FIX: 統一小寫，避免句首大寫與選項不符

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
        _playSuccessSound('correct');
    } else {
        btn.classList.add('is-wrong');
        feedbackEl.textContent = `✗ Answer: ${correct}`;
        feedbackEl.className = 'quiz-feedback wrong';
        quizState.wrong++;
        _playWrongSound();
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

    // ★ FIX R-01: 在任何路徑分叉前強制重置 reorderChecked，
    //   即使 showReorderQuestion() 因邊界條件提早 return，也不會殘留 true 鎖死 Pool。
    reorderChecked = false;

    // 清理練習分支狀態（避免 Retry Wrong 流程殘留前一輪練習狀態）
    _reorderPracticeCleanup();

    // 保留 start/end/title，讓 retry 時音檔可以正常播放
    const retryTitle = wrongQs.find(q => q.title)?.title || quizState.titleName || null;
    quizState.questions = shuffle(wrongQs.map(q => ({
        sentence: q.correct,
        start: q.start ?? null,
        end:   q.end   ?? null,
        title: q.title ?? retryTitle,
    })));
    quizState.currentIndex     = 0;
    quizState.correct          = 0;
    quizState.wrong            = 0;
    quizState.wrongItems       = [];
    quizState.answeredQuestions = [];

    // 重新設定音源（取第一題的 title）
    const firstTitle = quizState.questions[0]?.title;
    if (firstTitle) _setQuizAudioSrc(`audio/${encodeURIComponent(firstTitle.trim())}.mp3`);

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
        const tsData = await getTimestampForStoryWithCache(title) // BUG-10 FIX;
        if (!tsData || tsData.length === 0) {
            showNotification('Timestamp file not found for this article.', 'error');
            return;
        }
        const sel = quizState.selectedDifficulties;
        const rawPool = tsData.filter(l => {
            if (!l.sentence || l.sentence.trim().split(/\s+/).length < 4) return false;
            if (!sel || sel.size === 0 || sel.size === 3) return true;
            return sel.has(getDifficultyLabel(l.sentence.trim().split(/\s+/).length).diff);
        });
        if (rawPool.length === 0) {
            const diffLabel = (!sel || sel.size === 3) ? '' : [...sel].join('/') + ' ';
            showNotification(`No ${diffLabel}sentences found in this article.`, 'warning');
            return;
        }
        // BUG-4 FIX: 改用 weightedSample 取代純隨機 shuffle().slice()，
        // 讓 article 來源的 Reorder 也享有間隔重複（熟悉的句子少出，不熟的優先出）。
        const allMappedArticle = rawPool.map(l => ({
            sentence: l.sentence.trim(),
            start: l.start,
            end: l.end,
            title
        }));
        sentences = weightedSample(
            allMappedArticle,
            quizState.questionCount || 10,
            item => item.sentence,
            quizState.categoryName,
            quizState.titleName,
            'articleSentences'
        );

        // Preload audio
        _setQuizAudioSrc(`audio/${encodeURIComponent(title.trim())}.mp3`);
    } else {
        // From Note — 用 titleName 抓 timestamp，比對句子找 start/end
        const title = quizState.titleName;
        const items = getAllNoteItems(quizState.scope, quizState.categoryName, title);
        const sel = quizState.selectedDifficulties;
        const allNoteSents = Array.from(items.sentences || [])
            .filter(s => s.trim().split(/\s+/).length >= 4);
        const filteredNoteSents = (!sel || sel.size === 0 || sel.size === 3) ? allNoteSents : allNoteSents.filter(s => {
            const wc = s.trim().split(/\s+/).length;
            return sel.has(getDifficultyLabel(wc).diff);
        });
        if (filteredNoteSents.length === 0) {
            const diffLabel = (!sel || sel.size === 3) ? '' : [...sel].join('/') + ' ';
            showNotification(`No ${diffLabel}sentences in your notes.`, 'warning');
            return;
        }

        // Try to match each note sentence against timestamp data
        let tsData = null;
        if (title) {
            tsData = await getTimestampForStoryWithCache(title) // BUG-10 FIX;
        }

        // BUG FIX: 先把所有句子 map 成 question 物件，再用 weightedSample 依熟悉度加權抽題
        // 原本用純 shuffle().slice()，導致熟悉/不熟的句子等機率出題，與其他模式不一致
        const allMapped = filteredNoteSents.map(s => {
            const trimmed = s.trim();
            const _norm = t => t.trim().replace(/[.,?!'"`\u201c\u201d\u2018\u2019]/g, '').toLowerCase();
            let start = null, end = null, matchTitle = null;
            if (tsData) {
                const match = tsData.find(l =>
                    l.sentence && _norm(l.sentence) === _norm(trimmed)
                );
                if (match) { start = match.start; end = match.end; matchTitle = title; }
            }
            return { sentence: trimmed, start, end, title: matchTitle };
        });

        sentences = weightedSample(
            allMapped,
            quizState.questionCount || 10,
            item => item.sentence,
            quizState.categoryName,
            quizState.titleName,
            'noteSentences'
        );

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

// ── Reorder Practice Branch — 口說練習狀態機 ──────────────────
// 合法值: 'IDLE' | 'CHECKING' | 'CHECKED' |
//         'PRACTICE_IDLE' | 'RECORDING' | 'RECOGNIZING' | 'PRACTICE_DONE' | 'NEXT'
let reorderPracticeState           = 'IDLE';
let reorderPracticeRecognition     = null;    // SpeechRecognition 實例
let reorderPracticeBestTranscript  = '';      // 本次辨識最佳結果
let reorderPracticeBlob            = null;    // 錄音回放用 Object URL
let reorderPracticeMediaRecorder   = null;    // MediaRecorder 實例
let reorderPracticeChunks          = [];      // 錄音片段暫存
let reorderPracticeTargetSentence  = '';      // 本次練習的目標句（正確句）
let reorderPracticePlaybackAudio   = null;    // 回放用 Audio 物件
let reorderPracticeMimeType        = 'audio/webm'; // 錄音格式

// ★ FIX R-03: 統一管理 is-checked 狀態，防止競態假死
function _reorderSetCheckedState(checked) {
    const area = document.getElementById('quiz-reorder-area');
    if (!area) return;
    if (checked) {
        area.classList.add('is-checked');
        document.getElementById('reorder-clear-btn').disabled = true;
        const backBtn = document.getElementById('reorder-back-btn');
        if (backBtn) backBtn.disabled = true;
    } else {
        area.classList.remove('is-checked');
        document.getElementById('reorder-clear-btn').disabled = false;
        const backBtn = document.getElementById('reorder-back-btn');
        if (backBtn) backBtn.disabled = false;
    }
}

let reorderFirstWord = '';  // 第一個單字
let reorderLastWord = '';   // 最後一個單字
let reorderFirstWordIdx = -1; // shuffle 後 tokens[0] 在 reorderPool 中的索引（避免大小寫重複標記）
let reorderLastWordIdx  = -1; // shuffle 後 tokens[last] 在 reorderPool 中的索引

// ── 單字發音開關（hover / click）────────────────────────────
let reorderWordSpeakEnabled = true;

function _updateReorderSpeakToggleBtn() {
    const btn = document.getElementById('reorder-word-speak-toggle');
    if (!btn) return;
    const iconEl  = btn.querySelector('.reorder-ctrl-icon');
    if (reorderWordSpeakEnabled) {
        btn.classList.remove('reorder-ctrl-word-sound--off');
        btn.classList.add('reorder-ctrl-word-sound--on');
        if (iconEl) iconEl.textContent = '🔊';
    } else {
        btn.classList.remove('reorder-ctrl-word-sound--on');
        btn.classList.add('reorder-ctrl-word-sound--off');
        if (iconEl) iconEl.textContent = '🔇';
    }
}

document.getElementById('reorder-word-speak-toggle').addEventListener('click', () => {
    reorderWordSpeakEnabled = !reorderWordSpeakEnabled;
    _updateReorderSpeakToggleBtn();
});

// 重組句專用發音（三層降級）
function _speakReorderWord(word) {
    const clean = word.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').trim();
    if (!clean) return;
    _quizPlayWord(clean);
}

// _playGithubMp3: 单字或多字 — 統一用 AudioContext 播放，解決 Chrome iOS 靜音問題
async function _playGithubMp3(clean) {
    const words = clean.trim().split(/\s+/).filter(Boolean);
    if (words.length > 1) {
        await _playGithubMp3Sequence(words, 0);
        return;
    }
    // 單字：直接用共用發音函式
    await _quizPlayWord(clean);
}

async function _playGithubMp3Sequence(words, index) {
    if (index >= words.length) return;
    const word  = words[index];
    const clean = word.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').trim();
    if (!clean) { await _playGithubMp3Sequence(words, index + 1); return; }

    // iOS Chrome Fix: resume AudioContext synchronously before any await
    const _AC = window.AudioContext || window.webkitAudioContext;
    if (_AC) {
        if (!window._quizAudioCtx || window._quizAudioCtx.state === 'closed') {
            window._quizAudioCtx = new _AC();
        }
        if (window._quizAudioCtx.state === 'suspended') {
            window._quizAudioCtx.resume().catch(() => {});
        }
    }

    const BASE        = 'https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/';
    const capitalized = clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
    const lower       = clean.toLowerCase();
    const candidates  = [...new Set([capitalized, lower, clean.trim()])];

    let played = false;
    for (const candidate of candidates) {
        const src = BASE + encodeURIComponent(candidate) + '.mp3';
        try {
            const resp = await fetch(src);
            if (!resp.ok) continue;
            const arrayBuf = await resp.arrayBuffer();
            const ctx = window._quizAudioCtx;
            if (!ctx) break;
            if (ctx.state === 'suspended') await ctx.resume();
            const decoded = await ctx.decodeAudioData(arrayBuf);
            const source  = ctx.createBufferSource();
            source.buffer = decoded;
            source.connect(ctx.destination);
            if (typeof showAudioSourceHint === 'function') showAudioSourceHint('mp3');
            await new Promise(resolve => {
                source.onended = resolve;
                source.start(0);
            });
            played = true;
            break;
        } catch (e) { continue; }
    }

    if (!played) {
        // 找不到 MP3 → TTS 備用這個字
        if (typeof showAudioSourceHint === 'function') showAudioSourceHint('tts');
        if ('speechSynthesis' in window) {
            await new Promise(resolve => {
                const u = new SpeechSynthesisUtterance(clean);
                u.lang = 'en-US';
                u.rate = 0.9;
                u.onend = resolve;
                u.onerror = resolve;
                window.speechSynthesis.cancel();
                window.speechSynthesis.speak(u);
                setTimeout(resolve, 2000); // 防御性超時
            });
        }
    }

    // 播完這個字→繼續播下一個
    await _playGithubMp3Sequence(words, index + 1);
}

function _speakWithWebSpeech(clean) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'en-US';
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
}

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
    // FIX-D4: 換題前強制清除任何殘留的拖曳 ghost 元素與插入指示器
    if (_drag.ghost) {
        _drag.ghost.remove();
        _drag.ghost = null;
    }
    _removeInsertIndicator();
    _drag = { active: false, ghost: null, source: null, poolIdx: null, answerPos: null, word: null, startX: 0, startY: 0, moved: false, originEl: null };
    _resetReplayCount();
    _reorderPracticeCleanup(); // 換題時清理前一題的練習狀態與錄音資源
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
    // BUG-03 FIX: 用 { word, origIdx } 結構 shuffle，origIdx 天生唯一，
    // 即使句子有重複詞（如 "Go go go!"）hint 索引也永遠精準
    const tokens = tokenize(q.sentence);
    const indexedTokens = tokens.map((word, origIdx) => ({ word, origIdx }));
    let shuffledIndexed;
    let _shuffleAttempts = 0;
    do {
        shuffledIndexed = shuffle([...indexedTokens]);
        _shuffleAttempts++;
    } while (
        tokens.length > 1 &&
        _shuffleAttempts < 50 &&
        shuffledIndexed.map(t => t.word).join(' ') === tokens.join(' ')
    );
    reorderPool = shuffledIndexed.map(t => t.word);

    // 記錄第一個和最後一個單字（供 hint 顯示）
    reorderFirstWord = tokens[0];
    reorderLastWord  = tokens[tokens.length - 1];
    // origIdx 唯一，不需要特判 first === last 的情況
    reorderFirstWordIdx = shuffledIndexed.findIndex(t => t.origIdx === 0);
    reorderLastWordIdx  = shuffledIndexed.findIndex(t => t.origIdx === tokens.length - 1);

    // Hint 區域：改為音訊狀態顯示區（音訊閒置時顯示 first/last 提示）
    const hintEl = document.getElementById('reorder-hint');
    _reorderSetAudioStatus('idle');

    // Play button: always visible, disabled if no timestamp
    const playBtn = document.getElementById('reorder-play-btn');
    playBtn.classList.remove('is-hidden');
    playBtn.classList.remove('is-playing-voice', 'is-loading-audio');
    const _playLabelEl = playBtn.querySelector('.reorder-ctrl-label');
    if (_playLabelEl) _playLabelEl.textContent = 'Play';

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
    checkBtn.classList.add('quiz-btn-correct', 'reorder-check-full');
    checkBtn.disabled = false;
    _reorderSetCheckedState(false); // ★ FIX R-03: 統一清除 is-checked class，恢復所有控制按鈕
    document.getElementById('reorder-clear-btn').disabled = false;
    const _backBtn = document.getElementById('reorder-back-btn');
    if (_backBtn) _backBtn.disabled = false;

    renderReorderPool();
    renderReorderAnswer();

    // Auto-play if timestamp available
    if (q.start != null) {
        setTimeout(() => playReorderAudio(q), 150);
    }
}

// (removed — using playSnippet)

/**
 * Reorder 模式：更新 hint 區域為音訊狀態提示
 * state: 'idle' | 'loading' | 'playing'
 */
function _reorderSetAudioStatus(state) {
    const hintEl = document.getElementById('reorder-hint');
    if (!hintEl) return;
    hintEl.style.display = 'block';
    if (state === 'loading') {
        hintEl.innerHTML = '<span class="quiz-audio-status-icon is-spin">⏳</span> <span class="quiz-audio-status-text">載入音檔中…</span>';
        hintEl.className = 'reorder-hint quiz-audio-status--loading';
    } else if (state === 'playing') {
        hintEl.innerHTML = '<span class="quiz-audio-status-icon">🔊</span> <span class="quiz-audio-status-text">播放中，請仔細聆聽</span>';
        hintEl.className = 'reorder-hint quiz-audio-status--playing';
    } else {
        // idle：顯示 first/last 提示
        if (reorderFirstWord && reorderLastWord) {
            hintEl.innerHTML = `Hint: Start with "<strong>${reorderFirstWord}</strong>" and end with "<strong>${reorderLastWord}</strong>"`;
        } else {
            hintEl.textContent = '';
        }
        hintEl.className = 'reorder-hint';
    }
}

function playReorderAudio(q) {
    _trackReplay();
    const playBtn = document.getElementById('reorder-play-btn');
    // 套用使用者調整後的時間（若無調整則使用原始值）
    const timing = getQuizTiming(q.title, q.sentence, q.start, q.end);
    const _pLabel = playBtn.querySelector('.reorder-ctrl-label');
    playSnippet({
        start: timing.start, end: timing.end,
        onLoading: () => {
            _reorderSetAudioStatus('loading');
            playBtn.classList.add('is-loading-audio');
            playBtn.classList.remove('is-playing-voice');
            if (_pLabel) _pLabel.textContent = '⏳ 載入中…';
        },
        onStart: () => {
            _reorderSetAudioStatus('playing');
            playBtn.classList.remove('is-loading-audio');
            playBtn.classList.add('is-playing-voice');
            if (_pLabel) _pLabel.textContent = '🔊 播放中…';
        },
        onEnd: () => {
            _reorderSetAudioStatus('idle');
            playBtn.classList.remove('is-playing-voice', 'is-loading-audio');
            if (_pLabel) _pLabel.textContent = 'Play';
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
                // 答案區內重新排列，不發音
            } else {
                // 從單字池拖進答案區 → 發音
                reorderAnswer.splice(insertPos, 0, { word: _drag.word, idx: _drag.poolIdx });
                if (reorderWordSpeakEnabled) _speakReorderWord(_drag.word);
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

        // 清除鍵盤 highlight，避免重繪後殘留藍框
        _reorderClearHighlight();

        if (_drag.source === 'pool') {
            const idx = _drag.poolIdx;
            if (reorderAnswer.some(a => a.idx === idx)) return;
            reorderAnswer.push({ word: _drag.word, idx });
            if (reorderWordSpeakEnabled) _speakReorderWord(_drag.word); // 點擊放入答案區瞬間發音
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

    // 精確用 shuffle 後的 idx 判斷 hint，避免大小寫不同的同詞被重複標記
    const sameHint = (reorderFirstWordIdx === reorderLastWordIdx);
    let firstHintUsed = false;
    let lastHintUsed  = false;

    sortedEntries.forEach(({ word, idx }) => {
        const isUsed = reorderAnswer.some(a => a.idx === idx);
        const btn = document.createElement('button');
        btn.className = 'reorder-word';
        if (isUsed) btn.classList.add('is-used');

        let isHint = false;
        if (idx === reorderFirstWordIdx && !firstHintUsed) {
            isHint = true;
            firstHintUsed = true;
        } else if (idx === reorderLastWordIdx && !lastHintUsed && (!sameHint || firstHintUsed)) {
            isHint = true;
            lastHintUsed = true;
        }
        if (isHint) btn.classList.add('is-hint-word');

        btn.textContent = word;
        btn.dataset.idx = idx;
        // 同步鍵盤 highlight 狀態，避免重繪後遺留在錯誤的按鈕上
        if (_reorderKeyHighlightIdx !== null && idx === _reorderKeyHighlightIdx && !isUsed) {
            btn.classList.add('is-key-highlight');
        }

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
            if (reorderChecked) {
                // Check 後：若 Word 發音開關是 ON，點擊答案區單字仍可發音
                if (reorderWordSpeakEnabled) _speakReorderWord(item.word);
                return;
            }
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

// Back 按鈕：移除最後一個放入的單字
document.getElementById('reorder-back-btn').addEventListener('click', () => {
    if (reorderChecked || reorderAnswer.length === 0) return;
    reorderAnswer.pop();
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

    // ★ FIX R-02: 立即鎖定 checkBtn，消除 audio async gap 的重入視窗
    document.getElementById('reorder-check-btn').disabled = true;

    reorderChecked = true;
    _reorderSetCheckedState(true); // ★ FIX R-03: 統一鎖定所有控制按鈕

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
        _playSuccessSound('correct');
    } else {
        answerArea.classList.add('is-wrong');

        // LCS diff — find which user words are NOT part of the longest common subsequence
        // so only truly wrong/misplaced words get highlighted red
        // BUG-R1 FIX: use the same normalisation granularity as userStr/correctStr
        // (split the already-normalised strings) so that per-token comparisons are
        // consistent with the whole-sentence isCorrect check, and pure-punctuation
        // tokens that reduce to "" are filtered out rather than becoming stray empty
        // strings that skew the LCS table.
        const userTokens    = userStr.split(' ').filter(Boolean);
        const correctTokens = correctStr.split(' ').filter(Boolean);

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
        // FIX-C2: LCS 長度為 0 時不標差異色，直接顯示完整正確句更清楚
        const _lcsLen = dp[m][n];
        const _diffHtml = _lcsLen === 0
            ? q.sentence.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            : buildCorrectAnswerWithDiff(userAnswerStr, q.sentence);
        feedback.innerHTML = `✗ Correct order: <em class="quiz-review-correct-styled">${_diffHtml}</em>`;
        feedback.className = 'quiz-feedback wrong';
        quizState.wrong++;
        _playWrongSound();
        quizState.wrongItems.push(q.sentence);
    }

    quizState.answeredQuestions.push({
        type: 'sentence',
        question: q.sentence,
        selected: reorderAnswer.map(a => a.word).join(' '),
        correct: q.sentence,
        isCorrect,
        start: q.start ?? null,
        end:   q.end   ?? null,
        title: q.title ?? null,
    });
    if (typeof recordItemResult === 'function') {
        const _rtype = (typeof subpanelSource !== 'undefined' && subpanelSource.reorder === 'article') ? 'articleSentences' : 'noteSentences';
        recordItemResult(quizState.categoryName, quizState.titleName, _rtype, q.sentence, isCorrect, _quizReplayCount, 'reorder');
    }

    // Transform Check button → Next button
    const checkBtn = document.getElementById('reorder-check-btn');
    checkBtn.textContent = 'Next →';
    checkBtn.classList.remove('quiz-btn-correct', 'reorder-check-full');
    checkBtn.classList.add('quiz-btn-next-mode', 'reorder-check-full');
    checkBtn.disabled = false;
    checkBtn.dataset.mode = 'next';

    // 評分完成 → 顯示 Practice 按鈕（答對答錯皆顯示）
    _reorderPracticeTransition('CHECKED');
});

// ══════════════════════════════════════════════════════════════
//  REORDER PRACTICE BRANCH — 口說練習狀態機
// ══════════════════════════════════════════════════════════════

/**
 * 狀態機核心：切換狀態並觸發 UI 更新
 * 所有狀態變更都必須透過此函式
 */
function _reorderPracticeTransition(newState) {
    reorderPracticeState = newState;
    _reorderPracticeUpdateUI(newState);
}

/**
 * 根據當前狀態顯示/隱藏對應 UI 區塊
 *
 * 狀態對應 UI：
 *   IDLE / CHECKING   → practice-zone 隱藏
 *   CHECKED           → zone 顯示，practice-btn 顯示，controls/result 隱藏
 *   PRACTICE_IDLE     → zone 顯示，practice-btn 隱藏，controls 顯示，result 隱藏
 *   RECORDING         → zone 顯示，controls 顯示（mic 動畫），result 隱藏
 *   RECOGNIZING       → zone 顯示，controls 顯示（loading 動畫），result 隱藏
 *   PRACTICE_DONE     → zone 顯示，controls 隱藏，result 顯示
 */
function _reorderPracticeUpdateUI(state) {
    const zone     = document.getElementById('reorder-practice-zone');
    const entryBtn = document.getElementById('reorder-practice-btn');
    const controls = document.getElementById('reorder-practice-controls');
    const result   = document.getElementById('reorder-practice-result');
    const micBtn   = document.getElementById('reorder-practice-mic-btn');
    const label    = document.getElementById('reorder-practice-label');
    if (!zone) return;

    const show = (el) => el && el.classList.remove('is-hidden');
    const hide = (el) => el && el.classList.add('is-hidden');

    switch (state) {
        case 'IDLE':
        case 'CHECKING':
            hide(zone);
            hide(entryBtn);
            hide(controls);
            hide(result);
            break;

        case 'CHECKED':
            show(zone);
            show(entryBtn);
            hide(controls);
            hide(result);
            // 清除 mic 動畫 class
            if (micBtn) {
                micBtn.classList.remove('is-recording', 'is-recognizing');
            }
            break;

        case 'PRACTICE_IDLE':
            show(zone);
            hide(entryBtn);
            show(controls);
            hide(result);
            if (micBtn) {
                micBtn.classList.remove('is-recording', 'is-recognizing');
            }
            if (label) label.textContent = 'Tap mic & say the sentence';
            // 清除辨識文字
            const heardEl = document.getElementById('reorder-practice-heard');
            if (heardEl) heardEl.textContent = '';
            break;

        case 'RECORDING':
            show(zone);
            hide(entryBtn);
            show(controls);
            hide(result);
            if (micBtn) {
                micBtn.classList.add('is-recording');
                micBtn.classList.remove('is-recognizing');
            }
            if (label) label.textContent = '🔴 Recording… tap to stop';
            break;

        case 'RECOGNIZING':
            show(zone);
            hide(entryBtn);
            show(controls);
            hide(result);
            if (micBtn) {
                micBtn.classList.remove('is-recording');
                micBtn.classList.add('is-recognizing');
            }
            if (label) label.textContent = '⏳ Recognizing…';
            break;

        case 'PRACTICE_DONE':
            show(zone);
            hide(entryBtn);
            hide(controls);
            show(result);
            if (micBtn) {
                micBtn.classList.remove('is-recording', 'is-recognizing');
            }
            break;
    }
}

/**
 * 使用者按下 Practice 按鈕後的進入邏輯
 */
function _reorderPracticeEnter() {
    const q = quizState.questions[quizState.currentIndex];
    reorderPracticeTargetSentence = q ? q.sentence : '';
    reorderPracticeBestTranscript = '';
    // 釋放上一輪 Blob
    if (reorderPracticeBlob) {
        URL.revokeObjectURL(reorderPracticeBlob);
        reorderPracticeBlob = null;
    }
    reorderPracticeChunks = [];
    _reorderPracticeTransition('PRACTICE_IDLE');
}

/**
 * 啟動麥克風錄音 + 語音辨識
 */
async function _reorderPracticeStartRecording() {
    // ── iOS AudioContext 解鎖（在手勢堆疊內同步執行）──────────
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
        if (!window._quizAudioCtx || window._quizAudioCtx.state === 'closed') {
            window._quizAudioCtx = new AC();
        }
        if (window._quizAudioCtx.state === 'suspended') {
            window._quizAudioCtx.resume().catch(() => {});
        }
    }

    _reorderPracticeTransition('RECORDING');

    // ── 1. 麥克風 & MediaRecorder ─────────────────────────────
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            console.warn('[ReorderPractice] Mic permission denied:', e);
            _reorderPracticeHandleMicError();
            return;
        }

        reorderPracticeMimeType =
            (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm'))
                ? 'audio/webm'
                : 'audio/mp4';

        try {
            reorderPracticeMediaRecorder = new MediaRecorder(stream, { mimeType: reorderPracticeMimeType });
        } catch (e) {
            stream.getTracks().forEach(t => t.stop());
            reorderPracticeMediaRecorder = null;
        }

        if (reorderPracticeMediaRecorder) {
            reorderPracticeChunks = [];
            reorderPracticeMediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) reorderPracticeChunks.push(e.data);
            };
            reorderPracticeMediaRecorder.onstop = () => {
                stream.getTracks().forEach(t => t.stop());
                if (reorderPracticeChunks.length > 0) {
                    const blob = new Blob(reorderPracticeChunks, { type: reorderPracticeMimeType });
                    if (reorderPracticeBlob) URL.revokeObjectURL(reorderPracticeBlob);
                    reorderPracticeBlob = URL.createObjectURL(blob);
                }
                reorderPracticeChunks = [];
            };
            try {
                reorderPracticeMediaRecorder.start();
            } catch (e) {
                stream.getTracks().forEach(t => t.stop());
                reorderPracticeMediaRecorder = null;
            }
        }
    }

    // ── 2. SpeechRecognition ──────────────────────────────────
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        console.warn('[ReorderPractice] SpeechRecognition not supported');
        return;
    }

    reorderPracticeRecognition = new SR();
    reorderPracticeRecognition.lang = 'en-US';
    reorderPracticeRecognition.continuous = false;
    reorderPracticeRecognition.interimResults = true;

    reorderPracticeRecognition.onresult = (e) => {
        let best = '';
        for (let i = 0; i < e.results.length; i++) {
            if (e.results[i][0].transcript.length > best.length) {
                best = e.results[i][0].transcript;
            }
        }
        reorderPracticeBestTranscript = best;
        // 即時顯示辨識文字
        const heardEl = document.getElementById('reorder-practice-heard');
        if (heardEl) heardEl.textContent = best;
    };

    reorderPracticeRecognition.onend = () => {
        // 若仍在 RECORDING 狀態（自動結束），也停止 MediaRecorder 並進入 RECOGNIZING
        if (reorderPracticeState === 'RECORDING') {
            _reorderPracticeStopMediaRecorder();
        }
        // 進入 RECOGNIZING → 然後立即執行 finish
        if (reorderPracticeState === 'RECORDING' || reorderPracticeState === 'RECOGNIZING') {
            _reorderPracticeTransition('RECOGNIZING');
            // 短暫延遲讓 onstop 有機會產生 Blob，再執行 finish
            setTimeout(_reorderPracticeFinish, 300);
        }
    };

    reorderPracticeRecognition.onerror = (e) => {
        console.warn('[ReorderPractice] SpeechRecognition error:', e.error);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            _reorderPracticeHandleMicError();
        } else {
            // 其他錯誤仍嘗試完成
            _reorderPracticeStopMediaRecorder();
            _reorderPracticeTransition('RECOGNIZING');
            setTimeout(_reorderPracticeFinish, 300);
        }
    };

    try {
        reorderPracticeRecognition.start();
    } catch (e) {
        console.warn('[ReorderPractice] SpeechRecognition start error:', e);
    }
}

/**
 * 停止 MediaRecorder（內部輔助，不改變狀態）
 */
function _reorderPracticeStopMediaRecorder() {
    if (reorderPracticeMediaRecorder && reorderPracticeMediaRecorder.state !== 'inactive') {
        try { reorderPracticeMediaRecorder.stop(); } catch (e) {}
    }
    reorderPracticeMediaRecorder = null;
}

/**
 * 停止錄音（使用者再次點擊 mic 觸發）
 */
function _reorderPracticeStopRecording() {
    // 先停 SpeechRecognition（會觸發 onend → finish）
    if (reorderPracticeRecognition) {
        try { reorderPracticeRecognition.stop(); } catch (e) {}
    }
    _reorderPracticeStopMediaRecorder();
    _reorderPracticeTransition('RECOGNIZING');
}

/**
 * 辨識結束後，執行比對並顯示結果
 */
function _reorderPracticeFinish() {
    // 避免重複執行
    if (reorderPracticeState === 'PRACTICE_DONE') return;

    const target     = reorderPracticeTargetSentence || '';
    const transcript = reorderPracticeBestTranscript || '';

    // 利用現有的 buildCorrectAnswerWithDiff 產生 diff HTML
    const diffHTML = buildCorrectAnswerWithDiff(transcript, target);

    // 判斷是否完全正確
    const normTarget     = normalizeForCheck(target.match(/\S+/g) || []);
    const normTranscript = normalizeForCheck((transcript.match(/\S+/g) || []));
    const isPerfect      = normTarget === normTranscript;

    const diffEl = document.getElementById('reorder-practice-diff');
    if (diffEl) {
        if (transcript.trim() === '') {
            diffEl.innerHTML = '<span style="color:var(--color-text-light)">（未辨識到語音）</span>';
        } else if (isPerfect) {
            diffEl.innerHTML = `<span style="color:#2e7d32;font-weight:700">✓ Perfect!</span><br><em>${diffHTML}</em>`;
        } else {
            diffEl.innerHTML = `<span style="color:#c62828;font-size:0.88em">Correct:</span> <em class="quiz-review-correct-styled">${diffHTML}</em>`;
        }
    }

    _reorderPracticeTransition('PRACTICE_DONE');
}

/**
 * 回放剛才的錄音
 */
function _reorderPracticeReplay() {
    if (!reorderPracticeBlob) return;

    const btn = document.getElementById('reorder-practice-replay-btn');

    // 正在播放 → 停止
    if (reorderPracticePlaybackAudio && !reorderPracticePlaybackAudio.paused) {
        reorderPracticePlaybackAudio.pause();
        reorderPracticePlaybackAudio.currentTime = 0;
        if (btn) btn.classList.remove('is-playing');
        return;
    }

    reorderPracticePlaybackAudio = new Audio(reorderPracticeBlob);
    if (btn) btn.classList.add('is-playing');

    reorderPracticePlaybackAudio.onended = () => {
        if (btn) btn.classList.remove('is-playing');
    };
    reorderPracticePlaybackAudio.onerror = () => {
        if (btn) btn.classList.remove('is-playing');
    };
    reorderPracticePlaybackAudio.play().catch(() => {
        if (btn) btn.classList.remove('is-playing');
    });
}

/**
 * 重錄（Retry 按鈕）
 */
function _reorderPracticeReset() {
    // 停止回放
    if (reorderPracticePlaybackAudio) {
        reorderPracticePlaybackAudio.pause();
        reorderPracticePlaybackAudio = null;
    }
    const replayBtn = document.getElementById('reorder-practice-replay-btn');
    if (replayBtn) replayBtn.classList.remove('is-playing');

    reorderPracticeBestTranscript = '';
    if (reorderPracticeBlob) {
        URL.revokeObjectURL(reorderPracticeBlob);
        reorderPracticeBlob = null;
    }
    reorderPracticeChunks = [];

    _reorderPracticeTransition('PRACTICE_IDLE');
}

/**
 * 麥克風權限被拒或不支援時的錯誤處理
 */
function _reorderPracticeHandleMicError() {
    const micBtn = document.getElementById('reorder-practice-mic-btn');
    if (micBtn) {
        micBtn.classList.add('recognition-failed');
        setTimeout(() => micBtn.classList.remove('recognition-failed'), 1500);
    }
    const label = document.getElementById('reorder-practice-label');
    if (label) label.textContent = '⚠ Mic not available';
    _reorderPracticeTransition('PRACTICE_IDLE');
}

/**
 * 離開題目時清理所有資源（Next / 換題 / Retry Wrong）
 */
function _reorderPracticeCleanup() {
    // 停止錄音（若進行中）
    if (reorderPracticeState === 'RECORDING' || reorderPracticeState === 'RECOGNIZING') {
        if (reorderPracticeRecognition) {
            try { reorderPracticeRecognition.abort(); } catch (e) {}
            reorderPracticeRecognition = null;
        }
        _reorderPracticeStopMediaRecorder();
    }
    // 停止回放
    if (reorderPracticePlaybackAudio) {
        reorderPracticePlaybackAudio.pause();
        reorderPracticePlaybackAudio = null;
    }
    // 釋放 Blob URL
    if (reorderPracticeBlob) {
        URL.revokeObjectURL(reorderPracticeBlob);
        reorderPracticeBlob = null;
    }
    // 重置所有狀態變數
    reorderPracticeBestTranscript = '';
    reorderPracticeChunks         = [];
    reorderPracticeTargetSentence = '';
    reorderPracticeRecognition    = null;
    reorderPracticeMediaRecorder  = null;

    // 回到 IDLE 並更新 UI（隱藏整個 zone）
    _reorderPracticeTransition('IDLE');
}

// ── Reorder Practice Event Listeners ──────────────────────────

// Practice 入口按鈕
document.getElementById('reorder-practice-btn')
    ?.addEventListener('click', _reorderPracticeEnter);

// Mic 按鈕（toggle 錄音）
document.getElementById('reorder-practice-mic-btn')
    ?.addEventListener('click', () => {
        if (reorderPracticeState === 'RECORDING') {
            _reorderPracticeStopRecording();
        } else if (reorderPracticeState === 'PRACTICE_IDLE') {
            _reorderPracticeStartRecording();
        }
    });

// Replay 按鈕
document.getElementById('reorder-practice-replay-btn')
    ?.addEventListener('click', _reorderPracticeReplay);

// Retry 按鈕
document.getElementById('reorder-practice-retry-btn')
    ?.addEventListener('click', _reorderPracticeReset);

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

    // 按下字母鍵瞬間發音（受 Word Sound 開關控制）
    if (reorderWordSpeakEnabled) _speakReorderWord(reorderPool[targetIdx]);

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
        if (playBtn && !playBtn.classList.contains('is-hidden')) {
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
        _applySubpanelDefaults('fcplus');
        panel.classList.remove('is-hidden');
        card.classList.add('is-expanded');
        updateQuizAvailableCount('fcplus');
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
        updateQuizAvailableCount('fcplus');
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
        ...items.words.map(w => typeof w === 'string' ? { text: w, type: 'word' } : { ...w, type: 'word' }),
        ...items.phrases.map(p => typeof p === 'string' ? { text: p, type: 'phrase' } : { ...p, type: 'phrase' })
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

    allItems = filterByWordDifficulty(allItems); // CEFR multi-select

    if (allItems.length === 0) {
        showNotification('No words found for the selected CEFR level(s). Try selecting more levels.', 'warning');
        return;
    }

    quizState.mode          = 'fcplus';
    quizState.flashSource   = 'note';
    quizState.deck          = weightedSample(allItems, quizState.questionCount || 10,
                                item => item.text, quizState.categoryName, quizState.titleName, 'noteWords');
    quizState.deckIndex     = 0;
    quizState.againCountMap = {};  // FC-01 FIX (shared field)
    quizState.correct       = 0;
    quizState.wrong         = 0;
    quizState.wrongItems    = [];

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

    const tsData = await getTimestampForStoryWithCache(title) // BUG-10 FIX;

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
    deck = filterByWordDifficulty(deck); // CEFR multi-select
    deck = weightedSample(deck, quizState.questionCount || 10,
                          item => item.text, quizState.categoryName, title, 'articleWords');

    if (deck.length === 0) {
        showNotification(
            'No words found for the selected CEFR level(s). Try selecting more levels.',
            'warning'
        );
        return;
    }

    const audioSrc = `audio/${encodeURIComponent(title.trim())}.mp3`;
    _setQuizAudioSrc(audioSrc);

    quizState.mode          = 'fcplus';
    quizState.flashSource   = 'article';
    quizState.deck          = deck;
    quizState.deckIndex     = 0;
    quizState.againCountMap = {};  // FC-01 FIX (shared field)
    quizState.correct       = 0;
    quizState.wrong         = 0;
    quizState.wrongItems    = [];

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
    _fcpIsFlipped    = false;   // 重置：避免上一題的翻面狀態影響新題

    // 重置播放列：顯示正面播放，隱藏其他
    const _fp = document.getElementById('fcp-front-play');
    const _rp = document.getElementById('fcp-result-play');
    const _bp = document.getElementById('fcp-back-play');
    if (_fp) { _fp.classList.remove('is-hidden'); }
    if (_rp) { _rp.classList.add('is-hidden'); }
    if (_bp) { _bp.classList.add('is-hidden'); }

    // 清除上一題的即時答案列
    const oldInline = document.getElementById('fcplus-inline-answer');
    if (oldInline) oldInline.remove();

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

    // Sentence display — note 模式用 item.noteTitle
    const _fcplusCtxTitle = quizState.flashSource === 'article'
        ? quizState.titleName
        : (item.noteTitle || quizState.titleName); // scope 永遠是 'this'
    const ctx = (quizState.flashSource === 'article' && item.sentence)
        ? item.sentence
        : findContextForWord(item.text.replace(/-/g, ' '), _fcplusCtxTitle);

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

    // Front audio (word pronunciation) — 必須在 await 之前執行，
    // 避免 _setupFcplusFrontAudio 裡的 _fcpPlayBack = null 蓋掉 async 設好的值
    _setupFcplusFrontAudio(item);

    // Back audio
    const backAudioBtn      = document.getElementById('fcplus-back-audio-btn');
    const backEditContainer = document.getElementById('fcplus-back-edit-container');
    backAudioBtn.disabled = true;
    backAudioBtn.onclick  = null;
    if (backEditContainer) backEditContainer.innerHTML = '';

    const flashTitle = _fcplusCtxTitle;
    if (flashTitle && ctx) {
        const audioSrc   = `audio/${encodeURIComponent(flashTitle.trim())}.mp3`;
        _setQuizAudioSrc(audioSrc);
        try {
            const tsData = await getTimestampForStoryWithCache(flashTitle) // BUG-10 FIX;
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
                    _fcpPlayBack = backAudioBtn.onclick; // Space 鍵直接呼叫
                    if (_fcpIsFlipped) _fcpPlayBack();  // 若已翻面（音訊稍晚就緒）立即播

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
            // BUG-08 FIX: 移除從未使用的 isFirst / isLast 廢碼
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

    function _playWord() {
        if (!_fcplusSubmitted) _trackReplay();
        _quizPlayWord(item.text, audioBtn);
    }
    audioBtn.onclick = _playWord;
    _fcpPlayWord = _playWord;  // Space 鍵直接呼叫
    _fcpPlayBack = null;       // 背面音訊尚未設定，先清空
    _fcpIsFlipped = false;     // 重置翻面狀態

    // Also wire result-side audio btn — 結果面翻回正面後播單字（與 Flashcard 一致）
    const resultBtn = document.getElementById('fcplus-audio-btn-result');
    if (resultBtn) resultBtn.onclick = () => { if (_fcpPlayWord) _fcpPlayWord(); };

    // Auto-play first time（三層降級）
    _quizPlayWord(item.text, audioBtn);
    // iOS 封鎖偵測：等待 async fetch 完成後才顯示 pulse 提示（3s 給慢速網路足夠時間）
    setTimeout(() => {
        if (!audioBtn.classList.contains('is-playing-voice') &&
            !window.speechSynthesis?.speaking) {
            audioBtn.classList.add('needs-tap');
        }
    }, 3000);
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
        _playSuccessSound('correct');
    } else {
        quizState.wrong++;
        _playWrongSound();
        quizState.wrongItems.push(word);
        // Mark back-side word red
        const mark = document.getElementById('fcplus-back-mark');
        if (mark) mark.classList.add('fcplus-back-wrong');
    }

    // Hide submit, show flip hint
    document.getElementById('fcplus-submit-btn').classList.add('is-hidden');
    document.getElementById('fcplus-flip-hint').classList.remove('is-hidden');

    // ── 提交後立即顯示正確答案（逐字母紅/綠標色）────────────────
    _showFcplusInlineAnswer(inputs, word);
});

/**
 * 在輸入框下方立即顯示正確答案列
 * 正確字母 → 綠色，錯誤字母 → 紅色（hint 字母用灰色顯示）
 */
function _showFcplusInlineAnswer(inputs, word) {
    // 移除舊的（換題時清除）
    const old = document.getElementById('fcplus-inline-answer');
    if (old) old.remove();

    const container = document.createElement('div');
    container.id = 'fcplus-inline-answer';
    container.style.cssText = [
        'display:flex',
        'flex-wrap:wrap',
        'justify-content:center',
        'gap:3px',
        'margin-top:12px',
        'padding:10px 14px',
        'background:rgba(0,0,0,0.04)',
        'border-radius:10px',
        'border:1px solid rgba(0,0,0,0.08)',
    ].join(';');

    word.split('').forEach((ch, i) => {
        if (ch === '-') {
            const sep = document.createElement('span');
            sep.textContent = '-';
            sep.style.cssText = 'font-size:1.3rem;font-weight:700;color:#aaa;align-self:center;margin:0 2px';
            container.appendChild(sep);
            return;
        }

        const isSegFirst = i === 0 || word[i - 1] === '-';
        const isSegLast  = i === word.length - 1 || word[i + 1] === '-';
        const isHint     = isSegFirst || isSegLast;

        const span = document.createElement('span');
        span.textContent = ch.toLowerCase();
        span.style.cssText = [
            'display:inline-flex',
            'align-items:center',
            'justify-content:center',
            'width:1.7rem',
            'height:2rem',
            'border-radius:5px',
            'font-size:1.1rem',
            'font-weight:700',
            'line-height:1',
        ].join(';');

        if (isHint) {
            // hint 字母（首/尾）用灰色
            span.style.color = '#888';
            span.style.background = 'rgba(0,0,0,0.06)';
        } else {
            const inp = inputs.find(el => parseInt(el.dataset.idx) === i);
            const typed    = inp ? inp.value.toLowerCase() : '';
            const expected = ch.toLowerCase();
            const isOk     = typed === expected;
            span.style.color      = isOk ? '#1a8a3c' : '#d0312d';
            span.style.background = isOk ? 'rgba(26,138,60,0.12)' : 'rgba(208,49,45,0.12)';
            span.style.border     = isOk ? '1px solid rgba(26,138,60,0.3)' : '1px solid rgba(208,49,45,0.3)';
        }
        container.appendChild(span);
    });

    // 插入到 fcplus-letters 之後
    const lettersEl = document.getElementById('fcplus-letters');
    if (lettersEl && lettersEl.parentNode) {
        lettersEl.parentNode.insertBefore(container, lettersEl.nextSibling);
    }
}

// ── Card flip ─────────────────────────────────────────────────

document.getElementById('fcplus-card').addEventListener('click', (e) => {
    // 排除按鈕與輸入框
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.fcplus-result-next-btn')) return;
    if (!_fcplusSubmitted) return;

    const card = document.getElementById('fcplus-card');

    if (!_fcplusFlipped) {
        _fcplusFlipped = true;
        _fcpIsFlipped = true;
        card.classList.add('fcplus-flipped-back');
        _showFcplusBack();
        // 音訊已就緒 → 直接播；尚未就緒 → showFcplusCard async 完成後會自動播
        if (_fcpPlayBack) _fcpPlayBack();
    } else if (!_fcplusAfterFlip) {
        _fcplusAfterFlip = true;
        card.classList.remove('fcplus-flipped-back');
        _showFcplusFrontResult();
        // 結果面翻回正面：自動播單字（與 Flashcard 翻回正面行為一致）
        if (_fcpPlayWord) _fcpPlayWord();

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
    // 播放列：顯示正面播放，隱藏其他
    const fp = document.getElementById('fcp-front-play');
    const rp = document.getElementById('fcp-result-play');
    const bp = document.getElementById('fcp-back-play');
    if (fp) fp.classList.remove('is-hidden');
    if (rp) rp.classList.add('is-hidden');
    if (bp) bp.classList.add('is-hidden');
}

function _showFcplusBack() {
    document.querySelector('.fcplus-front').classList.add('is-hidden');
    document.getElementById('fcplus-front-result').classList.add('is-hidden');
    document.querySelector('.fcplus-back').classList.remove('is-hidden');
    // 播放列：隱藏正面播放，顯示背面播放
    const fp = document.getElementById('fcp-front-play');
    const rp = document.getElementById('fcp-result-play');
    const bp = document.getElementById('fcp-back-play');
    if (fp) fp.classList.add('is-hidden');
    if (rp) rp.classList.add('is-hidden');
    if (bp) bp.classList.remove('is-hidden');
    // 翻到背面時強制移除 input focus，確保空白鍵能被 document keydown 攔截
    document.querySelectorAll('#fcplus-letters .fcplus-letter-input').forEach(inp => inp.blur());
    document.body.focus();
}

function _showFcplusFrontResult() {
    document.querySelector('.fcplus-front').classList.add('is-hidden');
    document.querySelector('.fcplus-back').classList.add('is-hidden');
    const resultEl = document.getElementById('fcplus-front-result');
    resultEl.classList.remove('is-hidden');
    // 播放列：顯示結果面播放，隱藏其他
    const fp = document.getElementById('fcp-front-play');
    const rp = document.getElementById('fcp-result-play');
    const bp = document.getElementById('fcp-back-play');
    if (fp) fp.classList.add('is-hidden');
    if (rp) rp.classList.remove('is-hidden');
    if (bp) bp.classList.add('is-hidden');

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

    // ==================== 結果正面「下一題」按鈕 ====================
    // FCP-03 FIX: always remove existing button first to prevent orphan nodes
    const _oldNextBtn = document.getElementById('fcplus-result-next-btn');
    if (_oldNextBtn) _oldNextBtn.remove();

    const nextBtn = document.createElement('button');
    nextBtn.id = 'fcplus-result-next-btn';
    nextBtn.textContent = '下一題 →';
    nextBtn.className = 'quiz-next-btn fcplus-result-next-btn';
    resultEl.appendChild(nextBtn);
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
        // 若 input 還有 focus，先 blur 移除（避免 Space 被 input 攔截）
        if (document.activeElement && document.activeElement.classList.contains('fcplus-letter-input')) {
            document.activeElement.blur();
        }
        if (_fcplusFlipped && !_fcplusAfterFlip) {
            // 背面：播句子
            if (_fcpPlayBack) _fcpPlayBack();
        } else if (_fcplusAfterFlip) {
            // 結果面（翻回正面）：播單字（與 Flashcard 翻回正面一致）
            if (_fcpPlayWord) _fcpPlayWord();
        } else {
            // 正面：播單字
            if (_fcpPlayWord) _fcpPlayWord();
        }
        return;
    }

    if (e.code === 'Backspace' && !_fcplusSubmitted) {
        // FCP-04 FIX: ignore Backspace when card is flipped or showing result
        if (_fcplusFlipped || _fcplusAfterFlip) return;
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
        // FCP-02 FIX: after submit, Enter must flip card to show answer first
        // only advance to next question after BOTH flips are done
        if (!_fcplusFlipped) { document.getElementById('fcplus-card').click(); return; }
        if (!_fcplusAfterFlip) { document.getElementById('fcplus-card').click(); return; }
        quizState.deckIndex++;
        showFcplusCard();
    }
});

console.log('✅ Flashcard+ loaded.');


// ============================================================
//  VOICE REORDER MODE — voice-reorder.js (integrated)
//  Listen to a sentence → say words one by one to rebuild it
//  Fallback: tap chips manually
// ============================================================

// ── 數字文字 ↔ 阿拉伯數字 對照表 ───────────────────────────────
// 說 "ten" 池子是 "10"，或說 "10" 池子是 "ten"，都能正確匹配
const _VR_NUM_MAP = {
    'zero':'0','one':'1','two':'2','three':'3','four':'4',
    'five':'5','six':'6','seven':'7','eight':'8','nine':'9',
    'ten':'10','eleven':'11','twelve':'12','thirteen':'13','fourteen':'14',
    'fifteen':'15','sixteen':'16','seventeen':'17','eighteen':'18','nineteen':'19',
    'twenty':'20','thirty':'30','forty':'40','fifty':'50',
    'sixty':'60','seventy':'70','eighty':'80','ninety':'90',
    'hundred':'100','thousand':'1000','million':'1000000',
};
// 反向表：數字 → 文字
const _VR_NUM_MAP_REV = Object.fromEntries(Object.entries(_VR_NUM_MAP).map(([k,v]) => [v,k]));

/**
 * 將單字統一正規化：數字文字 → 阿拉伯數字（作為比對用的標準形式）
 * "ten" → "10"，"10" → "10"，"hello" → "hello"
 * [FIX-P2] 移除第二個 if 分支（_VR_NUM_MAP_REV 判斷後仍 return w，與 fallback 完全等價）
 */
function _vrNormalizeNum(w) {
    return _VR_NUM_MAP[w] || w;   // 文字→數字；其他（含已是數字）直接保留
}

// ── [REMOVED] _vrLevenshtein 與 _VR_SKIP 已移除：
// 目前 _approxEq 固定使用精準比對模式，Levenshtein 模糊配對功能尚未啟用。
// 若未來需要啟用模糊比對，請重新引入並在 _approxEq 中移除 return false 一行。

/**
 * Match heard transcript against remaining pool words.
 * Returns pool array index (not word index) of best match, or -1.
 * Layer 1: exact（目前唯一啟用層）
 */

// ── State ───────────────────────────────────────────────────
let _vrState = {
    sentences: [],       // [{text, start, end}] or [{text}]
    qIndex: 0,
    correct: 0,
    total: 0,
    wrongItems: [],
    // per-question
    words: [],           // original tokens (display)
    poolOrder: [],       // shuffled indices into words[] still in pool
    answer: [],          // placed word indices in order
    done: false,
    skipped: false,
    hasAudio: false,     // true when article has timestamp MP3
    audioSrc: '',
    currentTs: null,     // {start, end} of current sentence
    source: 'note',      // 'note' | 'article' — 記錄出題來源，供 recordItemResult 判斷 itemType
};

let _vrRecognition = null;
let _vrIsRecording = false;
let _vrRestartCount = 0;   // 連續重啟計數器（防止 onend 無限迴圈）
let _vrTimeoutId   = null; // [FIX-P0-B] 錄音逾時計時器 ID

// [FIX-P1] iOS Safari 對 continuous:true 支援不完整，每次停頓後就自動觸發 onend。
// 在 iOS 上將重啟上限從 3 提高到 8，讓說話較慢的使用者也能說完整句。
const _vrIsIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
                 (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const _VR_RESTART_LIMIT = _vrIsIOS ? 8 : 3;
const _VrSpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// FIX-5: 語音辨識相容性 Badge — 在 Voice Reorder 卡片上顯示瀏覽器支援狀態
// 無需用戶操作即可看到，避免點進去才發現不支援
(function _initSpeechCompatBadge() {
    const card = document.getElementById('quiz-mode-voice-reorder');
    if (!card) return;

    const badge = document.createElement('div');
    badge.id = 'speech-compat-badge';
    Object.assign(badge.style, {
        fontSize: '0.7rem',
        fontWeight: '600',
        padding: '2px 7px',
        borderRadius: '10px',
        marginTop: '4px',
        display: 'inline-block',
        letterSpacing: '0.02em',
    });

    if (_VrSpeechRecognition) {
        // 支援：顯示綠色打勾
        badge.textContent = '🎙 支援';
        badge.style.backgroundColor = '#e8f5e9';
        badge.style.color = '#2e7d32';
        badge.style.border = '1px solid #a5d6a7';
        badge.title = '您的瀏覽器支援語音辨識';
    } else {
        // 不支援：顯示橘色警告
        badge.textContent = '⚠️ 需要 Chrome';
        badge.style.backgroundColor = '#fff3e0';
        badge.style.color = '#e65100';
        badge.style.border = '1px solid #ffcc80';
        badge.title = '此功能需要 Chrome 瀏覽器，Safari/Firefox 不支援語音辨識 API';
    }

    // 插入到卡片的最後
    card.appendChild(badge);
})();

// ── DOM refs (resolved lazily after HTML is in DOM) ─────────
function _vrEl(id) { return document.getElementById(id); }

// ── Tokenise ───────────────────────────────────────────────
function _vrTokenize(sentence) {
    const raw = sentence.match(/\S+/g) || [];
    // 去除每個 token 的句首句尾標點，讓 chip 顯示更乾淨
    return raw.map(w => w.replace(/^[.,?!:;'"'""\-]+|[.,?!:;'"'""\-]+$/g, '').trim()).filter(Boolean);
}

// ── 比對用正規化：去除所有標點並統一連字符 ──────────────────────
// "self-esteem" → "selfesteem"，語音說 "self esteem" → token "self"+"esteem"
// 會透過 _vrClean 都變成無標點形式，再做 hyphen-aware 匹配
function _vrClean(w) {
    return w.replace(/[.,?!'"'"";:\-]/g, '').toLowerCase().trim();
}

// ── hideAllQuizAreas helper (same pattern as other modes) ──
function _vrHideAllAreas() {
    document.querySelectorAll('#quiz-session > div[id$="-area"]').forEach(el => el.classList.add('is-hidden'));
    // Also hide generic ones
    ['quiz-flashcard-area','quiz-fcplus-area','quiz-cloze-area','quiz-dictation-area',
     'quiz-article-listen-area','quiz-article-cloze-area','quiz-reorder-area','quiz-voice-reorder-area'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('is-hidden');
    });
}

// ════════════════════════════════════════════════════════════
//  ENTRY POINT
// ════════════════════════════════════════════════════════════
async function startVoiceReorder(source) {
    quizState.mode = 'voice-reorder';

    // ── Gather sentences ─────────────────────────────────────
    let sentences = [];
    let hasAudio  = false;
    let audioSrc  = '';
    let tsData    = [];

    if (source === 'article') {
        // Need titleName & timestamp file
        if (!quizState.titleName) {
            showNotification('Please select an article first.', 'warning');
            return;
        }
        tsData = await getTimestampForStory(quizState.titleName);
        if (!tsData || tsData.length === 0) {
            showNotification('No timestamp file for this article. Cannot use From Article.', 'warning');
            return;
        }
        // Filter by difficulty (use l.sentence — actual field name in timestamp data)
        const diffFilter = quizState.selectedDifficulties;
        const filtered = tsData.filter(line => {
            const sent = (line.sentence || '').trim();
            if (!sent) return false;
            const wc = _vrTokenize(sent).length;
            const diff = wc <= 8 ? 'easy' : wc <= 15 ? 'medium' : 'hard';
            return diffFilter.size === 3 || diffFilter.has(diff);
        });
        if (filtered.length === 0) {
            showNotification('No sentences match the selected difficulty.', 'warning');
            return;
        }
        sentences = filtered.map(l => ({ text: l.sentence.trim(), start: l.start, end: l.end }));

        // Set audio src
        const story = stories.find(s => s['標題'] === quizState.titleName);
        const major = story?.['大類'] || quizState.categoryName || '';
        audioSrc = `audio/${quizState.titleName}.mp3`;
        _setQuizAudioSrc(audioSrc);
        hasAudio = true;

    } else {
        // From Note: use saved sentences
        const items = getAllNoteItems(quizState.scope, quizState.categoryName, quizState.titleName);
        const noteSentences = items.sentences || [];
        if (noteSentences.length === 0) {
            showNotification('No sentences saved for this article yet.', 'warning');
            return;
        }
        // Filter by difficulty (word count)
        const diffFilter = quizState.selectedDifficulties;
        const filtered = noteSentences.filter(s => {
            const text = typeof s === 'string' ? s : s.text || '';
            const wc = _vrTokenize(text).length;
            const diff = wc <= 8 ? 'easy' : wc <= 15 ? 'medium' : 'hard';
            return diffFilter.size === 3 || diffFilter.has(diff);
        });
        if (filtered.length === 0) {
            showNotification('No sentences match the selected difficulty.', 'warning');
            return;
        }
        sentences = filtered.map(s => ({
            text: typeof s === 'string' ? s : s.text || '',
        }));
        hasAudio = false;
    }

    // BUG-3 FIX: 使用間隔重複算法（weightedSample）取代純隨機抽題
    // 傳入 'voiceReorder' 讓分桶時使用較低的衰減底板（15），
    // 避免剛學完但還不熟的句子因底板過高而停留在桶 B 被過度重複出題。
    const n = quizState.questionCount || 10;
    const _vrItemType = (source === 'article') ? 'articleSentences' : 'noteSentences';
    const sampled = weightedSample(
        sentences,
        n,
        s => s.text,
        quizState.categoryName,
        quizState.titleName,
        _vrItemType,
        'voiceReorder'   // 使用 voiceReorder 專屬底板
    );

    _vrState.sentences  = sampled;
    _vrState.qIndex     = 0;
    _vrState.correct    = 0;
    _vrState.total      = sampled.length;
    _vrState.wrongItems = [];
    _vrState.hasAudio   = hasAudio;
    _vrState.audioSrc   = audioSrc;
    _vrState.source     = source; // 保存來源，供 _vrCheckAnswer 判斷 itemType 使用

    // Reset shared quizState for result screen
    quizState.answeredQuestions = [];
    quizState.correct = 0;
    quizState.wrong   = 0;
    quizState.wrongItems = [];

    // Show session
    quizMenu.classList.add('is-hidden');
    quizResult.classList.add('is-hidden');
    quizSession.classList.remove('is-hidden');

    _vrHideAllAreas();
    _vrEl('quiz-voice-reorder-area').classList.remove('is-hidden');

    _vrUpdateProgress();
    _vrLoadQuestion();
}

// ════════════════════════════════════════════════════════════
//  LOAD QUESTION
// ════════════════════════════════════════════════════════════
function _vrLoadQuestion() {
    _vrStopRecordingSilent();
    _vrReleasePlaybackBlob(); // 釋放上一題的錄音 Blob，隱藏回聽按鈕
    const item = _vrState.sentences[_vrState.qIndex];
    _resetReplayCount();

    _vrState.words     = _vrTokenize(item.text);
    // IMPROVE-3 FIX: pool 排序鍵改用 _vrClean（與語音比對邏輯一致），避免含標點單字（self-esteem）排序錯位
    _vrState.poolOrder = _vrState.words.map((_, i) => i).sort((a, b) => _vrClean(_vrState.words[a]).localeCompare(_vrClean(_vrState.words[b])));
    _vrState.answer    = [];
    _vrState.done      = false;
    _vrState.skipped   = false;
    _vrState.currentTs = (item.start !== undefined) ? { start: item.start, end: item.end } : null;

    // Reset UI
    _vrEl('vr-feedback').className = 'quiz-feedback';
    _vrEl('vr-feedback').textContent = '';
    _vrEl('vr-heard-text').textContent = ''; _vrEl('vr-heard-text').classList.remove('has-result','has-error');
    _vrEl('vr-mic-label').textContent = 'Tap mic & say the whole sentence';
    _vrEl('vr-check-btn').textContent = 'Check ✓';
    _vrEl('vr-check-btn').style.display = '';
    _vrEl('vr-check-btn').disabled = false; // ★ FIX VR-01: iOS ghost click 可能在 done 分支設 disabled=true，但 _vrLoadQuestion 從未清除它，導致下一題 Check 永久灰掉。
    _vrEl('vr-answer-zone').classList.remove('vr-correct-flash'); // BUG-5 FIX: 清除上一題的綠色閃爍

    _vrRenderAnswerZone();
    _vrRenderPool();

    _vrNextPending = false; // WARN-2 FIX: 新題載入完畢，解除 pending 鎖

    // Auto-play sentence
    _vrPlaySentence(true);
}

// ── Play sentence ──────────────────────────────────────────
// _vrAudioLoading: 防止重複點擊在載入中時再次觸發
let _vrAudioLoading = false;

/**
 * 設定 VR 播放按鈕的三種狀態：
 *   'loading' → 🔄 載入中（旋轉動畫）
 *   'playing' → ⏸ 播放中
 *   'idle'    → ▶ 待機
 */
function _vrSetPlayBtnState(state) {
    const playBtn   = _vrEl('vr-play-btn');
    const replayBtn = _vrEl('vr-replay-btn');
    const statusBar  = document.getElementById('vr-status-bar');
    const statusIcon = document.getElementById('vr-status-icon');
    const statusText = document.getElementById('vr-status-text');

    // ── 更新隱藏的 play btn（JS 內部仍使用）──
    if (playBtn) {
        const iconEl = playBtn.querySelector('span:first-child');
        if (state === 'loading') {
            if (iconEl) iconEl.textContent = '⏳';
            playBtn.classList.add('is-loading');
            playBtn.disabled = true;
        } else if (state === 'playing') {
            if (iconEl) iconEl.textContent = '⏸';
            playBtn.classList.remove('is-loading');
            playBtn.disabled = false;
        } else {
            if (iconEl) iconEl.textContent = '▶';
            playBtn.classList.remove('is-loading');
            playBtn.disabled = false;
        }
    }

    // ── Replay btn ──
    if (replayBtn) {
        if (state === 'loading') {
            replayBtn.classList.add('is-loading'); replayBtn.disabled = true;
        } else {
            replayBtn.classList.remove('is-loading'); replayBtn.disabled = false;
        }
    }

    // ── 更新 Status Bar（上方可見狀態區）──
    if (statusBar && statusIcon && statusText) {
        statusBar.classList.remove('vr-status--loading', 'vr-status--playing');
        statusIcon.classList.remove('vr-spin');

        if (state === 'loading') {
            statusBar.classList.add('vr-status--loading');
            statusIcon.textContent = '⏳';
            statusIcon.classList.add('vr-spin');
            statusText.textContent = 'Loading audio…';
        } else if (state === 'playing') {
            statusBar.classList.add('vr-status--playing');
            statusIcon.textContent = '🔊';
            statusText.textContent = 'Playing… listen carefully';
        } else { // idle
            statusIcon.textContent = '▶';
            statusText.textContent = 'Play Sentence / Listen, then say each word to place it';
        }
    }

    // ── 清除舊的 feedback loading 訊息 ──
    if (state !== 'loading') {
        const fb = _vrEl('vr-feedback');
        if (fb && fb.textContent.includes('Loading audio')) {
            _vrShowFeedback('', '');
        }
    }
}

function _vrPlaySentence(isAuto) {
    if (!isAuto) _trackReplay();
    const item = _vrState.sentences[_vrState.qIndex];

    if (_vrState.hasAudio && _vrState.currentTs) {
        playSnippet({
            start:     _vrState.currentTs.start,
            end:       _vrState.currentTs.end,
            onLoading: () => { _vrSetPlayBtnState('loading'); },
            onStart:   () => { _vrSetPlayBtnState('playing'); },
            onEnd:     () => { _vrSetPlayBtnState('idle'); },
        });
    } else {
        // TTS fallback
        // BUG-7 FIX: TTS 路徑也先顯示 loading 狀態，再切換到 playing
        if (!('speechSynthesis' in window)) return;
        _vrSetPlayBtnState('loading');
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(item.text);
        u.lang = 'en-US'; u.rate = 0.85;
        u.onstart = () => { _vrSetPlayBtnState('playing'); };
        u.onend  = () => { _vrSetPlayBtnState('idle'); };
        u.onerror = () => { _vrSetPlayBtnState('idle'); };
        speechSynthesis.speak(u);
    }
}

// ════════════════════════════════════════════════════════════
//  VR DRAG SYSTEM — 自由拖曳（對齊 Reorder 模式）
// ════════════════════════════════════════════════════════════

let _vrDrag = {
    active: false, ghost: null, source: null,
    poolIdx: null, answerPos: null, word: null,
    startX: 0, startY: 0,
    originEl: null,
};
const _VR_DRAG_THRESHOLD = 6;

function _vrDragStart(e, source, poolIdx, answerPos, word) {
    if (_vrState.done) return;
    const point = e.touches ? e.touches[0] : e;
    _vrDrag.startX    = point.clientX;
    _vrDrag.startY    = point.clientY;
    _vrDrag.source    = source;
    _vrDrag.poolIdx   = poolIdx;
    _vrDrag.answerPos = answerPos;
    _vrDrag.word      = word;
    _vrDrag.active    = false;
    _vrDrag.originEl  = e.currentTarget;

    const ghost = document.createElement('div');
    ghost.className = 'vr-chip answer-chip reorder-drag-ghost';
    ghost.textContent = word;
    ghost.style.display = 'none';
    document.body.appendChild(ghost);
    _vrDrag.ghost = ghost;
}

function _vrDragMove(e) {
    if (!_vrDrag.ghost) return;
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - _vrDrag.startX;
    const dy = point.clientY - _vrDrag.startY;

    if (!_vrDrag.active && Math.sqrt(dx * dx + dy * dy) > _VR_DRAG_THRESHOLD) {
        _vrDrag.active = true;
        _vrDrag.ghost.style.display = '';
        if (_vrDrag.originEl) _vrDrag.originEl.classList.add('is-dragging');
        _vrUpdateInsertIndicator(point.clientX, point.clientY);
    }
    if (_vrDrag.active) {
        e.preventDefault();
        _vrDrag.ghost.style.left = (point.clientX - _vrDrag.ghost.offsetWidth  / 2) + 'px';
        _vrDrag.ghost.style.top  = (point.clientY - _vrDrag.ghost.offsetHeight / 2) + 'px';
        _vrUpdateInsertIndicator(point.clientX, point.clientY);
    }
}

function _vrDragEnd(e) {
    if (!_vrDrag.ghost) return;
    const point = e.changedTouches ? e.changedTouches[0] : e;
    let _dragPlacedIdx = null; // 記錄本次拖曳放入的 wordIdx（用於進場動畫）

    if (_vrDrag.active) {
        const insertPos = _vrGetInsertPosition(point.clientX, point.clientY);
        _vrRemoveInsertIndicator();
        _vrDrag.ghost.remove();
        _vrDrag.ghost = null;

        if (insertPos !== null) {
            if (_vrDrag.source === 'answer') {
                // 答案區內重排
                _vrState.answer.splice(_vrDrag.answerPos, 1);
                const finalPos = insertPos > _vrDrag.answerPos ? insertPos - 1 : insertPos;
                _vrState.answer.splice(finalPos, 0, _vrDrag.poolIdx);
            } else {
                // pool → 答案區：插入指定位置（拖曳不發音，只有點擊才發音）
                _vrState.poolOrder = _vrState.poolOrder.filter(i => i !== _vrDrag.poolIdx);
                _vrState.answer.splice(insertPos, 0, _vrDrag.poolIdx);
                _dragPlacedIdx = _vrDrag.poolIdx; // ← 記錄以觸發動畫
            }
        } else if (_vrDrag.source === 'answer') {
            // 拖出區外 → 退回 pool
            const wordIdx = _vrState.answer.splice(_vrDrag.answerPos, 1)[0];
            _vrState.poolOrder.push(wordIdx);
        }
        _vrDrag.active = false;

    } else {
        // 點擊（未超過 threshold）
        _vrDrag.ghost.remove();
        _vrDrag.ghost = null;
        _vrDrag.active = false;

        if (_vrDrag.source === 'pool') {
            const idx = _vrDrag.poolIdx;
            if (_vrState.answer.includes(idx)) { _vrResetDrag(); return; }
            _vrState.answer.push(idx);
            _vrState.poolOrder = _vrState.poolOrder.filter(i => i !== idx);
            if (_vrWordSpeakEnabled) _quizPlayWord(_vrDrag.word);
            _vrShowFeedback('', '');
            _vrEl('vr-heard-text').textContent = ''; _vrEl('vr-heard-text').classList.remove('has-result','has-error');
            _vrRenderAnswerZone(idx);   // ← 傳 idx 觸發進場動畫
            _vrRenderPool();
            if (_vrState.answer.length === _vrState.words.length && !_vrState.done) {
                _vrOnAllPlaced();
            }
            _vrResetDrag();
            return;
        } else {
            // answer chip 點擊 → 退回 pool
            const wordIdx = _vrState.answer.splice(_vrDrag.answerPos, 1)[0];
            _vrState.poolOrder.push(wordIdx);
        }
    }

    _vrShowFeedback('', '');
    _vrEl('vr-heard-text').textContent = ''; _vrEl('vr-heard-text').classList.remove('has-result','has-error');
    _vrRenderAnswerZone(_dragPlacedIdx ?? undefined);
    _vrRenderPool();

    if (_vrState.answer.length === _vrState.words.length && !_vrState.done) {
        // Fix 9: 手動拖曳補完最後一字時，語音 feedback（"X words placed — N more to go"）
        // 已在上方 _vrShowFeedback('','') 清除，_vrOnAllPlaced 不會再疊上舊文字
        _vrOnAllPlaced();
    }

    _vrResetDrag();
}

function _vrResetDrag() {
    _vrDrag = { active: false, ghost: null, source: null, poolIdx: null, answerPos: null, word: null, startX: 0, startY: 0, originEl: null };
}

// ── VR 插入位置計算（多行支援）────────────────────────────────
function _vrGetInsertPosition(clientX, clientY) {
    const zone = _vrEl('vr-answer-zone');
    const rect = zone.getBoundingClientRect();
    if (clientX < rect.left - 40 || clientX > rect.right  + 40 ||
        clientY < rect.top  - 40 || clientY > rect.bottom + 40) {
        return null;
    }
    const chips = [...zone.querySelectorAll('.vr-chip.answer-chip')];
    if (chips.length === 0) return 0;

    // 分行（midY 差距 ≤ 10px 視為同一行）
    const rows = [];
    let curRow = [], curTop = null;
    for (const chip of chips) {
        const r = chip.getBoundingClientRect();
        const midY = r.top + r.height / 2;
        if (curTop === null || Math.abs(midY - curTop) <= 10) {
            curRow.push({ el: chip, rect: r });
            if (curTop === null) curTop = midY;
        } else {
            rows.push(curRow);
            curRow = [{ el: chip, rect: r }];
            curTop = midY;
        }
    }
    if (curRow.length) rows.push(curRow);

    // 找最近的一行
    let bestRow = rows[0], bestDist = Infinity;
    for (const row of rows) {
        const top = row[0].rect.top, bot = row[0].rect.bottom;
        const dist = clientY < top ? top - clientY : clientY > bot ? clientY - bot : 0;
        if (dist < bestDist) { bestDist = dist; bestRow = row; }
    }

    // 依 X 軸決定插入位置
    for (let k = 0; k < bestRow.length; k++) {
        const r = bestRow[k].rect;
        if (clientX < r.left + r.width / 2) return chips.indexOf(bestRow[k].el);
    }
    return chips.indexOf(bestRow[bestRow.length - 1].el) + 1;
}

// ── VR 插入指示器 ─────────────────────────────────────────────
let _vrInsertIndicatorEl = null;

function _vrUpdateInsertIndicator(clientX, clientY) {
    const zone = _vrEl('vr-answer-zone');
    const pos  = _vrGetInsertPosition(clientX, clientY);
    if (pos === null) { _vrRemoveInsertIndicator(); zone.classList.remove('drag-over'); return; }
    zone.classList.add('drag-over');
    if (!_vrInsertIndicatorEl) {
        _vrInsertIndicatorEl = document.createElement('div');
        _vrInsertIndicatorEl.className = 'reorder-insert-indicator';
    }
    const chips = [...zone.querySelectorAll('.vr-chip.answer-chip')];
    if (chips.length === 0 || pos >= chips.length) {
        zone.appendChild(_vrInsertIndicatorEl);
    } else {
        zone.insertBefore(_vrInsertIndicatorEl, chips[pos]);
    }
    // 左右相鄰 chip 搖晃提示
    _vrClearNeighborHighlight();
    const leftChip  = chips[pos - 1] ?? null;
    const rightChip = chips[pos]     ?? null;
    if (leftChip)  leftChip.classList.add('is-neighbor-left');
    if (rightChip) rightChip.classList.add('is-neighbor-right');
}

function _vrClearNeighborHighlight() {
    const zone = _vrEl('vr-answer-zone');
    if (!zone) return;
    zone.querySelectorAll('.is-neighbor-left, .is-neighbor-right').forEach(el => {
        el.classList.remove('is-neighbor-left', 'is-neighbor-right');
    });
}

function _vrRemoveInsertIndicator() {
    const zone = _vrEl('vr-answer-zone');
    if (zone) zone.classList.remove('drag-over');
    if (_vrInsertIndicatorEl?.parentNode) _vrInsertIndicatorEl.parentNode.removeChild(_vrInsertIndicatorEl);
    _vrInsertIndicatorEl = null;
    _vrClearNeighborHighlight();
}

// 全域 pointer/touch 事件（拖曳離開元素後仍有效）
document.addEventListener('pointermove', (e) => { if (_vrDrag.ghost) _vrDragMove(e); }, { passive: false });
document.addEventListener('pointerup',   (e) => { if (_vrDrag.ghost) _vrDragEnd(e); });
document.addEventListener('touchmove',   (e) => { if (_vrDrag.ghost && _vrDrag.active) e.preventDefault(); }, { passive: false });

// ── Render answer zone ────────────────────────────────────
function _vrRenderAnswerZone(latestIdx) {
    const zone = _vrEl('vr-answer-zone');
    zone.innerHTML = '';
    if (_vrState.answer.length === 0) {
        const hint = document.createElement('span');
        hint.className = 'vr-answer-empty';
        hint.textContent = 'Drag or tap words below to build the sentence…';
        zone.appendChild(hint);
        return;
    }

    // 找出 latestIdx 在答案陣列中的位置（用於觸發左右鄰居動畫）
    const latestPos = (latestIdx !== undefined && latestIdx !== null)
        ? _vrState.answer.indexOf(latestIdx) : -1;

    _vrState.answer.forEach((wordIdx, pos) => {
        const chip = document.createElement('span');
        let cls = 'vr-chip answer-chip';
        if (wordIdx === latestIdx) {
            cls += ' just-arrived';
        } else if (latestPos >= 0 && pos === latestPos - 1) {
            cls += ' vr-neighbor-left';
        } else if (latestPos >= 0 && pos === latestPos + 1) {
            cls += ' vr-neighbor-right';
        }
        chip.className = cls;
        chip.textContent = _vrState.words[wordIdx];
        chip.style.touchAction = 'none';

        // 鄰居動畫只播一次，結束後移除 class
        if (cls.includes('vr-neighbor-')) {
            chip.addEventListener('animationend', () => {
                chip.classList.remove('vr-neighbor-left', 'vr-neighbor-right');
            }, { once: true });
        }

        chip.addEventListener('pointerdown', (e) => {
            if (_vrState.done) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            _vrDragStart(e, 'answer', wordIdx, pos, _vrState.words[wordIdx]);
        });
        zone.appendChild(chip);
    });
}

// ── Render word pool ──────────────────────────────────────
function _vrRenderPool() {
    const pool = _vrEl('vr-word-pool');
    pool.innerHTML = '';
    if (_vrState.poolOrder.length === 0) {
        pool.innerHTML = '<div style="padding:8px;color:var(--color-text-light);text-align:center;font-size:0.88em;">All words placed ✓</div>';
        return;
    }
    _vrState.poolOrder.forEach(idx => {
        const chip = document.createElement('span');
        chip.className = 'vr-chip pool-chip';
        chip.textContent = _vrState.words[idx];
        chip.dataset.wordIdx = idx;
        chip.style.touchAction = 'none';
        chip.addEventListener('pointerdown', (e) => {
            if (_vrState.done) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            _vrDragStart(e, 'pool', idx, null, _vrState.words[idx]);
        });
        pool.appendChild(chip);
    });
}

// ── Place word（供語音路徑呼叫；點擊/拖曳統一由 _vrDragEnd 處理）──
function _vrPlaceWord(wordIdx) {
    if (_vrState.done) return;
    if (_vrState.answer.includes(wordIdx)) return;

    _vrState.answer.push(wordIdx);
    _vrState.poolOrder = _vrState.poolOrder.filter(i => i !== wordIdx);
    _vrShowFeedback('', '');
    _vrEl('vr-heard-text').textContent = ''; _vrEl('vr-heard-text').classList.remove('has-result','has-error');
    _vrRenderAnswerZone(wordIdx);
    _vrRenderPool();

    // 語音辨識自動放字：不發音（只有手動點擊 pool chip 才發音）

    if (_vrState.answer.length === _vrState.words.length) {
        _vrOnAllPlaced();
    }
}

// ── Undo last ─────────────────────────────────────────────
function _vrUndoLast() {
    if (_vrState.done || _vrState.answer.length === 0) return;
    const last = _vrState.answer.pop();
    _vrState.poolOrder.push(last);
    _vrShowFeedback('', '');
    _vrEl('vr-heard-text').textContent = ''; _vrEl('vr-heard-text').classList.remove('has-result','has-error');
    _vrRenderAnswerZone();
    _vrRenderPool();
}

// ── All words placed → prompt check ──────────────────────
function _vrOnAllPlaced() {
    // 停止 Speech Recognition 但保留 MediaRecorder 繼續錄音，
    // 讓 _vrCheckAnswer 停止時才產生 Blob 顯示回聽按鈕
    _vrIsRecording = false;
    if (_vrRecognition) {
        try { _vrRecognition.stop(); } catch(e) {}
        _vrRecognition = null;
    }
    _vrBestTranscript = '';
    _vrSetMicOff();
    // ★ 不呼叫 _vrStopAudioRecordingSilent()，讓 MediaRecorder 繼續錄音直到 Check
    _vrEl('vr-mic-label').textContent = 'All words placed — tap Check!';
    // B 方案：播放輕柔「就緒」提示音（告知用戶可以按 Check）
    _playReadySound();
}

/**
 * 播放輕柔的「就緒」提示音（全部字放完但尚未 check）
 * 音調比答對音效低，音量小，不搶佔音效上下文
 */
function _playReadySound() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx = window._quizAudioCtx;
    if (!ctx || ctx.state === 'closed') {
        try { ctx = new AC(); } catch (e) { return; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    // 兩個短音（輕）
    [{ freq: 440, t: 0 }, { freq: 523.25, t: 0.1 }].forEach(({ freq, t }) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + t);
        gain.gain.setValueAtTime(0, now + t);
        gain.gain.linearRampToValueAtTime(0.12, now + t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.20);
        osc.start(now + t);
        osc.stop(now + t + 0.22);
    });
}

// ── Check answer ──────────────────────────────────────────
function _vrCheckAnswer() {
    if (_vrState.done) {
        // WARN-2 FIX: 雙重保護 — disabled + _vrNextPending flag，防止快速雙擊時多跳一題
        if (_vrNextPending) return;
        _vrNextPending = true;
        _vrEl('vr-check-btn').disabled = true;
        // Next question
        _vrState.qIndex++;
        if (_vrState.qIndex >= _vrState.total) {
            _vrNextPending = false;
            _vrFinish();
        } else {
            _vrUpdateProgress();
            _vrLoadQuestion(); // _vrLoadQuestion 結尾會重置 _vrNextPending
        }
        return;
    }

    _vrState.done = true;

    // 停止 Speech Recognition（靜默），但讓 MediaRecorder 正常停止產生 Blob → 顯示回聽按鈕
    _vrIsRecording = false;
    if (_vrRecognition) {
        try { _vrRecognition.stop(); } catch(e) {}
        _vrRecognition = null;
    }
    _vrBestTranscript = '';
    _vrSetMicOff();
    _vrStopAudioRecording(); // ★ 正常停止 → 產生 Blob，顯示回聽按鈕

    const userText    = _vrState.answer.map(i => _vrState.words[i]).join(' ');
    const correctText = _vrState.words.join(' ');
    // 固定精準比對：字序與字詞完全相同才算正確（無 Fuzzy 模式）
    const isCorrect   = !_vrState.skipped && userText === correctText;

    if (isCorrect) {
        _vrState.correct++;
        _vrEl('vr-answer-zone').classList.add('vr-correct-flash');
        _vrShowFeedback('ok', '✓ Perfect!');
        _playSuccessSound('correct');
    } else {
        _vrShowFeedback('wrong', `Answer: ${correctText}`);
        // WARN-1 FIX: 存 {text, qIndex} 而非純文字，避免重複句子時 Retry 時抓錯音訊段落
        _vrState.wrongItems.push({ text: correctText, qIndex: _vrState.qIndex });
    }

    // Track in answeredQuestions — 欄位對齊 showQuizResult 期望格式
    quizState.answeredQuestions.push({
        type:      'sentence',
        question:  correctText,
        selected:  userText,       // result screen 用 item.selected 顯示「Your answer」
        correct:   correctText,    // result screen 用 item.correct 顯示正確答案（字串）
        isCorrect,                 // result screen 用 item.isCorrect 判斷對錯 CSS
        start:     _vrState.currentTs?.start ?? null,
        end:       _vrState.currentTs?.end   ?? null,
        title:     quizState.titleName ?? null,
    });

    // Bug 2 Fix: 記錄 item-level 分數到 scores dashboard
    if (typeof recordItemResult === 'function') {
        // 使用 _vrState.source（'article'|'note'）判斷 itemType，
        // 與 startVoiceReorder 的抽題邏輯保持一致，不依賴 hasAudio 狀態
        const _vrItemType = (_vrState.source === 'article') ? 'articleSentences' : 'noteSentences';
        recordItemResult(
            quizState.categoryName,
            quizState.titleName,
            _vrItemType,
            correctText,
            isCorrect,
            _quizReplayCount,
            'voiceReorder'   // 存入 'voiceReorder' source key，口說成績獨立計算
        );
    }

    _vrEl('vr-check-btn').textContent = 'Next →';
    _vrEl('vr-mic-label').textContent = 'Tap Next for the next sentence.';
}

// ── Finish ─────────────────────────────────────────────────
function _vrFinish() {
    _vrStopRecordingSilent();

    quizState.correct    = _vrState.correct;
    quizState.wrong      = _vrState.total - _vrState.correct;
    // WARN-1 FIX: showQuizResult expects plain text strings, extract .text from wrongItems objects
    const wrongTexts = _vrState.wrongItems.map(w => (typeof w === 'object' ? w.text : w));
    quizState.wrongItems = wrongTexts;

    showQuizResult('voice-reorder', _vrState.correct, _vrState.total, wrongTexts);
}

// ── Retry Wrong (BUG-2 FIX) ──────────────────────────────
/**
 * 只練錯的：用 _vrState.wrongItems 重新組成句子清單，重新開始 Voice Reorder。
 * wrongItems 儲存的是正確句子文字，需重新對應原始資料（保留 start/end 音訊時間戳）。
 */
function _vrStartRetryWrong() {
    if (!_vrState.wrongItems || _vrState.wrongItems.length === 0) {
        showNotification('No wrong sentences to retry!', 'info');
        return;
    }

    // WARN-1 FIX: wrongItems 現在存 {text, qIndex}，用 qIndex 精確匹配原始 sentences
    // 避免重複句子（相同文字）時抓到錯誤的音訊段落
    const wrongEntries = _vrState.wrongItems; // [{text, qIndex}, ...]
    const retrySentences = wrongEntries
        .map(entry => _vrState.sentences[entry.qIndex])
        .filter(Boolean);

    // 若無法以 qIndex 對應（例如 sentences 已被 shuffle 覆蓋），fallback 用文字比對
    const wrongTextsSet = new Set(wrongEntries.map(e => e.text));
    const fallback = _vrState.sentences.filter(s => wrongTextsSet.has(s.text));
    const finalSentences = retrySentences.length > 0 ? retrySentences : fallback;

    _vrState.sentences  = shuffle(finalSentences);
    _vrState.qIndex     = 0;
    _vrState.correct    = 0;
    _vrState.total      = finalSentences.length;
    _vrState.wrongItems = [];

    quizState.answeredQuestions = [];
    quizState.correct    = 0;
    quizState.wrong      = 0;
    quizState.wrongItems = [];
    quizState.retryWrongOnly = true;

    quizResult.classList.add('is-hidden');
    quizSession.classList.remove('is-hidden');

    _vrHideAllAreas();
    _vrEl('quiz-voice-reorder-area').classList.remove('is-hidden');

    _vrUpdateProgress();
    _vrLoadQuestion();
}

// ── Progress (BUG-6 FIX: 進度條百分比與文字同步) ─────────────
function _vrUpdateProgress() {
    const done  = _vrState.qIndex;
    const total = _vrState.total;
    // IMPROVE-1 FIX: bar 寬度用 done/total（最後一題按 Check 後才滿格）
    // 文字維持 done+1/total（讓第 1 題顯示「1/N」而非「0/N」）
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
    const progText = _vrEl('quiz-progress-text');
    const progFill = _vrEl('quiz-progress-fill');
    if (progText) progText.textContent = `${done + 1} / ${total}`;
    if (progFill) progFill.style.width = pct + '%';
}

// ── Feedback ──────────────────────────────────────────────
function _vrShowFeedback(type, msg) {
    const el = _vrEl('vr-feedback');
    if (!msg) { el.className = 'quiz-feedback'; el.textContent = ''; return; }
    const typeClass = type === 'ok' ? 'correct'
                    : type === 'wrong' ? 'wrong'
                    : type === 'info'  ? 'loading-hint'
                    : '';
    el.className = `quiz-feedback is-visible ${typeClass}`;
    el.textContent = msg;
}

// ════════════════════════════════════════════════════════════
//  SPEECH RECOGNITION
// ════════════════════════════════════════════════════════════
function _vrStartRecording() {
    if (!_VrSpeechRecognition) {
        showNotification('Speech recognition not supported. Please use Chrome or Safari.', 'warning');
        return;
    }
    _vrRestartCount = 0; // 每次全新錄音，重置重啟計數器
    // 先停掉舊的 recognition（不清空答案，純粹重啟 API）
    if (_vrRecognition) {
        try { _vrRecognition.stop(); } catch(e) {}
        _vrRecognition = null;
    }

    // 清空 transcript 記錄（本次全新錄音）
    _vrBestTranscript = '';

    // Fix 1: 用本地 reference 綁定當下實例，防止快速重啟時舊 onend 操控新實例（殭屍 Recognition）
    const recog = new _VrSpeechRecognition();
    _vrRecognition = recog;
    recog.lang            = 'en-US';
    recog.continuous      = true;
    recog.interimResults  = true;
    recog.maxAlternatives = 1;

    recog.onresult = (e) => {
        // 若此實例已被取代，忽略所有回調（防止多實例同時寫入 _vrBestTranscript）
        if (recog !== _vrRecognition) return;
        // 優先累積 isFinal segment；interim 僅用於即時預覽，不覆蓋已確認結果
        let finalText   = '';
        let interimText = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) {
                finalText   += ' ' + e.results[i][0].transcript;
            } else {
                interimText += ' ' + e.results[i][0].transcript;
            }
        }

        if (finalText.trim()) {
            // 累積所有 final segment（防止 API 分多次回傳）
            // Fix 6: 每次收到 isFinal 結果就重置重啟計數器，讓「說話→停頓→說話」不被上限截斷
            _vrRestartCount = 0;
            _vrBestTranscript = (_vrBestTranscript + ' ' + finalText).trim();
            _vrEl('vr-heard-text').textContent = `Heard: "${_vrBestTranscript}"…`;
        } else if (interimText.trim()) {
            // Interim 只更新預覽，不寫入 _vrBestTranscript
            _vrEl('vr-heard-text').textContent = `Heard: "${_vrBestTranscript} ${interimText.trim()}"…`;
        }
    };

    // Fix 3: 補齊 audio-capture / network / aborted 等錯誤的使用者提示
    recog.onerror = (e) => {
        if (recog !== _vrRecognition) return; // 已被取代的舊實例，忽略
        if (e.error === 'no-speech') return;  // continuous 模式下 no-speech 不算錯，繼續等
        _vrStopRecordingSilent();
        const errorMessages = {
            'not-allowed':   'Microphone permission denied.',
            'audio-capture': '麥克風被其他程式佔用，請關閉後重試。',
            'network':       '網路連線異常，語音辨識需要網路連線。',
            'aborted':       '語音辨識被中斷，請重新點擊麥克風。',
        };
        const msg = errorMessages[e.error] || `語音辨識錯誤（${e.error}），請重試。`;
        showNotification(msg, 'warning');
    };

    recog.onend = () => {
        // Fix 1: 若此實例已被取代（快速重啟場景），直接退出，不重啟也不更改全域狀態
        if (recog !== _vrRecognition) return;
        // [FIX-P2 注解修正] continuous 模式下 onend 會在以下情況觸發：
        //   - 使用者主動停止（_vrIsRecording = false）→ 正常結束，不重啟
        //   - 系統意外中斷（網路波動、iOS 停頓偵測、切換 App）→ _vrIsRecording 仍為 true → 嘗試重啟
        // iOS Safari 因不完整支援 continuous，停頓後必然觸發此路徑，所以 iOS 上限較高（_VR_RESTART_LIMIT）
        if (_vrIsRecording && !_vrState.done) {
            if (_vrRestartCount >= _VR_RESTART_LIMIT) {
                // 超過重啟上限，放棄重試，告知用戶手動操作
                _vrSetMicOff();
                _vrIsRecording = false;
                _vrRestartCount = 0;
                showNotification('麥克風連線不穩定，請重新點擊麥克風。', 'warning');
                return;
            }
            _vrRestartCount++;
            try { recog.start(); } catch(e) {
                // [FIX-P0-A] 重啟失敗時同步重置 _vrIsRecording，
                // 否則 UI 顯示麥克風關閉，但內部仍認為在錄音，
                // 導致下次點擊麥克風觸發 stop 而非 start，功能整個卡死。
                _vrIsRecording = false;
                _vrSetMicOff();
            }
        } else {
            _vrRestartCount = 0; // 正常停止，重置計數
        }
    };

    try {
        _vrRecognition.start();
        _vrIsRecording = true;
        _vrEl('vr-mic-btn').classList.add('is-recording');
        _vrEl('vr-mic-label').textContent = '🔴 Recording… tap to stop';
        _vrStartAudioRecording(); // 雙軌並行：同步啟動 MediaRecorder 錄音

        // [FIX-P0-B] 30 秒逾時保護：網路不穩時 Web Speech API 有時靜悄悄地停止
        // 回應（onresult / onend 永遠不來），UI 卻一直顯示 🔴 錄音中。
        // 超時後自動停止並提示使用者，避免無限等待。
        const _thisRecog = recog;
        _vrTimeoutId = setTimeout(() => {
            if (_vrIsRecording && _vrRecognition === _thisRecog) {
                _vrStopRecording();
                showNotification('錄音逾時（30 秒），已自動停止。如有辨識結果已套用，否則請重新點麥克風。', 'warning');
            }
        }, 30000);
    } catch(e) {
        showNotification('Could not start microphone. Try again.', 'warning');
    }
}

function _vrStopRecordingSilent() {
    // 內部停止：只關閉 API，不觸發 pending 比對（供 _vrOnAllPlaced / _vrFinish / _vrCheckAnswer 使用）
    _vrIsRecording = false;
    // [FIX-P0-B] 清除逾時計時器，避免停止後仍觸發逾時警告
    if (_vrTimeoutId) { clearTimeout(_vrTimeoutId); _vrTimeoutId = null; }
    if (_vrRecognition) {
        try { _vrRecognition.stop(); } catch(e) {}
        _vrRecognition = null;
    }
    _vrBestTranscript = '';
    _vrSetMicOff();
    _vrStopAudioRecordingSilent(); // 靜默停止 MediaRecorder（不顯示回聽按鈕）
}

function _vrStopRecording() {
    _vrIsRecording = false;
    // [FIX-P0-B] 清除逾時計時器
    if (_vrTimeoutId) { clearTimeout(_vrTimeoutId); _vrTimeoutId = null; }
    if (_vrRecognition) {
        try { _vrRecognition.stop(); } catch(e) {}
        _vrRecognition = null;
    }
    _vrSetMicOff();
    _vrStopAudioRecording(); // 同步停止 MediaRecorder，產生 Blob 供回聽
    // ★ 直接用 _vrBestTranscript：歷史最長、最完整的識別結果
    const heard = _vrBestTranscript.trim();
    const heardEl = _vrEl('vr-heard-text');
    if (heard) {
        heardEl.textContent = `Heard: "${heard}"`;
        heardEl.classList.add('has-result');
        heardEl.classList.remove('has-error');
        _vrProcessSpeech(heard);
    } else {
        // No speech detected — show error state
        heardEl.textContent = "Didn't catch that — try again?";
        heardEl.classList.add('has-error');
        heardEl.classList.remove('has-result');
        const micBtn = _vrEl('vr-mic-btn');
        if (micBtn) {
            micBtn.classList.add('recognition-failed');
            setTimeout(() => micBtn.classList.remove('recognition-failed'), 1400);
        }
    }
    _vrBestTranscript = '';
}

function _vrSetMicOff() {
    const btn = _vrEl('vr-mic-btn');
    if (btn) btn.classList.remove('is-recording');
    const lbl = _vrEl('vr-mic-label');
    if (lbl && !_vrState.done) lbl.textContent = 'Tap mic & say the whole sentence';
}

// ── 縮寫展開對照表（雙向：縮寫→展開 / 展開→縮寫，減少語音辨識格式差異造成的失配）────
const _VR_CONTRACTIONS = {
    // 縮寫 → 展開（API 輸出縮寫，句子用展開形式）
    "it's":     "it is",     "don't":    "do not",    "can't":    "cannot",
    "i'm":      "i am",      "i've":     "i have",    "i'll":     "i will",
    "i'd":      "i would",   "he's":     "he is",     "she's":    "she is",
    "they're":  "they are",  "we're":    "we are",    "you're":   "you are",
    "isn't":    "is not",    "wasn't":   "was not",   "weren't":  "were not",
    "hasn't":   "has not",   "haven't":  "have not",  "won't":    "will not",
    "wouldn't": "would not", "couldn't": "could not", "shouldn't":"should not",
    "that's":   "that is",   "there's":  "there is",  "what's":   "what is",
    "let's":    "let us",    "who's":    "who is",    "he'd":     "he would",
    "she'd":    "she would", "they'd":   "they would","we'd":     "we would",
    "you'd":    "you would", "he'll":    "he will",   "she'll":   "she will",
    "they'll":  "they will", "we'll":    "we will",   "you'll":   "you will",
    "didn't":   "did not",   "doesn't":  "does not",  "hadn't":   "had not",
    "aren't":   "are not",   "i'd've":   "i would have",
};

// IMPROVE-2 FIX: 反向表（展開 → 縮寫），供 _vrExpandContractions 雙向比對使用
// 注意：同一展開形式只對應一個縮寫（取第一個）
const _VR_CONTRACTIONS_REV = (() => {
    const rev = {};
    for (const [k, v] of Object.entries(_VR_CONTRACTIONS)) {
        if (!rev[v]) rev[v] = k; // 先入優先
    }
    return rev;
})();

/**
 * 對語音辨識輸出做縮寫展開預處理：
 * IMPROVE-2 FIX:
 *   1. 先將彎撇號（‘’）統一轉為直撇號，確保 regex 和查表一致
 *   2. 縮寫 → 展開（API 輸出 "don't"，句子用 "do not"）
 *   3. 展開 → 縮寫（API 輸出 "do not"，句子用 "don't"）
 *   兩個方向都跑，讓語音辨識結果與句子池無論哪種格式都能對齊。
 *   複合縮寫 i'd've 透過精確字串比對處理（已在正向表中列出）。
 */
function _vrExpandContractions(text) {
    // Step 1: 彎撇號正規化（iOS/Word 常見）→ 直撇號，確保 regex \w' 能正確匹配
    const normalized = text.toLowerCase().replace(/[‘’]/g, "'");

    // Step 2: 先用多字詞精確比對處理複合縮寫（例如 i'd've / i would have）
    // 必須在單字 regex replace 之前跑，避免被拆散
    let result = normalized;
    // 正向：複合縮寫 → 展開
    for (const [k, v] of Object.entries(_VR_CONTRACTIONS)) {
        if (k.includes("'") && k.split("'").length > 2) { // 含兩個以上撇號 = 複合縮寫
            result = result.split(k).join(v);
        }
    }
    // 反向：展開多詞 → 複合縮寫（例如 "i would have" → "i'd've"）
    for (const [v, k] of Object.entries(_VR_CONTRACTIONS_REV)) {
        if (v.includes(' ') && v.split(' ').length >= 3) { // 三詞以上的展開形式
            result = result.split(v).join(k);
        }
    }

    // Step 3: 單字 regex replace — 縮寫 ↔ 展開雙向處理
    // 先跑正向（縮寫→展開），再跑反向（展開→縮寫）
    // 注意：兩趟都跑確保無論 API 輸出哪種格式都能命中
    result = result.replace(/[\w']+/g, m => _VR_CONTRACTIONS[m] || m);
    // 反向（單詞展開形式，例如 "cannot" → "can't" 在某些句子中有用）
    // 只替換有精確反向對應的詞（避免誤傷正常單字）
    result = result.replace(/[\w]+/g, m => _VR_CONTRACTIONS_REV[m] || m);

    return result;
}

function _vrProcessSpeech(heard) {
    if (_vrState.done) return;

    // ── 縮寫展開預處理：統一縮寫/展開格式，減少格式差異造成的失配 ──
    heard = _vrExpandContractions(heard);

    // ── 按照 heard 的語序，逐一從 pool 找字放入答案區 ──────────
    // 規則：
    //   1. 依 heardTokens 順序逐一掃描
    //   2. 每個 token 在目前剩餘 pool 裡找第一個近似匹配
    //      - 比對前用 _vrClean() 去除標點（"self-esteem" → "selfesteem"）
    //      - 數字正規化（"ten" ↔ "10"）
    //      - 連字符單字跨 token 匹配（說 "self esteem" 匹配池子的 "self-esteem"）
    //   3. 找到 → 從 pool 移除，依序 push 進 answer（維持說話語序）
    //   4. 找不到（pool 沒有該字）→ 跳過，繼續下一個 token
    //   5. pool 裡同一個字只能被匹配一次（先到先得）

    const heardTokens = heard.toLowerCase()
        .replace(/[.,?!'"'"";:]/g, '')   // 去標點但保留 - 讓後面 _vrClean 統一處理
        .split(/\s+/)
        .filter(Boolean);

    if (heardTokens.length === 0) {
        _vrShowFeedback('warn', 'No speech detected — tap mic and try again.');
        return;
    }

    function _approxEq(a, b) {
        // 先統一數字形式再比對（"ten" vs "10" 或 "10" vs "ten" 都算相同）
        const na = _vrNormalizeNum(a), nb = _vrNormalizeNum(b);
        if (na === nb) return true;
        return false; // 固定精準模式：不啟用 Levenshtein 模糊配對
    }

    // 工作用 pool（splice 用，不直接動 _vrState.poolOrder）
    const workingPool = [..._vrState.poolOrder];
    const toPlace = [];

    let t = 0; // heardTokens 的游標
    while (t < heardTokens.length) {
        const token = _vrClean(heardTokens[t]);
        let foundAt = -1;

        // ── 先嘗試單 token 匹配 ────────────────────────────────
        for (let k = 0; k < workingPool.length; k++) {
            const poolWord = _vrClean(_vrState.words[workingPool[k]]);
            if (_approxEq(token, poolWord)) {
                foundAt = k;
                break;
            }
        }

        if (foundAt !== -1) {
            toPlace.push(workingPool[foundAt]);
            workingPool.splice(foundAt, 1);
            t++;
            continue;
        }

        // ── 單 token 找不到：嘗試合併後續 token 匹配連字符單字 ──
        // 例如說 "self" "esteem" → 合併成 "selfesteem" 去匹配 "self-esteem"
        let merged = token;
        let consumed = 1;
        let mergedFound = false;

        for (let extra = t + 1; extra < Math.min(t + 4, heardTokens.length); extra++) {
            merged += _vrClean(heardTokens[extra]);
            consumed++;
            for (let k = 0; k < workingPool.length; k++) {
                const poolWord = _vrClean(_vrState.words[workingPool[k]]);
                if (_approxEq(merged, poolWord)) {
                    toPlace.push(workingPool[k]);
                    workingPool.splice(k, 1);
                    t += consumed; // 跳過已合併的 tokens
                    mergedFound = true;
                    break;
                }
            }
            if (mergedFound) break;
        }

        if (!mergedFound) {
            t++; // 找不到 → 跳過
        }
    }

    if (toPlace.length === 0) {
        _vrShowFeedback('warn', `Couldn't match any words — try speaking more clearly.`);
        return;
    }

    // 依 heard 語序寫入答案區
    toPlace.forEach(wordIdx => {
        _vrState.answer.push(wordIdx);
        _vrState.poolOrder = _vrState.poolOrder.filter(x => x !== wordIdx);
    });

    _vrRenderAnswerZone(toPlace[toPlace.length - 1]);
    _vrRenderPool();

    if (_vrState.answer.length === _vrState.words.length) {
        _vrShowFeedback('', '');
        _vrOnAllPlaced();
    } else {
        const remaining = _vrState.words.length - _vrState.answer.length;
        _vrShowFeedback('warn', `${toPlace.length} word${toPlace.length > 1 ? 's' : ''} placed — ${remaining} more to go.`);
    }
}

// ════════════════════════════════════════════════════════════
//  EVENT LISTENERS (bound once after page load)
// ════════════════════════════════════════════════════════════

// Mic toggle
document.getElementById('vr-mic-btn').addEventListener('click', () => {
    if (_vrState.done) return;
    if (_vrIsRecording) {
        // 正在錄音時再點 → 停止並比對
        _vrStopRecording();
    } else {
        // 若已有答案（上一次錄音結果），再點麥克風 = 重說
        // → 清空答案區退回池子、清空 Heard、重新開始
        if (_vrState.answer.length > 0) {
            // [FIX-P2] 直接從 words 重新產生排序好的完整 pool，
            // 而非逐一 pop+push，避免字卡排列順序與原始不同讓使用者困惑。
            _vrState.answer    = [];
            _vrState.poolOrder = _vrState.words.map((_, i) => i)
                .sort((a, b) => _vrState.words[a].toLowerCase().localeCompare(_vrState.words[b].toLowerCase()));
            _vrEl('vr-heard-text').textContent = ''; _vrEl('vr-heard-text').classList.remove('has-result','has-error');
            _vrShowFeedback('', '');
            _vrRenderAnswerZone();
            _vrRenderPool();
        }
        _vrStartRecording();
    }
});

// Play / Replay button
document.getElementById('vr-play-btn').addEventListener('click', () => {
    _vrPlaySentence(false);
});
document.getElementById('vr-replay-btn').addEventListener('click', () => {
    _vrPlaySentence(false);
});

// Undo
document.getElementById('vr-undo-btn').addEventListener('click', _vrUndoLast);

// Clear all
document.getElementById('vr-clear-btn').addEventListener('click', () => {
    if (_vrState.done) return;

    // ★ FIX VR-05 步驟1: 清除殘留的 transcript，防止下次停止錄音時把舊字放回去
    _vrBestTranscript = '';

    // ★ FIX VR-05 步驟2: 若正在錄音，靜默停止（不觸發 _vrProcessSpeech）
    if (_vrIsRecording) {
        _vrStopRecordingSilent();
    }

    // 重設 pool — 用完整重建而非逐一 pop，確保排序正確
    _vrState.answer    = [];
    _vrState.poolOrder = _vrState.words.map((_, i) => i)
        .sort((a, b) => _vrState.words[a].toLowerCase().localeCompare(_vrState.words[b].toLowerCase()));

    _vrShowFeedback('', '');
    _vrEl('vr-heard-text').textContent = ''; _vrEl('vr-heard-text').classList.remove('has-result','has-error');
    _vrRenderAnswerZone();
    _vrRenderPool();
});

// Check / Next
document.getElementById('vr-check-btn').addEventListener('click', _vrCheckAnswer);

// Word sound — 預設關閉（Voice Reorder 手動點擊 pool chip 時才發音）
let _vrWordSpeakEnabled = false;

/**
 * 更新 #vr-word-speak-toggle 按鈕的 UI 狀態（ON / OFF）
 * 與 Reorder 的 _updateReorderSpeakToggleBtn 邏輯相同
 */
function _updateVrWordSpeakToggleBtn() {
    const btn = document.getElementById('vr-word-speak-toggle');
    if (!btn) return;
    const iconEl = btn.querySelector('.reorder-ctrl-icon');
    if (_vrWordSpeakEnabled) {
        btn.classList.remove('reorder-ctrl-word-sound--off');
        btn.classList.add('reorder-ctrl-word-sound--on');
        if (iconEl) iconEl.textContent = '🔊';
    } else {
        btn.classList.remove('reorder-ctrl-word-sound--on');
        btn.classList.add('reorder-ctrl-word-sound--off');
        if (iconEl) iconEl.textContent = '🔇';
    }
}

document.getElementById('vr-word-speak-toggle')?.addEventListener('click', () => {
    _vrWordSpeakEnabled = !_vrWordSpeakEnabled;
    _updateVrWordSpeakToggleBtn();
});

// Strict / Fuzzy 切換已移除：固定使用精準比對模式

// ★ 語音識別唯一資料來源：歷史最長 transcript
// 每次 onresult 從完整 e.results 重新讀取，取字數最多的版本保留
// 解決 iOS Web Speech API 在 continuous 模式下 final 可能漏字的問題
let _vrBestTranscript = '';
let _vrNextPending = false; // WARN-2 FIX: 防止快速雙擊 Next 時多跳一題
let _vrPlaybackAborted = false; // WARN-3 FIX: 切題時標記舊 Playback 已廢棄，防止 onended/onerror 修改新題 UI

// Exit button (shared quiz-exit-btn) already handled globally; add voice-reorder stop

document.getElementById('quiz-exit-btn').addEventListener('click', () => {
    if (quizState.mode === 'voice-reorder') {
        _vrStopRecordingSilent();
    }
});

// ── Voice Reorder 鍵盤快捷鍵 ──────────────────────────────────
// Space  → Replay（重播句子）
// Enter  → Check / Next（檢查答案 或 下一題）
// M      → Mic toggle（開始/停止錄音）
// Z      → Undo（撤回最後一個字）
// X      → Clear all（清空答案區）
// 其他字母/數字 → 攔截 preventDefault，防止瀏覽器把 focus 跳到其他元素
document.addEventListener('keydown', (e) => {
    // 只在 voice-reorder 模式有效
    const vrArea = document.getElementById('quiz-voice-reorder-area');
    if (!vrArea || vrArea.classList.contains('is-hidden')) return;
    // 若焦點在 input / textarea，不攔截
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
        e.preventDefault();
        // Space → 直接觸發 Replay（vr-play-btn 已隱藏，僅 replay-btn 供使用者操作）
        const replayBtn = document.getElementById('vr-replay-btn');
        if (replayBtn && !replayBtn.disabled) replayBtn.click();

    } else if (e.code === 'Enter') {
        e.preventDefault();
        // Check 或 Next
        const checkBtn = document.getElementById('vr-check-btn');
        if (checkBtn && checkBtn.style.display !== 'none' && !checkBtn.disabled) {
            checkBtn.click();
        }

    } else if (e.code === 'KeyM') {
        e.preventDefault();
        // Mic toggle：開始錄音 / 停止錄音
        const micBtn = document.getElementById('vr-mic-btn');
        if (micBtn && !_vrState.done) micBtn.click();

    } else if (e.code === 'KeyZ') {
        e.preventDefault();
        // Undo 最後一個字
        if (!_vrState.done) _vrUndoLast();

    } else if (e.code === 'KeyX') {
        e.preventDefault();
        // Clear all
        const clearBtn = document.getElementById('vr-clear-btn');
        if (clearBtn && !_vrState.done) clearBtn.click();

    } else if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        // 其他字母/數字鍵：阻止瀏覽器預設行為（避免 focus 跳到頁面其他可聚焦元素，
        // 導致後續 pointer/touch 事件 target 錯亂，word chip 無法點擊）
        e.preventDefault();
    }
});

console.log('✅ Voice Reorder loaded.');

// ════════════════════════════════════════════════════════════
//  VR AUDIO RECORDING — 錄音 + 當題回放（方案 A：RAM Blob）
//  原理：MediaRecorder 與 Web Speech API 雙軌並行
//  生命週期：每題按麥克風開始錄音 → 停止錄音 → Blob URL →
//            顯示「回聽」按鈕 → 下一題時自動 revoke 釋放記憶體
// ════════════════════════════════════════════════════════════

let _vrRecorder      = null;   // MediaRecorder 實例
let _vrAudioChunks   = [];     // 錄音資料片段
let _vrPlaybackBlob  = null;   // 當前題目的錄音 Object URL
let _vrPlaybackAudio = null;   // 回放用 Audio 元素
let _vrSilentStop    = false;  // true 時 onstop 不顯示回聽按鈕（跳題/Check/退出場景）

/**
 * 開始錄音（與 _vrStartRecording 同步呼叫）
 * async 函式：getUserMedia 需 await，但呼叫點在 click 手勢內，iOS 相容
 */
async function _vrStartAudioRecording() {
    // 若上一題 Blob 還殘留（例如重說時），先釋放
    _vrReleasePlaybackBlob();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;

    let stream;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
        // 麥克風被拒或不支援 → 靜默略過，語音識別功能不受影響
        return;
    }

    // iOS Safari 只支援 audio/mp4；其他瀏覽器用 audio/webm（品質較好）
    const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm'))
        ? 'audio/webm'
        : 'audio/mp4';

    try {
        _vrRecorder = new MediaRecorder(stream, { mimeType });
    } catch (e) {
        stream.getTracks().forEach(t => t.stop());
        return;
    }

    _vrAudioChunks = [];

    _vrRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) _vrAudioChunks.push(e.data);
    };

    _vrRecorder.onstop = () => {
        // 停止所有音訊軌道（釋放瀏覽器麥克風指示燈）
        stream.getTracks().forEach(t => t.stop());

        if (_vrAudioChunks.length === 0) return;
        if (_vrSilentStop) {
            // 靜默停止（跳題 / Check / 退出）→ 丟棄錄音，不顯示回聽按鈕
            _vrAudioChunks = [];
            _vrSilentStop  = false;
            return;
        }

        const blob = new Blob(_vrAudioChunks, { type: mimeType });
        _vrAudioChunks = [];
        _vrPlaybackBlob = URL.createObjectURL(blob);

        // 顯示回聽按鈕
        const btn = document.getElementById('vr-playback-btn');
        if (btn) btn.style.display = 'flex';
    };

    try {
        _vrRecorder.start();
    } catch (e) {
        stream.getTracks().forEach(t => t.stop());
        _vrRecorder = null;
    }
}

/**
 * 停止錄音 — 用戶主動停止（顯示回聽按鈕）
 */
function _vrStopAudioRecording() {
    _vrSilentStop = false; // 正常停止 → onstop 會顯示回聽按鈕
    if (_vrRecorder && _vrRecorder.state !== 'inactive') {
        try { _vrRecorder.stop(); } catch (e) {}
    }
    _vrRecorder = null;
}

/**
 * 停止錄音 — 靜默停止（跳題 / Check / 退出，不顯示回聽按鈕）
 */
function _vrStopAudioRecordingSilent() {
    _vrSilentStop = true; // 靜默停止 → onstop 會丟棄錄音
    if (_vrRecorder && _vrRecorder.state !== 'inactive') {
        try { _vrRecorder.stop(); } catch (e) {}
    }
    _vrRecorder = null;
}

/**
 * 回放錄音（點回聽按鈕觸發）
 * 若正在播放則停止；若未播放則開始
 */
function _vrPlayback() {
    if (!_vrPlaybackBlob) return;

    const btn     = document.getElementById('vr-playback-btn');
    const iconEl  = document.getElementById('vr-playback-icon');
    const labelEl = document.getElementById('vr-playback-label');
    const micLbl  = document.getElementById('vr-mic-label');

    // 正在播放 → 停止
    if (_vrPlaybackAudio && !_vrPlaybackAudio.paused) {
        _vrPlaybackAudio.pause();
        _vrPlaybackAudio.currentTime = 0;
        if (btn)     btn.classList.remove('is-playing');
        if (iconEl)  iconEl.textContent  = '▶';
        if (labelEl) labelEl.textContent = '回聽我的發音';
        // 恢復 mic-label
        if (micLbl && !_vrState.done) {
            micLbl.textContent = _vrIsRecording ? '🔴 Recording… tap to stop' : 'Tap mic & say the whole sentence';
        }
        return;
    }

    // 開始播放
    _vrPlaybackAborted = false; // WARN-3 FIX: 本次播放開始，重置廢棄旗標
    _vrPlaybackAudio = new Audio(_vrPlaybackBlob);

    if (btn)     btn.classList.add('is-playing');
    if (iconEl)  iconEl.textContent  = '■';
    if (labelEl) labelEl.textContent = '播放中…';
    if (micLbl)  micLbl.textContent  = '🎧 正在回播您的錄音…';

    _vrPlaybackAudio.onended = () => {
        if (_vrPlaybackAborted) return; // WARN-3 FIX: 已切題，忽略舊回調
        if (btn)     btn.classList.remove('is-playing');
        if (iconEl)  iconEl.textContent  = '▶';
        if (labelEl) labelEl.textContent = '回聽我的發音';
        // 回放結束，恢復正常提示
        if (micLbl && !_vrState.done) {
            micLbl.textContent = 'Tap mic & say the whole sentence';
        }
    };
    _vrPlaybackAudio.onerror = () => {
        if (_vrPlaybackAborted) return; // WARN-3 FIX: 已切題，忽略舊回調
        if (btn)     btn.classList.remove('is-playing');
        if (iconEl)  iconEl.textContent  = '▶';
        if (labelEl) labelEl.textContent = '回聽我的發音';
        if (micLbl && !_vrState.done) {
            micLbl.textContent = 'Tap mic & say the whole sentence';
        }
    };
    _vrPlaybackAudio.play().catch(() => {
        if (btn) btn.classList.remove('is-playing');
        if (labelEl) labelEl.textContent = '回聽我的發音';
        if (micLbl && !_vrState.done) {
            micLbl.textContent = 'Tap mic & say the whole sentence';
        }
    });
}

/**
 * 釋放 Blob URL 並隱藏回聽按鈕（每題切換時呼叫）
 * 必須 revoke 以避免記憶體洩漏
 */
function _vrReleasePlaybackBlob() {
    _vrPlaybackAborted = true; // WARN-3 FIX: 通知任何 pending 的 onended/onerror 忽略回調
    if (_vrPlaybackAudio) {
        _vrPlaybackAudio.pause();
        _vrPlaybackAudio = null;
    }
    if (_vrPlaybackBlob) {
        URL.revokeObjectURL(_vrPlaybackBlob);
        _vrPlaybackBlob = null;
    }
    _vrAudioChunks = [];
    const btn = document.getElementById('vr-playback-btn');
    if (btn) {
        btn.style.display = 'none';
        btn.classList.remove('is-playing');
    }
    const iconEl  = document.getElementById('vr-playback-icon');
    const labelEl = document.getElementById('vr-playback-label');
    if (iconEl)  iconEl.textContent  = '▶';
    if (labelEl) labelEl.textContent = '回聽我的發音';
}

// 回聽按鈕 event listener
// Fix 10: 加 null 保護，避免 DOM 不存在時拋出 TypeError 導致模組載入中斷
document.getElementById('vr-playback-btn')?.addEventListener('click', _vrPlayback);

console.log('✅ VR Audio Recording module loaded.');
