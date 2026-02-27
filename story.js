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
const categoryList = document.getElementById('category-list');
const categoryTitle = document.getElementById('category-title');
const titleList = document.getElementById('title-list');
const playbackTitle = document.getElementById('playback-title');
const textContainer = document.getElementById('text-container');
const audio = document.getElementById('audio');
const backToCategoryBtn = document.getElementById('back-to-category');
const playPauseBtn = document.getElementById('play-pause');
const backToHomeBtn = document.getElementById('back-to-home');
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

// --- New Timestamp Feature Element ---
const toggleTimestampBtn = document.getElementById('toggle-timestamp-btn');


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
let timestampData = [];
let hasTimestampFile = false;
let lastHighlightedSentence = null;
let timestampUpdateRafId = null; // For smooth scrolling animation

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
function setAudioTimeAccurate(targetTime, maxRetries = 3) {
    const isMobile = isMobileDevice();
    
    // 手機裝置：提前 0.3 秒以補償定位誤差
    // PC 裝置：提前 0.1 秒（較精確）
    const bufferTime = isMobile ? 0.3 : 0.1;
    const adjustedTime = Math.max(0, targetTime - bufferTime);
    
    console.log(`[Time Set] Target: ${targetTime.toFixed(3)}s, Adjusted: ${adjustedTime.toFixed(3)}s (Mobile: ${isMobile})`);
    
    // 第一次設定
    audio.currentTime = adjustedTime;
    
    // 驗證機制：檢查是否設定成功
    let retryCount = 0;
    const verifyInterval = setInterval(() => {
        const actualTime = audio.currentTime;
        const timeDiff = Math.abs(actualTime - adjustedTime);
        
        // 如果誤差超過 0.5 秒，重新設定
        if (timeDiff > 0.5 && retryCount < maxRetries) {
            console.warn(`[Time Set Retry ${retryCount + 1}] Expected: ${adjustedTime.toFixed(3)}s, Got: ${actualTime.toFixed(3)}s`);
            audio.currentTime = adjustedTime;
            retryCount++;
        } else {
            clearInterval(verifyInterval);
            if (timeDiff > 0.5) {
                console.error(`[Time Set Failed] After ${maxRetries} retries, still off by ${timeDiff.toFixed(3)}s`);
            } else {
                console.log(`[Time Set Success] Positioned at ${actualTime.toFixed(3)}s`);
            }
        }
    }, 100); // 每 100ms 檢查一次
    
    // 5 秒後清除驗證機制（避免永久運行）
    setTimeout(() => clearInterval(verifyInterval), 5000);
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
    
    // Hide all internal app views as a cleanup step
    [homeView, categoryView, playbackView, noteView].forEach(el => {
        el.classList.add('is-hidden');
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

    showView(homeView); // Default to home view
}

function createListItemWithImage(text, onClick, fallbackText = null) {
    const container = document.createElement('div');
    container.className = 'list-item-with-image'; 

    const img = document.createElement('img');
    img.className = 'category-thumb';
    img.alt = text;
    
    // 設定初始狀態
    img.dataset.tryState = 'main-jpg'; 
    img.src = `images/${text}.jpg`; 

    // 錯誤處理：依序嘗試 JPG -> PNG -> Fallback JPG -> Fallback PNG -> 隱藏
    img.onerror = function() {
        const state = this.dataset.tryState;

        if (state === 'main-jpg') {
            // 1. 本名 JPG 失敗 -> 試試 本名 PNG
            this.dataset.tryState = 'main-png';
            this.src = `images/${text}.png`;
        } 
        else if (state === 'main-png') {
            // 2. 本名 PNG 失敗 -> 如果有備用字(上一層)，試試 上一層 JPG
            if (fallbackText) {
                this.dataset.tryState = 'fallback-jpg';
                this.src = `images/${fallbackText}.jpg`;
            } else {
                this.classList.add('img-hidden');
            }
        } 
        else if (state === 'fallback-jpg') {
            // 3. 上一層 JPG 失敗 -> 試試 上一層 PNG
            this.dataset.tryState = 'fallback-png';
            this.src = `images/${fallbackText}.png`;
        } 
        else {
            // 4. 全部都失敗 -> 隱藏圖片
            this.classList.add('img-hidden');
        }
    };

    const span = document.createElement('span');
    span.textContent = text;

    container.appendChild(img);
    container.appendChild(span);

    container.addEventListener('click', onClick);

    return container;
}

function showView(view) {
    const customArticlesView = document.getElementById('custom-articles-view');
    const quizView = document.getElementById('quiz-view');
    const scoresDashboardView = document.getElementById('scores-dashboard-view');
    const audioEditorManagerView = document.getElementById('audio-editor-manager-view');
    const itemDetailView = document.getElementById('item-detail-view');
    // 加入 subCategoryView 和 dataManagerView 到隱藏列表
    [loginView, appContainer, homeView, subCategoryView, categoryView, playbackView, noteView, dataManagerView, customArticlesView, quizView, scoresDashboardView, audioEditorManagerView, itemDetailView].forEach(el => {
        if(el) el.classList.add('is-hidden');
    });
    
    // 特殊處理：appContainer 總是包含這些內部視圖
    if (view !== loginView) {
        appContainer.classList.remove('is-hidden');
    }
    
    view.classList.remove('is-hidden');
    document.body.classList.toggle('note-view-active', view === noteView);
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
                localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(data.lastSession));
                console.log("Last session synced from Cloud:", data.lastSession);
            }
            // 3. === Sync Sub Category Sessions ===
            if (data.subCategorySessions) {
                localStorage.setItem(SUB_CATEGORY_SESSION_KEY, JSON.stringify(data.subCategorySessions));
                console.log("Sub category sessions synced from Cloud:", data.subCategorySessions);
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

function saveWordsToStorage() {
    const serializableWords = serializeDataForStorage(savedWords);
    localStorage.setItem(SAVED_WORDS_KEY, JSON.stringify(serializableWords));
    console.log("Notes saved to Local Storage.");
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
        
        // 1. Save globally (最新的播放記錄)
        localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(state));

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
                localStorage.setItem(SUB_CATEGORY_SESSION_KEY, JSON.stringify(subCategorySessions));
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
            localStorage.setItem(SUB_CATEGORY_SESSION_KEY, JSON.stringify(subCategorySessions));
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
    if (timestampCache[title]) {
        return timestampCache[title];
    }
    
const url = `https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/audio/${encodeURIComponent(title.trim())} Timestamp.txt`;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const text = await response.text();
            const data = parseTimestampText(text); // Uses existing parser
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
                    playSentenceSnippet(itemText, noteViewTitle);

                    // Listen for playback end to restore button
                    const restoreOnEnd = () => {
                        voiceBtn.classList.remove('is-playing-voice');
                        noteAudioPlayer.removeEventListener('pause', restoreOnEnd);
                        noteAudioPlayer.removeEventListener('ended', restoreOnEnd);
                    };
                    noteAudioPlayer.addEventListener('pause', restoreOnEnd, { once: true });
                    noteAudioPlayer.addEventListener('ended', restoreOnEnd, { once: true });
                } else {
                    const audioSrc = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(itemText.trim())}.mp3`;
                    const wordAudio = new Audio(audioSrc);
                    wordAudio.play().catch(() => {
                        voiceBtn.classList.remove('is-playing-voice');
                        showNotification(`Audio for "${itemText}" was not found.`, 'error');
                    });
                    wordAudio.addEventListener('ended', () => {
                        voiceBtn.classList.remove('is-playing-voice');
                    }, { once: true });
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

// NEW: Function to play audio for a saved word
function playWordAudio(word) {
    const audioSrc = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(word.trim())}.mp3`;
    const wordAudio = new Audio(audioSrc);
    
    wordAudio.play().catch((error) => {
        console.log(`Audio not found for "${word}", using TTS fallback:`, error);
        // 使用 Web Speech API 作為備用方案
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(word.trim());
            utterance.lang = 'en-US'; // 設定為英文發音
            utterance.rate = 0.9; // 稍微慢一點，讓發音更清楚
            window.speechSynthesis.speak(utterance);
        } else {
            showNotification(`Audio for "${word}" was not found and TTS is not supported.`, 'error');
        }
    });
}

textContainer.addEventListener('click', (e) => {
    // 忽略使用者用滑鼠選取/反白文字時的點擊
    if (window.getSelection().toString().length > 0) return;

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
                stagedWordsContainer.appendChild(stagedWordEl);
            }
        }
    }
});


stagedWordsContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('staged-word')) e.target.remove();
});

clearStagingBtn.addEventListener('click', () => {
    stagedWordsContainer.innerHTML = '';
});

addToNoteBtn.addEventListener('click', () => {
    const stagedWords = Array.from(stagedWordsContainer.querySelectorAll('.staged-word'));
    if (stagedWords.length === 0) return;
    const textToAdd = stagedWords.map(el => el.textContent).join(' ');
    if (textToAdd) {
        addWordToNote(textToAdd, currentCategoryName, currentStoryTitle);
        navigator.clipboard.writeText(textToAdd);
        stagedWordsContainer.innerHTML = '';
    }
});

// --- 新增 Back to Titles 邏輯 ---
if (backToCategoryBtn) {
    backToCategoryBtn.addEventListener('click', () => {
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

// NEW: Play a sentence snippet from the main audio (startTime to endTime)
let snippetStopTimeout = null;

function playAudioSnippet(startTime, endTime) {
    // Clear any existing snippet stop timer
    if (snippetStopTimeout) {
        clearTimeout(snippetStopTimeout);
        snippetStopTimeout = null;
    }
    
    // Only works if main audio is loaded and not currently playing the full story
    if (!isFinite(audio.duration) || isPlaying) return;
    
    const duration = endTime - startTime;
    if (duration <= 0) return;
    
    audio.currentTime = startTime;
    audio.play().then(() => {
        // Stop after the snippet duration
        snippetStopTimeout = setTimeout(() => {
            audio.pause();
            audio.currentTime = startTime; // reset to snippet start
            snippetStopTimeout = null;
        }, duration * 1000 + 100); // small buffer for smoothness
    }).catch(e => {
        console.warn('Snippet playback failed:', e);
    });
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
    });
    textContainer.appendChild(frag);
    lastHighlightedSentence = null;
    computeScrollMax();
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
    alert('Audio file not found.');
    playPauseBtn.classList.remove('is-playing');
    isPlaying = false;
    return;
  }
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

function computeScrollTarget(element) {
    const containerRect = textContainer.getBoundingClientRect();
    const elemRect = element.getBoundingClientRect();
    const targetPosition = textContainer.clientHeight * 0.08;
    return elemRect.top - containerRect.top + textContainer.scrollTop - targetPosition;
}

function smoothScrollTo(target, instant = false) {
    const clamped = Math.max(0, Math.min(target, scrollMax));
    if (instant) {
        textContainer.style.scrollBehavior = 'auto';
        textContainer.scrollTop = clamped;
        // restore smooth after one frame
        requestAnimationFrame(() => { textContainer.style.scrollBehavior = ''; });
    } else {
        textContainer.style.scrollBehavior = 'smooth';
        textContainer.scrollTop = clamped;
    }
}

function timestampUpdateLoop() {
    if (!isPlaying || !isTimestampMode || !isFinite(audio.duration) || audio.duration === 0) {
        timestampUpdateRafId = null;
        return;
    }

    const currentTime = audio.currentTime;
    
    // Binary search highlight
    const idx = findActiveSentenceIndex(currentTime);
    const activeSentence = idx !== -1 ? timestampData[idx] : null;
    const sentenceElement = activeSentence
        ? textContainer.querySelector(`[data-start="${activeSentence.start}"]`)
        : null;
    
    if (sentenceElement && sentenceElement !== lastHighlightedSentence) {
        if (lastHighlightedSentence) lastHighlightedSentence.classList.remove('is-current');
        sentenceElement.classList.add('is-current');
        lastHighlightedSentence = sentenceElement;

        // Recompute scroll target only when sentence changes
        cachedScrollTarget = computeScrollTarget(sentenceElement);
        smoothScrollTo(cachedScrollTarget);

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
    const minutes = parseInt(parts[1], 10);
    const seconds = parseInt(secondsParts[0], 10);
    const milliseconds = parseInt(secondsParts[1], 10);
    return (minutes * 60) + seconds + (milliseconds / 1000);
}

function parseTimestampText(text) {
    const lines = text.trim().split('\n');
    const data = [];
    const regex = /\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\](.*)/;
    const shortRegex = /\[(\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}\.\d{3})\](.*)/;

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
            data.push({
                start: timeToSeconds(match[1]),
                end: timeToSeconds(match[2]),
                sentence: match[3].trim()
            });
        }
    }
    return data;
}



// === 修正後的正確版本 ===
async function loadTimestampForStory(title) {
const url = `https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/audio/${encodeURIComponent(title.trim())} Timestamp.txt`;

    try {  // <--- 【請補上這一行】
        const response = await fetch(url);
        if (response.ok) {
            const text = await response.text();
            timestampData = parseTimestampText(text);
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
        renderCategories();
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
    const itemEl = createListItemWithImage(item['標題'], () => showPlayback(index), category);
    titleList.appendChild(itemEl);
  });
  
  showView(categoryView);
}

// ===== MODIFIED FUNCTION =====
async function showPlayback(index, startTime = 0, maintainTimestampMode = false) {
  // 儲存切換前的模式狀態
  const wasTimestampMode = maintainTimestampMode && isTimestampMode;

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
  stagedWordsContainer.innerHTML = '';

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

  // Always use timestamp mode; fallback to plain text if no timestamp file
  if (hasTimestampFile) {
      renderTimestampContent();
  } else {
      textContainer.appendChild(parafyAndMakeClickable('\n\n' + story['內文'], currentCategoryName, currentStoryTitle));
  }

  // 設定音訊來源
  setAudioSourceWithFallback(currentStoryTitle);

  const onLoaded = () => {
    audio.removeEventListener('canplaythrough', onLoaded); // 立即移除監聽器
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
  audio.addEventListener('canplaythrough', onLoaded);

  showView(playbackView);
}
// ===== END OF MODIFIED FUNCTION =====

function stopAudioAndReset() {
  stagedWordsContainer.innerHTML = '';
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

  isTimestampMode = true;
  lastHighlightedSentence = null;
  lastHighlightedWords = [];
  lastActiveSentenceStart = -1;
}

function pauseAudio() {
    audio.pause();
    isPlaying = false;
    playPauseBtn.classList.remove('is-playing');
    saveLastPlaybackState();
    stopTimestampUpdateLoop();
    stopJsonModeHighlightLoop();
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

    // 2. 判斷邏輯：
    // 手機裝置：放寬到 2.0 秒（因為觸控操作較慢）
    // PC 裝置：維持 1.5 秒
    // 如果播放超過該句開頭一定時間，按「上一句」通常是想「重聽這一句」。
    // 如果剛開始播放不久，按「上一句」才是真的跳到「前一句」。
    const threshold = isMobileDevice() ? 2.0 : 1.5;
    
    if (currentTime > currentSent.start + threshold) {
        setAudioTimeAccurate(currentSent.start); // 使用改進的時間設定函數
    } else {
        if (currentIndex > 0) {
            setAudioTimeAccurate(timestampData[currentIndex - 1].start); // 使用改進的時間設定函數
        } else {
            audio.currentTime = 0;
        }
    }
}

// Button listeners
if (backToHomeBtn) {
    backToHomeBtn.addEventListener('click', () => { stopAudioAndReset(); showView(homeView); });
}

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
        pauseAudio();
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
    saveLastPlaybackState();
    // Clear any pending snippet stop timer when full playback starts
    if (snippetStopTimeout) {
        clearTimeout(snippetStopTimeout);
        snippetStopTimeout = null;
    }
    if (isTimestampMode && hasTimestampFile) {
        timestampUpdateLoop();
    }
});

audio.addEventListener('pause', () => { 
    if (isPlaying) {
        pauseAudio();
    }
});

// ===== MODIFIED EVENT LISTENER =====
audio.addEventListener('ended', () => {
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

audio.addEventListener('timeupdate', () => { 
    if (isFinite(audio.duration)) progressBar.value = (audio.currentTime / audio.duration) * 100;
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
    localStorage.setItem(CUSTOM_ARTICLES_KEY, JSON.stringify(articles));
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
            localStorage.setItem(CUSTOM_ARTICLES_KEY, JSON.stringify(doc.data().customArticles));
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
        heading.textContent = '新增文章';
        titleInput.value = '';
        majorInput.value = '';
        categoryInput.value = '';
        contentInput.value = '';
        slugPreview.textContent = '—';
    } else {
        const arts = loadCustomArticles();
        const art = arts[idx];
        heading.textContent = '編輯文章';
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
    const slug = generateSlug(title);

    if (editingArticleIdx === -1) {
        arts.push({
            id: 'custom-' + Date.now(),
            title, major, category, content, slug,
            merged: false,
            createdAt: new Date().toISOString()
        });
        showNotification('文章已新增', 'success');
    } else {
        const existing = arts[editingArticleIdx];
        arts[editingArticleIdx] = {
            ...existing,
            title, major, category, content,
            slug: title === existing.title ? existing.slug : slug,
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
        container.innerHTML = '<p style="color:var(--color-text-light);text-align:center;padding:30px 0;">還沒有自訂文章。點擊「新增文章」開始。</p>';
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
    if (arts.length === 0) { alert('沒有自訂文章可以匯出。'); return; }

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
function importCustomArticles(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) throw new Error('JSON 必須是陣列');

            const existing = loadCustomArticles();
            const existingSlugs = new Set(existing.map(a => a.slug));
            let added = 0;

            data.forEach(item => {
                // Accept both "export format" and "internal format"
                const title = item['標題'] || item.title || '';
                const content = item['內文'] || item.content || '';
                const major = item['大類'] || item.major || '';
                const category = item['分類'] || item.category || '';
                const slug = item['slug'] || item.slug || generateSlug(title);

                if (!title || !content) return;
                if (existingSlugs.has(slug)) return; // Skip duplicates

                existing.push({
                    id: 'custom-' + Date.now() + '-' + added,
                    title, major, category, content, slug,
                    merged: false,
                    createdAt: new Date().toISOString()
                });
                existingSlugs.add(slug);
                added++;
            });

            saveCustomArticles(existing);
            renderCustomArticlesList();
            alert(`成功匯入 ${added} 篇文章。`);
        } catch (err) {
            alert('匯入失敗：' + err.message);
        }
    };
    reader.readAsText(file);
}

// --- Merged detection (inline panel) ---
function checkMergedArticles() {
    const arts = loadCustomArticles();
    if (arts.length === 0) { showNotification('沒有自訂文章', 'error'); return; }

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
            if (guestNotesRaw) {
                console.log("Found guest notes in local storage. Merging...");
                const guestNotesParsed = JSON.parse(guestNotesRaw);
                const guestNotes = parseFirestoreData(guestNotesParsed);
                savedWords = mergeNotes(guestNotes, savedWords);
                await saveWordsToFirestore();
                localStorage.removeItem(SAVED_WORDS_KEY);
                console.log("Merge successful and local guest notes cleared.");
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
