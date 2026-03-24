// ============================================================
//  QUIZ SYSTEM — quiz.js
//  Phase 1: Flashcard | Phase 2: Cloze | Phase 3: Dictation
//  Phase 4: Score Records
// ============================================================

const QUIZ_SCORES_KEY = 'readingChallengeQuizScores';
// TTS_PREF_KEY 已移除：發音改為兩層自動降級（GitHub MP3 → Web Speech）

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
    difficulty: 'mix',         // 'easy' | 'medium' | 'hard' | 'mix' (legacy, kept for sentence/article modes)
    selectedCefrLevels: new Set(['a1a2', 'b1b2', 'c1c2']), // multi-select CEFR for Words & Phrases modes
    selectedDifficulties: new Set(['easy', 'medium', 'hard']), // multi-select for Dictation & Reorder
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
        const src = quizAudioPlayer._webaudio_src;
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

// ── 間隔重複參數設定（可依需求調整）────────────────────────────
const SR_CONFIG = {
    // 記憶底板：即使再久沒複習，有效熟悉度最多只降到這個值。
    // 代表「學過就是學過，不會完全忘記」。建議範圍：20–40。
    decayFloor: 30,

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
 */
function calcEffectiveFamiliarity(rec, itemType) {
    if (!rec || !_recHasPractice(rec)) {
        return { rawFam: null, effectiveFam: null, daysSince: Infinity };
    }

    // 取得原始熟悉度
    let rawFam;
    if (typeof calcWeightedFamiliarity === 'function' && itemType) {
        rawFam = calcWeightedFamiliarity(rec, itemType);
    } else {
        const sources = ['fc','fcplus','dictation','reorder','articleListen'];
        const vals = sources.map(s => {
            const sr = rec[s];
            if (!sr) return null;
            const total = (sr.correct || 0) + (sr.wrong || 0);
            return total > 0 ? Math.round((1 - sr.wrong / total) * 100) : null;
        }).filter(v => v !== null);
        rawFam = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    }

    // 取得上次測驗日期
    const lastSeen = rec.lastSeen || null;
    const days = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 86400000) : 0;

    // 依原始熟悉度選擇半衰期
    let halfLife;
    if (rawFam >= 70)      halfLife = SR_CONFIG.halfLifeHigh;
    else if (rawFam >= 40) halfLife = SR_CONFIG.halfLifeMid;
    else                   halfLife = SR_CONFIG.halfLifeLow;

    // 底板不超過 rawFam（避免答錯率高的題被虛假拉高）
    const floor = Math.min(SR_CONFIG.decayFloor, rawFam);
    const decayFactor = Math.pow(2, -days / halfLife);
    const effectiveFam = Math.round(floor + (rawFam - floor) * decayFactor);

    return { rawFam, effectiveFam, daysSince: days };
}

/**
 * 分桶優先抽題（間隔重複版）
 *
 * 桶 A（95%）：從未測驗（effectiveFam === null）→ 最高優先
 * 桶 B（剩餘 × 70%）：有效熟悉度 < 40%（含衰減後停在底板的題）
 * 桶 C（剩餘 × 20%）：有效熟悉度 40–69%
 * 桶 D（剩餘 × 5%） ：有效熟悉度 ≥ 70%（幾乎不出）
 *
 * 學過的題（effectiveFam 有值）永遠不進桶 A，
 * 即使衰減到底板（30%）也只落在桶 B，優先度低於未測驗。
 */
function weightedSample(pool, n, keyFn, categoryName, titleName, itemType) {
    if (!pool || pool.length === 0) return [];
    n = Math.min(n, pool.length);

    // 讀取 itemScores
    let itemScores = {};
    try { itemScores = JSON.parse(localStorage.getItem('readingChallengeItemScores') || '{}'); } catch (e) {}

    const storeKey    = `${categoryName}||${titleName}`;
    const typeDataMap = (itemScores[storeKey] && itemType)
        ? (itemScores[storeKey][itemType] || {})
        : {};

    // 將每題分到對應的桶
    const bucketA = []; // 從未測驗
    const bucketB = []; // 有效熟悉度 < 40%
    const bucketC = []; // 有效熟悉度 40–69%
    const bucketD = []; // 有效熟悉度 ≥ 70%

    for (const item of pool) {
        const text = keyFn ? keyFn(item) : String(item);
        const rec  = typeDataMap[text] || null;
        const { effectiveFam } = calcEffectiveFamiliarity(rec, itemType);

        if (effectiveFam === null)   bucketA.push(item);
        else if (effectiveFam < 40)  bucketB.push(item);
        else if (effectiveFam < 70)  bucketC.push(item);
        else                         bucketD.push(item);
    }

    // 桶 A 優先填滿 untestedFillRatio 比例，剩餘配額給 B/C/D
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

    // Sync CEFR multi-select button states on open (default: all active)
    // _syncCefrButtons is defined after this function; safe to call since
    // openQuiz is only invoked via user interaction, after all JS has parsed.
    setTimeout(() => {
        _syncCefrButtons('flashcard');
        _syncCefrButtons('fcplus');
    }, 0);

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
        // 在選單頁，← Back 依來源決定
        if (quizState.source === 'note') {
            showView(document.getElementById('note-view'));
        } else if (quizState.source === 'scores') {
            // 從 Scores Dashboard 進來：回到 Detail View（若有文章），否則回 Dashboard
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
const _DIFF_MODES = new Set(['dictation', 'reorder']);
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
        if (diff === 'mix') {
            b.classList.toggle('is-active', quizState.selectedDifficulties.size === 3);
        } else if (_DIFF_KEYS.has(diff)) {
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
            if (diff === 'mix') {
                // Mix = select all three
                quizState.selectedDifficulties = new Set(['easy', 'medium', 'hard']);
            } else if (_DIFF_KEYS.has(diff)) {
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
    else if (mode === 'reorder')     startReorder(subpanelSource.reorder || 'note');
    else if (mode === 'article-listen' || mode === 'article-cloze') startArticleQuiz();
});

document.getElementById('quiz-retry-wrong-btn').addEventListener('click', () => {
    quizState.retryWrongOnly = true;
    const mode = quizState.mode;
    if (mode === 'dictation')            startDictationRetryWrong();
    else if (mode === 'reorder')         startReorderRetryWrong();
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
    if (typeof recordItemResult === 'function' && _fcItem) {
        const _itype = quizState.flashSource === 'article' ? 'articleWords' : 'noteWords';
        recordItemResult(quizState.categoryName, quizState.titleName, _itype, _fcItem.text, true, 0, 'fc');
    }
    showFlashcard();
});

document.getElementById('flashcard-wrong').addEventListener('click', () => {
    const item = quizState.deck[quizState.deckIndex];
    quizState.wrong++;
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
        if (b.textContent.toLowerCase() === correct.toLowerCase()) b.classList.add('is-correct'); // BUG-01 FIX: 大小寫不敏感，與 isCorrect 判斷一致
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
    // BUG-03 FIX: 用 { word, origIdx } 結構 shuffle，origIdx 天生唯一，
    // 即使句子有重複詞（如 "Go go go!"）hint 索引也永遠精準
    const tokens = tokenize(q.sentence);
    const indexedTokens = tokens.map((word, origIdx) => ({ word, origIdx }));
    let shuffledIndexed;
    do { shuffledIndexed = shuffle([...indexedTokens]); }
    while (tokens.length > 1 &&
           shuffledIndexed.map(t => t.word).join(' ') === tokens.join(' '));
    reorderPool = shuffledIndexed.map(t => t.word);

    // 記錄第一個和最後一個單字（供 hint 顯示）
    reorderFirstWord = tokens[0];
    reorderLastWord  = tokens[tokens.length - 1];
    // origIdx 唯一，不需要特判 first === last 的情況
    reorderFirstWordIdx = shuffledIndexed.findIndex(t => t.origIdx === 0);
    reorderLastWordIdx  = shuffledIndexed.findIndex(t => t.origIdx === tokens.length - 1);
    
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

function playReorderAudio(q) {
    _trackReplay();
    const playBtn = document.getElementById('reorder-play-btn');
    // 套用使用者調整後的時間（若無調整則使用原始值）
    const timing = getQuizTiming(q.title, q.sentence, q.start, q.end);
    const _pLabel = playBtn.querySelector('.reorder-ctrl-label');
    playSnippet({
        start: timing.start, end: timing.end,
        onStart: () => {
            playBtn.classList.add('is-playing-voice');
            if (_pLabel) _pLabel.textContent = 'Playing…';
        },
        onEnd: () => {
            playBtn.classList.remove('is-playing-voice');
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

    reorderChecked = true;
    document.getElementById('reorder-clear-btn').disabled = true;
    const _backBtnCheck = document.getElementById('reorder-back-btn');
    if (_backBtnCheck) _backBtnCheck.disabled = true;

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
