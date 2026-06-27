/* Reading Challenge SPA */

// App Views
const subCategoryView = document.getElementById('sub-category-view');
const homeView = document.getElementById('home-view');
const categoryView = document.getElementById('category-view');
const playbackView = document.getElementById('playback-view');
const noteView = document.getElementById('note-view');

// New Auth and App Container Views
const loginView = document.getElementById('login-view');
const appContainer = document.getElementById('app-container');
const googleSigninBtn = document.getElementById('google-signin-btn');
const guestModeBtn = document.getElementById('guest-mode-btn');
const userInfo = document.getElementById('user-info');
const signOutBtn = document.getElementById('sign-out-btn');
const signInFromGuestBtn = document.getElementById('sign-in-from-guest-btn');

// Existing Elements
const majorCategoryList = document.getElementById('major-category-list');
const subCategoryList = document.getElementById('sub-category-list');
const subCategoryHeader = document.getElementById('sub-category-header');
const backToMajorBtn = document.getElementById('back-to-major-view');
const continueReadingContainer = document.getElementById('continue-reading-container');
const categoryList = document.getElementById('title-list'); // B-01 修正：HTML 中 id 為 title-list
const categoryTitle = document.getElementById('category-title');
const titleList = document.getElementById('title-list');
const playbackTitle = document.getElementById('playback-title');
const textContainer = document.getElementById('text-container');
const audio = document.getElementById('audio');
const backToCategoryBtn = document.getElementById('back-to-category');
const playPauseBtn = document.getElementById('play-pause');
// B-02 修正：#back-to-home 在 HTML 中不存在，已移除此取值
const backToSubCategoryBtn = document.getElementById('back-to-sub-category');
const rewindBtn = document.getElementById('rewind-5');
const forwardBtn = document.getElementById('forward-5');
const prevStoryBtn = document.getElementById('prev-story');
const nextStoryBtn = document.getElementById('next-story');
const progressBar = document.getElementById('progress-bar');
const addToNoteBtn = document.getElementById('add-to-note-btn');
const stagedWordsContainer = document.getElementById('staged-words-container');
const clearStagingBtn = document.getElementById('clear-staging-btn');
const copyStagedBtn = document.getElementById('copy-staged-btn');

// B-07 修正：#toggle-timestamp-btn 在 HTML 中不存在，已移除此取值


// Note view elements
const goToNoteBtn = document.getElementById('go-to-note');
const backToHomeFromNoteBtn = document.getElementById('back-to-home-from-note');
const noteListWords = document.getElementById('note-list-words');
const noteListSentences = document.getElementById('note-list-sentences');
const exportCurrentNoteJsonBtn = document.getElementById('export-current-note-json-btn');
const exportAllNotesJsonBtn = document.getElementById('export-all-notes-json-btn');
const addWordForm = document.getElementById('add-word-form');
const goToStoryNoteBtn = document.getElementById('go-to-story-note-btn');
const backToStoryFromNoteBtn = document.getElementById('back-to-story-from-note-btn');
const newWordInput = document.getElementById('new-word-input');
const addManualWordBtn = document.getElementById('add-manual-word-btn');
// --- NEWLY ADDED ELEMENTS ---
// ===== MODIFIED LINE =====
const prevNoteBtn = document.getElementById('prev-note-btn');
const nextNoteBtn = document.getElementById('next-note-btn');
const noteViewTitleEl = document.getElementById('note-view-title');

// Data Manager elements
const dataManagerView = document.getElementById('data-manager-view');
const goToDataManagerBtn = document.getElementById('go-to-data-manager');
const backToHomeFromDataManagerBtn = document.getElementById('back-to-home-from-data-manager');
const exportAllDataBtn = document.getElementById('export-all-data-btn');
const importDataBtn = document.getElementById('import-data-btn');
const importDataInput = document.getElementById('import-data-input');
const readingProgressEditor = document.getElementById('reading-progress-editor');
const lastSessionEditor = document.getElementById('last-session-editor');

// State Variables
let currentMajorCategory = null; // 記錄目前在哪個大類 (例如 "Books")
let stories = [];
let vocabularyData = [];
let isPlaying = false;
let scrollMax = 0;
let durationFallback = 59;
let audioTriedCandidates = [];
let savedWords = {};
let currentStoryList = [];
let currentStoryIndex = -1;
let currentCategoryName = null;
let currentStoryTitle = null;
let noteViewCategory = null;
let noteViewTitle = null;
let playbackPositionBeforeNote = 0;
let currentUser = null; // To hold the logged-in user object
let currentNoteOrigin = 'menu'; // NEW: Tracks how user entered the note view ('menu' or 'story')

// --- New State Variables for Sentence Playback ---
let timestampCache = {};
let noteAudioPlayer = new Audio();
let currentSnippetTimeout = null;

// --- New Timestamp State Variables ---
let isTimestampMode = true;  // Always timestamp mode — plain text removed
let showTranslation = false; // 控制是否顯示中文翻譯

// --- Router State ---
// 防止 hashchange → restoreFromHash 時又觸發 Router.push 造成無限迴圈
let _routerRestoring = false;
let timestampData = [];

// BUG-02 修正：模組層級儲存 canplaythrough handler，防止快速切換文章時重複累積監聽器
let _canplaythroughHandler = null;
let hasTimestampFile = false;
let lastHighlightedSentence = null;
let timestampUpdateRafId = null; // For smooth scrolling animation
let sentenceElementMap = new Map(); // FIX: cache start→element to avoid per-frame querySelector

// ── 閱讀挑戰模式（Reading Challenge Mode）狀態 ──────────────────────────────
// 全新「連續平滑捲動」提詞器機制：
//   - 整個文字區塊以固定 px/秒持續向上捲動
//   - 目前可見區中央的句子以顏色 highlight
//   - 與 mp3 完全脫鉤；點擊句子才臨時播放該句音訊
let isReadingMode = false;
let readingIsPlaying = false;
let readingIndex = -1;         // 目前 highlight 的句子 index

// ── 閱讀挑戰模式：跟讀錄音狀態 ──────────────────────────────
let readingMediaRecorder = null;
let readingMediaStream = null;
let readingRecordedChunks = [];
let readingRecordingBlobUrl = null;
let readingRecordingMimeType = '';
let isReadingRecording = false;
let readingRafId = null;
let readingLastFrameTs = 0;
let readingScrollTopBeforeEnter = 0; // 進入閱讀模式前的 scrollTop，退出時還原

// 單一速度數值（px/秒），範圍 5–80，預設 20
const READING_SPEED_DEFAULT = 20;
const READING_SPEED_WPS = { slow: 2.5, medium: 4, fast: 6 }; // 僅保留供 getReadingSentenceDurationMs 參考
const READING_MIN_DURATION_MS = 1100;

let readingSpeedPx = (function () {
    try {
        const v = parseInt(localStorage.getItem('readingModeSpeedPx'), 10);
        return (!isNaN(v) && v >= 5 && v <= 80) ? v : READING_SPEED_DEFAULT;
    } catch (e) { return READING_SPEED_DEFAULT; }
})();

// 舊版 key（三檔）僅保留讓其他地方不報錯
let readingSpeedKey = 'medium';

// ── 閱讀模式字級：範圍 14–28px，預設 20px，存入 localStorage ─────────────
const READING_FONT_DEFAULT = 20;
let readingFontSize = (function () {
    try {
        const v = parseInt(localStorage.getItem('readingModeFontSize'), 10);
        return (!isNaN(v) && v >= 14 && v <= 28) ? v : READING_FONT_DEFAULT;
    } catch (e) { return READING_FONT_DEFAULT; }
})();

function applyReadingFontSize(size) {
    readingFontSize = Math.max(14, Math.min(28, Math.round(size)));
    try { localStorage.setItem('readingModeFontSize', String(readingFontSize)); } catch (e) {}
    // 寫入 CSS 變數，讓 #text-container.reading-active 套用
    document.documentElement.style.setProperty('--reading-font-size', readingFontSize + 'px');
    // 同步滑桿 UI
    const slider  = document.getElementById('reading-font-slider');
    const valueEl = document.getElementById('reading-font-value');
    if (slider)  slider.value        = readingFontSize;
    if (valueEl) valueEl.textContent = readingFontSize + 'px';
}

function initReadingFontSlider() {
    const slider  = document.getElementById('reading-font-slider');
    const valueEl = document.getElementById('reading-font-value');
    if (!slider || !valueEl) return;

    // 清除舊監聽器（替換節點）
    const newSlider = slider.cloneNode(true);
    slider.parentNode.replaceChild(newSlider, slider);
    const s = document.getElementById('reading-font-slider');

    // 套用已儲存的字級
    applyReadingFontSize(readingFontSize);
    s.value        = readingFontSize;
    valueEl.textContent = readingFontSize + 'px';

    s.oninput = () => {
        applyReadingFontSize(parseInt(s.value, 10));
    };
}
// ── 閱讀模式字級 end ──────────────────────────────────────────────────────

// Binary search: find the active sentence index for a given currentTime
function findActiveSentenceIndex(time) {
    let lo = 0, hi = timestampData.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const line = timestampData[mid];
        if (time < line.start) {
            hi = mid - 1;
        } else if (time > line.end) {
            lo = mid + 1;
        } else {
            return mid; // found
        }
    }
    return -1;
}

// --- NEW State Variables for JSON Mode Highlighting ---
let jsonModeUpdateRafId = null;
let lastHighlightedWords = [];
let lastActiveSentenceStart = -1; // To track the current sentence

// Storage Keys
const LAST_SESSION_KEY = 'readingChallengeLastSession';
const SAVED_WORDS_KEY = 'readingChallengeSavedWordsV2';
const SUB_CATEGORY_SESSION_KEY = 'readingChallengeSubCategorySessions'; // 儲存所有子分類的進度

// ============================================
// 手機音訊時間定位精度修正 - 新增區塊
// ============================================

// 偵測是否為手機裝置
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// 改進的音訊時間設定函數 - 加入緩衝和重試機制
// BUG-04 修正：以模組層級變數儲存 intervalId，每次呼叫前清除前一個 interval，
// 防止快速連續呼叫時產生多個並行 setInterval 實例相互干擾（記憶體洩漏）
let _verifyIntervalId = null;
let _verifyTimeoutId  = null;

// ── BUG-2 修正：setAudioTimeAccurate ────────────────────────────────────────
// 問題：原本手機固定「提前 0.3 秒」補償 iOS seek 延遲，
//       但語速快的段落中，0.3 秒 = 約 1 個單字的時長，
//       導致「回播上一句」會從上一句的「倒數第 1 個單字」而非句首開始。
//
// 修正：移除固定提前量，直接 seek 到精準目標時間；
//       改用「更短的重試間隔（80ms）+ 更嚴格的誤差門檻（0.15s）」
//       讓重試機制自行修正 iOS seek 的實際偏差，而不是盲目提前。
// ─────────────────────────────────────────────────────────────────────────────
function setAudioTimeAccurate(targetTime) {
    // 清除上一次尚未結束的驗證迴圈
    if (_verifyIntervalId) {
        clearInterval(_verifyIntervalId);
        _verifyIntervalId = null;
    }
    if (_verifyTimeoutId) {
        clearTimeout(_verifyTimeoutId);
        _verifyTimeoutId = null;
    }

    // ✅ 直接 seek 到精準目標（不再預扣固定 bufferTime）
    const targetExact = Math.max(0, targetTime);
    audio.currentTime = targetExact;

    console.log(`[Time Set] Target: ${targetExact.toFixed(3)}s (precise, no pre-offset)`);

    // 驗證重試機制：若 iOS 實際落點偏差 > 0.15s，重新 seek
    let retryCount = 0;
    const MAX_RETRIES = 4;
    _verifyIntervalId = setInterval(() => {
        const actualTime = audio.currentTime;
        const timeDiff = Math.abs(actualTime - targetExact);

        if (timeDiff > 0.15 && retryCount < MAX_RETRIES) {
            console.warn(`[Time Set Retry ${retryCount + 1}] Expected: ${targetExact.toFixed(3)}s, Got: ${actualTime.toFixed(3)}s (diff: ${timeDiff.toFixed(3)}s)`);
            audio.currentTime = targetExact;
            retryCount++;
        } else {
            // B-10 修正：不管成功或失敗，立刻清除 interval，不再等待 3 秒 timeout
            clearInterval(_verifyIntervalId);
            _verifyIntervalId = null;
            if (_verifyTimeoutId) {
                clearTimeout(_verifyTimeoutId);
                _verifyTimeoutId = null;
            }
            if (timeDiff > 0.15) {
                console.error(`[Time Set Failed] After ${MAX_RETRIES} retries, still off by ${timeDiff.toFixed(3)}s`);
            } else {
                console.log(`[Time Set OK] Positioned at ${actualTime.toFixed(3)}s (diff: ${timeDiff.toFixed(3)}s)`);
            }
        }
    }, 80); // 80ms 間隔
}

// ============================================
// 手機音訊時間定位精度修正 - 結束
// ============================================

// --- UI Management ---

// NEW: Function to show the login view
function showLoginView() {
    // Hide the main app container and show the login screen
    appContainer.classList.add('is-hidden');
    loginView.classList.remove('is-hidden');
    
    // B-11 修正：補齊所有可能顯示的 view，避免登出時殘留畫面
    const customArticlesView = document.getElementById('custom-articles-view');
    const quizView = document.getElementById('quiz-view');
    const scoresDashboardView = document.getElementById('scores-dashboard-view');
    const audioEditorManagerView = document.getElementById('audio-editor-manager-view');
    const itemDetailView = document.getElementById('item-detail-view');
    [homeView, subCategoryView, categoryView, playbackView, noteView,
     dataManagerView, customArticlesView, quizView, scoresDashboardView,
     audioEditorManagerView, itemDetailView].forEach(el => {
        if (el) el.classList.add('is-hidden');
    });

    // Reset any ongoing playback state
    stopAudioAndReset();
}

// FIXED: Merged and corrected showAppView function
async function showAppView(user) {
    loginView.classList.add('is-hidden');
    appContainer.classList.remove('is-hidden');
    
    const isGuest = !user || user.isAnonymous;

    if (!isGuest) {
        // --- Signed In Mode ---
        userInfo.textContent = `Signed in as: ${user.displayName || user.email}`;
        signOutBtn.classList.remove('is-hidden');
        signInFromGuestBtn.classList.add('is-hidden');
    } else {
        // --- Guest Mode ---
        userInfo.textContent = 'Guest Mode';
        signOutBtn.classList.add('is-hidden');
        signInFromGuestBtn.classList.remove('is-hidden');
    }

    // Load story and vocabulary data if not already loaded
    if (stories.length === 0 || vocabularyData.length === 0) {
        await loadData();
    }
    
    // ===== 修改這行 =====
    renderMajorCategories(); // 原本可能是 renderCategories()，請改為 renderMajorCategories()
    // ==================

    // Show review badge if there are articles due for review
    setTimeout(() => {
        if (typeof renderHomeReviewBadge === 'function') renderHomeReviewBadge();
    }, 300);

    // 登入後：先嘗試從 URL hash 恢復畫面，否則顯示首頁
    const initState = (typeof Router !== 'undefined') ? Router.current() : { view: 'home' };
    if (initState.view !== 'home') {
        await restoreFromHash(location.hash);
    } else {
        showView(homeView);
    }
}

// ── FIX-1: 圖片存在快取（B 方案清單，啟動時由 story.json hasThumb 欄位填入）──────
// key: 圖片相對路徑 (e.g. "images/Atomic Habits.jpg")  value: true | false
const _imageExistsCache = new Map();

/**
 * createListItemWithImage
 *
 * showThumb = true  → 只在 sub-category 列表使用，採 IntersectionObserver 延遲載入
 *                     + fetch HEAD cache（A+C 方案），或直接查 _imageExistsCache（B 方案）
 * showThumb = false → 文章列表使用，完全不建立 <img>，不發任何網路請求
 */
function createListItemWithImage(text, onClick, fallbackText = null, showThumb = true) {
    const container = document.createElement('div');
    container.className = 'list-item-with-image';

    const span = document.createElement('span');
    span.textContent = text;

    if (!showThumb) {
        // 文章列表：純文字，不建 img，不發網路請求
        container.appendChild(span);
        container.addEventListener('click', onClick);
        return container;
    }

    // Sub-category：建 img 元素，用 IntersectionObserver 延遲觸發
    const img = document.createElement('img');
    img.className = 'category-thumb';
    img.alt = text;
    img.classList.add('img-hidden'); // 預設隱藏，確認圖片存在後才顯示

    container.appendChild(img);
    container.appendChild(span);
    container.addEventListener('click', onClick);

    // 同時嘗試「空格版」與「底線版」檔名
    // 例：分類名 "James Clear – Atomic Habits" → 也試 "James_Clear_–_Atomic_Habits"
    // 以及三條底線版 "James_Clear___Atomic_Habits"（–符號也換成_）
    const toUnderscore = s => s.replace(/[^A-Za-z0-9.\-]/g, '_');
    const textU = toUnderscore(text);
    const fallU = fallbackText ? toUnderscore(fallbackText) : null;
    const candidates = [...new Set([
        `images/${text}.jpg`,
        `images/${text}.png`,
        `images/${textU}.jpg`,
        `images/${textU}.png`,
        ...(fallbackText ? [
            `images/${fallbackText}.jpg`,
            `images/${fallbackText}.png`,
            `images/${fallU}.jpg`,
            `images/${fallU}.png`,
        ] : [])
    ])];

    function _trySetImage() {
        // B 方案：走完所有候補，找到第一個快取為 true 的就顯示並結束
        // FIX: 原本找到第一個「有快取記錄」的 path 就 return，不管值是 true/false，
        //      導致第一個候補快取為 false 時，後面的候補（如 .png）永遠不會被嘗試。
        //      修正：應繼續走完所有候補，直到找到 true 的為止。
        let allCached = true;
        for (const path of candidates) {
            if (!_imageExistsCache.has(path)) {
                allCached = false;
                break;
            }
        }
        if (allCached) {
            // 所有候補都有快取結果，找出第一個 true 的來用
            for (const path of candidates) {
                if (_imageExistsCache.get(path)) {
                    img.src = path;
                    img.classList.remove('img-hidden');
                    return;
                }
            }
            return; // 全部都是 false，沒有圖片
        }

        // A+C 方案：快取未命中，用 fetch HEAD 依序確認（加 cache: 'force-cache'）
        (function tryNext(i) {
            if (i >= candidates.length) {
                candidates.forEach(p => _imageExistsCache.set(p, false));
                return;
            }
            // 若此候補已有快取，直接跳過或使用
            if (_imageExistsCache.has(candidates[i])) {
                if (_imageExistsCache.get(candidates[i])) {
                    img.src = candidates[i];
                    img.classList.remove('img-hidden');
                    return;
                }
                tryNext(i + 1);
                return;
            }
            fetch(candidates[i], { method: 'HEAD', cache: 'force-cache' })
                .then(res => {
                    if (res.ok) {
                        _imageExistsCache.set(candidates[i], true);
                        img.src = candidates[i];
                        img.classList.remove('img-hidden');
                        // 其他候補標記為 false
                        candidates.slice(i + 1).forEach(p => _imageExistsCache.set(p, false));
                    } else {
                        _imageExistsCache.set(candidates[i], false);
                        tryNext(i + 1);
                    }
                })
                .catch(() => {
                    _imageExistsCache.set(candidates[i], false);
                    tryNext(i + 1);
                });
        })(0);
    }

    // A 方案：若快取已全部就緒，直接套用（不等 IntersectionObserver）
    // FIX: 按 Back 重建 DOM 後，快取已有結果卻還要等元素進入視口才觸發，
    //      造成已知有圖的書仍然短暫空白。直接檢查快取，若已完整就立即顯示。
    const allAlreadyCached = candidates.every(p => _imageExistsCache.has(p));
    if (allAlreadyCached) {
        _trySetImage();
    } else if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries, obs) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    obs.disconnect();
                    _trySetImage();
                }
            });
        }, { rootMargin: '100px' }); // 提前 100px 預載
        observer.observe(container);
    } else {
        // 不支援 IntersectionObserver 的舊瀏覽器直接觸發
        _trySetImage();
    }

    return container;
}

function showView(view, _routeState) {
    const customArticlesView = document.getElementById('custom-articles-view');
    const quizView = document.getElementById('quiz-view');
    const scoresDashboardView = document.getElementById('scores-dashboard-view');
    const audioEditorManagerView = document.getElementById('audio-editor-manager-view');
    const itemDetailView = document.getElementById('item-detail-view');
    // 加入 subCategoryView 和 dataManagerView 到隱藏列表
    [loginView, appContainer, homeView, subCategoryView, categoryView, playbackView, noteView, dataManagerView, customArticlesView, quizView, scoresDashboardView, audioEditorManagerView, itemDetailView].forEach(el => {
        if(el) el.classList.add('is-hidden');
    });

    // ── 離開 quiz view 時清理 quiz 子面板殘留 ──────────────────
    // 確保下次進入 quiz 時不會看到上一次的 session / result 畫面
    if (view !== quizView) {
        const qSession = document.getElementById('quiz-session');
        const qResult  = document.getElementById('quiz-result');
        const qMenu    = document.getElementById('quiz-menu');
        // 只重置子面板；不動 quizState，保留上下文讓下次 openQuiz 重新填入
        if (qSession) qSession.classList.add('is-hidden');
        if (qResult)  qResult.classList.add('is-hidden');
        if (qMenu)    qMenu.classList.remove('is-hidden');
        // 停止所有 quiz 音訊
        if (typeof quizAudioPlayer !== 'undefined') quizAudioPlayer.pause();
        if (typeof WebAudioEngine !== 'undefined') WebAudioEngine.stop();
    }

    // 特殊處理：appContainer 總是包含這些內部視圖
    if (view !== loginView) {
        appContainer.classList.remove('is-hidden');
    }
    
    // 切換到閱讀頁時，停止 WebAudioEngine（清除 Quiz 殘留音訊，避免空白鍵誤播舊句子）
    if (view === playbackView && typeof WebAudioEngine !== 'undefined') {
        WebAudioEngine.stop();
    }

    view.classList.remove('is-hidden');
    document.body.classList.toggle('note-view-active', view === noteView);

    // ── user-status：只在首頁顯示 ─────────────────────────────
    const userStatusEl = document.getElementById('user-status');
    if (userStatusEl) {
        userStatusEl.classList.toggle('is-hidden', view !== homeView);
    }

    // ── Router：更新 URL hash（登入頁不記錄路由）─────────────
    if (typeof Router !== 'undefined' && view !== loginView && !_routerRestoring) {
        let state = _routeState || null;
        if (!state) {
            // 根據顯示的 view 自動推斷路由狀態
            if (view === homeView)              state = { view: 'home' };
            else if (view === subCategoryView)  state = { view: 'major', major: currentMajorCategory || '' };
            else if (view === categoryView)     state = { view: 'category', major: currentMajorCategory || '', sub: currentCategoryName || '' };
            else if (view === noteView)         state = { view: 'note' };
            else if (view === quizView)         state = { view: 'quiz' };
            else if (view === scoresDashboardView) state = { view: 'scores' };
            // playbackView 由 showPlayback() 明確傳入 state，此處不處理
        }
        if (state) Router.push(state);
    }
}

// --- Firebase Auth Functions ---
function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider)
        .then((result) => {
            console.log("Sign-in successful via popup:", result.user);
            // onAuthStateChanged will handle the UI update
        })
        .catch((error) => {
            console.error("Sign-in popup error:", error.code, error.message);
            alert(`Sign-in failed: ${error.message}`);
        });
}

function signOutUser() {
    firebase.auth().signOut().catch((error) => {
        console.error("Sign out error:", error);
    });
    // The onAuthStateChanged listener will handle UI changes
}

async function enterGuestMode() {
    currentUser = null;
    loadWordsFromStorage(); // Load notes from local storage for guests
    await showAppView(null);
}

// --- Data Persistence (Unified) ---

// Helper to convert Firestore data to local Set format
function parseFirestoreData(parsed) {
    const newSavedWords = {};
    for (const category in parsed) {
        newSavedWords[category] = {};
        for (const title in parsed[category]) {
            const entry = parsed[category][title];
            // Guard: ensure each field is an array before wrapping in Set
            const toArray = v => Array.isArray(v) ? v : (v ? [] : []);
            newSavedWords[category][title] = {
                words:     new Set(toArray(entry.words)),
                phrases:   new Set(toArray(entry.phrases)),
                sentences: new Set(toArray(entry.sentences))
            };
        }
    }
    return newSavedWords;
}

// Helper to convert local Set format to Firestore-compatible Array format
function serializeDataForStorage(data) {
    const serializable = {};
    for (const category in data) {
        serializable[category] = {};
        for (const title in data[category]) {
            serializable[category][title] = {
                words: Array.from(data[category][title].words || []),
                phrases: Array.from(data[category][title].phrases || []),
                sentences: Array.from(data[category][title].sentences || [])
            };
        }
    }
    return serializable;
}

// NEW: Helper function to merge local guest notes into user's notes
function mergeNotes(guestNotes, userNotes) {
    const merged = userNotes; // Start with the user's notes

    for (const category in guestNotes) {
        if (!merged[category]) {
            merged[category] = guestNotes[category]; // If category doesn't exist, add it entirely
            continue;
        }
        for (const title in guestNotes[category]) {
            if (!merged[category][title]) {
                merged[category][title] = guestNotes[category][title]; // If title doesn't exist, add it entirely
                continue;
            }

            // If both exist, merge the Sets
            const guestEntry = guestNotes[category][title];
            const userEntry = merged[category][title];

            guestEntry.words.forEach(word => userEntry.words.add(word));
            guestEntry.phrases.forEach(phrase => userEntry.phrases.add(phrase));
            guestEntry.sentences.forEach(sentence => userEntry.sentences.add(sentence));
        }
    }
    return merged;
}

// ===== UPDATED FUNCTION: LOAD NOTES AND LAST SESSION FROM FIRESTORE =====
async function loadWordsFromFirestore() {
    if (!currentUser) {
        console.log("User not logged in, cannot load from Firestore.");
        savedWords = {}; 
        return; 
    }
    try {
        const docRef = db.collection('userNotes').doc(currentUser.uid);
        const doc = await docRef.get();
        if (doc.exists) {
            const data = doc.data(); // Get the full document data
            
            // 1. Load Notes
            const firestoreData = data.savedWords || {};
            savedWords = parseFirestoreData(firestoreData);

            // 2. === NEW: Sync Last Playback Session ===
            // This ensures that when we log in on PC, we get the progress from Mobile
            if (data.lastSession) {
                // FIX-3: 使用 safeSetItem
                safeSetItem(LAST_SESSION_KEY, JSON.stringify(data.lastSession));
                console.log("Last session synced from Cloud:", data.lastSession);
            }
            // 3. === Sync Sub Category Sessions ===
            if (data.subCategorySessions) {
                // FIX-3: 使用 safeSetItem
                safeSetItem(SUB_CATEGORY_SESSION_KEY, JSON.stringify(data.subCategorySessions));
                console.log("Sub category sessions synced from Cloud:", data.subCategorySessions);
            }
            // 4. === Sync Quiz Last Session（上次 Quiz 選擇的 Book / Chapter）===
            if (data.quizLastSession) {
                safeSetItem('readingChallengeQuizLastSession', JSON.stringify(data.quizLastSession));
                console.log("Quiz last session synced from Cloud:", data.quizLastSession);
            }
            // ===========================================

            console.log("Notes and session loaded from Firestore.");
        } else {
            console.log("No data found in Firestore for this user.");
            savedWords = {};
        }
    } catch (error) {
        console.error("Error loading notes from Firestore:", error);
        throw new Error("Failed to load user notes from Firestore.");
    }
}

async function saveWordsToFirestore() {
    if (!currentUser) {
        console.log("User not logged in, cannot save to Firestore.");
        return;
    }
    const serializableWords = serializeDataForStorage(savedWords);
    try {
        const docRef = db.collection('userNotes').doc(currentUser.uid);
        await docRef.set({ savedWords: serializableWords }, { merge: true });
        console.log("Notes successfully saved to Firestore!");
    } catch (error) {
        console.error("Error saving notes to Firestore:", error);
    }
}

function loadWordsFromStorage() {
    try {
        const storedWords = localStorage.getItem(SAVED_WORDS_KEY);
        if (storedWords) {
            const parsed = JSON.parse(storedWords);
            savedWords = parseFirestoreData(parsed); // Reuse parser
            console.log("Notes loaded from Local Storage.");
        } else {
            savedWords = {};
        }
    } catch (e) {
        console.error("Failed to parse words from localStorage", e);
        savedWords = {};
    }
}

// ── FIX-3: safeSetItem utility ───────────────────────────────────────────────
// 封裝所有 localStorage.setItem，統一處理 QuotaExceededError
// 回傳 true 表示成功，false 表示失敗
//
// ── 儲存空間預警機制 ─────────────────────────────────────────────────────────
// 每次寫入後若用量超過 WARN_RATIO（80%），發出預警通知。
// 用 _storageWarnedAt 記錄上次警告時間，避免每次存檔都彈出。
const _STORAGE_LIMIT  = 5 * 1024 * 1024; // 5 MB（localStorage 典型上限）
const _WARN_RATIO     = 0.80;             // 80% 開始預警
const _WARN_COOLDOWN  = 5 * 60 * 1000;   // 兩次預警之間至少間隔 5 分鐘
let   _storageWarnedAt = 0;

function _checkStorageUsage() {
    try {
        let total = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            total += (k.length + (localStorage.getItem(k) || '').length) * 2;
        }
        const pct = total / _STORAGE_LIMIT;
        const now = Date.now();
        if (pct >= 1.0) {
            // 已滿（理論上 setItem 已拋例外，這裡補一道保險）
            if (now - _storageWarnedAt > _WARN_COOLDOWN) {
                _storageWarnedAt = now;
                _showPersistentStorageAlert('🚨 儲存空間已滿！上次寫入可能已遺失。請立即至 💾 儲存空間管理 匯出資料並清理舊記錄。', 'error');
            }
        } else if (pct >= _WARN_RATIO) {
            if (now - _storageWarnedAt > _WARN_COOLDOWN) {
                _storageWarnedAt = now;
                const usedPct = Math.round(pct * 100);
                _showPersistentStorageAlert(`⚠️ 儲存空間已用 ${usedPct}%（接近上限），建議至 💾 儲存空間管理 匯出備份並清理資料，避免資料遺失。`, 'warn');
            }
        }
    } catch (_) { /* 計算失敗不影響主流程 */ }
}

/**
 * 比一般 showNotification 更持久的儲存空間警告橫幅。
 * 會在頁面最上方插入一條固定橫幅，附帶「前往管理」按鈕與關閉鈕。
 * 若橫幅已存在則更新文字，不重複建立。
 */
function _showPersistentStorageAlert(message, level) {
    const BANNER_ID = 'storage-warn-banner';
    let banner = document.getElementById(BANNER_ID);
    if (!banner) {
        banner = document.createElement('div');
        banner.id = BANNER_ID;
        banner.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
            'display:flex', 'align-items:center', 'gap:10px',
            'padding:10px 16px', 'font-size:0.88em', 'font-weight:600',
            'box-shadow:0 2px 8px rgba(0,0,0,0.18)', 'flex-wrap:wrap'
        ].join(';');

        const msgEl = document.createElement('span');
        msgEl.id = BANNER_ID + '-msg';
        msgEl.style.flex = '1';
        banner.appendChild(msgEl);

        const openBtn = document.createElement('button');
        openBtn.textContent = '💾 前往管理';
        openBtn.style.cssText = 'padding:4px 12px;border-radius:5px;border:none;cursor:pointer;font-weight:700;font-size:0.95em;';
        openBtn.addEventListener('click', () => {
            if (typeof openStorageViewer === 'function') openStorageViewer();
            banner.remove();
        });
        banner.appendChild(openBtn);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.title = '關閉（本次忽略）';
        closeBtn.style.cssText = 'padding:4px 8px;border-radius:5px;border:none;cursor:pointer;font-size:0.9em;';
        closeBtn.addEventListener('click', () => banner.remove());
        banner.appendChild(closeBtn);

        document.body.prepend(banner);
    }

    const isError = level === 'error';
    banner.style.background = isError ? '#b71c1c' : '#e65100';
    banner.style.color       = '#fff';
    document.getElementById(BANNER_ID + '-msg').textContent = message;
}

function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        // 寫入成功後非同步檢查用量，不阻塞主流程
        setTimeout(_checkStorageUsage, 0);
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            console.error('[FIX-3] localStorage quota exceeded for key:', key);
            _showPersistentStorageAlert('🚨 儲存失敗：空間已滿！資料未能寫入。請立即至 💾 儲存空間管理 匯出備份並清理舊記錄。', 'error');
        } else {
            console.error('[FIX-3] localStorage.setItem error for key:', key, e);
        }
        return false;
    }
}
// ─────────────────────────────────────────────────────────────────────────────

function saveWordsToStorage() {
    const serializableWords = serializeDataForStorage(savedWords);
    // FIX-3: 使用 safeSetItem 取代裸露的 setItem
    if (safeSetItem(SAVED_WORDS_KEY, JSON.stringify(serializableWords))) {
        console.log("Notes saved to Local Storage.");
    }
}

// === NEW UNIFIED SAVE FUNCTION ===
function persistNotes() {
    if (currentUser) {
        saveWordsToFirestore();
    } else {
        saveWordsToStorage();
    }
}

// ===== UPDATED FUNCTION: SAVE PLAYBACK STATE TO CLOUD =====
function saveLastPlaybackState() {
    if (currentStoryIndex > -1 && currentStoryList[currentStoryIndex]) {
        const story = currentStoryList[currentStoryIndex];
        const state = { 
            title: story['標題'], 
            time: audio.currentTime,
            category: story['分類']?.[0],
            majorCategory: story['大類'] || 'Uncategorized'
        };
        
        // 1. Save globally (最新的播放記錄) — FIX-3: 使用 safeSetItem
        safeSetItem(LAST_SESSION_KEY, JSON.stringify(state));

        // 2. 儲存到該子分類的專屬記錄
        try {
            const subCategorySessions = JSON.parse(localStorage.getItem(SUB_CATEGORY_SESSION_KEY) || '{}');
            
            const categoryKey = state.category;
            if (categoryKey) {
                subCategorySessions[categoryKey] = {
                    title: state.title,
                    time: state.time,
                    majorCategory: state.majorCategory,
                    timestamp: Date.now()
                };
                // FIX-3: 使用 safeSetItem
                safeSetItem(SUB_CATEGORY_SESSION_KEY, JSON.stringify(subCategorySessions));
            }
        } catch (e) {
            console.error("Error saving sub-category session:", e);
        }

        // 3. If logged in, sync to Cloud
        if (currentUser) {
            db.collection('userNotes').doc(currentUser.uid).set({ 
                lastSession: state,
                subCategorySessions: JSON.parse(localStorage.getItem(SUB_CATEGORY_SESSION_KEY) || '{}')
            }, { merge: true }).catch(err => console.error("Error saving session to cloud:", err));
        }
    }
}


function clearLastPlaybackState() {
    localStorage.removeItem(LAST_SESSION_KEY);
}

function clearSubCategoryPlaybackState(categoryName) {
    try {
        const subCategorySessions = JSON.parse(localStorage.getItem(SUB_CATEGORY_SESSION_KEY) || '{}');
        if (subCategorySessions[categoryName]) {
            delete subCategorySessions[categoryName];
            // FIX-3: 使用 safeSetItem
            safeSetItem(SUB_CATEGORY_SESSION_KEY, JSON.stringify(subCategorySessions));
        }
    } catch (e) {
        console.error("Error clearing sub-category session:", e);
    }
}

// story.js - 新增 Helper Functions

// 1. 取得所有已儲存單字的 Set (將所有分類、所有文章下的 Words 集合起來)
function getAllSavedWordsSet() {
    const set = new Set();
    // 遍歷 savedWords 物件
    for (const cat in savedWords) {
        for (const title in savedWords[cat]) {
            const data = savedWords[cat][title];
            if (data.words) {
                // 轉為小寫存入，方便比對
                data.words.forEach(w => set.add(w.toLowerCase().trim()));
            }
        }
    }
    return set;
}

// NEW: Get saved words only for the current story
function getSavedWordsForCurrentStory(categoryName, titleName) {
    const set = new Set();
    if (!categoryName || !titleName) return set;
    
    const storyData = savedWords[categoryName]?.[titleName];
    if (storyData && storyData.words) {
        storyData.words.forEach(w => set.add(w.toLowerCase().trim()));
    }
    // Also include phrases for highlighting
    if (storyData && storyData.phrases) {
        storyData.phrases.forEach(p => set.add(p.toLowerCase().trim()));
    }
    return set;
}


// 2. 模糊比對邏輯 (處理複數、過去式、進行式)
function isWordSaved(rawText, savedSet) {
    // 先移除標點符號並轉小寫 (例如 "running." -> "running")
    const word = rawText.replace(/^[.,?!:;'"`""''()[\]{}\-/*]+|[.,?!:;'"`""''()[\]{}\-/*]+$/g, '').toLowerCase();
    
    if (!word) return false;

    // A. 直接命中 (例如 saved: "apple", text: "apple")
    if (savedSet.has(word)) return true;

    // B. 簡單的詞尾變化還原 (Heuristic Stemming)
    // 注意：這無法處理不規則變化 (如 go -> went)，但能處理大部分情況
    
    // === FORWARD MATCHING: Check if text word matches saved word ===
    // (Text word is a variation of saved word)
    
    // 1. 複數/第三人稱單數 (ends with 's') -> 移除 's'
    if (word.endsWith('s') && savedSet.has(word.slice(0, -1))) return true;
    
    // 2. 複數 (ends with 'es') -> 移除 'es' (e.g., boxes -> box)
    if (word.endsWith('es') && savedSet.has(word.slice(0, -2))) return true;
    
    // 3. 過去式 (ends with 'ed') -> 移除 'd' 或 'ed'
    if (word.endsWith('ed')) {
        if (savedSet.has(word.slice(0, -1))) return true; // e.g., danced -> dance
        if (savedSet.has(word.slice(0, -2))) return true; // e.g., played -> play
    }
    
    // 4. 進行式 (ends with 'ing') -> 移除 'ing'
    if (word.endsWith('ing')) {
        if (savedSet.has(word.slice(0, -3))) return true; // e.g., playing -> play
        // 5. 進行式去e加ing的情況 (e.g., making -> make) -> 移除 'ing' 補 'e'
        if (savedSet.has(word.slice(0, -3) + 'e')) return true;
    }
    
    // === REVERSE MATCHING: Check if saved words are variations of text word ===
    // (Saved word is base form, text word is variation)
    // Examples that work with this logic:
    //   - text="recognized", saved="recognize" (recognize + d = recognized)
    //   - text="Alchemist", saved="alchemist" (case-insensitive, handled by toLowerCase)
    // Note: "wiped" -> "wipe" is already handled by FORWARD matching above
    
    for (const savedWord of savedSet) {
        // Check if saved word + common endings = text word
        
        // Past tense variations
        if (word === savedWord + 'd') return true;  // e.g., wipe -> wiped, recognize -> recognized
        if (word === savedWord + 'ed') return true; // e.g., play -> played
        
        // For words ending in 'e', check if removing 'e' and adding 'ed' matches
        if (savedWord.endsWith('e') && word === savedWord.slice(0, -1) + 'ed') return true; // e.g., love -> loved
        
        // Present participle / gerund variations
        if (word === savedWord + 'ing') return true; // e.g., play -> playing
        if (savedWord.endsWith('e') && word === savedWord.slice(0, -1) + 'ing') return true; // e.g., love -> loving
        
        // Plural / third person variations
        if (word === savedWord + 's') return true;   // e.g., play -> plays
        if (word === savedWord + 'es') return true;  // e.g., box -> boxes
        
        // For words ending in consonant+y, check if changing 'y' to 'ies' matches
        if (savedWord.endsWith('y') && savedWord.length > 1) {
            const beforeY = savedWord[savedWord.length - 2];
            // Check if it's consonant + y (not vowel + y)
            if (!/[aeiou]/.test(beforeY)) {
                if (word === savedWord.slice(0, -1) + 'ies') return true; // e.g., carry -> carries
                if (word === savedWord.slice(0, -1) + 'ied') return true; // e.g., carry -> carried
            }
        }
    }

    return false;
}

// --- Word Classification ---

function classifyEntry(text) {
    const trimmedText = text.trim();
    const wordCount = trimmedText.split(/\s+/).length;
    const hasEndingPunctuation = /[.?!]$/.test(trimmedText);
    // 新增：檢查是否包含連字號
    const hasHyphen = trimmedText.includes('-');

    if (wordCount > 4 || hasEndingPunctuation) return 'sentences';
    // 修改：如果單詞數大於1，或者包含連字號，就歸類為片語
    if (wordCount > 1 || hasHyphen) return 'phrases';
    return 'words';
}


// --- Word Note Functions ---
function addWordToNote(text, category, title) {
    // 將 cleanedText 從 const 改為 let，使其可以被修改
    let cleanedText = text.trim();
    if (!cleanedText || !category || !title) return;

    if (!savedWords[category]) savedWords[category] = {};
    if (!savedWords[category][title]) {
        savedWords[category][title] = { words: new Set(), phrases: new Set(), sentences: new Set() };
    }

    const type = classifyEntry(cleanedText);

    // 新增邏輯：如果類型是片語，將空格替換為連字號
    if (type === 'phrases') {
        // 使用正規表示式 \s+ 來處理一個或多個連續空格的情況
        cleanedText = cleanedText.replace(/\s+/g, '-');
    }

    savedWords[category][title][type].add(cleanedText);
    persistNotes(); // Use the new unified save function
}

function showNotification(message, type = 'info') {
    const containerId = 'notification-container';
    let container = document.getElementById(containerId);
    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        // 基本樣式，使其固定在右上角
        container.style.position = 'fixed';
        container.style.top = '20px';
        container.style.right = '20px';
        container.style.zIndex = '1050';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    // 模仿您在 index.js 中的 class 名稱
    toast.className = `toast ${type}`; 
    toast.textContent = message;

    // 添加一些基本樣式讓它可見
    Object.assign(toast.style, {
        padding: '10px 20px',
        backgroundColor: type === 'error' ? '#f44336' : (type === 'warning' ? '#ff9800' : '#4CAF50'),
        color: 'white',
        borderRadius: '5px',
        marginBottom: '10px',
        boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
        opacity: '0',
        transition: 'opacity 0.3s'
    });
    
    container.appendChild(toast);
    
    // 淡入效果
    setTimeout(() => { toast.style.opacity = '1'; }, 10);

    // 4秒後自動移除
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.addEventListener('transitionend', () => toast.remove());
    }, 4000);
}

// --- NEW: Functions for Sentence Playback ---
async function getTimestampForStory(title) {
    // BUG FIX: 原本用 if (timestampCache[title]) 判斷，
    // 當快取值為 null（查詢失敗）時會被當成 false，導致每次都重複發出失敗的網路請求。
    // 改為 !== undefined，讓成功(data)和失敗(null)都能被正確快取。
    if (timestampCache[title] !== undefined) {
        return timestampCache[title];
    }

    const url = `https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/audio/${encodeURIComponent(title.trim())} Timestamp.txt`;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const text = await response.text();
            const rawData = parseTimestampText(text); // Uses existing parser
            // 套用 localStorage tsOverride
            const data = (typeof applyTsOverride === 'function')
                ? applyTsOverride(title, rawData)
                : rawData;
            timestampCache[title] = data;
            return data;
        } else {
            console.warn(`Timestamp file not found for "${title}"`);
            timestampCache[title] = null; // Cache the failure
            return null;
        }
    } catch (error) {
        console.error(`Error fetching timestamp for ${title}:`, error);
        timestampCache[title] = null;
        return null;
    }
}

/**
 * 強制清除指定文章（或全部）的 timestamp 記憶體快取。
 * 當你更新了 GitHub 上的 Timestamp.txt，在不重整頁面的情況下，
 * 可在瀏覽器 console 輸入 clearTimestampCache(null) 強制重新載入全部，
 * 或 clearTimestampCache("文章標題") 只清除特定文章。
 * @param {string|null} title  文章標題；傳 null 清除全部
 */
function clearTimestampCache(title) {
    if (title) {
        delete timestampCache[title];
        console.log(`[Timestamp] Cache cleared for "${title}"`);
    } else {
        const count = Object.keys(timestampCache).length;
        timestampCache = {};
        console.log(`[Timestamp] All cache cleared (${count} entries)`);
    }
}

async function playSentenceSnippet(sentenceText, storyTitle) {
    // ── 停止任何正在播放的片段 ──────────────────────────────
    // 停止 Web Audio Engine 的播放
    if (typeof WebAudioEngine !== 'undefined') {
        WebAudioEngine.stop();
    }
    // 相容性保留：停止舊的 noteAudioPlayer（不再用於播放，但仍用於主播放列）
    if (currentSnippetTimeout) {
        clearTimeout(currentSnippetTimeout);
        currentSnippetTimeout = null;
    }
    if (noteAudioPlayer._snippetTimeUpdateHandler) {
        noteAudioPlayer.removeEventListener('timeupdate', noteAudioPlayer._snippetTimeUpdateHandler);
        noteAudioPlayer._snippetTimeUpdateHandler = null;
    }
    noteAudioPlayer.pause();

    // iOS Chrome Fix: 在所有 await 之前同步解鎖 AudioContext。
    // await getTimestampForStory() 會離開手勢堆疊，之後 resume() 靜默失敗。
    if (typeof WebAudioEngine !== 'undefined' && WebAudioEngine.isSupported()) {
        WebAudioEngine.unlock();
    }

    // 暫停主播放器
    if (isPlaying) {
        pauseAudio();
    }

    // ── 查找 Timestamp ───────────────────────────────────────
    const tsData = await getTimestampForStory(storyTitle);
    if (!tsData || tsData.length === 0) {
        showNotification(`Timestamp data not found for "${storyTitle}".`, 'error');
        return;
    }

    const normalize = (text) => text.trim().replace(/[.,?!'"`\u201c\u201d\u2018\u2019]/g, '').toLowerCase();
    const normalizedSentence = normalize(sentenceText);
    const match = tsData.find(line => normalize(line.sentence) === normalizedSentence);

    if (!match) {
        showNotification('Could not find the exact sentence in the story timestamp.', 'warning');
        console.warn(`[Snippet] No match found for: "${normalizedSentence}"`);
        return;
    }

    // 套用已調整的時間
    const adjusted = (typeof getNoteAdjustedTiming === 'function')
        ? getNoteAdjustedTiming(storyTitle, sentenceText, match.start, match.end)
        : { start: match.start, end: match.end };
    const { start, end } = adjusted;

    if (end - start <= 0) {
        showNotification('Invalid timestamp duration for this sentence.', 'error');
        return;
    }

    const audioSrc = `audio/${encodeURIComponent(storyTitle.trim())}.mp3`;

    // ── 優先使用 Web Audio Engine（精確，手機/PC 一致）──────
    if (typeof WebAudioEngine !== 'undefined' && WebAudioEngine.isSupported()) {
        await WebAudioEngine.playSnippet({
            src:     audioSrc,
            start:   start,
            end:     end,
            onStart: () => console.log(`[Snippet] Playing: "${sentenceText.substring(0, 40)}…"`),
            onEnd:   () => console.log('[Snippet] Playback ended.'),
            onError: (err) => {
                console.error('[Snippet] WebAudioEngine error:', err);
                showNotification('Could not play audio for this sentence.', 'error');
            }
        });
        return;
    }

    // ── Fallback：舊的 HTMLAudioElement 方式（瀏覽器不支援 Web Audio API 時）──
    console.warn('[Snippet] Web Audio API not supported, falling back to HTMLAudioElement.');
    const currentSrcFilename = decodeURIComponent(noteAudioPlayer.src.split('/').pop() || '');
    const targetFilename = `${storyTitle.trim()}.mp3`;
    if (currentSrcFilename !== targetFilename) {
        noteAudioPlayer.src = audioSrc;
        noteAudioPlayer.load();
    }
    const isMobile = isMobileDevice();
    const bufferTime = isMobile ? 0.3 : 0.1;
    const stopBuffer = isMobile ? 0.6 : 0.2;
    noteAudioPlayer.currentTime = Math.max(0, start - bufferTime);
    const timeUpdateHandler = function() {
        if (noteAudioPlayer.currentTime >= end + stopBuffer) {
            noteAudioPlayer.pause();
            noteAudioPlayer.removeEventListener('timeupdate', timeUpdateHandler);
            noteAudioPlayer._snippetTimeUpdateHandler = null;
        }
    };
    noteAudioPlayer._snippetTimeUpdateHandler = timeUpdateHandler;
    noteAudioPlayer.addEventListener('timeupdate', timeUpdateHandler);
    noteAudioPlayer.play().catch(e => {
        console.error('[Snippet] Fallback play failed:', e);
        showNotification('Could not play audio for this sentence.', 'error');
        noteAudioPlayer.removeEventListener('timeupdate', timeUpdateHandler);
        noteAudioPlayer._snippetTimeUpdateHandler = null;
    });
    const actualDuration = (end + stopBuffer - Math.max(0, start - bufferTime)) * 1000;
    currentSnippetTimeout = setTimeout(() => {
        if (!noteAudioPlayer.paused) noteAudioPlayer.pause();
        if (noteAudioPlayer._snippetTimeUpdateHandler) {
            noteAudioPlayer.removeEventListener('timeupdate', noteAudioPlayer._snippetTimeUpdateHandler);
            noteAudioPlayer._snippetTimeUpdateHandler = null;
        }
        currentSnippetTimeout = null;
    }, actualDuration + 300);
}


// NEW helper function to get the current expansion state of note sections
function getExpansionStates() {
    const states = {};
    const headers = document.querySelectorAll('#note-content-wrapper .note-section-header');
    headers.forEach(header => {
        const targetId = header.dataset.target;
        if (targetId) {
            states[targetId] = header.classList.contains('is-expanded');
        }
    });
    return states;
}

// ===== MODIFIED FUNCTION =====
function renderNoteView(level = 'categories', categoryName = null, titleName = null, expansionStates = null) {
    const noteContentWrapper = document.getElementById('note-content-wrapper');
    const noteAddSection = document.querySelector('.note-add-section');
    
    // Explicitly hide form and buttons by default
    if (noteAddSection) noteAddSection.style.display = 'none';
    backToStoryFromNoteBtn.hidden = true;
    exportCurrentNoteJsonBtn.hidden = true;
    exportAllNotesJsonBtn.hidden = true;
    prevNoteBtn.hidden = true; 
    prevNoteBtn.onclick = null; 
    nextNoteBtn.hidden = true; 
    nextNoteBtn.onclick = null;
    const goToQuizBtn = document.getElementById('go-to-quiz-btn');
    if (goToQuizBtn) goToQuizBtn.hidden = true;
    
    backToStoryFromNoteBtn.classList.remove('is-highlighted');
    backToHomeFromNoteBtn.classList.remove('is-highlighted');

    const createListItem = (text, clickHandler, container) => {
        const item = document.createElement('div');
        item.className = 'category-item';
        item.textContent = text;
        item.addEventListener('click', clickHandler);
        container.appendChild(item);
    };

    if (level === 'categories' || level === 'titles') {
        noteViewTitleEl.textContent = 'Word Note'; 
        noteContentWrapper.innerHTML = '<div class="list" id="temp-list-container"></div>';
        const tempListContainer = document.getElementById('temp-list-container');
        
        if (level === 'categories') {
            const categories = Object.keys(savedWords).sort((a, b) => a.localeCompare(b));
            if (categories.length === 0) {
                tempListContainer.innerHTML = '<p>No notes saved yet.</p>';
            } else {
                categories.forEach(category => {
                    // 計算該分類下所有標題的總筆數
                    const titles = Object.keys(savedWords[category] || {});
                    let totalItems = 0;
                    titles.forEach(title => {
                        const data = savedWords[category][title];
                        totalItems += (data.words?.size || 0) + (data.phrases?.size || 0) + (data.sentences?.size || 0);
                    });

                    const item = document.createElement('div');
                    item.className = 'category-item note-category-item';
                    item.innerHTML = `
                        <span>${category}</span>
                        <span class="note-badge">${totalItems}</span>
                    `;
                    item.addEventListener('click', () => renderNoteView('titles', category));
                    tempListContainer.appendChild(item);
                });
            }
            backToHomeFromNoteBtn.onclick = () => showView(homeView);
        } else { // level === 'titles'
            const titles = Object.keys(savedWords[categoryName] || {}).sort((a, b) => a.localeCompare(b));
            titles.forEach(title => {
                const data = savedWords[categoryName][title];
                const w = data.words?.size || 0;
                const p = data.phrases?.size || 0;
                const s = data.sentences?.size || 0;

                const item = document.createElement('div');
                item.className = 'category-item note-category-item';
                item.innerHTML = `
                    <span class="note-title-text">${title}</span>
                    <span class="note-title-badges">
                        ${w > 0 ? `<span class="note-badge-small note-badge-w">W ${w}</span>` : ''}
                        ${p > 0 ? `<span class="note-badge-small note-badge-p">P ${p}</span>` : ''}
                        ${s > 0 ? `<span class="note-badge-small note-badge-s">S ${s}</span>` : ''}
                    </span>
                `;
                item.addEventListener('click', () => renderNoteView('words', categoryName, title));
                tempListContainer.appendChild(item);
            });
            backToHomeFromNoteBtn.onclick = () => renderNoteView('categories');
        }
    } else if (level === 'words' && categoryName && titleName) {
        
        noteViewTitleEl.textContent = `Note: ${titleName}`; 
        
        // Show the input form ONLY in this view
        if (noteAddSection) noteAddSection.style.display = 'block';
        
        // Show export buttons
        exportCurrentNoteJsonBtn.hidden = false;
        exportAllNotesJsonBtn.hidden = false;

        // Helper function to build each collapsible section's HTML
        const buildSectionHTML = (type, title, count) => {
            const listId = `note-list-${type}`;
            const isExpanded = expansionStates ? expansionStates[listId] === true : false;
            const headerClass = isExpanded ? 'note-section-header is-expanded' : 'note-section-header';
            const listStyle = isExpanded ? '' : 'style="display: none;"';
            const countBadge = count > 0 ? `<span class="note-section-count">(${count})</span>` : '';

            return `
                <div class="${headerClass}" data-target="${listId}"><h3>${title} ${countBadge}</h3><span class="toggle-icon"></span></div>
                <div id="${listId}" class="list" ${listStyle}></div>
            `;
        };

        const noteDataPreview = savedWords[categoryName]?.[titleName] || { words: new Set(), phrases: new Set(), sentences: new Set() };
        
        noteContentWrapper.innerHTML = `
            ${buildSectionHTML('words', 'Words', noteDataPreview.words?.size || 0)}
            ${buildSectionHTML('phrases', 'Phrases', noteDataPreview.phrases?.size || 0)}
            ${buildSectionHTML('sentences', 'Sentences', noteDataPreview.sentences?.size || 0)}
        `;
        
        noteViewCategory = categoryName;
        noteViewTitle = titleName;

        // 預載對應文章的 MP3（Web Audio Engine 背景解碼，讓句子播放時能即時回應）
        const preloadSrc = `audio/${encodeURIComponent(titleName.trim())}.mp3`;
        if (typeof WebAudioEngine !== 'undefined' && WebAudioEngine.isSupported()) {
            WebAudioEngine.preload(preloadSrc);
            console.log(`[Note] WebAudioEngine preloading: ${titleName}`);
        } else {
            // Fallback：舊的 HTMLAudioElement 預載
            if (!noteAudioPlayer.src.endsWith(encodeURIComponent(titleName.trim()) + '.mp3')) {
                noteAudioPlayer.pause();
                noteAudioPlayer.src = preloadSrc;
                noteAudioPlayer.preload = 'auto';
                noteAudioPlayer.load();
                console.log(`[Note] Preloading audio (fallback) for: ${titleName}`);
            }
        }

        backToStoryFromNoteBtn.hidden = false;
        if (goToQuizBtn) goToQuizBtn.hidden = false;

        if (currentNoteOrigin === 'story') {
            backToStoryFromNoteBtn.classList.add('is-highlighted');
        } else {
            backToHomeFromNoteBtn.classList.add('is-highlighted');
        }

        // --- Navigation Logic ---
        const storyList = stories.filter(item => item['分類']?.map(c => c.trim()).includes(categoryName))
                                 .sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));
        const currentIndex = storyList.findIndex(story => story['標題'] === titleName);
        
        if (currentIndex > 0) {
            const prevStory = storyList[currentIndex - 1];
            prevNoteBtn.hidden = false;
            prevNoteBtn.onclick = () => {
                currentNoteOrigin = 'menu';
                playbackPositionBeforeNote = 0;
                const currentState = getExpansionStates();
                renderNoteView('words', categoryName, prevStory['標題'], currentState);
            };
        }
        
        if (currentIndex > -1 && currentIndex < storyList.length - 1) {
            const nextStory = storyList[currentIndex + 1];
            nextNoteBtn.hidden = false;
            nextNoteBtn.onclick = () => {
                currentNoteOrigin = 'menu'; 
                playbackPositionBeforeNote = 0; 
                const currentState = getExpansionStates(); 
                renderNoteView('words', categoryName, nextStory['標題'], currentState);
            };
        }

        const noteData = savedWords[categoryName]?.[titleName] || { words: new Set(), phrases: new Set(), sentences: new Set() };
        const sortItems = (set) => Array.from(set).sort((a, b) => a.localeCompare(b));

        const createWordItem = (itemText, type, container) => {
            const item = document.createElement('div');
            item.className = 'word-item';
            
            // Container for text or input
            let wordTextEl = document.createElement('span');
            wordTextEl.className = 'word-text';
            wordTextEl.textContent = itemText;
            
            const actions = document.createElement('div');
            actions.className = 'word-item-actions';

            // 1. Voice Button
            const voiceBtn = document.createElement('button');
            voiceBtn.textContent = '▶';
            voiceBtn.title = 'Play';
            voiceBtn.addEventListener('click', (e) => {
                e.stopPropagation();

                // Highlight button to show it's playing
                voiceBtn.classList.add('is-playing-voice');

                if (type === 'sentences') {
                    // B-04 修正：改用 WebAudioEngine 的 onEnd callback 還原按鈕狀態
                    // 原本監聽 noteAudioPlayer 的 pause/ended，但 WebAudioEngine 不觸發這些事件
                    if (typeof WebAudioEngine !== 'undefined' && WebAudioEngine.isSupported()) {
                        (async () => {
                            const tsData = await getTimestampForStory(noteViewTitle);
                            if (!tsData || tsData.length === 0) {
                                voiceBtn.classList.remove('is-playing-voice');
                                showNotification('Timestamp data not found.', 'error');
                                return;
                            }
                            const normalize = (t) => t.trim().replace(/[.,?!'"]/g, '').toLowerCase();
                            const match = tsData.find(line => normalize(line.sentence) === normalize(itemText));
                            if (!match) {
                                voiceBtn.classList.remove('is-playing-voice');
                                showNotification('Could not find sentence in timestamp.', 'warning');
                                return;
                            }
                            const adjusted = (typeof getNoteAdjustedTiming === 'function')
                                ? getNoteAdjustedTiming(noteViewTitle, itemText, match.start, match.end)
                                : { start: match.start, end: match.end };
                            const audioSrc = 'audio/' + encodeURIComponent(noteViewTitle.trim()) + '.mp3';
                            WebAudioEngine.playSnippet({
                                src: audioSrc,
                                start: adjusted.start,
                                end: adjusted.end,
                                onEnd: () => voiceBtn.classList.remove('is-playing-voice'),
                                onError: () => {
                                    voiceBtn.classList.remove('is-playing-voice');
                                    showNotification('Could not play audio for this sentence.', 'error');
                                }
                            });
                        })();
                    } else {
                        // Fallback：WebAudioEngine 不支援時，沿用原本流程
                        playSentenceSnippet(itemText, noteViewTitle);
                        const restoreOnEnd = () => {
                            voiceBtn.classList.remove('is-playing-voice');
                            noteAudioPlayer.removeEventListener('pause', restoreOnEnd);
                            noteAudioPlayer.removeEventListener('ended', restoreOnEnd);
                        };
                        noteAudioPlayer.addEventListener('pause', restoreOnEnd, { once: true });
                        noteAudioPlayer.addEventListener('ended', restoreOnEnd, { once: true });
                    }
                } else {
                    // 嘗試播放 GitHub MP3，若找不到則降級 TTS
                    const cleanItem = itemText.trim();

                    // ── iOS Fix: 修正 1 ──────────────────────────────────────────────
                    // 必須在 user gesture 的同步 call stack 內立即送出靜音佔位，
                    // 取得 iOS WebKit 的 TTS 授權，後續無論走 MP3 或 TTS 路徑授權均已就緒。
                    _iosPreUnlockTTS(cleanItem);

                    const onVoiceEnd = () => voiceBtn.classList.remove('is-playing-voice');

                    // ── iOS Fix: 修正 2 ──────────────────────────────────────────────
                    // 優先使用 _quizPlayWord（AudioContext 路徑），解決 iOS Chrome 對
                    // new Audio() 跨域 autoplay policy 導致的靜音問題。
                    // iosCallbacks 讓 MP3 成功時 cancel() 掉靜音佔位，
                    // MP3 失敗時以原音量重播 TTS（授權已由 pre-unlock 取得）。
                    if (typeof _quizPlayWord === 'function') {
                        _quizPlayWord(cleanItem, voiceBtn, onVoiceEnd, {
                            onMp3Success: () => {
                                window.speechSynthesis.cancel();
                            },
                            onMp3Fail: () => {
                                // MP3 全部失敗，以原音量重播 TTS（iOS 授權已解鎖）
                                window.speechSynthesis.cancel();
                                const u = new SpeechSynthesisUtterance(cleanItem);
                                u.lang = 'en-US';
                                u.rate = 0.9;
                                let _startFired = false;
                                u.onstart = () => { _startFired = true; };
                                u.onend = onVoiceEnd;
                                u.onerror = onVoiceEnd;
                                voiceBtn.classList.add('is-playing-voice');
                                window.speechSynthesis.speak(u);
                                // iOS Fix: 修正 3 — 靜音偵測時間統一改為 800ms
                                setTimeout(() => {
                                    if (!_startFired && !window.speechSynthesis.speaking) {
                                        voiceBtn.classList.remove('is-playing-voice');
                                    }
                                }, 800);
                            }
                        });
                    } else {
                        // _quizPlayWord 不可用時的備用路徑（舊瀏覽器）
                        const capitalized = cleanItem.charAt(0).toUpperCase() + cleanItem.slice(1).toLowerCase();
                        const candidates = [...new Set([capitalized, cleanItem.toLowerCase()])];
                        let tried = 0;

                        function _tryNoteGithub() {
                            if (tried >= candidates.length) {
                                // MP3 不存在 → 降級 TTS（iOS 授權已由 pre-unlock 取得）
                                window.speechSynthesis.cancel();
                                if ('speechSynthesis' in window) {
                                    const u = new SpeechSynthesisUtterance(cleanItem);
                                    u.lang = 'en-US';
                                    u.rate = 0.9;
                                    let _startFired = false;
                                    u.onstart = () => { _startFired = true; };
                                    u.onend = onVoiceEnd;
                                    u.onerror = onVoiceEnd;
                                    voiceBtn.classList.add('is-playing-voice');
                                    window.speechSynthesis.speak(u);
                                    // iOS Fix: 修正 3 — 靜音偵測時間統一改為 800ms
                                    setTimeout(() => {
                                        if (!_startFired && !window.speechSynthesis.speaking) {
                                            voiceBtn.classList.remove('is-playing-voice');
                                        }
                                    }, 800);
                                }
                                return;
                            }
                            const BASE = 'https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/';
                            const src = BASE + encodeURIComponent(candidates[tried++]) + '.mp3';
                            const au = new Audio(src);
                            let settled = false;
                            au.onerror = () => { if (!settled) { settled = true; _tryNoteGithub(); } };
                            au.play()
                                .then(() => { window.speechSynthesis.cancel(); }) // MP3 成功，取消靜音佔位
                                .catch(() => { if (!settled) { settled = true; _tryNoteGithub(); } });
                            au.addEventListener('canplay', () => { settled = true; }, { once: true });
                            au.addEventListener('ended', onVoiceEnd, { once: true });
                        }
                        _tryNoteGithub();
                    }
                }
            });
            actions.appendChild(voiceBtn);

            // 1b. Audio Edit Button (only for sentences)
            if (type === 'sentences') {
                // 非同步建立：先佔位，timestamp 載入後填入真正的 start/end
                const audioEditBtnPlaceholder = document.createElement('button');
                audioEditBtnPlaceholder.className = 'audio-edit-inline-btn';
                audioEditBtnPlaceholder.title = '調整音檔時間';
                audioEditBtnPlaceholder.innerHTML = '✏️';
                actions.appendChild(audioEditBtnPlaceholder);

                // 非同步取得 timestamp，再更新按鈕
                getTimestampForStory(noteViewTitle).then(tsData => {
                    if (!tsData) return;
                    const normalize = (t) => t.trim().replace(/[.,?!'"`""'']/g, '').toLowerCase();
                    const match = tsData.find(line => normalize(line.sentence) === normalize(itemText));
                    if (!match) return;

                    const audioSrc = `audio/${encodeURIComponent(noteViewTitle.trim())}.mp3`;
                    // 用 createAudioEditBtn 替換佔位按鈕
                    const realBtn = createAudioEditBtn({
                        title:    noteViewTitle,
                        sentence: itemText,
                        start:    match.start,
                        end:      match.end,
                        audioSrc,
                        player:   noteAudioPlayer,
                        onSave:   (newStart, newEnd) => {
                            // 更新按鈕狀態（is-adjusted）
                            realBtn.innerHTML = '✏️✓';
                            realBtn.classList.add('is-adjusted');
                            realBtn.title = '已調整（點擊再編輯）';
                        }
                    });
                    audioEditBtnPlaceholder.replaceWith(realBtn);
                }).catch(() => {
                    // timestamp 不可用，靜默移除佔位按鈕
                    audioEditBtnPlaceholder.remove();
                });
            }

            // 2. Word Button (only for words/phrases)
            if (type === 'words' || type === 'phrases') {
                const wordBtn = document.createElement('button');
                wordBtn.textContent = 'Word';
                wordBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const wordForUrl = itemText.trim().toLowerCase();
                    if (wordForUrl.includes(' ')) {
                        showNotification("「Word」查詢功能不適用於包含空格的片語。", 'warning');
                        return;
                    }
                    const wordExists = vocabularyData.some(wordObj => 
                        (wordObj.Words || "").toLowerCase() === wordForUrl
                    );
                    if (wordExists) {
                        window.open(`https://boydyang-designer.github.io/English-vocabulary/?word=${encodeURIComponent(wordForUrl)}&from=story`, '_blank');
                    } else {
                        showNotification(`單字 "${itemText}" 在詞庫中找不到對應資料。`, 'error');
                    }
                });
                actions.appendChild(wordBtn);
            }

            // 3. Copy Button
            const copyBtn = document.createElement('button');
            copyBtn.className = 'secondary';
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(itemText).then(() => {
                    copyBtn.textContent = 'Copied!';
                    copyBtn.classList.add('btn-success-feedback');
                    setTimeout(() => {
                        copyBtn.textContent = 'Copy';
                        copyBtn.classList.remove('btn-success-feedback');
                    }, 1000);
                });
            });
            actions.appendChild(copyBtn);

            // 4. Edit Button (NEW)
            const editBtn = document.createElement('button');
            editBtn.className = 'secondary';
            editBtn.textContent = 'Edit';
            
            let isEditing = false; // Toggle state

            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                
                if (!isEditing) {
                    // --- Start Editing Mode ---
                    isEditing = true;
                    item.classList.add('is-editing');
                    
                    // Create input
                    const input = document.createElement('input');
                    input.type = 'text';
                    input.value = itemText;
                    input.className = 'edit-word-input'; // Useful for CSS styling
                    // Inline style for immediate effect
                    input.style.flex = '1';
                    input.style.marginRight = '8px';
                    input.style.padding = '5px';
                    input.style.fontSize = '1rem';

                    // Replace span with input
                    wordTextEl.replaceWith(input);
                    input.focus();

                    // Change button to Save
                    editBtn.textContent = 'Save';
                    editBtn.classList.remove('secondary'); // Make it look primary
                    
                    // Allow saving via Enter key
                    input.addEventListener('keydown', (k) => {
                        if(k.key === 'Enter') editBtn.click();
                    });

                } else {
                    // --- Save Mode ---
                    const input = item.querySelector('input');
                    const newValue = input.value.trim();
                    
                    // If changed and not empty
                    if (newValue && newValue !== itemText) {
                         // Update Data
                         savedWords[categoryName][titleName][type].delete(itemText);
                         savedWords[categoryName][titleName][type].add(newValue);
                         persistNotes();
                         
                         // Re-render to sort and clean up
                         const currentState = getExpansionStates();
                         renderNoteView('words', categoryName, titleName, currentState);
                    } else {
                        // Cancel/Revert if empty or no change
                        const span = document.createElement('span');
                        span.className = 'word-text';
                        span.textContent = itemText;
                        
                        input.replaceWith(span);
                        wordTextEl = span; // Update reference
                        
                        editBtn.textContent = 'Edit';
                        editBtn.classList.add('secondary');
                        item.classList.remove('is-editing');
                        isEditing = false;
                    }
                }
            });
            actions.appendChild(editBtn);

            // 5. Delete Button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'secondary';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                item.classList.add('is-deleting');
                setTimeout(() => {
                    if (confirm(`Delete '${itemText}'?`)) {
                        const currentState = getExpansionStates(); 
                        
                        savedWords[categoryName][titleName][type].delete(itemText);
                        const titleData = savedWords[categoryName][titleName];
                        if (titleData.words.size === 0 && titleData.phrases.size === 0 && titleData.sentences.size === 0) {
                            delete savedWords[categoryName][titleName];
                        }
                        if (Object.keys(savedWords[categoryName]).length === 0) {
                            delete savedWords[categoryName];
                        }
                        persistNotes();
                        
                        if (!savedWords[categoryName]) {
                            renderNoteView('categories');
                        } else if (!savedWords[categoryName][titleName]) {
                            renderNoteView('titles', categoryName);
                        } else {
                            renderNoteView('words', categoryName, titleName, currentState); 
                        }
                    } else {
                        item.classList.remove('is-deleting');
                    }
                }, 50);
            });
            actions.appendChild(deleteBtn);

            item.append(wordTextEl, actions);
            container.appendChild(item);
        };
        
        const containers = {
            words: document.getElementById('note-list-words'),
            phrases: document.getElementById('note-list-phrases'),
            sentences: document.getElementById('note-list-sentences')
        };

        ['words', 'phrases', 'sentences'].forEach(type => {
            const items = sortItems(noteData[type]);
            containers[type].innerHTML = '';
            if (items.length === 0) {
                containers[type].innerHTML = `<p>No ${type} saved yet.</p>`;
            } else {
                items.forEach(item => createWordItem(item, type, containers[type]));
            }
        });
        
        backToHomeFromNoteBtn.onclick = () => renderNoteView('titles', categoryName);
    }
}
// ===== END OF MODIFIED FUNCTION =====



// --- Event Listeners & Core App Logic ---

// Note view listeners
goToNoteBtn.addEventListener('click', () => {
    currentNoteOrigin = 'menu'; // Set origin to menu
    renderNoteView('categories');
    showView(noteView);
});

// Quiz home button listener
const goToQuizHomeBtn = document.getElementById('go-to-quiz-home');
if (goToQuizHomeBtn) {
    goToQuizHomeBtn.addEventListener('click', () => {
        openQuiz(null, null);
    });
}

// Scores Dashboard navigation
const goToScoresBtn = document.getElementById('go-to-scores');
if (goToScoresBtn) {
    goToScoresBtn.addEventListener('click', () => {
        if (typeof openScoresDashboard === 'function') openScoresDashboard();
    });
}
const backToHomeFromScoresBtn = document.getElementById('back-to-home-from-scores');
if (backToHomeFromScoresBtn) {
    backToHomeFromScoresBtn.addEventListener('click', () => showView(homeView));
}

// 音檔時間編輯器：首頁入口 & Back 按鈕
const goToAudioEditorHomeBtn = document.getElementById('go-to-audio-editor');
if (goToAudioEditorHomeBtn) {
    goToAudioEditorHomeBtn.addEventListener('click', () => {
        if (typeof openAudioEditorManager === 'function') openAudioEditorManager();
    });
}
const backFromAudioEditorBtn = document.getElementById('back-from-audio-editor-manager');
if (backFromAudioEditorBtn) {
    backFromAudioEditorBtn.addEventListener('click', () => showView(homeView));
}

// ── 新功能：匯出修改版 .txt / 比對 GitHub ──────────────────────
document.getElementById('aem-export-ts-btn')?.addEventListener('click', () => {
    const tsOv = (typeof loadTsOverride === 'function') ? loadTsOverride() : {};
    const titles = Object.keys(tsOv);
    if (titles.length === 0) {
        if (typeof showNotification === 'function') showNotification('目前沒有任何暫存的 Timestamp 修改', 'warning');
        return;
    }
    // 勾選式多選匯出
    if (typeof showTsPickerDialog === 'function') {
        showTsPickerDialog({
            titles,
            heading: '選擇要匯出的文章',
            confirmLabel: '匯出',
            onConfirm: async (selected) => {
                for (const t of selected) {
                    if (typeof exportTimestampTxt === 'function') await exportTimestampTxt(t);
                }
                if (selected.length > 1) {
                    if (typeof showNotification === 'function')
                        showNotification(`✓ 已匯出 ${selected.length} 篇文章的 Timestamp`, 'success');
                }
            }
        });
    }
});

document.getElementById('aem-compare-github-btn')?.addEventListener('click', () => {
    const tsOv = (typeof loadTsOverride === 'function') ? loadTsOverride() : {};
    const titles = Object.keys(tsOv);
    if (titles.length === 0) {
        if (typeof showNotification === 'function') showNotification('目前沒有任何暫存的 Timestamp 修改', 'warning');
        return;
    }
    // 比對只能一篇，但改用勾選 UI（單選）
    if (typeof showTsPickerDialog === 'function') {
        showTsPickerDialog({
            titles,
            heading: '選擇要比對的文章',
            confirmLabel: '比對',
            singleSelect: true,
            onConfirm: (selected) => {
                if (selected.length > 0 && typeof openTsCompare === 'function') {
                    openTsCompare(selected[0]);
                }
            }
        });
    }
});

addManualWordBtn.addEventListener('click', () => {
    const newWord = newWordInput.value.trim();
    if (newWord && noteViewCategory && noteViewTitle) {
        const currentState = getExpansionStates(); // Capture state
        addWordToNote(newWord, noteViewCategory, noteViewTitle);
        newWordInput.value = '';
        newWordInput.focus();
        renderNoteView('words', noteViewCategory, noteViewTitle, currentState); // Pass state
    }
});

newWordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        addManualWordBtn.click();
    }
});

// Staging area listeners
function cleanWord(word) {
  return word ? word.replace(/^[.,?!:;'"`“”‘’()[\]{}\-/*]+|[.,?!:;'"`“”‘’()[\]{}\-/*]+$/g, '') : '';
}

// NEW: Function to find the actual saved word form from notes
function findSavedWordForm(clickedWord, categoryName, titleName) {
    if (!categoryName || !titleName) return null;
    
    const storyData = savedWords[categoryName]?.[titleName];
    if (!storyData) return null;
    
    const normalizedClicked = clickedWord.toLowerCase().trim();
    
    // Check in words
    if (storyData.words) {
        for (const savedWord of storyData.words) {
            const normalizedSaved = savedWord.toLowerCase().trim();
            // Direct match
            if (normalizedClicked === normalizedSaved) {
                return savedWord;
            }
            // Check if they match using the same logic as isWordSaved
            if (isWordMatchVariation(normalizedClicked, normalizedSaved)) {
                return savedWord;
            }
        }
    }
    
    // Check in phrases
    if (storyData.phrases) {
        for (const savedPhrase of storyData.phrases) {
            const normalizedSaved = savedPhrase.toLowerCase().trim();
            if (normalizedClicked === normalizedSaved) {
                return savedPhrase;
            }
            if (isWordMatchVariation(normalizedClicked, normalizedSaved)) {
                return savedPhrase;
            }
        }
    }
    
    return null;
}

// Helper function to check if two normalized words are variations of each other
function isWordMatchVariation(word1, word2) {
    // Try forward matching (word1 is variation of word2)
    if (word1.endsWith('s') && word1.slice(0, -1) === word2) return true;
    if (word1.endsWith('es') && word1.slice(0, -2) === word2) return true;
    if (word1.endsWith('ed') && (word1.slice(0, -1) === word2 || word1.slice(0, -2) === word2)) return true;
    if (word1.endsWith('ing') && (word1.slice(0, -3) === word2 || word1.slice(0, -3) + 'e' === word2)) return true;
    
    // Try reverse matching (word2 is base form, word1 is variation)
    if (word1 === word2 + 'd') return true;
    if (word1 === word2 + 'ed') return true;
    if (word2.endsWith('e') && word1 === word2.slice(0, -1) + 'ed') return true;
    if (word1 === word2 + 'ing') return true;
    if (word2.endsWith('e') && word1 === word2.slice(0, -1) + 'ing') return true;
    if (word1 === word2 + 's') return true;
    if (word1 === word2 + 'es') return true;
    
    // Consonant+y changes
    if (word2.endsWith('y') && word2.length > 1) {
        const beforeY = word2[word2.length - 2];
        if (!/[aeiou]/.test(beforeY)) {
            if (word1 === word2.slice(0, -1) + 'ies') return true;
            if (word1 === word2.slice(0, -1) + 'ied') return true;
        }
    }
    
    return false;
}

// ── 發音系統（兩層降級）───────────────────────────────────────────────────
// 層級一：GitHub audio_files MP3（自有字典，最快最穩）
// 層級二：Web Speech API（瀏覽器合成語音，最後保底）
// ─────────────────────────────────────────────────────────────────────────────

// ── iOS TTS Pre-unlock 工具函式 ───────────────────────────────────────────────
// 必須在 user gesture 的同步 call stack 內呼叫，才能讓 iOS WebKit 解鎖 TTS 授權。
// 送出一個靜音 utterance 佔位；若後續 MP3 播放成功，呼叫 speechSynthesis.cancel()
// 取消它；若 MP3 失敗，重新送出有聲 utterance。
function _iosPreUnlockTTS(text) {
    if (!('speechSynthesis' in window)) return null;
    const u = new SpeechSynthesisUtterance((text || '').trim() || '\u00A0');
    u.volume = 0; // 靜音佔位，不影響使用者體驗
    u.lang = 'en-US';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return u;
}

// 層級二：Web Speech TTS
// FIX-4: _speakTTS — 加入 iOS Chrome 靜音 Bug 偵測與補救
// 策略：speak() 後 800ms 內若 speechSynthesis.speaking 仍為 false，
//       判定靜音，cancel() 後重試一次；重試後 1000ms 仍無聲則通知用戶。
function _speakTTS(word, _retryCount = 0) {
    if (!('speechSynthesis' in window)) {
        showNotification(`Audio for "${word}" was not found and TTS is not supported.`, 'error');
        return;
    }
    // iOS pre-unlock：第一次嘗試時在手勢堆疊內同步送出靜音佔位，取得授權
    // retry 路徑（_retryCount > 0）是在 setTimeout 內呼叫，已脫離手勢堆疊，
    // 但授權已由第一次呼叫時取得，retry 只需直接 speak。
    if (_retryCount === 0) {
        _iosPreUnlockTTS(word);
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.trim());
    utterance.lang = 'en-US';
    utterance.rate = 0.9;

    let _startFired = false;
    utterance.onstart = () => { _startFired = true; };
    utterance.onerror = (e) => {
        console.warn('[FIX-4] TTS onerror:', e.error);
    };

    window.speechSynthesis.speak(utterance);

    // iOS Chrome 靜音偵測：800ms 後確認是否真的開始發音
    setTimeout(() => {
        if (!_startFired && !window.speechSynthesis.speaking) {
            console.warn(`[FIX-4] TTS silent bug detected (attempt ${_retryCount + 1})`);
            window.speechSynthesis.cancel();
            if (_retryCount < 2) {
                // iOS Fix: 修正 4 — 重試上限由 1 次改為 2 次，給 iOS 語音引擎更充裕的初始化機會
                setTimeout(() => _speakTTS(word, _retryCount + 1), 100);
            } else {
                // 重試後仍無聲，通知用戶
                showNotification('⚠️ 語音合成在此裝置上無法使用，請改用 Chrome 桌面版。', 'warning');
            }
        }
    }, 800);
}

// ── 發音來源提示（輕薄 toast）────────────────────────────────────────────────
let _audioHintEl = null;
let _audioHintTimeout = null;

function showAudioSourceHint(type) {
    // 建立元素（只建一次，之後重複使用）
    if (!_audioHintEl) {
        _audioHintEl = document.createElement('div');
        _audioHintEl.id = 'audio-source-hint';
        Object.assign(_audioHintEl.style, {
            position:      'fixed',
            top:           '56px',
            left:          '50%',
            transform:     'translateX(-50%)',
            padding:       '3px 10px',
            borderRadius:  '20px',
            fontSize:      '0.72rem',
            fontWeight:    '600',
            letterSpacing: '0.04em',
            pointerEvents: 'none',
            zIndex:        '1100',
            opacity:       '0',
            transition:    'opacity 0.15s ease',
            whiteSpace:    'nowrap',
            boxShadow:     '0 1px 4px rgba(0,0,0,0.15)'
        });
        document.body.appendChild(_audioHintEl);
    }

    // 清除上一個計時器
    if (_audioHintTimeout) {
        clearTimeout(_audioHintTimeout);
        _audioHintTimeout = null;
    }

    if (type === 'mp3') {
        _audioHintEl.textContent = '🔊 MP3';
        _audioHintEl.style.backgroundColor = '#e8f5e9';
        _audioHintEl.style.color = '#2e7d32';
        _audioHintEl.style.border = '1px solid #a5d6a7';
    } else {
        _audioHintEl.textContent = '🔊 TTS';
        _audioHintEl.style.backgroundColor = '#fff3e0';
        _audioHintEl.style.color = '#e65100';
        _audioHintEl.style.border = '1px solid #ffcc80';
    }

    // 淡入
    _audioHintEl.style.opacity = '1';

    // 1.5 秒後淡出
    _audioHintTimeout = setTimeout(() => {
        _audioHintEl.style.opacity = '0';
        _audioHintTimeout = null;
    }, 1500);
}

// 播放單字發音（主要 API）— 兩層降級
// 策略：直接嘗試播 MP3，載入失敗才降級 TTS（不依賴字典預先判斷）
async function playWordAudio(word) {
    const cleanWord = word.trim().toLowerCase().replace(/^[.,?!:;'"]+|[.,?!:;'"]+$/g, '');
    if (!cleanWord) return;

    // iOS Chrome Fix: new Audio(src).play() 在跨域 MP3 上靜音。
    // 若 quiz.js 已載入，直接使用共用的 _quizPlayWord（AudioContext 路徑，已修復）。
    if (typeof _quizPlayWord === 'function') {
        _quizPlayWord(cleanWord);
        return;
    }

    // Fallback（quiz.js 未載入時）：直接嘗試 GitHub audio_files MP3
    const src = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(cleanWord)}.mp3`;
    const au = new Audio(src);

    au.addEventListener('error', () => {
        console.warn(`[playWordAudio] MP3 not found for "${cleanWord}", using TTS.`);
        showAudioSourceHint('tts');
        _speakTTS(word);
    }, { once: true });

    au.play()
        .then(() => {
            showAudioSourceHint('mp3');
        })
        .catch(() => {
            console.warn(`[playWordAudio] play() blocked for "${cleanWord}", using TTS.`);
            showAudioSourceHint('tts');
            _speakTTS(word);
        });
}

textContainer.addEventListener('click', (e) => {
    // 忽略使用者用滑鼠選取/反白文字時的點擊
    if (window.getSelection().toString().length > 0) return;

    // ── 閱讀挑戰模式：點擊句子 → 暫停自動捲動 + 播放該句 mp3 ──────────────
    // mp3 播完後維持暫停，等使用者按播放鍵才繼續往下捲動。
    if (isReadingMode) {
        const sentenceSpan = e.target.closest('.timestamp-sentence');
        if (sentenceSpan) {
            pauseReadingScroll();
            const startTime = parseFloat(sentenceSpan.dataset.start);
            const endTime = parseFloat(sentenceSpan.dataset.end);
            const idx = timestampData.findIndex(l => String(l.start) === sentenceSpan.dataset.start);
            if (idx !== -1) readingIndex = idx; // 記錄焦點，但不觸發捲動
            if (!isNaN(startTime) && !isNaN(endTime)) {
                playAudioSnippet(startTime, endTime);
            }
        }
        return;
    }

    if (isTimestampMode) {
        if (isPlaying) {
            // 播放中：點擊會跳轉音訊並將整個句子加入暫存區
            const sentenceSpan = e.target.closest('.timestamp-sentence');
            if (sentenceSpan) {
                const startTime = parseFloat(sentenceSpan.dataset.start);
                if (!isNaN(startTime)) {
                    audio.currentTime = startTime; // 跳轉音訊到句子開頭
                }
                
                // 清空暫存區並加入點擊的句子
                stagedWordsContainer.innerHTML = ''; 
                const sentenceText = sentenceSpan.textContent.trim();
                if (sentenceText) {
                    const stagedEl = document.createElement('span');
                    stagedEl.className = 'staged-word';
                    stagedEl.textContent = sentenceText;
                    stagedWordsContainer.appendChild(stagedEl);
                    updateStagingBtnState();
                }
            }
        } else {
            // 暫停時：點擊句子 -> 播放該片段；點擊 phrase -> 加入整個 phrase；點擊單字 -> 加入暫存並播單字發音

            // 先判斷是否點到句子本體（非子元素）
            const sentenceSpan = e.target.closest('.timestamp-sentence');
            if (sentenceSpan && e.target === sentenceSpan) {
                const startTime = parseFloat(sentenceSpan.dataset.start);
                const endTime = parseFloat(sentenceSpan.dataset.end);
                if (!isNaN(startTime) && !isNaN(endTime)) {
                    playAudioSnippet(startTime, endTime);
                }
                return;
            }

            // 判斷是否點到 phrase span（整個 phrase 為一個單位）
            const phraseSpan = e.target.closest('.is-saved-phrase');
            if (phraseSpan) {
                // phrase 文字：把各 clickable-word 的文字組合起來（含空格）
                const phraseText = phraseSpan.textContent.trim();
                const savedForm  = phraseSpan.dataset.phrase || phraseText;
                playWordAudio(savedForm);
                const stagedEl = document.createElement('span');
                stagedEl.className = 'staged-word';
                stagedEl.textContent = phraseText;
                stagedWordsContainer.appendChild(stagedEl);
                updateStagingBtnState();
                return;
            }

            // 一般單字
            const wordSpan = e.target.closest('.clickable-word');
            if (wordSpan) {
                const cleanedWord = cleanWord(wordSpan.textContent);
                if (cleanedWord) {
                    if (wordSpan.classList.contains('is-saved-word')) {
                        const savedForm = findSavedWordForm(cleanedWord, currentCategoryName, currentStoryTitle);
                        if (savedForm) {
                            playWordAudio(savedForm);
                        } else {
                            playWordAudio(cleanedWord);
                        }
                    } else {
                        playWordAudio(cleanedWord);
                    }
                    const stagedWordEl = document.createElement('span');
                    stagedWordEl.className = 'staged-word';
                    stagedWordEl.textContent = cleanedWord;
                    stagedWordsContainer.appendChild(stagedWordEl);
                    updateStagingBtnState();
                }
            }
        }
    } else { 
        // 原始 JSON 模式：總是暫存單字
        const wordSpan = e.target.closest('.clickable-word');
        if (wordSpan) {
            const cleanedWord = cleanWord(wordSpan.textContent);
            if (cleanedWord) {
                // MODIFIED: Play audio for ANY word when paused
                if (!isPlaying) {
                    if (wordSpan.classList.contains('is-saved-word')) {
                        // Find the actual saved word form from notes
                        const savedForm = findSavedWordForm(cleanedWord, currentCategoryName, currentStoryTitle);
                        if (savedForm) {
                            playWordAudio(savedForm);
                        } else {
                            // Fallback to clicked word if not found
                            playWordAudio(cleanedWord);
                        }
                    } else {
                        // Play audio even for non-saved words
                        playWordAudio(cleanedWord);
                    }
                }
                
                const stagedWordEl = document.createElement('span');
                stagedWordEl.className = 'staged-word';
                stagedWordEl.textContent = cleanedWord;
                stagedWordsContainer.appendChild(stagedWordEl);
                updateStagingBtnState();
                // ✅ BUG-4 修正：已移除重複的 appendChild（原第 1593 行有一行多餘的 appendChild 導致單字被加入兩次）
            }
        }
    }
});


// ── FIX-7: Staging button state helper ────────────────────────────────────────
function updateStagingBtnState() {
    const hasWords = stagedWordsContainer.querySelectorAll('.staged-word').length > 0;
    addToNoteBtn.disabled = !hasWords;
    clearStagingBtn.disabled = !hasWords;
    document.getElementById('copy-staged-btn').disabled = !hasWords;
    document.getElementById('play-staged-btn').disabled = !hasWords;
}

stagedWordsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('staged-word')) {
        e.target.remove();
        updateStagingBtnState();
    }
});

clearStagingBtn.addEventListener('click', () => {
    stagedWordsContainer.innerHTML = ''; if (typeof updateStagingBtnState === 'function') updateStagingBtnState();
    updateStagingBtnState();
});

addToNoteBtn.addEventListener('click', () => {
    const stagedWords = Array.from(stagedWordsContainer.querySelectorAll('.staged-word'));
    if (stagedWords.length === 0) return;
    const textToAdd = stagedWords.map(el => el.textContent).join(' ');
    if (textToAdd) {
        addWordToNote(textToAdd, currentCategoryName, currentStoryTitle);
        navigator.clipboard.writeText(textToAdd);
        stagedWordsContainer.innerHTML = ''; if (typeof updateStagingBtnState === 'function') updateStagingBtnState();
        updateStagingBtnState();
    }
});

// --- 新增 Back to Titles 邏輯 ---
if (backToCategoryBtn) {
    backToCategoryBtn.addEventListener('click', () => {
        // 離開文章：自動關閉編輯模式，下次進入文章是乾淨狀態
        if (typeof resetTsEditMode === 'function') resetTsEditMode();

        // Custom article mode: return to custom articles view
        if (backToCategoryBtn._customArticleMode) {
            restoreAudioControls();
            const customView = document.getElementById('custom-articles-view');
            renderCustomArticlesList();
            showView(customView);
            return;
        }

        // 1. 先暫存當前的分類名稱 (例如 "生活")，因為 stopAudioAndReset 會把它清空
        const targetCategory = currentCategoryName;
        
        // 2. 停止音訊並重置播放狀態 (清除高亮、暫存區等)
        stopAudioAndReset();
        
        // 3. 恢復並重新渲染該分類的文章列表
        if (targetCategory) {
            showCategory(targetCategory);
        } else {
            // 如果狀態遺失，則回到首頁
            renderMajorCategories();
            showView(homeView);
        }
    });
}


copyStagedBtn.addEventListener('click', () => {
    const textToCopy = Array.from(stagedWordsContainer.querySelectorAll('.staged-word')).map(el => el.textContent).join(' ');
    if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            copyStagedBtn.classList.add('btn-success-feedback');
            setTimeout(() => copyStagedBtn.classList.remove('btn-success-feedback'), 500);
        });
    }
});

// ── Staging Play Button ────────────────────────────────────────────────────────
// 策略：
//   單一單字 → 先試 GitHub audio_files MP3（2s timeout）→ 失敗降級 TTS
//   片段/多詞/整句 → 直接 TTS 朗讀
// ──────────────────────────────────────────────────────────────────────────────
const playStagedBtn = document.getElementById('play-staged-btn');

/** TTS 朗讀一段文字，播完後執行 onDone — FIX-4: 加入 iOS 靜音偵測 */
function _playStagedViaTTS(text, onDone, _retryCount = 0) {
    if (!('speechSynthesis' in window)) {
        showNotification('此瀏覽器不支援 TTS。', 'error');
        onDone();
        return;
    }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text.trim());
    utt.lang = 'en-US';
    utt.rate = 0.9;
    utt.onend = onDone;
    utt.onerror = onDone;

    let _startFired = false;
    utt.onstart = () => { _startFired = true; };

    window.speechSynthesis.speak(utt);
    showAudioSourceHint('tts');

    // FIX-4: iOS Chrome 靜音偵測（800ms 窗口）
    setTimeout(() => {
        if (!_startFired && !window.speechSynthesis.speaking) {
            console.warn(`[FIX-4] TTS (staged) silent bug detected (attempt ${_retryCount + 1})`);
            window.speechSynthesis.cancel();
            if (_retryCount < 2) {
                // iOS Fix: 修正 4 — 重試上限由 1 次改為 2 次
                setTimeout(() => _playStagedViaTTS(text, onDone, _retryCount + 1), 100);
            } else {
                showNotification('⚠️ 語音合成在此裝置上無法使用。', 'warning');
                onDone();
            }
        }
    }, 800);
}

/** 單字：先試 MP3，2 秒超時或失敗就降級 TTS */
function _playStagedSingleWord(word, onDone) {
    const clean = word.trim().toLowerCase().replace(/^[.,?!:;'"]+|[.,?!:;'"]+$/g, '');
    if (!clean) { onDone(); return; }

    // 若 quiz.js 共用函數可用，優先走 AudioContext 路徑（解決 iOS Chrome 跨域）
    if (typeof _quizPlayWord === 'function') {
        _quizPlayWord(clean);
        showAudioSourceHint('mp3');
        setTimeout(onDone, 2500); // _quizPlayWord 無 callback，用估算時長
        return;
    }

    const src = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(clean)}.mp3`;
    const au = new Audio(src);
    let settled = false;

    const fallback = () => {
        if (settled) return;
        settled = true;
        au.pause();
        _playStagedViaTTS(word, onDone);
    };

    const fallbackTimer = setTimeout(fallback, 2000); // 2 秒超時切 TTS

    au.addEventListener('error', () => {
        clearTimeout(fallbackTimer);
        fallback();
    }, { once: true });

    au.addEventListener('ended', () => {
        if (settled) return;
        settled = true;
        clearTimeout(fallbackTimer);
        onDone();
    }, { once: true });

    au.play()
        .then(() => { showAudioSourceHint('mp3'); })
        .catch(() => {
            clearTimeout(fallbackTimer);
            fallback();
        });
}

if (playStagedBtn) playStagedBtn.addEventListener('click', () => {
    const stagedWords = Array.from(stagedWordsContainer.querySelectorAll('.staged-word'));
    if (stagedWords.length === 0) return;

    const fullText = stagedWords.map(el => el.textContent).join(' ').trim();
    if (!fullText) return;

    // ★ iOS pre-unlock：在 user gesture 的同步 call stack 內立即送出靜音佔位，
    //   取得 iOS WebKit 的 TTS 授權。後續無論走 MP3 或 TTS 路徑，授權均已就緒。
    _iosPreUnlockTTS(fullText);

    playStagedBtn.disabled = true;
    playStagedBtn.classList.add('is-playing-staged');

    const onDone = () => {
        playStagedBtn.disabled = false;
        playStagedBtn.classList.remove('is-playing-staged');
    };

    // 判斷是否為單一單字（只有一個 staged 元素且內容無空格）
    const isSingleWord = stagedWords.length === 1 && !/\s/.test(stagedWords[0].textContent.trim());

    if (isSingleWord) {
        // 單字：_playStagedSingleWord 內部會：
        //   MP3 成功 → cancel 掉靜音佔位
        //   MP3 失敗 → cancel 後以原音量重新 speak（iOS 授權已解鎖，不會靜音）
        _playStagedSingleWord(fullText, onDone);
    } else {
        // 片段、多詞、整句 → cancel 靜音佔位，直接以原音量 TTS
        window.speechSynthesis.cancel();
        _playStagedViaTTS(fullText, onDone);
    }
});
// ── End Staging Play Button ───────────────────────────────────────────────────

// ── BUG-3 修正：playAudioSnippet ────────────────────────────────────────────
// 問題：iOS Safari 要求 audio.play() 在使用者手勢的同步 call stack 中呼叫。
//       當 audio.readyState < 2（HAVE_CURRENT_DATA），設定 currentTime 後
//       瀏覽器需重新 buffer，此過程為非同步，後續 play() 脫離 call stack，
//       iOS 會因 AutoPlay Policy 封鎖播放，導致點擊句子片段無聲。
//
// 修正：先嘗試呼叫 play()（讓 iOS 在手勢 call stack 中授權），
//       若 audio 尚未就緒，監聽 canplay 事件後再執行實際播放邏輯。
// ─────────────────────────────────────────────────────────────────────────────
let snippetStopTimeout = null; // ✅ 宣告保留（供 audio.play 'ended' 事件使用）

function playAudioSnippet(startTime, endTime) {
    if (snippetStopTimeout) {
        clearTimeout(snippetStopTimeout);
        snippetStopTimeout = null;
    }

    // 若主音訊尚未載入（沒有 src 或 duration 尚未確定），給使用者明確提示
    if (!audio.src || audio.src === window.location.href) {
        showNotification('⚠️ 音訊尚未載入，無法播放片段。', 'warn');
        return;
    }

    if (!isFinite(audio.duration) || isPlaying) return;

    const duration = endTime - startTime;
    if (duration <= 0) return;

    // 內部執行播放的函數
    const _doSnippetPlay = () => {
        audio.currentTime = startTime;
        audio.play().then(() => {
            snippetStopTimeout = setTimeout(() => {
                audio.pause();
                audio.currentTime = startTime; // 播完後重設回片段起點
                snippetStopTimeout = null;
            }, duration * 1000 + 150); // +150ms 緩衝，避免尾音被截斷
        }).catch(e => {
            console.warn('[Snippet] playAudioSnippet play() failed:', e);
        });
    };

    // ✅ 若 audio 已就緒（readyState >= 2），直接播
    // ✅ 若尚未就緒，等 canplay 事件（一次性）再播
    if (audio.readyState >= 2) {
        _doSnippetPlay();
    } else {
        audio.addEventListener('canplay', _doSnippetPlay, { once: true });
    }
}


// ════════════════════════════════════════════════════════════════════════
// 閱讀挑戰模式 (Reading Challenge Mode)
// 連續滾動提詞器風格：目前句放大/加亮，捲動速度（慢/中/快）純粹依字數計算，
// 與 mp3 完全脫鉤；點擊句子才會臨時播放該句音訊。
// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
//  連續平滑捲動（Teleprompter）+ 中央句子 Highlight
// ════════════════════════════════════════════════════════════════════════

// 根據目前 scrollTop 找出「最靠近畫面中央 40% 位置」的句子 index
function getReadingCenterIndex() {
    // highlight 鎖點放在可見區 55% 處（偏中下）
    // 原本 38% 太靠上，句子快速被推離視野；55% 讓目前句在畫面停留更久
    const midY = textContainer.scrollTop + textContainer.clientHeight * 0.55;
    let bestIdx = -1, bestDist = Infinity;
    timestampData.forEach((line, i) => {
        const el = sentenceElementMap.get(String(line.start));
        if (!el) return;
        const dist = Math.abs(el.offsetTop - midY);
        if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    });
    return bestIdx;
}

// 套用 highlight：只標記 centerIdx 那一句，其餘清除
function applyReadingHighlightByIndex(centerIdx) {
    if (centerIdx === readingIndex) return; // 沒變就不動 DOM
    readingIndex = centerIdx;
    timestampData.forEach((line, i) => {
        const el = sentenceElementMap.get(String(line.start));
        if (!el) return;
        el.classList.toggle('is-reading-current', i === centerIdx);
        // 中文翻譯行同步
        const zhEl = el.nextElementSibling;
        if (zhEl && zhEl.classList.contains('timestamp-translation')) {
            zhEl.classList.toggle('is-reading-current', i === centerIdx);
        }
    });
}

// 連續捲動主迴圈：每幀推進 scrollTop + 更新 highlight
// 用浮點數累加器解決低速時瀏覽器整數捨入導致「卡死不動」問題
let _readingScrollAccum = 0; // 累加尚未整數化的小數部分

function readingModeLoop(ts) {
    if (!isReadingMode || !readingIsPlaying) { readingRafId = null; return; }

    if (!readingLastFrameTs) readingLastFrameTs = ts;
    const delta = (ts - readingLastFrameTs) / 1000; // 秒
    readingLastFrameTs = ts;

    // 累加浮點位移，只有整數部分才真正寫入 scrollTop
    _readingScrollAccum += readingSpeedPx * delta;
    const intStep = Math.floor(_readingScrollAccum);
    _readingScrollAccum -= intStep;

    const newScrollTop = textContainer.scrollTop + intStep;

    if (newScrollTop >= scrollMax) {
        textContainer.scrollTop = scrollMax;
        _readingScrollAccum = 0;
        readingIsPlaying = false;
        updateReadingPlayBtnUI();
        readingRafId = null;
        applyReadingHighlightByIndex(getReadingCenterIndex());
        return;
    }

    if (intStep > 0) textContainer.scrollTop = newScrollTop;

    // 每幀更新 highlight（低成本：只比對 index，不動 DOM）
    applyReadingHighlightByIndex(getReadingCenterIndex());

    // 同步進度條 UI
    updateReadingProgressUI();

    readingRafId = requestAnimationFrame(readingModeLoop);
}

// 取得目前可見區中間位置最近的句子 index（供點擊後記錄 & 退出模式對齊）
function getReadingVisibleIndex() {
    return getReadingCenterIndex();
}

// 跳轉到指定句子並讓它出現在畫面中段（點擊跳轉用，不啟動捲動）
function scrollToSentenceInstant(idx) {
    if (idx < 0 || idx >= timestampData.length) return;
    const el = sentenceElementMap.get(String(timestampData[idx].start));
    if (!el) return;
    const targetPos = el.offsetTop - textContainer.clientHeight * 0.32;
    textContainer.scrollTop = Math.max(0, Math.min(targetPos, scrollMax));
}

function startReadingScroll() {
    readingIsPlaying = true;
    readingLastFrameTs = 0;
    _readingScrollAccum = 0; // 每次重新播放都從 0 開始累加
    updateReadingPlayBtnUI();
    if (!readingRafId) readingRafId = requestAnimationFrame(readingModeLoop);
}

function getReadingSentenceDurationMs(sentenceText) {
    const wordCount = String(sentenceText || '').trim().split(/\s+/).filter(Boolean).length || 1;
    const wps = READING_SPEED_WPS['medium'];
    return Math.max(READING_MIN_DURATION_MS, (wordCount / wps) * 1000);
}

// setReadingIndex：點擊句子後記錄位置
function setReadingIndex(idx, { scroll = true } = {}) {
    if (idx < 0 || idx >= timestampData.length) return;
    readingIndex = idx;
    if (scroll) scrollToSentenceInstant(idx);
    applyReadingHighlightByIndex(idx);
}

// applyReadingHighlight：舊介面保留，轉接到新函式
function applyReadingHighlight(idx) { applyReadingHighlightByIndex(idx); }

// 初始化速度滑桿 UI（enterReadingMode 時呼叫）
// ── 速度統一設定器：鍵盤 / 觸控 / 滑桿 都走這裡 ──────────────────────────
function setReadingSpeedPx(v) {
    readingSpeedPx = Math.max(5, Math.min(80, Math.round(v)));
    safeSetItem('readingModeSpeedPx', String(readingSpeedPx)); // 統一走 safeSetItem（含容量警告）
    // 同步更新滑桿 UI（若存在）
    const slider  = document.getElementById('reading-speed-slider');
    const valueEl = document.getElementById('reading-speed-value');
    if (slider)  slider.value        = readingSpeedPx;
    if (valueEl) valueEl.textContent = readingSpeedPx;
}

// ── 速度鎖定狀態（按鈕長按模式：觸控 scrubbing 判斷用）──
let _readingSpeedLocked = false;

function initReadingSpeedSlider() {
    const slider  = document.getElementById('reading-speed-slider');
    const valueEl = document.getElementById('reading-speed-value');
    if (!slider) return;

    // 清除舊監聽器
    const newSlider = slider.cloneNode(true);
    slider.parentNode.replaceChild(newSlider, slider);
    const s = document.getElementById('reading-speed-slider');

    s.value = readingSpeedPx;
    if (valueEl) valueEl.textContent = readingSpeedPx;

    // 重設鎖定狀態
    _readingSpeedLocked = false;

    // 同步 oninput（給隱藏 range 用）
    s.oninput = () => {
        setReadingSpeedPx(parseInt(s.value, 10));
        const v = document.getElementById('reading-speed-value');
        if (v) v.textContent = readingSpeedPx;
    };
}

// ── 速度按鈕：長按後左右滑動調整速度 ─────────────────────────────
(function () {
    let _held = false;
    let _startX = 0, _startY = 0, _baseVal = 20;
    let _decided = false, _isHoriz = false;
    let _holdTimer = null;

    // Toast
    let _toastEl = null, _toastTimer = null;
    function showAdjToast(label, v) {
        if (!_toastEl) {
            _toastEl = document.createElement('div');
            Object.assign(_toastEl.style, {
                position: 'fixed', bottom: '90px', left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(122,107,90,0.92)',
                color: '#fff', padding: '6px 20px',
                borderRadius: '99px', fontSize: '14px', fontWeight: '700',
                pointerEvents: 'none', zIndex: '2000',
                opacity: '0', transition: 'opacity 0.15s ease',
                whiteSpace: 'nowrap', letterSpacing: '0.04em'
            });
            document.body.appendChild(_toastEl);
        }
        _toastEl.textContent = label + ' ' + v;
        _toastEl.style.opacity = '1';
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => { if (_toastEl) _toastEl.style.opacity = '0'; }, 800);
    }

    function activate(btn) {
        _held = true;
        btn.classList.add('is-held');
    }
    function deactivate(btn) {
        _held = false;
        _decided = false; _isHoriz = false;
        btn.classList.remove('is-held');
    }

    document.addEventListener('DOMContentLoaded', () => {
        const speedBtn = document.getElementById('reading-speed-btn');
        const fontBtn  = document.getElementById('reading-font-btn');
        if (!speedBtn || !fontBtn) return;

        // ── 速度按鈕 ──
        function speedTouchStart(e) {
            if (!isReadingMode) return;
            e.preventDefault();
            _startX = e.touches[0].clientX;
            _startY = e.touches[0].clientY;
            _baseVal = readingSpeedPx;
            _decided = false; _isHoriz = false;
            activate(speedBtn);
        }
        function speedTouchMove(e) {
            if (!_held) return;
            const dx = e.touches[0].clientX - _startX;
            const dy = e.touches[0].clientY - _startY;
            if (!_decided) {
                if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
                _decided = true;
                _isHoriz = Math.abs(dx) > Math.abs(dy) * 1.1;
            }
            if (!_isHoriz) return;
            e.preventDefault();
            const steps = Math.trunc(dx / 7);
            const newVal = Math.max(5, Math.min(80, _baseVal + steps));
            if (newVal !== readingSpeedPx) {
                setReadingSpeedPx(newVal);
                showAdjToast('速度', newVal);
            }
        }
        function speedTouchEnd() { deactivate(speedBtn); }

        speedBtn.addEventListener('touchstart', speedTouchStart, { passive: false });
        speedBtn.addEventListener('touchmove',  speedTouchMove,  { passive: false });
        speedBtn.addEventListener('touchend',   speedTouchEnd,   { passive: true });
        // 桌機：滑鼠拖曳
        speedBtn.addEventListener('mousedown', (e) => {
            if (!isReadingMode) return;
            _startX = e.clientX; _baseVal = readingSpeedPx;
            activate(speedBtn);
            function onMove(ev) {
                const dx = ev.clientX - _startX;
                const steps = Math.trunc(dx / 7);
                const newVal = Math.max(5, Math.min(80, _baseVal + steps));
                if (newVal !== readingSpeedPx) {
                    setReadingSpeedPx(newVal);
                    showAdjToast('速度', newVal);
                }
            }
            function onUp() {
                deactivate(speedBtn);
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // ── 字級按鈕 ──
        let _fHeld = false;
        let _fStartX = 0, _fBaseVal = 20;
        let _fDecided = false, _fIsHoriz = false;

        function fontActivate() { _fHeld = true; fontBtn.classList.add('is-held'); }
        function fontDeactivate() {
            _fHeld = false; _fDecided = false; _fIsHoriz = false;
            fontBtn.classList.remove('is-held');
        }

        fontBtn.addEventListener('touchstart', (e) => {
            if (!isReadingMode) return;
            e.preventDefault();
            _fStartX = e.touches[0].clientX;
            _fBaseVal = readingFontSize;
            _fDecided = false; _fIsHoriz = false;
            fontActivate();
        }, { passive: false });

        fontBtn.addEventListener('touchmove', (e) => {
            if (!_fHeld) return;
            const dx = e.touches[0].clientX - _fStartX;
            const dy = e.touches[0].clientY - _fStartY;
            if (!_fDecided) {
                if (Math.abs(dx) < 5) return;
                _fDecided = true; _fIsHoriz = true;
            }
            if (!_fIsHoriz) return;
            e.preventDefault();
            const steps = Math.trunc(dx / 12);
            const newVal = Math.max(14, Math.min(28, _fBaseVal + steps));
            if (newVal !== readingFontSize) {
                applyReadingFontSize(newVal);
                showAdjToast('字級', newVal + 'px');
            }
        }, { passive: false });

        fontBtn.addEventListener('touchend', fontDeactivate, { passive: true });

        fontBtn.addEventListener('mousedown', (e) => {
            if (!isReadingMode) return;
            _fStartX = e.clientX; _fBaseVal = readingFontSize;
            fontActivate();
            function onMove(ev) {
                const dx = ev.clientX - _fStartX;
                const steps = Math.trunc(dx / 12);
                const newVal = Math.max(14, Math.min(28, _fBaseVal + steps));
                if (newVal !== readingFontSize) {
                    applyReadingFontSize(newVal);
                    showAdjToast('字級', newVal + 'px');
                }
            }
            function onUp() {
                fontDeactivate();
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            }
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    });
})();

// 速度條鎖定模式下的觸控橫向 scrubbing
(function () {
    let _sStartX = 0, _sStartY = 0, _sBaseSpeed = 20;
    let _sDecided = false, _sIsHoriz = false;

    // 速度 Toast
    let _toastEl = null, _toastTimer = null;
    function showSpeedToast(v) {
        if (!_toastEl) {
            _toastEl = document.createElement('div');
            Object.assign(_toastEl.style, {
                position: 'fixed', bottom: '90px', left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(122,107,90,0.9)',
                color: '#fff', padding: '5px 18px',
                borderRadius: '99px', fontSize: '13px', fontWeight: '700',
                pointerEvents: 'none', zIndex: '2000',
                opacity: '0', transition: 'opacity 0.15s ease',
                whiteSpace: 'nowrap', letterSpacing: '0.04em'
            });
            document.body.appendChild(_toastEl);
        }
        _toastEl.textContent = '速度 ' + v;
        _toastEl.style.opacity = '1';
        clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => { _toastEl.style.opacity = '0'; }, 1000);
    }

    document.addEventListener('touchstart', (e) => {
        if (!isReadingMode || !_readingSpeedLocked || e.touches.length !== 1) return;
        _sStartX    = e.touches[0].clientX;
        _sStartY    = e.touches[0].clientY;
        _sBaseSpeed = readingSpeedPx;
        _sDecided   = false;
        _sIsHoriz   = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isReadingMode || !_readingSpeedLocked || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - _sStartX;
        const dy = e.touches[0].clientY - _sStartY;
        if (!_sDecided) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            _sDecided = true;
            _sIsHoriz = Math.abs(dx) > Math.abs(dy) * 1.2;
        }
        if (!_sIsHoriz) return;
        e.preventDefault();
        const steps  = Math.trunc(dx / 8);
        const newVal = Math.max(5, Math.min(80, _sBaseSpeed + steps));
        if (newVal !== readingSpeedPx) {
            setReadingSpeedPx(newVal);
            showSpeedToast(newVal);
        }
    }, { passive: false });

    document.addEventListener('touchend', () => {
        _sDecided = false; _sIsHoriz = false;
    }, { passive: true });
})();

// ── 閱讀進度條：點擊鎖定模式 ─────────────────────────────
// 點擊進度條 → 進入「進度調整模式」（鎖定），此時：
//   - 左右滑動畫面 或 鍵盤 ←→ 皆可調整進度
//   - 再次點擊進度條 → 解鎖，離開調整模式
let _readingProgressDragging = false; // 進度調整模式中，暫停 rAF 寫入
let _readingProgressLocked   = false; // 是否處於「進度調整模式（鎖定）」
let _readingProgressWasPlaying = false; // 鎖定前是否在播放中

// 進度條點擊觸發：鎖定 / 解鎖切換
function _toggleReadingProgressLock(e) {
    e.stopPropagation();
    if (!isReadingMode) return;

    if (!_readingProgressLocked) {
        // ── 進入鎖定 ──
        _readingProgressLocked = true;
        _readingProgressDragging = true;
        _readingProgressWasPlaying = readingIsPlaying;
        if (readingIsPlaying) pauseReadingScroll();

        const slider = document.getElementById('reading-progress-slider');
        if (slider) {
            slider.classList.add('is-active');
            slider.title = '進度調整中（再按一下解鎖）';
        }
        showNotification('進度調整模式：左右滑動或 ← → 鍵調整進度，再按一下解鎖', 'info', 2000);
    } else {
        // ── 解鎖 ──
        _readingProgressLocked = false;
        _readingProgressDragging = false;
        readingLastFrameTs = 0;

        const slider = document.getElementById('reading-progress-slider');
        if (slider) {
            slider.classList.remove('is-active');
            slider.title = '點擊後可拖曳調整進度';
        }
        // 若之前在播放，解鎖後恢復播放
        if (_readingProgressWasPlaying) startReadingScroll();
        showNotification('進度解鎖', 'info', 800);
    }
}

function initReadingProgressSlider() {
    const slider  = document.getElementById('reading-progress-slider');
    const timeEl  = document.getElementById('reading-progress-time');
    if (!slider) return;

    // 清除舊監聽器（重新進入模式時）
    const newSlider = slider.cloneNode(true);
    slider.parentNode.replaceChild(newSlider, slider);
    const s = document.getElementById('reading-progress-slider');

    s.value = 0;
    if (timeEl) timeEl.textContent = '0%';

    // 重設鎖定狀態
    _readingProgressLocked = false;
    _readingProgressDragging = false;
    s.classList.remove('is-active');

    // 點擊 → 鎖定/解鎖
    s.addEventListener('click',      _toggleReadingProgressLock);
    s.addEventListener('touchend',   (e) => { e.preventDefault(); _toggleReadingProgressLock(e); }, { passive: false });

    // 拖拉中即時跳轉（鎖定狀態下 oninput 仍可用）
    s.oninput = () => {
        if (!scrollMax) return;
        const pct = parseInt(s.value, 10) / 1000;
        textContainer.scrollTop = Math.round(pct * scrollMax);
        const t = document.getElementById('reading-progress-time');
        if (t) t.textContent = Math.round(pct * 100) + '%';
    };
}

// 進度條鎖定模式下的鍵盤 ← → 調整進度（步進 2%）
function _readingProgressKeyStep(dir) {
    if (!_readingProgressLocked) return false;
    const slider = document.getElementById('reading-progress-slider');
    if (!slider || !scrollMax) return true;
    const step = Math.round(1000 * 0.02); // 每次 2%
    const newVal = Math.max(0, Math.min(1000, parseInt(slider.value, 10) + dir * step));
    slider.value = newVal;
    slider.dispatchEvent(new Event('input'));
    return true;
}

// 進度條鎖定模式下的觸控橫向 scrubbing
(function () {
    let _pStartX = 0, _pStartY = 0, _pStartVal = 0;
    let _pDecided = false, _pIsHoriz = false;

    document.addEventListener('touchstart', (e) => {
        if (!isReadingMode || !_readingProgressLocked || e.touches.length !== 1) return;
        _pStartX   = e.touches[0].clientX;
        _pStartY   = e.touches[0].clientY;
        const slider = document.getElementById('reading-progress-slider');
        _pStartVal = slider ? parseInt(slider.value, 10) : 0;
        _pDecided  = false;
        _pIsHoriz  = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!isReadingMode || !_readingProgressLocked || e.touches.length !== 1) return;
        const dx = e.touches[0].clientX - _pStartX;
        const dy = e.touches[0].clientY - _pStartY;
        if (!_pDecided) {
            if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
            _pDecided = true;
            _pIsHoriz = Math.abs(dx) > Math.abs(dy) * 1.2;
        }
        if (!_pIsHoriz) return;
        e.preventDefault();
        // 全螢幕寬度 = 1000 單位
        const screenW = window.innerWidth || 375;
        const delta = Math.round((dx / screenW) * 1000);
        const slider = document.getElementById('reading-progress-slider');
        if (!slider) return;
        const newVal = Math.max(0, Math.min(1000, _pStartVal + delta));
        slider.value = newVal;
        slider.dispatchEvent(new Event('input'));
    }, { passive: false });

    document.addEventListener('touchend', () => {
        _pDecided = false; _pIsHoriz = false;
    }, { passive: true });
})();

function updateReadingProgressUI() {
    if (_readingProgressDragging || !scrollMax) return;
    const slider  = document.getElementById('reading-progress-slider');
    const timeEl  = document.getElementById('reading-progress-time');
    if (!slider) return;
    const pct = textContainer.scrollTop / scrollMax;
    slider.value = Math.round(pct * 1000);
    if (timeEl) timeEl.textContent = Math.round(pct * 100) + '%';
}

function pauseReadingScroll() {
    readingIsPlaying = false;
    readingLastFrameTs = 0;
    updateReadingPlayBtnUI();
    if (readingRafId) { cancelAnimationFrame(readingRafId); readingRafId = null; }
}

function updateReadingPlayBtnUI() {
    const btn = document.getElementById('reading-play-pause');
    if (btn) btn.classList.toggle('is-playing', readingIsPlaying);
}

function updateReadingSpeedBtnUI() {
    // 舊三檔按鈕已移除，改用滑桿（initReadingSpeedSlider）；此函式保留供現有呼叫點不報錯
}

function enterReadingMode() {
    if (!hasTimestampFile || !timestampData.length) {
        showNotification('這篇文章沒有逐句時間戳資料，無法使用閱讀挑戰模式。', 'error');
        return;
    }

    // 閱讀模式有自己的節奏，不跟 mp3 同步播放；先確保主音訊是暫停的
    if (isPlaying) pauseAudio(true);
    if (snippetStopTimeout) { clearTimeout(snippetStopTimeout); snippetStopTimeout = null; }
    audio.pause();

    // 關閉句子編輯模式，避免跟閱讀模式互相干擾
    if (typeof resetTsEditMode === 'function') resetTsEditMode();

    // 儲存進入前的捲動位置，供退出時還原
    readingScrollTopBeforeEnter = textContainer.scrollTop;

    isReadingMode = true;
    document.getElementById('playback-view')?.classList.add('is-reading-mode');
    textContainer.classList.add('reading-active');
    document.getElementById('reading-mode-controls')?.classList.remove('is-hidden');
    document.getElementById('reading-mode-btn')?.classList.add('is-reading-mode-active');

    updateReadingSpeedBtnUI();
    initReadingSpeedSlider();
    initReadingFontSlider();
    initReadingProgressSlider();

    // 連續捲動：從頂部開始（提詞器體驗，完整從頭閱讀）
    textContainer.scrollTop = 0;
    readingIndex = -1;

    // 不自動播放，讓使用者自行點擊播放鍵開始
}

function exitReadingMode() {
    pauseReadingScroll();
    isReadingMode = false;
    _readingProgressDragging = false;
    _readingProgressLocked = false;
    _readingSpeedLocked = false;
    // 清除進度條/速度條的鎖定視覺狀態
    document.getElementById('reading-progress-slider')?.classList.remove('is-active');
    document.getElementById('reading-speed-slider')?.classList.remove('is-locked');

    // 離開閱讀模式時，若還在錄音中先停止，並清除暫存的試聽錄音（避免下次進入殘留舊錄音）
    if (isReadingRecording) stopReadingRecording();
    discardReadingRecording();

    document.getElementById('playback-view')?.classList.remove('is-reading-mode');
    textContainer.classList.remove('reading-active');
    document.getElementById('reading-mode-controls')?.classList.add('is-hidden');
    document.getElementById('reading-mode-btn')?.classList.remove('is-reading-mode-active');

    // 清除閱讀模式留下的樣式 class（連續捲動模式理論上不加，但防禦性清除）
    timestampData.forEach(line => {
        const el = sentenceElementMap.get(String(line.start));
        if (el) {
            el.classList.remove('is-reading-current', 'is-reading-passed');
            const zhEl = el.nextElementSibling;
            if (zhEl && zhEl.classList.contains('timestamp-translation')) {
                zhEl.classList.remove('is-reading-current', 'is-reading-passed');
            }
        }
    });
    readingIndex = -1;

    // 還原進入前的捲動位置，讓使用者回到原本閱讀的地方繼續
    textContainer.scrollTop = readingScrollTopBeforeEnter;
    readingScrollTopBeforeEnter = 0;
}

// ── 閱讀挑戰模式：跟讀錄音（麥克風）─────────────────────────────
function updateReadingRecordBtnUI() {
    document.getElementById('reading-record-btn')?.classList.toggle('is-recording', isReadingRecording);
}

async function startReadingRecording() {
    if (isReadingRecording) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        showNotification('此瀏覽器不支援錄音功能。', 'error');
        return;
    }
    // 開始新錄音前，先清掉舊的試聽結果
    discardReadingRecording();
    try {
        readingMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        showNotification('無法取得麥克風權限，請到瀏覽器設定中允許麥克風存取。', 'error');
        return;
    }
    const mimeCandidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
    readingRecordingMimeType = mimeCandidates.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    readingRecordedChunks = [];
    try {
        readingMediaRecorder = readingRecordingMimeType
            ? new MediaRecorder(readingMediaStream, { mimeType: readingRecordingMimeType })
            : new MediaRecorder(readingMediaStream);
    } catch (err) {
        readingMediaRecorder = new MediaRecorder(readingMediaStream);
        readingRecordingMimeType = readingMediaRecorder.mimeType || '';
    }
    readingMediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) readingRecordedChunks.push(e.data);
    };
    readingMediaRecorder.onstop = finalizeReadingRecording;
    readingMediaRecorder.start();
    isReadingRecording = true;
    updateReadingRecordBtnUI();
}

function stopReadingRecording() {
    if (!isReadingRecording || !readingMediaRecorder) return;
    readingMediaRecorder.stop(); // onstop 會呼叫 finalizeReadingRecording
    isReadingRecording = false;
    updateReadingRecordBtnUI();
    if (readingMediaStream) {
        readingMediaStream.getTracks().forEach(track => track.stop());
        readingMediaStream = null;
    }
}

function finalizeReadingRecording() {
    if (!readingRecordedChunks.length) return;
    const blobType = readingRecordingMimeType || 'audio/webm';
    const blob = new Blob(readingRecordedChunks, { type: blobType });
    if (readingRecordingBlobUrl) URL.revokeObjectURL(readingRecordingBlobUrl);
    readingRecordingBlobUrl = URL.createObjectURL(blob);

    const audioEl = document.getElementById('reading-record-audio');
    if (audioEl) audioEl.src = readingRecordingBlobUrl;
    document.getElementById('reading-record-playback')?.classList.remove('is-hidden');
}

function discardReadingRecording() {
    if (readingRecordingBlobUrl) {
        URL.revokeObjectURL(readingRecordingBlobUrl);
        readingRecordingBlobUrl = null;
    }
    readingRecordedChunks = [];
    const audioEl = document.getElementById('reading-record-audio');
    if (audioEl) { audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); }
    document.getElementById('reading-record-playback')?.classList.add('is-hidden');
}

function downloadReadingRecording() {
    if (!readingRecordingBlobUrl) return;
    const ext = readingRecordingMimeType.includes('mp4') ? 'm4a'
              : readingRecordingMimeType.includes('webm') ? 'webm'
              : 'audio';
    const safeTitle = String(currentStoryTitle || '跟讀錄音').replace(/[\\/:*?"<>|]/g, '').trim() || '跟讀錄音';
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const a = document.createElement('a');
    a.href = readingRecordingBlobUrl;
    a.download = `${safeTitle}_${stamp}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
}


function parafyAndMakeClickable(text, categoryName = null, titleName = null) {
    const cleaned = String(text).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
    const paragraphs = cleaned.split(/\n+/);
    const frag = document.createDocumentFragment();
    
    // --- 新增：先取得所有已存單字 ---
    const savedSet = getSavedWordsForCurrentStory(categoryName, titleName);
    // -----------------------------

    paragraphs.forEach(pText => {
        const p = document.createElement('p');
        if (pText.trim() === '') {
            p.innerHTML = '&nbsp;';
        } else {
            pText.split(/(\s+|—|–)/).forEach(part => {
                if (!part) return;
                const span = document.createElement('span');
                if (/^(\s+|—|–)$/.test(part)) {
                    span.textContent = part;
                } else {
                    span.className = 'clickable-word';
                    span.textContent = part;
                    
                    // --- 新增：檢查是否為已存單字 ---
                    if (isWordSaved(part, savedSet)) {
                        span.classList.add('is-saved-word');
                    }
                    // -----------------------------
                }
                p.appendChild(span);
            });
        }
        frag.appendChild(p);
    });
    return frag;
}

// --- New Timestamp Rendering Function ---

function renderTimestampContent() {
    textContainer.innerHTML = '';
    textContainer.scrollTop = 0;
    const frag = document.createDocumentFragment();

    // 閱讀模式開頭緩衝：插入一個高度約 40% 視口的空白，
    // 讓第一句從畫面下方捲入，而不是一開始就卡在頂部
    const topSpacer = document.createElement('div');
    topSpacer.className = 'reading-top-spacer';
    frag.appendChild(topSpacer);

    const { wordSet, phraseList } = getSavedSetsForTimestamp(currentCategoryName, currentStoryTitle);

    timestampData.forEach(line => {
        const p = document.createElement('p');
        p.className = 'timestamp-sentence';
        p.dataset.start = line.start;
        p.dataset.end = line.end;

        // Split into tokens (words) and whitespace/dash separators
        const parts = line.sentence.split(/(\s+|—|–)/);
        // Extract only non-whitespace tokens for annotation
        const tokens = parts.filter(pt => pt && !/^(\s+|—|–)$/.test(pt));
        const ann = annotateTokens(tokens, wordSet, phraseList);

        let tokenIdx = 0;
        // We need to walk parts and assign annotations to word tokens
        // Build a parallel index: for each part, if it's a word token, get its annotation
        const wordPartIndices = [];
        parts.forEach((pt, i) => {
            if (pt && !/^(\s+|—|–)$/.test(pt)) wordPartIndices.push(i);
        });

        // Track open phrase span
        let phraseSpan = null;
        let lastPhraseText = null;

        parts.forEach((part, partIdx) => {
            if (!part) return;

            if (/^(\s+|—|–)$/.test(part)) {
                // Whitespace/dash — if inside a phrase span, append to it; else append to p
                if (phraseSpan) {
                    phraseSpan.appendChild(document.createTextNode(part));
                } else {
                    p.appendChild(document.createTextNode(part));
                }
                return;
            }

            // It's a word token
            const a = ann[tokenIdx++];

            if (a.type === 'phrase') {
                if (a.role === 'start' || a.role === 'solo') {
                    // Open a new phrase wrapper
                    phraseSpan = document.createElement('span');
                    phraseSpan.className = 'is-saved-phrase';
                    phraseSpan.dataset.phrase = a.phraseOriginal;
                    lastPhraseText = a.phraseText;
                    p.appendChild(phraseSpan);
                }
                const span = document.createElement('span');
                span.className = 'clickable-word';
                span.textContent = part;
                if (phraseSpan) phraseSpan.appendChild(span);
                else p.appendChild(span);

                if (a.role === 'end' || a.role === 'solo') {
                    phraseSpan = null;
                    lastPhraseText = null;
                }
            } else {
                // Close any open phrase (safety)
                if (phraseSpan) { phraseSpan = null; lastPhraseText = null; }

                const span = document.createElement('span');
                span.className = 'clickable-word';
                span.textContent = part;
                if (a.type === 'word') span.classList.add('is-saved-word');
                p.appendChild(span);
            }
        });

        frag.appendChild(p);

        // 如果有中文翻譯，加一個翻譯行
        if (line.translation) {
            const pZh = document.createElement('p');
            pZh.className = 'timestamp-translation';
            pZh.dataset.start = line.start;
            pZh.textContent = line.translation;
            frag.appendChild(pZh);
        }
    });
    textContainer.appendChild(frag);
    lastHighlightedSentence = null;

    // 底部緩衝：讓最後幾句也能被 highlight（否則捲到底時 55% 鎖點找不到它們）
    const bottomSpacer = document.createElement('div');
    bottomSpacer.className = 'reading-bottom-spacer';
    textContainer.appendChild(bottomSpacer);

    // FIX: 預先建立 start → DOM element 的 Map，避免 timestampUpdateLoop 每次句子切換都做 O(n) querySelector 掃描
    sentenceElementMap = new Map();
    textContainer.querySelectorAll('.timestamp-sentence').forEach(el => {
        sentenceElementMap.set(el.dataset.start, el);
    });

    computeScrollMax();
    // 插入 ✏️ 編輯按鈕（由 timestamp-editor.js 提供）
    if (typeof attachTsEditButtons === 'function' && currentStoryTitle) {
        attachTsEditButtons(currentStoryTitle);
    }
}


function buildAudioCandidates(title) {
  return ['audio/' + encodeURIComponent(title.trim()) + '.mp3'];
}

function setAudioSourceWithFallback(title) {
  audioTriedCandidates = buildAudioCandidates(title);
  tryNextAudioCandidate();
}

function tryNextAudioCandidate() {
  if (!audioTriedCandidates.length) {
    // FIX-2: 所有候補都失敗，顯示明確錯誤提示
    showNotification('❌ 找不到音訊檔案，請確認 audio/ 資料夾或網路連線。', 'error');
    playPauseBtn.classList.remove('is-playing');
    playPauseBtn.classList.remove('is-loading');
    isPlaying = false;
    return;
  }
  // FIX-2: 顯示載入中提示 + 按鈕 loading 狀態
  showNotification('🔊 載入音訊中…', 'info');
  playPauseBtn.classList.add('is-loading');
  playPauseBtn.disabled = true;
  audio.src = audioTriedCandidates.shift();
  audio.load();
}

// Scrolling functions
function computeScrollMax() {
  scrollMax = Math.max(0, textContainer.scrollHeight - textContainer.clientHeight);
}

// --- NEW: Functions to stop animation loops ---
function stopJsonModeHighlightLoop() {
    if (jsonModeUpdateRafId) {
        cancelAnimationFrame(jsonModeUpdateRafId);
        jsonModeUpdateRafId = null;
    }
}

function stopTimestampUpdateLoop() {
    if (timestampUpdateRafId) {
        cancelAnimationFrame(timestampUpdateRafId);
        timestampUpdateRafId = null;
    }
}


// --- NEW: Predictive Smooth Scrolling and Highlight Logic for Timestamp Mode ---

// Cache target scroll position, only recompute when sentence changes
let cachedScrollTarget = -1;
let lastHighlightedSentenceIndex = -1;

// --- 暫停時自由滾動模式 ---
// 暫停時設為 true，允許使用者自由滾動；播放時重設為 false，恢復聚焦模式
let userIsScrollingManually = false;
let _manualScrollTimeout = null;

function computeScrollTarget(element) {
    const containerRect = textContainer.getBoundingClientRect();
    const elemRect = element.getBoundingClientRect();
    const targetPosition = textContainer.clientHeight * 0.08;
    return elemRect.top - containerRect.top + textContainer.scrollTop - targetPosition;
}

// FIX: 改用 JS lerp 滾動取代 CSS scrollBehavior:smooth，
// 避免 CSS smooth 動畫期間高光已切換但畫面還在移動的視覺延遲。
let _lerpScrollRafId = null;

function smoothScrollTo(target, instant = false) {
    // 暫停時使用者自由滾動中，不強制跳回聚焦位置（閱讀挑戰模式不受此限制，因為它有自己的捲動節奏）
    if (userIsScrollingManually && !isReadingMode) return;

    const clamped = Math.max(0, Math.min(target, scrollMax));

    if (instant) {
        if (_lerpScrollRafId) { cancelAnimationFrame(_lerpScrollRafId); _lerpScrollRafId = null; }
        textContainer.style.scrollBehavior = 'auto';
        textContainer.scrollTop = clamped;
        requestAnimationFrame(() => { textContainer.style.scrollBehavior = ''; });
        return;
    }

    // lerp 每幀步進：速度係數 0.18（值越大越快，0.1~0.25 為合理範圍）
    if (_lerpScrollRafId) cancelAnimationFrame(_lerpScrollRafId);
    textContainer.style.scrollBehavior = 'auto'; // 確保 CSS smooth 不干擾

    function step() {
        const current = textContainer.scrollTop;
        const diff = clamped - current;
        if (Math.abs(diff) < 1) {
            textContainer.scrollTop = clamped;
            _lerpScrollRafId = null;
            return;
        }
        textContainer.scrollTop = current + diff * 0.18;
        _lerpScrollRafId = requestAnimationFrame(step);
    }
    _lerpScrollRafId = requestAnimationFrame(step);
}

// ── Highlight timing correction ───────────────────────────────────────────────
// Whisper 生成的 timestamp 標記的是「字幕顯示時間」，比實際語音起點早約 250ms。
// 實測此音檔：Timestamp start 比音訊語音早 200~260ms（平均中位 ~250ms）。
// 加入補償值讓高光晚觸發，對齊真正的語音起點。
// 可透過 UI 的「時間調整」功能微調；此處為全域預設值。
const HIGHLIGHT_OFFSET_SEC = 0.25; // 250ms，可依需求調整
// ─────────────────────────────────────────────────────────────────────────────

function timestampUpdateLoop() {
    if (!isPlaying || !isTimestampMode || !isFinite(audio.duration) || audio.duration === 0) {
        timestampUpdateRafId = null;
        return;
    }

    // FIX: 用補償後的時間做 binary search，讓高光對齊實際語音而非 Whisper 的早標時間點
    const currentTime = audio.currentTime - HIGHLIGHT_OFFSET_SEC;

    // Binary search highlight
    let idx = findActiveSentenceIndex(currentTime);

    // FIX: 句子間空白時間（end < t < next.start）保留上一句高光，
    // 避免高光在兩句之間閃滅讓讀者失去定位感。
    // 只有在下一句真正開始後才切換，完全沒有句子（開頭/結尾靜音）才清除。
    if (idx === -1) {
        // 找出「最近剛結束」的句子：currentTime > end 且距離最近
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < timestampData.length; i++) {
            const d = currentTime - timestampData[i].end;
            if (d > 0 && d < bestDist) { bestDist = d; bestIdx = i; }
        }
        // 若與下一句的距離 < 3 秒（句間停頓），保持上一句高光不清除
        const nextIdx = bestIdx + 1;
        const nextStart = (nextIdx < timestampData.length) ? timestampData[nextIdx].start : Infinity;
        const gapToNext = nextStart - currentTime;
        if (bestIdx !== -1 && gapToNext < 3.0) {
            idx = bestIdx; // 保留前一句
        }
    }

    const activeSentence = idx !== -1 ? timestampData[idx] : null;

    // FIX: 使用預建 Map，O(1) 取得 DOM element，取代每次 querySelector O(n) 掃描
    const sentenceElement = activeSentence
        ? (sentenceElementMap.get(String(activeSentence.start)) || null)
        : null;

    if (sentenceElement && sentenceElement !== lastHighlightedSentence) {
        if (lastHighlightedSentence) lastHighlightedSentence.classList.remove('is-current');
        sentenceElement.classList.add('is-current');
        lastHighlightedSentence = sentenceElement;

        // Recompute scroll target only when sentence changes
        // 若使用者正在手動滾動（暫停中捲過），播放後第一次切換句子才重設回聚焦模式
        cachedScrollTarget = computeScrollTarget(sentenceElement);
        if (!userIsScrollingManually) {
            smoothScrollTo(cachedScrollTarget);
        }

    } else if (!activeSentence && lastHighlightedSentence) {
        lastHighlightedSentence.classList.remove('is-current');
        lastHighlightedSentence = null;
        cachedScrollTarget = -1;
    }

    timestampUpdateRafId = requestAnimationFrame(timestampUpdateLoop);
}


// --- REVISED: Highlight and Scroll Logic for JSON Mode for Continuous Highlighting ---
function jsonModeHighlightLoop() {
    if (!isPlaying || isTimestampMode || !isFinite(audio.duration) || audio.duration === 0 || !hasTimestampFile) {
        jsonModeUpdateRafId = null;
        return;
    }

    const currentTime = audio.currentTime;

    // Binary search for active sentence
    const idx = findActiveSentenceIndex(currentTime);
    const activeSentenceData = idx !== -1 ? timestampData[idx] : null;

    if (activeSentenceData) {
        // 當句子切換時，才需要重新尋找並設定高亮單字
        if (activeSentenceData.start !== lastActiveSentenceStart) {
            lastActiveSentenceStart = activeSentenceData.start;

            // 清除先前的高亮
            lastHighlightedWords.forEach(span => span.classList.remove('is-current-sentence', 'highlight-start', 'highlight-end'));
            lastHighlightedWords = [];

            const normalize = (text) => text
                .replace(/[^a-zA-Z0-9]/g, '')
                .toLowerCase();

            const normalizedTargetSentence = normalize(activeSentenceData.sentence);
            
            // --- 修改開始 ---
            // 搜尋所有 span (包含單字與空白)，以實現連續高亮效果
            const allSpans = Array.from(textContainer.querySelectorAll('p > span'));
            // --- 修改結束 ---
            
            let found = false;

            for (let i = 0; i < allSpans.length; i++) {
                let tempSpanBuffer = [];
                let tempText = '';
                for (let j = i; j < allSpans.length; j++) {
                    const currentSpan = allSpans[j];
                    tempSpanBuffer.push(currentSpan);
                    tempText += currentSpan.textContent;
                    const normalizedCurrentText = normalize(tempText);

                    if (normalizedCurrentText === normalizedTargetSentence) {
                        lastHighlightedWords = tempSpanBuffer;
                        found = true;
                        break;
                    }
                    if (normalizedCurrentText.length > normalizedTargetSentence.length + 5) { // 優化：如果長度超出太多就跳出
                        break;
                    }
                }
                if (found) break;
            }

            // 如果找到對應的單字，就加上高亮效果
            if (found) {
                lastHighlightedWords.forEach((span, index) => {
                    span.classList.add('is-current-sentence');
                    if (index === 0) span.classList.add('highlight-start');
                    if (index === lastHighlightedWords.length - 1) span.classList.add('highlight-end');
                });

                // Scroll: compute target only once per sentence change
                cachedScrollTarget = computeScrollTarget(lastHighlightedWords[0]);
                smoothScrollTo(cachedScrollTarget);
            }
        }
    } else {
        // 如果沒有正在播放的句子，清除所有高亮
        if (lastActiveSentenceStart !== -1) {
            lastHighlightedWords.forEach(span => span.classList.remove('is-current-sentence', 'highlight-start', 'highlight-end'));
            lastHighlightedWords = [];
            lastActiveSentenceStart = -1;
        }
    }

    jsonModeUpdateRafId = requestAnimationFrame(jsonModeHighlightLoop);
}


// Story loading and rendering
async function loadData() {
  try {
    const [storyRes, vocabRes] = await Promise.all([
        fetch('https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/story.json', { cache: 'no-store' }),
        fetch('https://boydyang-designer.github.io/English-vocabulary/audio_files/Z_total_words.json', { cache: 'no-store' })
    ]);

    if (!storyRes.ok) throw new Error(`Failed to fetch story.json: ${storyRes.statusText}`);
    if (!vocabRes.ok) throw new Error(`Failed to fetch Z_total_words.json: ${vocabRes.statusText}`);

    const storyJson = await storyRes.json();
    const vocabJson = await vocabRes.json();
    
    stories = Array.isArray(storyJson['New Words']) ? storyJson['New Words'] : [];
    vocabularyData = Array.isArray(vocabJson['New Words']) ? vocabJson['New Words'] : [];

    // FIX-1 B方案：從 story.json 的 "Categories" 陣列預填圖片快取
    // hasThumb: false → 確定沒圖，所有路徑（空格版＋底線版）都標 false，不發任何請求
    // hasThumb: true  → 不預填，讓 HEAD 請求自行確認是 .jpg 還是 .png（也可能是底線版）
    if (Array.isArray(storyJson['Categories'])) {
        const toU = s => s.replace(/[^A-Za-z0-9.\-]/g, '_');
        storyJson['Categories'].forEach(cat => {
            const name = cat['分類'] || cat['name'] || '';
            if (!name) return;
            if (!Object.prototype.hasOwnProperty.call(cat, 'hasThumb')) return;
            if (cat['hasThumb'] === true) return; // 有圖：不預填，讓 HEAD 請求確認副檔名
            // hasThumb: false → 標記所有候補為 false，避免發出無謂的 404 請求
            const nameU = toU(name);
            [name, nameU].forEach(variant => {
                ['jpg', 'png'].forEach(ext => {
                    _imageExistsCache.set(`images/${variant}.${ext}`, false);
                });
            });
        });
        console.log(`[FIX-1] Image cache pre-filled from story.json Categories (${storyJson['Categories'].length} entries)`);
    }

    console.log("✅ Stories and Vocabulary data loaded successfully.");

  } catch (error) {
    console.error(error);
    alert("Could not load necessary app data. Please check your internet connection and try again.");
  }
}

// --- New Timestamp Data Loading and Parsing ---
function timeToSeconds(timeStr) {
    const parts = timeStr.split(':');
    const secondsParts = parts[2].split('.');
    const hours   = parseInt(parts[0], 10);          // FIX: 加入小時欄位，避免長音檔（>60 分）高光錯位
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(secondsParts[0], 10);
    const milliseconds = parseInt(secondsParts[1], 10);
    return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
}

function parseTimestampText(text) {
    const lines = text.trim().split('\n');
    const data = [];
    const regex = /\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\](.*)/;
    const shortRegex = /\[(\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}\.\d{3})\](.*)/;
    const zhRegex = /[\u4e00-\u9fff]/; // 偵測中文字元

    for (const line of lines) {
        let match = line.match(regex);
        if (!match) {
            match = line.match(shortRegex);
            if (match) {
                match[1] = '00:' + match[1];
                match[2] = '00:' + match[2];
            }
        }

        if (match) {
            const sentenceText = match[3].trim();
            const startSec = timeToSeconds(match[1]);
            const endSec = timeToSeconds(match[2]);

            if (zhRegex.test(sentenceText)) {
                // 這是中文翻譯行 → 附加到上一筆資料的 translation 欄位
                if (data.length > 0 && data[data.length - 1].start === startSec) {
                    data[data.length - 1].translation = sentenceText;
                }
            } else {
                // 這是英文原文行 → 新增一筆
                data.push({
                    start: startSec,
                    end: endSec,
                    sentence: sentenceText,
                    translation: '' // 預設空，等下一行中文填入
                });
            }
        }
    }
    return data;
}



// === 修正後的正確版本（已整合 tsOverride）===
async function loadTimestampForStory(title) {
const url = `https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/audio/${encodeURIComponent(title.trim())} Timestamp.txt`;

    try {
        const response = await fetch(url);
        if (response.ok) {
            const text = await response.text();
            const rawData = parseTimestampText(text);
            // 套用 localStorage tsOverride（文字與時間的暫存修改）
            timestampData = (typeof applyTsOverride === 'function')
                ? applyTsOverride(title, rawData)
                : rawData;
            hasTimestampFile = timestampData.length > 0;
        } else {
            console.warn(`Timestamp file not found for "${title}" (404)`);
            hasTimestampFile = false;
            timestampData = [];
        }
    } catch (error) {
        console.error("Error fetching timestamp file:", error);
        hasTimestampFile = false;
        timestampData = [];
    }
}



function renderMajorCategories() {
  // 1. 抓取所有不重複的「大類」
  const majors = [...new Set(stories.map(item => item['大類'] || 'Uncategorized').filter(Boolean))].sort();
  
  majorCategoryList.innerHTML = '';
  
  // 【新增邏輯】每次渲染時先清空繼續閱讀區塊
  if (continueReadingContainer) {
      continueReadingContainer.innerHTML = ''; 
  }

  // 【新增邏輯】檢查是否有上次閱讀紀錄
  try {
    const lastSession = localStorage.getItem(LAST_SESSION_KEY);
    
    // 確保有紀錄、且容器存在
    if (lastSession && continueReadingContainer) {
        const { title, time, majorCategory } = JSON.parse(lastSession);
        
        // 檢查該文章是否還存在於目前的資料庫中 (避免舊資料錯誤)
        const storyExists = stories.some(s => s['標題'] === title);
        
        // 只有當時間大於 5 秒且文章存在時才顯示 (避免剛開始聽就顯示)
        if (storyExists && time > 5) {
            const continueBtn = document.createElement('div');
            
            // 使用 category-item 樣式保持一致，並加上額外樣式區別
            continueBtn.className = 'category-item'; 
            
            // 設定特殊的綠色樣式，讓它看起來像是一個提示
            continueBtn.style.backgroundColor = '#e8f5e9'; 
            continueBtn.style.border = '1px solid #4CAF50';
            continueBtn.style.color = '#2E7D32';
            continueBtn.style.fontWeight = 'bold';
            continueBtn.style.marginBottom = '15px'; // 與 Note 按鈕保持距離
            
            // 格式化時間 (例如: 125秒 -> 2:05)
            const minutes = Math.floor(time / 60);
            const seconds = Math.floor(time % 60).toString().padStart(2, '0');
            
            // 設定按鈕內容
            continueBtn.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <div style="display: flex; flex-direction: column; gap: 4px;">
                        ${majorCategory ? `<span style="font-size: 0.75em; font-weight: 600; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em;">${majorCategory}</span>` : ''}
                        <span>Continue: ${title}</span>
                    </div>
                    <span style="font-size: 0.9em; opacity: 0.8; flex-shrink: 0; margin-left: 10px;">${minutes}:${seconds}</span>
                </div>
            `;
            
            // 點擊事件：呼叫原本就有的 resumeLastPlayback
            continueBtn.addEventListener('click', () => {
                resumeLastPlayback(title, time);
            });

            continueReadingContainer.appendChild(continueBtn);
        }
    }
  } catch (e) {
      console.error("Error loading last session:", e);
  }

  // 2. 產生原本的大類按鈕
  majors.forEach(major => {
    const div = document.createElement('div');
    div.className = 'category-item';
    div.textContent = major; 
    div.addEventListener('click', () => showSubCategories(major));
    majorCategoryList.appendChild(div);
  });
}


//  MODIFIED: 顯示子分類 (Render Sub Categories)
// ==========================================
function showSubCategories(major) {
  currentMajorCategory = major; 
  subCategoryHeader.textContent = major;
  subCategoryList.innerHTML = '';

  const storiesInMajor = stories.filter(s => (s['大類'] || 'Uncategorized') === major);
  const categories = [...new Set(storiesInMajor.flatMap(item => item['分類'] || []).map(c => c.trim()).filter(Boolean))].sort();

  // 讀取所有子分類的播放記錄
  let subCategorySessions = {};
  try {
      subCategorySessions = JSON.parse(localStorage.getItem(SUB_CATEGORY_SESSION_KEY) || '{}');
  } catch (e) {
      console.error("Error loading sub-category sessions:", e);
  }

  categories.forEach(category => {
    // 建立容器包含分類項目和繼續閱讀按鈕
    const wrapper = document.createElement('div');
    wrapper.style.marginBottom = '10px';
    
    // 原本的分類項目
    const item = createListItemWithImage(category, () => showCategory(category), major);
    wrapper.appendChild(item);
    
    // 檢查這個分類是否有播放記錄
    const categorySession = subCategorySessions[category];
    if (categorySession && categorySession.time > 5) {
        const { title, time } = categorySession;
        
        // 檢查該文章是否還存在
        const storyExists = stories.some(s => 
            s['標題'] === title && 
            s['分類']?.includes(category)
        );
        
        if (storyExists) {
            const continueBtn = document.createElement('div');
            continueBtn.className = 'category-item sub-category-continue-btn';
            
            // 設定樣式
            continueBtn.style.backgroundColor = '#f1f8f4';
            continueBtn.style.border = '1px solid #81C784';
            continueBtn.style.color = '#388E3C';
            continueBtn.style.fontSize = '0.9em';
            continueBtn.style.padding = '8px 12px';
            continueBtn.style.marginTop = '5px';
            continueBtn.style.marginLeft = '10px';
            continueBtn.style.marginRight = '10px';
            
            // 格式化時間
            const minutes = Math.floor(time / 60);
            const seconds = Math.floor(time % 60).toString().padStart(2, '0');
            
            // 設定按鈕內容
            const displayTitle = title.length > 30 ? title.substring(0, 30) + '...' : title;
            continueBtn.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
                    <span style="font-size: 0.85em;">↻ Continue: ${displayTitle}</span>
                    <span style="font-size: 0.8em; opacity: 0.8;">${minutes}:${seconds}</span>
                </div>
            `;
            
            // 點擊事件
            continueBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                resumeSubCategoryPlayback(category, title, time);
            });

            wrapper.appendChild(continueBtn);
        }
    }
    
    subCategoryList.appendChild(wrapper);
  });

  showView(subCategoryView);
}

function resumeSubCategoryPlayback(category, title, time) {
    const story = stories.find(s => 
        s['標題'] === title && 
        s['分類']?.includes(category)
    );
    
    if (!story) {
        alert("Could not find the story from this category's last session.");
        clearSubCategoryPlaybackState(category);
        showSubCategories(currentMajorCategory);
        return;
    }
    
    currentStoryList = stories.filter(item => 
        item['分類']?.map(c => c.trim()).includes(category) &&
        (item['大類'] || 'Uncategorized') === currentMajorCategory
    ).sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));
    
    const indexInList = currentStoryList.findIndex(s => s['標題'] === title);
    
    if (indexInList > -1) {
        showCategory(category);
        showPlayback(indexInList, time);
    }
}


function resumeLastPlayback(title, time) {
    const story = stories.find(s => s['標題'] === title);
    if (!story) {
        alert("Could not find the story from your last session.");
        clearLastPlaybackState();
        renderMajorCategories();
        showView(homeView);
        return;
    }
    const category = story['分類']?.[0];
    if (!category) return;

    // 確保 currentMajorCategory 正確設定，避免從首頁直接點擊時過濾失敗
    currentMajorCategory = story['大類'] || 'Uncategorized';
    
    currentStoryList = stories.filter(item => item['分類']?.map(c => c.trim()).includes(category))
                            .sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));
    const indexInList = currentStoryList.findIndex(s => s['標題'] === title);
    
    if (indexInList > -1) {
        showCategory(category);
        showPlayback(indexInList, time);
    }
}



function showCategory(category) {
  categoryTitle.textContent = category;
  currentCategoryName = category;
  
  titleList.innerHTML = '';

  currentStoryList = stories.filter(item => {
      const matchMajor = (item['大類'] || 'Uncategorized') === currentMajorCategory;
      const matchSub = item['分類']?.map(c => c.trim()).includes(category);
      return matchMajor && matchSub;
  }).sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));

  currentStoryList.forEach((item, index) => {
    // 修改處：傳入 category 作為第三個參數 (fallback)
    // 如果找不到這篇文章的圖，就會去抓 category (如 "Atomic Habits") 的圖
    // FIX-1: 文章列表不需要圖片，傳 showThumb=false 完全跳過圖片請求
    const itemEl = createListItemWithImage(item['標題'], () => showPlayback(index), category, false);
    titleList.appendChild(itemEl);
  });
  
  showView(categoryView);
}

// ===== MODIFIED FUNCTION =====
async function showPlayback(index, startTime = 0, maintainTimestampMode = false) {
  // 儲存切換前的模式狀態
  const wasTimestampMode = maintainTimestampMode && isTimestampMode;

  // 切換文章前，若還在閱讀挑戰模式中，先退出（避免殘留樣式/計時器指向舊文章的句子）
  if (isReadingMode) exitReadingMode();

  // 停止當前的動畫循環和音訊
  stopTimestampUpdateLoop();
  stopJsonModeHighlightLoop();
  if (isPlaying) {
      pauseAudio();
  }
  audio.removeAttribute('src');
  audio.load();

  // 重設狀態（稍後會根據 maintainTimestampMode 重新設定）
  isTimestampMode = true;
  timestampData = [];
  hasTimestampFile = false;
  lastHighlightedSentence = null;
  cachedScrollTarget = -1;
  lastHighlightedWords = [];
  lastActiveSentenceStart = -1;
  stagedWordsContainer.innerHTML = ''; if (typeof updateStagingBtnState === 'function') updateStagingBtnState();

  // 載入新故事的資料
  currentStoryIndex = index;
  const story = currentStoryList[currentStoryIndex];
  if (!story) return;

  currentStoryTitle = story['標題'];
  playbackTitle.textContent = currentStoryTitle;
  textContainer.innerHTML = ''; // 清空
  textContainer.scrollTop = 0;
  progressBar.value = 0;

  prevStoryBtn.hidden = currentStoryIndex <= 0;
  nextStoryBtn.hidden = currentStoryIndex >= currentStoryList.length - 1;

  // 等待新故事的時間戳檔案載入
  await loadTimestampForStory(currentStoryTitle); // 這會更新 hasTimestampFile 和按鈕可見性

  // 根據是否有 timestamp 檔案，顯示/隱藏頂部 ✏️ 編輯模式按鈕
  const tsEditModeBtn = document.getElementById('ts-edit-mode-btn');
  if (tsEditModeBtn) tsEditModeBtn.style.display = hasTimestampFile ? '' : 'none';

  // 根據是否有 timestamp 檔案，顯示/隱藏頂部 📖 閱讀挑戰模式按鈕
  const readingModeBtnEl = document.getElementById('reading-mode-btn');
  if (readingModeBtnEl) readingModeBtnEl.style.display = hasTimestampFile ? '' : 'none';

  // 顯示/隱藏中文翻譯 Toggle 按鈕
  const toggleTranslationBtn = document.getElementById('toggle-translation-btn');
  if (toggleTranslationBtn) {
      // 有翻譯內容才顯示按鈕（避免純英文 timestamp 出現無效按鈕）
      const hasTranslation = timestampData.some(line => line.translation);
      toggleTranslationBtn.style.display = hasTranslation ? '' : 'none';
      showTranslation = false;
      toggleTranslationBtn.textContent = '顯示中文';
  }

  // Always use timestamp mode; fallback to plain text if no timestamp file
  if (hasTimestampFile) {
      renderTimestampContent();
  } else {
      textContainer.appendChild(parafyAndMakeClickable('\n\n' + story['內文'], currentCategoryName, currentStoryTitle));
  }

  // 設定音訊來源
  setAudioSourceWithFallback(currentStoryTitle);

  // BUG-02 修正：先清除上一個尚未觸發的 handler，再掛新的，防止快速切換文章時累積
  if (_canplaythroughHandler) {
    audio.removeEventListener('canplaythrough', _canplaythroughHandler);
    _canplaythroughHandler = null;
  }
  const onLoaded = () => {
    audio.removeEventListener('canplaythrough', onLoaded);
    _canplaythroughHandler = null;
    if (isFinite(audio.duration)) {
        if (startTime > 0) {
            audio.currentTime = Math.min(startTime, audio.duration);
        }
        computeScrollMax();

        // 如果是自動切換下一首，則自動播放
        if (wasTimestampMode) {
            playPauseBtn.click(); // 觸發播放
        }
    }
  };
  _canplaythroughHandler = onLoaded;
  audio.addEventListener('canplaythrough', onLoaded);

  showView(playbackView, { view: 'story', major: currentMajorCategory || '', sub: currentCategoryName || '', index: currentStoryIndex });
}
// ===== END OF MODIFIED FUNCTION =====

function stopAudioAndReset() {
  // 離開文章時，若還在閱讀挑戰模式中，先退出並清理樣式/計時器
  if (isReadingMode) exitReadingMode();

  stagedWordsContainer.innerHTML = ''; if (typeof updateStagingBtnState === 'function') updateStagingBtnState();
  stopTimestampUpdateLoop();
  stopJsonModeHighlightLoop();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  isPlaying = false;
  playPauseBtn.classList.remove('is-playing');
  progressBar.value = 0;
  currentStoryTitle = null;
  currentCategoryName = null;
  playbackPositionBeforeNote = 0;
  userIsScrollingManually = false;
  if (_manualScrollTimeout) { clearTimeout(_manualScrollTimeout); _manualScrollTimeout = null; }

  isTimestampMode = true;
  lastHighlightedSentence = null;
  lastHighlightedWords = [];
  lastActiveSentenceStart = -1;
  readingScrollTopBeforeEnter = 0; // 切換/離開文章時清除暫存的捲動位置

  // 離開文章時關閉編輯模式，並隱藏頂部 ✏️ 按鈕
  if (typeof resetTsEditMode === 'function') resetTsEditMode();
  const _tsBtn = document.getElementById('ts-edit-mode-btn');
  if (_tsBtn) _tsBtn.style.display = 'none';
  // 離開文章時隱藏頂部 📖 閱讀挑戰模式按鈕
  const _readingBtn = document.getElementById('reading-mode-btn');
  if (_readingBtn) _readingBtn.style.display = 'none';
  // 離開文章時隱藏中文翻譯按鈕，並重設狀態
  const _toggleZhBtn = document.getElementById('toggle-translation-btn');
  if (_toggleZhBtn) _toggleZhBtn.style.display = 'none';
  showTranslation = false;
}

function pauseAudio(byUser = false) {
    audio.pause();
    isPlaying = false;
    playPauseBtn.classList.remove('is-playing');
    saveLastPlaybackState();
    stopTimestampUpdateLoop();
    stopJsonModeHighlightLoop();
    // 只有使用者主動按暫停，才允許自由滾動；系統內部呼叫不觸發
    if (byUser) {
        userIsScrollingManually = true;
        // 立刻取消 lerp 滾動動畫，否則動畫會繼續把畫面拉回去
        if (_lerpScrollRafId) {
            cancelAnimationFrame(_lerpScrollRafId);
            _lerpScrollRafId = null;
        }
    }
}

// --- New Helper Functions for Timestamp Navigation ---

function skipToNextSentence() {
    if (!timestampData || timestampData.length === 0) return;
    
    const currentTime = audio.currentTime;
    // 找到第一個 "開始時間" 晚於當前時間的句子 (加 0.2s 緩衝避免卡在同一句)
    const nextSent = timestampData.find(line => line.start > currentTime + 0.2);
    
    if (nextSent) {
        setAudioTimeAccurate(nextSent.start); // 使用改進的時間設定函數
    } else {
        // 如果找不到(已經是最後一句之後)，就跳到結束
        audio.currentTime = audio.duration;
    }
}

function skipToPrevSentence() {
    if (!timestampData || timestampData.length === 0) return;

    const currentTime = audio.currentTime;
    
    // 1. 找出目前正在播放(或是剛播完)的是哪一句的索引
    let currentIndex = -1;
    for (let i = 0; i < timestampData.length; i++) {
        // 只要句子的開始時間小於當前時間，它就是潛在的"當前句"
        if (timestampData[i].start <= currentTime + 0.2) {
            currentIndex = i;
        } else {
            break; // 後面的句子還沒開始，停止搜尋
        }
    }

    if (currentIndex === -1) {
        audio.currentTime = 0;
        return;
    }

    const currentSent = timestampData[currentIndex];

    // ── BUG-2 修正：統一 threshold ───────────────────────────────────────────
    // 原本手機用 2.0、PC 用 1.5，目的是補償手機 seek 偏差造成的「剛 seek 完就按上一句」問題。
    // 現在 setAudioTimeAccurate() 已移除固定提前量並改用精準重試，
    // seek 精度手機/PC 趨於一致，不再需要差異化 threshold。
    // 統一使用 1.5 秒：播放超過 1.5 秒才算「重聽本句」，否則跳到上一句。
    // ─────────────────────────────────────────────────────────────────────────
    const threshold = 1.5; // ✅ 手機/PC 統一，不再區分

    if (currentTime > currentSent.start + threshold) {
        // 已播超過 threshold → 重聽本句
        setAudioTimeAccurate(currentSent.start);
    } else {
        // 剛開始播 → 跳到上一句
        if (currentIndex > 0) {
            setAudioTimeAccurate(timestampData[currentIndex - 1].start);
        } else {
            audio.currentTime = 0;
        }
    }
}

// Button listeners
// B-02 修正：backToHomeBtn 已移除，此事件綁定不再需要

// --- 修改開始 ---

// 1. 從「第二層 (Sub Category)」回到「第一層 (大類)」
if (backToMajorBtn) {
    backToMajorBtn.addEventListener('click', () => {
        renderMajorCategories(); // 確保回到首頁時重新渲染大類
        showView(homeView);
    });
}

// 2. 從「第三層 (文章列表)」回到「第二層 (Sub Category)」
// 注意：這裡取代了原本的 backToCategoryBtn 監聽器
if (backToSubCategoryBtn) {
    backToSubCategoryBtn.addEventListener('click', () => {
        // 使用全域變數 currentMajorCategory 來決定要顯示哪個子分類列表
        if (currentMajorCategory) {
            showSubCategories(currentMajorCategory);
        } else {
            // 如果狀態遺失，安全起見回到首頁
            renderMajorCategories();
            showView(homeView);
        }
    });
}


// 中文翻譯 Toggle 按鈕
const toggleTranslationBtn = document.getElementById('toggle-translation-btn');
if (toggleTranslationBtn) {
    toggleTranslationBtn.addEventListener('click', () => {
        showTranslation = !showTranslation;
        document.querySelectorAll('.timestamp-translation').forEach(el => {
            el.style.display = showTranslation ? 'block' : 'none';
        });
        toggleTranslationBtn.textContent = showTranslation ? '隱藏中文' : '顯示中文';
    });
}

// ── 閱讀挑戰模式：進入/退出、播放暫停（控制捲動）、速度切換 ──────────────
const readingModeBtn = document.getElementById('reading-mode-btn');
if (readingModeBtn) {
    readingModeBtn.addEventListener('click', () => {
        if (isReadingMode) exitReadingMode();
        else enterReadingMode();
    });
}

document.getElementById('reading-mode-exit-btn')?.addEventListener('click', exitReadingMode);

document.getElementById('reading-play-pause')?.addEventListener('click', () => {
    if (readingIsPlaying) pauseReadingScroll();
    else startReadingScroll();
});

document.getElementById('reading-record-btn')?.addEventListener('click', () => {
    if (isReadingRecording) stopReadingRecording();
    else startReadingRecording();
});

document.getElementById('reading-record-download-btn')?.addEventListener('click', downloadReadingRecording);
document.getElementById('reading-record-discard-btn')?.addEventListener('click', discardReadingRecording);


rewindBtn.addEventListener('click', () => { 
    if (isTimestampMode && hasTimestampFile) {
        skipToPrevSentence();
    } else {
        audio.currentTime = Math.max(0, audio.currentTime - 5); 
    }
});

forwardBtn.addEventListener('click', () => { 
    if (isTimestampMode && hasTimestampFile) {
        skipToNextSentence();
    } else {
        if(isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); 
    }
});

playPauseBtn.addEventListener('click', () => {
    if (isPlaying) {
        pauseAudio(true); // 使用者主動暫停，啟用自由滾動
    } else {
        audio.play().catch(e => console.error("Play failed:", e));
    }
});



// ===== MODIFIED LINE =====
prevStoryBtn.addEventListener('click', () => { if (currentStoryIndex > 0) { showPlayback(currentStoryIndex - 1, 0, true); } });
// ===== MODIFIED LINE =====
nextStoryBtn.addEventListener('click', () => { if (currentStoryIndex < currentStoryList.length - 1) { showPlayback(currentStoryIndex + 1, 0, true); } });

// toggleTimestampBtn removed — always timestamp mode

goToStoryNoteBtn.addEventListener('click', () => {
    if (currentCategoryName && currentStoryTitle) {
        currentNoteOrigin = 'story'; // Set origin to story
        playbackPositionBeforeNote = audio.currentTime;
        if (isPlaying) pauseAudio();
        renderNoteView('words', currentCategoryName, currentStoryTitle);
        showView(noteView);
    }
});

const goToStoryQuizBtn = document.getElementById('go-to-story-quiz-btn');
if (goToStoryQuizBtn) {
    goToStoryQuizBtn.addEventListener('click', () => {
        if (currentCategoryName && currentStoryTitle && typeof openQuiz === 'function') {
            playbackPositionBeforeNote = audio.currentTime; // 儲存進度，回到 Story 時可恢復
            if (isPlaying) pauseAudio();
            openQuiz(currentCategoryName, currentStoryTitle, 'story');
        }
    });
}

backToStoryFromNoteBtn.addEventListener('click', () => {
    if (noteViewCategory && noteViewTitle) {
        const story = stories.find(s => s['標題'] === noteViewTitle);
        const category = story?.['分類']?.[0];
        if (category) {
            currentStoryList = stories.filter(item => item['分類']?.map(c => c.trim()).includes(category))
                                      .sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));
            const indexInList = currentStoryList.findIndex(s => s['標題'] === noteViewTitle);
            if (indexInList > -1) {
                showCategory(category);
                // This now correctly uses noteViewTitle and playbackPositionBeforeNote
                // which will be 0 if "Next Note" was clicked.
                showPlayback(indexInList, playbackPositionBeforeNote);
            }
        }
    }
});

audio.addEventListener('play', () => { 
    isPlaying = true; 
    playPauseBtn.classList.add('is-playing'); 
    // 閱讀挑戰模式下，捲動/高亮/進度保存完全由獨立邏輯處理（見 readingModeLoop），
    // 這裡只需要維持 isPlaying 旗標一致，避免跟原本的播放邏輯互相干擾。
    if (isReadingMode) return;
    saveLastPlaybackState();
    // 恢復播放時，關閉自由滾動，立刻跳回目前高亮句子
    userIsScrollingManually = false;
    if (_manualScrollTimeout) { clearTimeout(_manualScrollTimeout); _manualScrollTimeout = null; }
    // 重新從 lastHighlightedSentence 計算捲動目標，確保即使暫停期間未切換句子也能正確聚焦
    if (lastHighlightedSentence) {
        cachedScrollTarget = computeScrollTarget(lastHighlightedSentence);
    }
    if (cachedScrollTarget >= 0) {
        smoothScrollTo(cachedScrollTarget, true); // 瞬間跳回聚焦位置
    }
    // Clear any pending snippet stop timer when full playback starts
    if (snippetStopTimeout) {
        clearTimeout(snippetStopTimeout);
        snippetStopTimeout = null;
    }
    if (isTimestampMode && hasTimestampFile) {
        timestampUpdateLoop();
    }
});

// FIX-2: 音訊載入成功 → 清除「載入中」狀態
audio.addEventListener('canplaythrough', () => {
    playPauseBtn.classList.remove('is-loading');
    playPauseBtn.disabled = false;
    // Update total duration display once known
    const totalEl = document.getElementById('playback-total-time');
    if (totalEl && isFinite(audio.duration)) {
        totalEl.textContent = formatPlaybackTime(audio.duration);
    }
}, { once: false });

// FIX-2: 音訊載入失敗 → 顯示明確的錯誤通知（網路或 GitHub 無法連線）
audio.addEventListener('error', () => {
    if (!audio.src || audio.src === window.location.href) return; // src 為空時忽略
    playPauseBtn.classList.remove('is-loading');
    playPauseBtn.disabled = false;
    showNotification('⚠️ 音訊無法載入，請確認網路連線或 GitHub 是否可存取。', 'error');
    console.warn('[FIX-2] Audio load error for:', audio.src);
});

audio.addEventListener('pause', () => { 
    if (isPlaying) {
        pauseAudio();
    }
});

// ===== MODIFIED EVENT LISTENER =====
audio.addEventListener('ended', () => {
    // 閱讀挑戰模式下播放的只是單句片段（會在播完前被 playAudioSnippet 的計時器主動暫停），
    // 理論上不會自然觸發 ended；多一層防護避免邊界情況下誤觸發切換下一篇文章。
    if (isReadingMode) {
        isPlaying = false;
        playPauseBtn.classList.remove('is-playing');
        return;
    }

    clearLastPlaybackState();
    document.getElementById('continue-last-session-btn')?.remove();

    // --- 請求 1 & 2 的核心邏輯 ---

    // 1. 基本重設（為了允許重播）
    isPlaying = false;
    playPauseBtn.classList.remove('is-playing');
    audio.currentTime = 0;
    progressBar.value = 0;
    stopTimestampUpdateLoop();
    stopJsonModeHighlightLoop();

    // 重設高亮狀態
    if (lastHighlightedSentence) {
        lastHighlightedSentence.classList.remove('is-current');
        lastHighlightedSentence = null;
    }
    textContainer.scrollTop = 0; // 滾動到頂部

    // 2. 檢查是否在 Timestamp 模式下自動播放下一則
    if (isTimestampMode && currentStoryIndex < currentStoryList.length - 1) {
        // 是 Timestamp 模式，且有下一則故事
        console.log("Timestamp 模式結束，自動播放下一則...");
        // 呼叫 showPlayback，並傳入 true 來保持 Timestamp 模式
        showPlayback(currentStoryIndex + 1, 0, true);
    } else {
        // 不是 Timestamp 模式，或是最後一則故事
        // 則不執行任何動作。
        // 此時，使用者點擊播放鍵（playPauseBtn）將會從頭重播（因為 isPlaying = false 且 currentTime = 0）
        console.log("播放結束。");
    }
});
// ===== END OF MODIFIED EVENT LISTENER =====

// ── FIX-4: Time display helper ──────────────────────────────────
function formatPlaybackTime(seconds) {
    if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

audio.addEventListener('timeupdate', () => { 
    if (isFinite(audio.duration)) {
        progressBar.value = (audio.currentTime / audio.duration) * 100;
        const curEl = document.getElementById('playback-current-time');
        const totEl = document.getElementById('playback-total-time');
        if (curEl) curEl.textContent = formatPlaybackTime(audio.currentTime);
        if (totEl) totEl.textContent = formatPlaybackTime(audio.duration);
    }
});
progressBar.addEventListener('input', () => {
    if (isFinite(audio.duration)) {
        audio.currentTime = (progressBar.value / 100) * audio.duration;
        // Cancel any in-progress smooth scroll so it snaps to new position immediately
        cachedScrollTarget = -1;
        textContainer.style.scrollBehavior = 'auto';
        requestAnimationFrame(() => { textContainer.style.scrollBehavior = ''; });
    }
});

document.addEventListener('keydown', (event) => {
  if (!playbackView.classList.contains('is-hidden')) {
    if (event.target.tagName === 'INPUT') return;
    if (typeof isTsEditModeActive === 'function' && isTsEditModeActive()) return;

    // ── 閱讀模式：左右鍵邏輯 ──────────────────────────────
    if (isReadingMode) {
      // 速度條鎖定中：左右鍵調速
      if (_readingSpeedLocked) {
        if (event.code === 'ArrowLeft')  { event.preventDefault(); setReadingSpeedPx(readingSpeedPx - 3); return; }
        if (event.code === 'ArrowRight') { event.preventDefault(); setReadingSpeedPx(readingSpeedPx + 3); return; }
      }
      // 進度條鎖定中：左右鍵調進度
      if (_readingProgressLocked) {
        if (event.code === 'ArrowLeft')  { event.preventDefault(); _readingProgressKeyStep(-1); return; }
        if (event.code === 'ArrowRight') { event.preventDefault(); _readingProgressKeyStep( 1); return; }
      }
      if (event.code === 'Space') {
        event.preventDefault();
        document.getElementById('reading-play-pause')?.click();
        return;
      }
      return;
    }

    // ── 一般播放模式 ─────────────────────────────────────────
    if (event.code === 'Space') { event.preventDefault(); playPauseBtn.click(); }
    if (event.code === 'ArrowLeft') { event.preventDefault(); rewindBtn.click(); }
    if (event.code === 'ArrowRight') { event.preventDefault(); forwardBtn.click(); }
  }
});


// ============================================================
//  CUSTOM ARTICLES FEATURE
// ============================================================

const CUSTOM_ARTICLES_KEY = 'readingChallengeCustomArticles';

// --- Storage helpers ---
function loadCustomArticles() {
    try {
        const raw = localStorage.getItem(CUSTOM_ARTICLES_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error('Failed to load custom articles', e);
        return [];
    }
}

function saveCustomArticles(articles) {
    // FIX-3: 使用 safeSetItem
    safeSetItem(CUSTOM_ARTICLES_KEY, JSON.stringify(articles));
    if (currentUser) {
        db.collection('userNotes').doc(currentUser.uid)
          .set({ customArticles: articles }, { merge: true })
          .catch(err => console.error('Firestore custom articles save error:', err));
    }
    updateCustomArticlesBadge();
}

async function loadCustomArticlesFromFirestore() {
    if (!currentUser) return;
    try {
        const doc = await db.collection('userNotes').doc(currentUser.uid).get();
        if (doc.exists && doc.data().customArticles) {
            // FIX-3: 使用 safeSetItem
            safeSetItem(CUSTOM_ARTICLES_KEY, JSON.stringify(doc.data().customArticles));
        }
    } catch (e) {
        console.error('Firestore custom articles load error:', e);
    }
}

// --- Slug generator ---
function generateSlug(title) {
    return title.trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^\w\u4e00-\u9fff-]/g, '')
        .replace(/^-+|-+$/g, '')
        || 'article-' + Date.now();
}

// FIX-8: Slug 衝突偵測 — 若已存在相同 slug，自動加序號（e.g. my-story → my-story-2）
function ensureUniqueSlug(slug, existingSlugs) {
    if (!existingSlugs.has(slug)) return slug;
    let i = 2;
    while (existingSlugs.has(`${slug}-${i}`)) i++;
    return `${slug}-${i}`;
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// --- Badge on home screen ---
function updateCustomArticlesBadge() {
    const articles = loadCustomArticles();
    const badge = document.getElementById('custom-articles-count-badge');
    if (!badge) return;
    if (articles.length > 0) {
        badge.textContent = articles.length;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
}

// --- Inline editor panel state ---
let editingArticleIdx = -1;
let editingCardEl = null; // reference to the card being edited

function openEditorPanel(idx = -1) {
    editingArticleIdx = idx;

    const panel = document.getElementById('custom-editor-panel');
    const heading = document.getElementById('editor-panel-heading');
    const titleInput = document.getElementById('editor-article-title');
    const majorInput = document.getElementById('editor-article-major');
    const categoryInput = document.getElementById('editor-article-category');
    const contentInput = document.getElementById('editor-article-content');
    const slugPreview = document.getElementById('editor-slug-preview');

    // Clear any previously highlighted card
    if (editingCardEl) {
        editingCardEl.classList.remove('is-editing');
        editingCardEl = null;
    }

    if (idx === -1) {
        heading.textContent = 'Add Article';
        titleInput.value = '';
        majorInput.value = '';
        categoryInput.value = '';
        contentInput.value = '';
        slugPreview.textContent = '—';
    } else {
        const arts = loadCustomArticles();
        const art = arts[idx];
        heading.textContent = 'Edit Article';
        titleInput.value = art.title || '';
        majorInput.value = art.major || '';
        categoryInput.value = art.category || '';
        contentInput.value = art.content || '';
        slugPreview.textContent = art.slug || '—';

        // Highlight the card being edited
        const cards = document.querySelectorAll('.custom-article-card');
        if (cards[idx]) {
            editingCardEl = cards[idx];
            editingCardEl.classList.add('is-editing');
        }
    }

    panel.classList.remove('is-hidden');

    // Scroll panel into view smoothly
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    titleInput.focus();
}

function closeEditorPanel() {
    const panel = document.getElementById('custom-editor-panel');
    panel.classList.add('is-hidden');
    if (editingCardEl) {
        editingCardEl.classList.remove('is-editing');
        editingCardEl = null;
    }
    editingArticleIdx = -1;
}

function saveFromEditorPanel() {
    const title = document.getElementById('editor-article-title').value.trim();
    const major = document.getElementById('editor-article-major').value.trim();
    const category = document.getElementById('editor-article-category').value.trim();
    const content = document.getElementById('editor-article-content').value.trim();

    if (!title) { showNotification('請填入標題', 'error'); return; }
    if (!content) { showNotification('請填入內文', 'error'); return; }

    const arts = loadCustomArticles();
    const rawSlug = generateSlug(title);

    if (editingArticleIdx === -1) {
        // FIX-8: 新增文章時確保 slug 不重複
        const existingSlugs = new Set(arts.map(a => a.slug));
        const slug = ensureUniqueSlug(rawSlug, existingSlugs);
        if (slug !== rawSlug) {
            showNotification(`slug 已自動調整為「${slug}」以避免衝突`, 'info');
        }
        arts.push({
            id: 'custom-' + Date.now(),
            title, major, category, content, slug,
            merged: false,
            createdAt: new Date().toISOString()
        });
        showNotification('文章已新增', 'success');
    } else {
        const existing = arts[editingArticleIdx];
        let slug;
        if (title === existing.title) {
            slug = existing.slug; // 標題沒變，保留原 slug
        } else {
            // FIX-8: 標題改變時，排除自己後確保新 slug 不重複
            const otherSlugs = new Set(arts.filter((_, i) => i !== editingArticleIdx).map(a => a.slug));
            slug = ensureUniqueSlug(rawSlug, otherSlugs);
            if (slug !== rawSlug) {
                showNotification(`slug 已自動調整為「${slug}」以避免衝突`, 'info');
            }
        }
        arts[editingArticleIdx] = {
            ...existing,
            title, major, category, content, slug,
            updatedAt: new Date().toISOString()
        };
        showNotification('文章已更新', 'success');
    }

    saveCustomArticles(arts);
    closeEditorPanel();
    renderCustomArticlesList();
}

// --- Render custom articles list ---
function renderCustomArticlesList() {
    const articles = loadCustomArticles();
    const container = document.getElementById('custom-articles-list');
    if (!container) return;
    container.innerHTML = '';

    if (articles.length === 0) {
        container.innerHTML = '<p style="color:var(--color-text-light);text-align:center;padding:30px 0;">No custom articles yet. Click "Add Article" to get started.</p>';
        return;
    }

    articles.forEach((art, idx) => {
        const card = document.createElement('div');
        card.className = 'custom-article-card' + (art.merged ? ' is-merged' : '');

        const preview = (art.content || '').replace(/\n/g, ' ').trim();

        card.innerHTML = `
          <div class="custom-article-card-header">
            <div class="custom-article-card-meta">
              <div class="custom-article-card-title">${escapeHtml(art.title)}</div>
              <div class="custom-article-card-tags">
                ${art.major ? `<span class="custom-tag">${escapeHtml(art.major)}</span>` : ''}
                ${art.category ? `<span class="custom-tag">${escapeHtml(art.category)}</span>` : ''}
              </div>
              <div class="custom-article-card-slug">${escapeHtml(art.slug)}</div>
            </div>
            ${art.merged ? '<span class="merged-badge">已彙整</span>' : ''}
          </div>
          <div class="custom-article-card-preview">${escapeHtml(preview)}</div>
          <div class="custom-article-card-actions">
            <button class="btn-read-custom secondary" data-idx="${idx}">閱讀</button>
            <button class="btn-edit-custom secondary" data-idx="${idx}">編輯</button>
            <button class="btn-delete-custom secondary" data-idx="${idx}">刪除</button>
            ${art.merged ? `<button class="btn-unmark-merged secondary" data-idx="${idx}">取消已彙整</button>` : ''}
          </div>
        `;
        container.appendChild(card);
    });

    container.querySelectorAll('.btn-read-custom').forEach(btn => {
        btn.addEventListener('click', () => openCustomArticlePlayback(parseInt(btn.dataset.idx)));
    });
    container.querySelectorAll('.btn-edit-custom').forEach(btn => {
        btn.addEventListener('click', () => openEditorPanel(parseInt(btn.dataset.idx)));
    });
    container.querySelectorAll('.btn-delete-custom').forEach(btn => {
        btn.addEventListener('click', () => deleteCustomArticle(parseInt(btn.dataset.idx)));
    });
    container.querySelectorAll('.btn-unmark-merged').forEach(btn => {
        btn.addEventListener('click', () => {
            const arts = loadCustomArticles();
            arts[parseInt(btn.dataset.idx)].merged = false;
            saveCustomArticles(arts);
            renderCustomArticlesList();
        });
    });
}

// --- Delete article ---
function deleteCustomArticle(idx) {
    if (!confirm('確定要刪除這篇文章嗎？')) return;
    // If currently editing this article, close panel first
    if (editingArticleIdx === idx) closeEditorPanel();
    const arts = loadCustomArticles();
    arts.splice(idx, 1);
    // BUG-04 修正：刪除後 idx 之後的所有索引往前移，editingArticleIdx 需同步更新
    if (editingArticleIdx > idx) {
        editingArticleIdx--;
    }
    saveCustomArticles(arts);
    renderCustomArticlesList();
    showNotification('文章已刪除');
}

// --- Placeholder for legacy save (not used in inline mode) ---
function saveCustomArticleFromModal() { saveFromEditorPanel(); }
function closeCustomArticleModal() { closeEditorPanel(); }
function openCustomArticleModal(idx = -1) { openEditorPanel(idx); }

// --- Read custom article (opens playback view in text-only mode) ---
function openCustomArticlePlayback(idx) {
    const arts = loadCustomArticles();
    const art = arts[idx];
    if (!art) return;

    // Stop any existing audio
    stopAudioAndReset();

    // Set up minimal state so notes work
    currentCategoryName = art.category || '自訂文章';
    currentStoryTitle = art.title;
    currentStoryList = [];      // No prev/next in custom mode
    currentStoryIndex = -1;

    playbackTitle.textContent = art.title;
    textContainer.innerHTML = '';
    textContainer.scrollTop = 0;
    progressBar.value = 0;

    // Hide audio controls — no mp3 yet
    const fixedControls = document.getElementById('fixed-controls-container');
    if (fixedControls) fixedControls.dataset.customMode = '1';

    // Render text only
    textContainer.appendChild(parafyAndMakeClickable('\n\n' + art.content, currentCategoryName, art.title));
    computeScrollMax();

    // Hide audio buttons, show text-only notice
    playPauseBtn.style.opacity = '0.3';
    playPauseBtn.style.pointerEvents = 'none';
    rewindBtn.style.opacity = '0.3';
    rewindBtn.style.pointerEvents = 'none';
    forwardBtn.style.opacity = '0.3';
    forwardBtn.style.pointerEvents = 'none';

    prevStoryBtn.hidden = true;
    nextStoryBtn.hidden = true;
    // Back button returns to custom articles view
    const backBtn = document.getElementById('back-to-category');
    backBtn._customArticleMode = true;

    showView(playbackView);
}

// Restore audio controls when leaving playback
function restoreAudioControls() {
    playPauseBtn.style.opacity = '';
    playPauseBtn.style.pointerEvents = '';
    rewindBtn.style.opacity = '';
    rewindBtn.style.pointerEvents = '';
    forwardBtn.style.opacity = '';
    forwardBtn.style.pointerEvents = '';
    const fixedControls = document.getElementById('fixed-controls-container');
    if (fixedControls) delete fixedControls.dataset.customMode;
    const backBtn = document.getElementById('back-to-category');
    if (backBtn) backBtn._customArticleMode = false;
}

// --- Export JSON ---
function exportCustomArticles() {
    const arts = loadCustomArticles();
    if (arts.length === 0) { alert('No custom articles to export.'); return; }

    // Export format: mapped to Excel columns
    const exportData = arts.map(a => ({
        '大類': a.major || '',
        '分類': a.category || '',
        '標題': a.title || '',
        '內文': a.content || '',
        'slug': a.slug || ''
    }));

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `custom-articles-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// --- Import JSON ---
// FIX-9: 加入深層驗證 + 匯入前自動備份現有資料
function _validateArticleItem(item) {
    // 深層驗證每筆資料結構是否正確
    const title   = item['標題'] || item.title || '';
    const content = item['內文'] || item.content || '';
    if (typeof title !== 'string' || title.trim().length === 0)   return false;
    if (typeof content !== 'string' || content.trim().length === 0) return false;
    return true;
}

function _backupCustomArticles(existing) {
    // 匯入前自動下載備份 JSON（靜默下載，不干擾流程）
    if (existing.length === 0) return;
    try {
        const blob = new Blob([JSON.stringify(existing, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `custom-articles-backup-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('[FIX-9] Backup downloaded before import.');
    } catch (e) {
        console.warn('[FIX-9] Backup download failed:', e);
    }
}

function importCustomArticles(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            // FIX-9: JSON 解析
            let data;
            try {
                data = JSON.parse(e.target.result);
            } catch (parseErr) {
                showNotification('❌ 匯入失敗：JSON 格式無效，請確認檔案內容。', 'error');
                return;
            }

            if (!Array.isArray(data)) {
                showNotification('❌ 匯入失敗：JSON 必須是陣列格式。', 'error');
                return;
            }

            // FIX-9: 深層驗證每筆資料
            const valid   = data.filter(_validateArticleItem);
            const invalid = data.length - valid.length;

            if (valid.length === 0) {
                showNotification('❌ 匯入失敗：所有項目都缺少「標題」或「內文」欄位。', 'error');
                return;
            }

            // FIX-9: 告知用戶有幾筆無效資料將被略過
            const invalidMsg = invalid > 0
                ? `\n（已略過 ${invalid} 筆格式不正確的資料）`
                : '';

            // FIX-9: 匯入前提示並提供備份
            const existing    = loadCustomArticles();
            const backupMsg   = existing.length > 0
                ? `\n\n現有 ${existing.length} 篇文章將保留（合併匯入），並自動下載備份。`
                : '';

            const confirmed = confirm(
                `即將匯入 ${valid.length} 篇文章。${invalidMsg}${backupMsg}\n\n確定繼續？`
            );
            if (!confirmed) return;

            // FIX-9: 自動下載備份
            if (existing.length > 0) {
                _backupCustomArticles(existing);
            }

            // 合併匯入（跳過 slug 重複）
            const existingSlugs = new Set(existing.map(a => a.slug));
            let added = 0;

            valid.forEach(item => {
                const title    = (item['標題'] || item.title || '').trim();
                const content  = (item['內文'] || item.content || '').trim();
                const major    = (item['大類'] || item.major || '').trim();
                const category = (item['分類'] || item.category || '').trim();
                // FIX-8: 匯入時也使用 ensureUniqueSlug 防止衝突
                const rawSlug  = (item['slug'] || item.slug || generateSlug(title));
                const slug     = ensureUniqueSlug(rawSlug, existingSlugs);

                existing.push({
                    id:        'custom-' + Date.now() + '-' + added,
                    title, major, category, content, slug,
                    merged:    false,
                    createdAt: new Date().toISOString()
                });
                existingSlugs.add(slug);
                added++;
            });

            saveCustomArticles(existing);
            renderCustomArticlesList();
            showNotification(
                `✅ 成功匯入 ${added} 篇文章${invalid > 0 ? `，略過 ${invalid} 筆無效資料` : ''}。`,
                'success'
            );
        } catch (err) {
            showNotification('❌ 匯入失敗：' + err.message, 'error');
            console.error('[FIX-9] Import error:', err);
        }
    };
    reader.readAsText(file);
}

// --- Merged detection (inline panel) ---
function checkMergedArticles() {
    const arts = loadCustomArticles();
    if (arts.length === 0) { showNotification('No custom articles', 'error'); return; }

    const officialSlugs = new Set(stories.map(s => s['標題']?.trim().toLowerCase()));

    const updatedArts = arts.map(a => {
        const isNowMerged = officialSlugs.has(a.slug.toLowerCase()) ||
                            officialSlugs.has(a.title?.trim().toLowerCase());
        return { ...a, merged: isNowMerged || a.merged };
    });

    saveCustomArticles(updatedArts);

    const panel = document.getElementById('merged-results-panel');
    const list = document.getElementById('merged-results-list');
    const mergedItems = updatedArts.filter(a => a.merged);

    list.innerHTML = '';

    if (mergedItems.length === 0) {
        list.innerHTML = '<p class="no-merged-msg">目前沒有偵測到已彙整的文章。</p>';
    } else {
        mergedItems.forEach(art => {
            const item = document.createElement('div');
            item.className = 'merged-modal-item';
            item.innerHTML = `
              <div class="merged-modal-item-info">
                <div class="merged-modal-item-title">${escapeHtml(art.title)}</div>
                <div class="merged-modal-item-slug">${escapeHtml(art.slug)}</div>
              </div>
              <div class="merged-modal-item-actions">
                <button class="btn-delete-merged secondary" data-id="${art.id}">刪除</button>
                <button class="btn-keep-merged secondary" data-id="${art.id}">保留</button>
              </div>
            `;
            list.appendChild(item);
        });

        list.querySelectorAll('.btn-delete-merged').forEach(btn => {
            btn.addEventListener('click', () => {
                const latest = loadCustomArticles();
                saveCustomArticles(latest.filter(a => a.id !== btn.dataset.id));
                renderCustomArticlesList();
                btn.closest('.merged-modal-item').remove();
                if (list.children.length === 0) {
                    list.innerHTML = '<p class="no-merged-msg">已全部處理完畢。</p>';
                }
            });
        });

        list.querySelectorAll('.btn-keep-merged').forEach(btn => {
            btn.addEventListener('click', () => {
                btn.closest('.merged-modal-item').remove();
                if (list.children.length === 0) {
                    list.innerHTML = '<p class="no-merged-msg">已全部處理完畢。</p>';
                }
            });
        });
    }

    panel.classList.remove('is-hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    renderCustomArticlesList();
}

// --- Event listeners ---
function initCustomArticles() {
    const customView = document.getElementById('custom-articles-view');

    document.getElementById('go-to-custom-articles')?.addEventListener('click', () => {
        closeEditorPanel();
        document.getElementById('merged-results-panel')?.classList.add('is-hidden');
        renderCustomArticlesList();
        showView(customView);
    });

    document.getElementById('back-to-home-from-custom')?.addEventListener('click', () => {
        closeEditorPanel();
        showView(homeView);
    });

    document.getElementById('add-custom-article-btn')?.addEventListener('click', () => {
        openEditorPanel(-1);
    });

    document.getElementById('export-custom-articles-btn')?.addEventListener('click', exportCustomArticles);

    document.getElementById('import-custom-articles-input')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) { importCustomArticles(file); e.target.value = ''; }
    });

    document.getElementById('check-merged-btn')?.addEventListener('click', checkMergedArticles);

    // Inline editor: slug live preview
    document.getElementById('editor-article-title')?.addEventListener('input', (e) => {
        const slug = generateSlug(e.target.value);
        document.getElementById('editor-slug-preview').textContent = slug || '—';
    });

    // Inline editor: save / cancel / close
    document.getElementById('editor-save-btn')?.addEventListener('click', saveFromEditorPanel);
    document.getElementById('editor-cancel-btn')?.addEventListener('click', closeEditorPanel);
    document.getElementById('editor-close-btn')?.addEventListener('click', closeEditorPanel);

    // Merged results panel close
    document.getElementById('merged-results-close-btn')?.addEventListener('click', () => {
        document.getElementById('merged-results-panel')?.classList.add('is-hidden');
    });

    updateCustomArticlesBadge();
}

// ============================================================
//  END CUSTOM ARTICLES FEATURE
// ============================================================

function init() {
  const noteWrapper = document.getElementById('note-content-wrapper');
  if (noteWrapper) {
      noteWrapper.addEventListener('click', (e) => {
          const header = e.target.closest('.note-section-header');
          if (header?.dataset.target) {
              const targetList = document.getElementById(header.dataset.target);
              if (targetList) {
                  header.classList.toggle('is-expanded');
                  targetList.style.display = targetList.style.display === 'none' ? '' : 'none';
              }
          }
      });
  }

  if (googleSigninBtn) googleSigninBtn.addEventListener('click', signIn);
  if (guestModeBtn) guestModeBtn.addEventListener('click', enterGuestMode);
  if (signOutBtn) signOutBtn.addEventListener('click', signOutUser);
  if (signInFromGuestBtn) signInFromGuestBtn.addEventListener('click', signIn);
 
  window.addEventListener('resize', computeScrollMax, { passive: true });
  initCustomArticles();
}

// ============================================================
//  ROUTER: hashchange 監聽 & restoreFromHash
// ============================================================

/**
 * 依照 URL hash 還原對應的畫面狀態。
 * 只在資料已載入（stories.length > 0）且使用者已通過 auth 後才會被呼叫。
 */
async function restoreFromHash(hash) {
    if (typeof Router === 'undefined') return;

    _routerRestoring = true; // 暫停 showView 內的 Router.push
    try {
        const state = Router.parseHash(hash);

        switch (state.view) {
            case 'major': {
                if (state.major) {
                    showSubCategories(state.major);
                } else {
                    renderMajorCategories();
                    showView(homeView);
                }
                break;
            }
            case 'category': {
                if (state.major && state.sub) {
                    currentMajorCategory = state.major;
                    showCategory(state.sub);
                } else {
                    renderMajorCategories();
                    showView(homeView);
                }
                break;
            }
            case 'story': {
                if (state.major && state.sub && stories.length > 0) {
                    // 重建 currentStoryList 以便 showPlayback 能找到正確的文章
                    currentMajorCategory = state.major;
                    currentCategoryName  = state.sub;
                    currentStoryList = stories.filter(item => {
                        const matchMajor = (item['大類'] || 'Uncategorized') === state.major;
                        const matchSub   = item['分類']?.map(c => c.trim()).includes(state.sub);
                        return matchMajor && matchSub;
                    }).sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));

                    const idx = Math.min(state.index, currentStoryList.length - 1);
                    if (idx >= 0 && currentStoryList.length > 0) {
                        await showPlayback(idx);
                    } else {
                        showCategory(state.sub);
                    }
                } else {
                    renderMajorCategories();
                    showView(homeView);
                }
                break;
            }
            case 'note': {
                renderNoteView('categories');
                showView(noteView);
                break;
            }
            case 'quiz': {
                if (typeof openQuiz === 'function') openQuiz(null, null);
                break;
            }
            case 'scores': {
                if (typeof openScoresDashboard === 'function') openScoresDashboard();
                break;
            }
            default: {
                renderMajorCategories();
                showView(homeView);
            }
        }
    } finally {
        _routerRestoring = false;
    }
}

// hashchange：使用者點擊瀏覽器「上一頁 / 下一頁」時觸發
window.addEventListener('hashchange', async () => {
    // 只在 app 已經初始化（使用者已登入）後才處理
    if (stories.length > 0) {
        await restoreFromHash(location.hash);
    }
});

// ============================================================
//  END OF ROUTER
// ============================================================

firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        try {
            const guestNotesRaw = localStorage.getItem(SAVED_WORDS_KEY);
            await loadWordsFromFirestore();
            await loadCustomArticlesFromFirestore();
            await loadAudioAdjustmentsFromFirestore();
            await loadQuizScoresFromFirestore();
            await loadItemScoresFromFirestore();
            // B-05 修正：合併前詢問使用者，選否則直接丟棄 Guest 資料
            if (guestNotesRaw) {
                const guestNotesParsed = JSON.parse(guestNotesRaw);
                const guestNotes = parseFirestoreData(guestNotesParsed);

                // 計算 Guest 筆記總筆數，讓使用者知道有多少資料
                let guestCount = 0;
                for (const cat in guestNotes) {
                    for (const title in guestNotes[cat]) {
                        const d = guestNotes[cat][title];
                        guestCount += (d.words?.size || 0) + (d.phrases?.size || 0) + (d.sentences?.size || 0);
                    }
                }

                const doMerge = guestCount > 0
                    ? confirm(`發現 Guest 模式留下的筆記（共 ${guestCount} 筆）。
要合併到你的帳號嗎？

選「確定」→ 合併
選「取消」→ 直接丟棄`)
                    : false;

                if (doMerge) {
                    savedWords = mergeNotes(guestNotes, savedWords);
                    await saveWordsToFirestore();
                    console.log('Merge successful and local guest notes cleared.');
                } else {
                    console.log('User declined merge. Guest notes discarded.');
                }
                // 不管選哪個，都清除本地 Guest 資料
                localStorage.removeItem(SAVED_WORDS_KEY);
            }
            await showAppView(user);
        } catch (error) {
            console.error("Critical error during user session initialization:", error);
            alert("Could not load your saved notes. Please check your internet connection and try again. Your notes will not be saved until the issue is resolved.");
            showLoginView(); 
        }
    } else {
        console.log("Auth state changed: User is logged out.");
        currentUser = null;
        savedWords = {};
        showLoginView();
    }
});

init();
// ── Timestamp highlight helpers ───────────────────────────────
/**
 * 回傳拆開的 { wordSet, phraseList } 供 timestamp 模式使用
 * phraseList 每項: { original, tokens[] }，已把儲存時的連字號還原為空格
 * 長 phrase 優先排前，避免短 phrase 搶先匹配
 */
function getSavedSetsForTimestamp(categoryName, titleName) {
    const wordSet    = new Set();
    const phraseList = [];
    if (!categoryName || !titleName) return { wordSet, phraseList };

    const storyData = savedWords[categoryName]?.[titleName];
    if (!storyData) return { wordSet, phraseList };

    if (storyData.words) {
        storyData.words.forEach(w => wordSet.add(w.toLowerCase().trim()));
    }
    if (storyData.phrases) {
        storyData.phrases.forEach(p => {
            const normalized = p.toLowerCase().trim().replace(/-/g, ' ');
            const tokens = normalized.split(/\s+/).filter(Boolean);
            if (tokens.length > 0) phraseList.push({ original: p, tokens });
        });
        phraseList.sort((a, b) => b.tokens.length - a.tokens.length);
    }
    return { wordSet, phraseList };
}

/**
 * 把一個句子的 word tokens 與 phraseList 比對
 * 回傳 annotation 陣列，長度同 tokens：
 *   { type: 'phrase', phraseOriginal, phraseText, role: 'start'|'mid'|'end'|'solo' }
 *   { type: 'word' }
 *   { type: 'none' }
 * tokens: 原始 token 陣列（含標點，不含空白）
 */
function annotateTokens(tokens, wordSet, phraseList) {
    const strip = t => t.replace(/^[.,?!:;'"`""''()[\]{}\-/*]+|[.,?!:;'"`""''()[\]{}\-/*]+$/g, '').toLowerCase();
    const n = tokens.length;
    const ann = Array.from({ length: n }, () => ({ type: 'none' }));

    // 先標記 phrase（長優先）
    const taken = new Array(n).fill(false);
    for (const ph of phraseList) {
        const pt = ph.tokens; // already lowercased, no punct
        for (let i = 0; i <= n - pt.length; i++) {
            if (taken[i]) continue;
            let match = true;
            for (let k = 0; k < pt.length; k++) {
                if (taken[i + k] || strip(tokens[i + k]) !== pt[k]) { match = false; break; }
            }
            if (match) {
                const phraseText = tokens.slice(i, i + pt.length).join(' ');
                for (let k = 0; k < pt.length; k++) {
                    taken[i + k] = true;
                    const role = pt.length === 1 ? 'solo'
                               : k === 0 ? 'start'
                               : k === pt.length - 1 ? 'end' : 'mid';
                    ann[i + k] = { type: 'phrase', phraseOriginal: ph.original, phraseText, role };
                }
            }
        }
    }

    // 再標記未被 phrase 佔用的 word
    for (let i = 0; i < n; i++) {
        if (!taken[i]) {
            const stripped = strip(tokens[i]);
            if (stripped && isWordSaved(tokens[i], wordSet)) {
                ann[i] = { type: 'word' };
            }
        }
    }
    return ann;
}
// 頁面載入時立即套用已儲存的閱讀字級（CSS 變數）
applyReadingFontSize(readingFontSize);
