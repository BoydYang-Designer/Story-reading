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
const exportWordsBtn = document.getElementById('export-words-btn');
const goToStoryNoteBtn = document.getElementById('go-to-story-note-btn');
const backToStoryFromNoteBtn = document.getElementById('back-to-story-from-note-btn');
const addWordForm = document.getElementById('add-word-form');
const newWordInput = document.getElementById('new-word-input');
const addManualWordBtn = document.getElementById('add-manual-word-btn');
// --- NEWLY ADDED ELEMENTS ---
// ===== MODIFIED LINE =====
const prevNoteBtn = document.getElementById('prev-note-btn');
const nextNoteBtn = document.getElementById('next-note-btn');
const noteViewTitleEl = document.getElementById('note-view-title');

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

// --- Mobile Seek Guard ---
// 手機 seek 時會觸發偽的 pause 事件；此旗標用來忽略該事件
// 用 counter 而不是 boolean，因為某些手機瀏覽器會在一次 seek 裡觸發兩個 pause
let isSeekingSkip = 0;

// --- New Timestamp State Variables ---
let isTimestampMode = false;
let timestampData = [];
let hasTimestampFile = false;
let lastHighlightedSentence = null;
let timestampUpdateRafId = null; // For smooth scrolling animation

// --- NEW State Variables for JSON Mode Highlighting ---
let jsonModeUpdateRafId = null;
let lastHighlightedWords = [];
let lastActiveSentenceStart = -1; // To track the current sentence

// Storage Keys
const LAST_SESSION_KEY = 'readingChallengeLastSession';
const SAVED_WORDS_KEY = 'readingChallengeSavedWordsV2';

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
    // 加入 subCategoryView 到隱藏列表
    [loginView, appContainer, homeView, subCategoryView, categoryView, playbackView, noteView].forEach(el => {
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
            newSavedWords[category][title] = {
                words: new Set(entry.words || []),
                phrases: new Set(entry.phrases || []),
                sentences: new Set(entry.sentences || [])
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
        const state = { title: currentStoryList[currentStoryIndex]['標題'], time: audio.currentTime };
        
        // 1. Save locally (as backup and for offline use)
        localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(state));

        // 2. === NEW: If logged in, sync to Cloud ===
        if (currentUser) {
            // Using merge: true to avoid overwriting the 'savedWords' field
            db.collection('userNotes').doc(currentUser.uid).set({ 
                lastSession: state 
            }, { merge: true }).catch(err => console.error("Error saving session to cloud:", err));
        }
        // ===========================================
    }
}

function clearLastPlaybackState() {
    localStorage.removeItem(LAST_SESSION_KEY);
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
    // Stop any currently playing snippet from this feature
    if (currentSnippetTimeout) {
        clearTimeout(currentSnippetTimeout);
        currentSnippetTimeout = null;
    }
    noteAudioPlayer.pause();

    // Also pause the main player if it's running
    if (isPlaying) {
        pauseAudio();
    }

    const timestampData = await getTimestampForStory(storyTitle);
    if (!timestampData || timestampData.length === 0) {
        showNotification(`Timestamp data not found for "${storyTitle}".`, 'error');
        return;
    }

    // Normalize sentence for better matching by removing punctuation and making it lowercase
    const normalize = (text) => text.trim().replace(/[.,?!'"`“”‘’]/g, '').toLowerCase();
    const normalizedSentence = normalize(sentenceText);

    const match = timestampData.find(line => normalize(line.sentence) === normalizedSentence);

    if (!match) {
        showNotification('Could not find the exact sentence in the story timestamp.', 'warning');
        console.warn(`No match found for: "${normalizedSentence}"`);
        return;
    }

    const { start, end } = match;
    const duration = (end - start) * 1000;

    // Check for invalid duration
    if (duration <= 0) {
        showNotification('Invalid timestamp duration for this sentence.', 'error');
        return;
    }
    
    // 修改前
    // return ['audio/' + encodeURIComponent(title.trim()) + '.mp3'];
    // 這裡您也已經有寫 trim() 了，所以音檔應該是可以播放的，主要是 Timestamp 讀取的部分漏了 trim()。
    
    // 正確設定音源
    const audioSrc = `audio/${encodeURIComponent(storyTitle.trim())}.mp3`;

    noteAudioPlayer.src = audioSrc;
    noteAudioPlayer.currentTime = start;
    
    noteAudioPlayer.play().catch(e => {
        console.error("Snippet play failed:", e);
        showNotification('Could not play audio for this sentence.', 'error');
    });

    // Set a timeout to stop playback precisely at the end time
    currentSnippetTimeout = setTimeout(() => {
        noteAudioPlayer.pause();
        currentSnippetTimeout = null;
    }, duration);
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
    
    // Explicitly hide form and buttons by default
    addWordForm.style.display = 'none'; // Ensure hidden in Categories/Titles
    backToStoryFromNoteBtn.hidden = true;
    exportWordsBtn.hidden = true;
    prevNoteBtn.hidden = true; 
    prevNoteBtn.onclick = null; 
    nextNoteBtn.hidden = true; 
    nextNoteBtn.onclick = null; 

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
                categories.forEach(category => createListItem(category, () => renderNoteView('titles', category), tempListContainer));
            }
            backToHomeFromNoteBtn.textContent = 'Back to Home';
            backToHomeFromNoteBtn.onclick = () => showView(homeView);
        } else { // level === 'titles'
            const titles = Object.keys(savedWords[categoryName] || {}).sort((a, b) => a.localeCompare(b));
            titles.forEach(title => createListItem(title, () => renderNoteView('words', categoryName, title), tempListContainer));
            backToHomeFromNoteBtn.textContent = 'Back to Categories';
            backToHomeFromNoteBtn.onclick = () => renderNoteView('categories');
        }
    } else if (level === 'words' && categoryName && titleName) {
        
        noteViewTitleEl.textContent = `Note: ${titleName}`; 
        
        // Show the input form ONLY in this view
        addWordForm.style.display = 'flex'; 

        // Helper function to build each collapsible section's HTML
        const buildSectionHTML = (type, title) => {
            const listId = `note-list-${type}`;
            const isExpanded = expansionStates ? expansionStates[listId] === true : false;
            const headerClass = isExpanded ? 'note-section-header is-expanded' : 'note-section-header';
            const listStyle = isExpanded ? '' : 'style="display: none;"';

            return `
                <div class="${headerClass}" data-target="${listId}"><h3>${title}</h3><span class="toggle-icon"></span></div>
                <div id="${listId}" class="list" ${listStyle}></div>
            `;
        };
        
        noteContentWrapper.innerHTML = `
            ${buildSectionHTML('words', 'Words')}
            ${buildSectionHTML('phrases', 'Phrases')}
            ${buildSectionHTML('sentences', 'Sentences')}
        `;
        
        noteViewCategory = categoryName;
        noteViewTitle = titleName;
        backToStoryFromNoteBtn.hidden = false;
        exportWordsBtn.hidden = false;

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
            voiceBtn.textContent = 'Voice';
            voiceBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (type === 'sentences') {
                    playSentenceSnippet(itemText, noteViewTitle);
                } else {
                    const audioSrc = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(itemText.trim())}.mp3`;
                    const wordAudio = new Audio(audioSrc);
                    wordAudio.play().catch(() => {
                        // 如果 MP3 播放失敗,使用 TTS
                        console.log(`Audio not found for "${itemText}", using TTS instead`);
                        speakText(itemText);
                    });
                }
            });
            actions.appendChild(voiceBtn);

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
        
        backToHomeFromNoteBtn.textContent = 'Back to Titles';
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

exportWordsBtn.addEventListener('click', () => {
    let allItems = [];
    for (const category in savedWords) {
        for (const title in savedWords[category]) {
            allItems = allItems.concat(
                Array.from(savedWords[category][title].words),
                Array.from(savedWords[category][title].phrases),
                Array.from(savedWords[category][title].sentences)
            );
        }
    }
    const uniqueItems = [...new Set(allItems)];
    if (uniqueItems.length === 0) {
        alert("No items to copy.");
        return;
    }
    const textToCopy = uniqueItems.sort((a, b) => a.localeCompare(b)).join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
        alert(`${uniqueItems.length} total items copied to clipboard.`);
    }).catch(err => alert('Could not copy items.'));
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

// NEW: Function to play audio for a saved word (with TTS fallback)
function playWordAudio(word) {
    const audioSrc = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(word.trim())}.mp3`;
    const wordAudio = new Audio(audioSrc);
    wordAudio.play().catch((error) => {
        console.log(`Audio not found for "${word}", using TTS instead:`, error);
        // 如果 MP3 播放失敗,使用 TTS 作為備用方案
        speakText(word);
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
            // 暫停時：點擊會將單字加入暫存區，不影響音訊
            const wordSpan = e.target.closest('.clickable-word');
            if (wordSpan) {
                const cleanedWord = cleanWord(wordSpan.textContent);
                if (cleanedWord) {
                    // NEW: If word is saved and player is paused, play its audio
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
                        // NEW: If word is not saved, use TTS to speak it
                        speakText(cleanedWord);
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
                // NEW: If word is saved and player is paused, play its audio
                if (!isPlaying && wordSpan.classList.contains('is-saved-word')) {
                    // Find the actual saved word form from notes
                    const savedForm = findSavedWordForm(cleanedWord, currentCategoryName, currentStoryTitle);
                    if (savedForm) {
                        playWordAudio(savedForm);
                    } else {
                        // Fallback to clicked word if not found
                        playWordAudio(cleanedWord);
                    }
                } else if (!isPlaying) {
                    // NEW: If word is not saved and player is paused, use TTS
                    speakText(cleanedWord);
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

// Playback content functions

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
    
    // --- 新增：先取得所有已存單字 ---
    const savedSet = getSavedWordsForCurrentStory(currentCategoryName, currentStoryTitle);
    // -----------------------------

    timestampData.forEach((line, index) => {
        const p = document.createElement('p');
        p.className = 'timestamp-sentence';
        p.dataset.start = line.start;
        p.dataset.end = line.end;
        p.dataset.tsIndex = index; // 新增：添加索引屬性

        line.sentence.split(/(\s+|—|–)/).forEach(part => {
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
function timestampUpdateLoop() {
    if (!isPlaying || !isTimestampMode || !isFinite(audio.duration) || audio.duration === 0) {
        timestampUpdateRafId = null;
        return;
    }

    const currentTime = audio.currentTime;
    
    // 1. Highlight Logic - 找到當前播放的句子索引
    let activeIndex = -1;
    for (let i = 0; i < timestampData.length; i++) {
        const line = timestampData[i];
        if (currentTime >= line.start && currentTime < line.end) {
            activeIndex = i;
            break;
        }
    }
    
    const sentenceElement = (activeIndex >= 0) ? textContainer.querySelector(`[data-ts-index="${activeIndex}"]`) : null;
    
    if (sentenceElement && sentenceElement !== lastHighlightedSentence) {
        if (lastHighlightedSentence) {
            lastHighlightedSentence.classList.remove('is-current');
        }
        sentenceElement.classList.add('is-current');
        lastHighlightedSentence = sentenceElement;
    }

    // 2. Predictive Smooth Scrolling Logic
    const progress = currentTime / audio.duration;
    const baseScrollTop = progress * scrollMax;
    let targetScrollTop = baseScrollTop;

    if (lastHighlightedSentence) {
        const containerHeight = textContainer.clientHeight;
        const sentenceTop = lastHighlightedSentence.offsetTop;
        const sentenceHeight = lastHighlightedSentence.offsetHeight;
        const correctiveScrollTop = sentenceTop - (containerHeight / 2) + (sentenceHeight / 2);
        
        const weight = 0.8;
        targetScrollTop = (baseScrollTop * (1 - weight)) + (correctiveScrollTop * weight);
    }
    
    const currentScrollTop = textContainer.scrollTop;
    const scrollDifference = targetScrollTop - currentScrollTop;
    textContainer.scrollTop += scrollDifference * 0.1;

    timestampUpdateRafId = requestAnimationFrame(timestampUpdateLoop);
}


// --- REVISED: Highlight and Scroll Logic for JSON Mode for Continuous Highlighting ---
function jsonModeHighlightLoop() {
    if (!isPlaying || isTimestampMode || !isFinite(audio.duration) || audio.duration === 0 || !hasTimestampFile) {
        jsonModeUpdateRafId = null;
        return;
    }

    const currentTime = audio.currentTime;

    let activeSentenceData = null;
    for (const line of timestampData) {
        if (currentTime >= line.start && currentTime < line.end) {
            activeSentenceData = line;
            break;
        }
    }

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

    // --- NEW: 持續平滑滾動邏輯 (此部分在每一幀都會執行) ---
    const progress = currentTime / audio.duration;
    const baseScrollTop = progress * scrollMax;
    let targetScrollTop = baseScrollTop;

    // 如果有高亮的單字，微調滾動目標，使其盡量保持在畫面中央
    if (lastHighlightedWords.length > 0) {
        const firstWord = lastHighlightedWords[0];
        const containerHeight = textContainer.clientHeight;
        const wordTop = firstWord.offsetTop;
        const wordHeight = firstWord.offsetHeight;
        
        // 計算能讓當前句子置中的滾動位置
        const correctiveScrollTop = wordTop - (containerHeight / 2) + (wordHeight / 2);
        
        // 混合預測性滾動和修正性滾動，讓句子置中佔較大權重
        const weight = 0.8; 
        targetScrollTop = (baseScrollTop * (1 - weight)) + (correctiveScrollTop * weight);
    }
    
    const currentScrollTop = textContainer.scrollTop;
    const scrollDifference = targetScrollTop - currentScrollTop;
    
    // 使用插值法實現平滑滾動效果
    textContainer.scrollTop += scrollDifference * 0.1;

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
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const secondsParts = parts[2].split('.');
    const seconds = parseInt(secondsParts[0], 10);
    const milliseconds = parseInt(secondsParts[1], 10);
    return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
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
            toggleTimestampBtn.style.display = hasTimestampFile ? 'flex' : 'none';
        } else {
            console.warn(`Timestamp file not found for "${title}" (404)`);
            hasTimestampFile = false;
            timestampData = [];
            toggleTimestampBtn.style.display = 'none';
        }
    } catch (error) { // 現在這裡正確了，因為前面有 try
        console.error("Error fetching timestamp file:", error);
        hasTimestampFile = false;
        timestampData = [];
        toggleTimestampBtn.style.display = 'none';
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
        const { title, time } = JSON.parse(lastSession);
        
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
                    <span>Continue: ${title}</span>
                    <span style="font-size: 0.9em; opacity: 0.8;">${minutes}:${seconds}</span>
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

  categories.forEach(category => {
    // 修改處：傳入 major 作為第三個參數 (fallback)
    // 如果找不到 category 的圖，就會去抓 major 的圖
    const item = createListItemWithImage(category, () => showCategory(category), major);
    subCategoryList.appendChild(item);
  });

  showView(subCategoryView);
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
  isTimestampMode = false;
  timestampData = [];
  hasTimestampFile = false;
  lastHighlightedSentence = null;
  toggleTimestampBtn.classList.remove('is-active');
  toggleTimestampBtn.style.display = 'none';
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

  // 根據是否保持模式來決定渲染哪個內容
  if (wasTimestampMode && hasTimestampFile) {
      // 保持 Timestamp 模式
      isTimestampMode = true;
      toggleTimestampBtn.classList.add('is-active');
      renderTimestampContent();
  } else {
      // 預設使用 JSON 模式
      isTimestampMode = false;
      toggleTimestampBtn.classList.remove('is-active');
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

  isTimestampMode = false;
  toggleTimestampBtn.classList.remove('is-active');
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

// --- Helper function to immediately highlight a sentence by index ---
function highlightSentenceByIndex(targetIndex) {
    if (!timestampData || targetIndex < 0 || targetIndex >= timestampData.length) return;
    
    // 移除舊的高亮
    if (lastHighlightedSentence) {
        lastHighlightedSentence.classList.remove('is-current');
    }
    
    // 添加新的高亮（使用 data-ts-index 而不是 data-start，更可靠）
    const targetSentence = textContainer.querySelector(`[data-ts-index="${targetIndex}"]`);
    if (targetSentence) {
        targetSentence.classList.add('is-current');
        lastHighlightedSentence = targetSentence;
        
        // 滾動到視窗中央
        const containerHeight = textContainer.clientHeight;
        const sentenceTop = targetSentence.offsetTop;
        const sentenceHeight = targetSentence.offsetHeight;
        const targetScrollTop = sentenceTop - (containerHeight / 2) + (sentenceHeight / 2);
        
        textContainer.scrollTop = targetScrollTop;
    }
}

// [Modified] story.js - skipToNextSentence
function skipToNextSentence() {
    if (!timestampData || timestampData.length === 0) return;
    
    const currentTime = audio.currentTime;
    // 檢查原生音訊狀態，確認是否正在播放中
    const wasPlaying = !audio.paused || isPlaying;

    // 1. 找出目前正在播放的句子索引
    let currentIndex = -1;
    for (let i = 0; i < timestampData.length; i++) {
        if (currentTime >= timestampData[i].start && currentTime < timestampData[i].end) {
            currentIndex = i;
            break;
        }
    }
    
    if (currentIndex === -1) {
        for (let i = 0; i < timestampData.length; i++) {
            if (timestampData[i].start <= currentTime) {
                currentIndex = i;
            } else {
                break;
            }
        }
    }

    // 2. 跳到下一句
    if (currentIndex < timestampData.length - 1) {
        const targetIndex = currentIndex + 1;
        const targetTime = timestampData[targetIndex].start;
        
        // 手機修補：增加計數器數值，確保能忽略手機跳轉時產生的一連串暫停訊號
        if (wasPlaying) isSeekingSkip = 5; 
        
        // 更新 UI 高亮
        highlightSentenceByIndex(targetIndex);
        
        // 更新音訊時間
        audio.currentTime = targetTime;

        // 【關鍵修正】手機上必須明確再次呼叫 play()，否則會卡住
        if (wasPlaying) {
            const playPromise = audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.log("Auto-resume failed (mobile restriction):", error);
                    // 如果自動播放失敗，確保 UI 狀態同步為暫停
                    isPlaying = false;
                    playPauseBtn.classList.remove('is-playing');
                });
            }
        }
    } else {
        // 已經是最後一句，跳到末尾
        audio.currentTime = audio.duration;
    }
}

// [Modified] story.js - skipToPrevSentence
function skipToPrevSentence() {
    if (!timestampData || timestampData.length === 0) return;

    const currentTime = audio.currentTime;
    // 檢查原生音訊狀態
    const wasPlaying = !audio.paused || isPlaying;
    
    // 1. 找出目前正在播放的句子索引
    let currentIndex = -1;
    for (let i = 0; i < timestampData.length; i++) {
        if (currentTime >= timestampData[i].start && currentTime < timestampData[i].end) {
            currentIndex = i;
            break;
        }
    }
    
    if (currentIndex === -1) {
        for (let i = 0; i < timestampData.length; i++) {
            if (timestampData[i].start <= currentTime) {
                currentIndex = i;
            } else {
                break;
            }
        }
    }

    // 手機修補：設定較高的忽略計數
    if (wasPlaying) isSeekingSkip = 5;

    if (currentIndex === -1) {
        highlightSentenceByIndex(0);
        audio.currentTime = 0;
        if (wasPlaying) audio.play().catch(e => console.log(e));
        return;
    }

    const currentSent = timestampData[currentIndex];
    let targetTime = 0;
    let targetIndex = 0;

    // 2. 判斷邏輯
    if (currentTime > currentSent.start + 1.5) {
        // 重聽當前句
        targetIndex = currentIndex;
        targetTime = currentSent.start;
    } else {
        if (currentIndex > 0) {
            // 跳到前一句
            targetIndex = currentIndex - 1;
            targetTime = timestampData[targetIndex].start;
        } else {
            // 已經是第一句，回到開頭
            targetIndex = 0;
            targetTime = 0;
        }
    }

    // 更新 UI
    highlightSentenceByIndex(targetIndex);
    
    // 更新音訊
    audio.currentTime = targetTime;

    // 【關鍵修正】強制恢復播放
    if (wasPlaying) {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                console.log("Auto-resume failed:", error);
            });
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
prevStoryBtn.addEventListener('click', () => { if (currentStoryIndex > 0) { showPlayback(currentStoryIndex - 1, 0, isTimestampMode); } });
// ===== MODIFIED LINE =====
nextStoryBtn.addEventListener('click', () => { if (currentStoryIndex < currentStoryList.length - 1) { showPlayback(currentStoryIndex + 1, 0, isTimestampMode); } });

toggleTimestampBtn.addEventListener('click', () => {
    if (!hasTimestampFile) {
        alert('無 Timestamp');
        return;
    }
    isTimestampMode = !isTimestampMode;
    toggleTimestampBtn.classList.toggle('is-active', isTimestampMode);

    if (isTimestampMode) {
        stopJsonModeHighlightLoop();
        lastHighlightedWords.forEach(span => span.classList.remove('is-current-sentence', 'highlight-start', 'highlight-end'));
        lastHighlightedWords = [];
        lastActiveSentenceStart = -1;
        
        renderTimestampContent();
        if (isPlaying) timestampUpdateLoop();
    } else {
        stopTimestampUpdateLoop();
        
        const story = currentStoryList[currentStoryIndex];
        textContainer.innerHTML = '';
        textContainer.appendChild(parafyAndMakeClickable('\n\n' + story['內文'], currentCategoryName, currentStoryTitle));
        lastHighlightedSentence = null;
        computeScrollMax();
        
        if (isPlaying) jsonModeHighlightLoop();
    }
});

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
    // seek 結束後清除任何殘留的 counter，避免吃掉之後真正的 pause
    isSeekingSkip = 0;
    if (isTimestampMode) {
        timestampUpdateLoop();
    } else {
        jsonModeHighlightLoop();
    }
});

audio.addEventListener('pause', () => { 
    // --- 手機修補：seek 時觸發的偽 pause 事件，直接忽略 ---
    // counter > 0 表示還在 seek 視窗內，每次觸發減一，直到歸零才處理真的 pause
    if (isSeekingSkip > 0) {
        isSeekingSkip--;
        return;
    }
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
    if (isTimestampMode) {
        if (lastHighlightedSentence) {
            lastHighlightedSentence.classList.remove('is-current');
            lastHighlightedSentence = null;
        }
    } else {
        lastHighlightedWords.forEach(span => span.classList.remove('is-current-sentence', 'highlight-start', 'highlight-end'));
        lastHighlightedWords = [];
        lastActiveSentenceStart = -1;
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
progressBar.addEventListener('input', () => { if (isFinite(audio.duration)) audio.currentTime = (progressBar.value / 100) * audio.duration; });

document.addEventListener('keydown', (event) => {
  if (!playbackView.classList.contains('is-hidden')) {
    if (event.target.tagName === 'INPUT') return;
    if (event.code === 'Space') { event.preventDefault(); playPauseBtn.click(); }
    if (event.code === 'ArrowLeft') { event.preventDefault(); rewindBtn.click(); }
    if (event.code === 'ArrowRight') { event.preventDefault(); forwardBtn.click(); }
  }
});

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
}

firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;
        try {
            const guestNotesRaw = localStorage.getItem(SAVED_WORDS_KEY);
            await loadWordsFromFirestore();
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

// ===== TTS (Text-to-Speech) Functions =====
// 使用瀏覽器內建的 Web Speech API 來朗讀文字

/**
 * 使用 TTS 朗讀指定文字
 * @param {string} text - 要朗讀的文字
 */
function speakText(text) {
    // 1. 如果有正在播放的語音,先停止
    window.speechSynthesis.cancel();

    // 2. 建立發音請求
    const utterance = new SpeechSynthesisUtterance(text);
    
    // 3. 設定語言 (英文)
    utterance.lang = 'en-US'; 
    
    // 4. 設定速度 (1 為正常速度)
    utterance.rate = 1.0; 
    
    // 5. 播放
    window.speechSynthesis.speak(utterance);
}

/**
 * 從點擊座標抓取該位置的單字
 * @param {number} x - 點擊的 X 座標
 * @param {number} y - 點擊的 Y 座標
 * @returns {string|null} - 回傳單字文字,如果沒有則回傳 null
 */
function getWordAtPoint(x, y) {
    let range;
    let textNode;
    let offset;

    // 標準瀏覽器方法 (Chrome, Edge, Firefox, Safari)
    if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(x, y);
        if (!range) return null;
        textNode = range.startContainer;
        offset = range.startOffset;
    } else if (document.caretPositionFromPoint) { // Firefox fallback
        const rangePosition = document.caretPositionFromPoint(x, y);
        if (!rangePosition) return null;
        textNode = rangePosition.offsetNode;
        offset = rangePosition.offset;
    } else {
        return null;
    }

    // 確保點擊的是文字節點 (Text Node)
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return null;

    const data = textNode.textContent;
    
    // 往回找單字起點
    let start = offset;
    while (start > 0 && isWordChar(data.charAt(start - 1))) {
        start--;
    }
    
    // 往後找單字終點
    let end = offset;
    while (end < data.length && isWordChar(data.charAt(end))) {
        end++;
    }

    const word = data.slice(start, end);
    // 過濾掉空白或標點符號的誤點擊
    if (word.trim().length > 0) {
        return word.trim();
    }
    return null;
}

/**
 * 判斷字元是否為單字的一部分
 * @param {string} char - 要檢查的字元
 * @returns {boolean} - 是否為單字字元
 */
function isWordChar(char) {
    // 包含字母、數字、連字符、撇號和重音字母
    return /^[a-zA-Z0-9\-\u00C0-\u00FF']$/.test(char);
}

init();