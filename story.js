/* Reading Challenge SPA */

// App Views
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
const categoryList = document.getElementById('category-list');
const categoryTitle = document.getElementById('category-title');
const titleList = document.getElementById('title-list');
const playbackTitle = document.getElementById('playback-title');
const textContainer = document.getElementById('text-container');
const audio = document.getElementById('audio');
const playPauseBtn = document.getElementById('play-pause');
const backToHomeBtn = document.getElementById('back-to-home');
const backToCategoryBtn = document.getElementById('back-to-category');
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

// State Variables
let stories = [];
let vocabularyData = [];
let isPlaying = false;
let rafId = null;
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

// --- New Timestamp State Variables ---
let isTimestampMode = false;
let timestampData = [];
let hasTimestampFile = false;
let lastHighlightedSentence = null;
let timestampUpdateRafId = null; // For smooth scrolling animation

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
        await loadData(); // <--- 更新函式名稱
    }
    renderCategories();
    showView(homeView); // Default to home view
}


function showView(view) {
    [homeView, categoryView, playbackView, noteView].forEach(el => {
        el.classList.add('is-hidden');
    });
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

async function loadWordsFromFirestore() {
    if (!currentUser) {
        console.log("User not logged in, cannot load from Firestore.");
        savedWords = {}; 
        return; // Keep this part
    }
    try {
        const docRef = db.collection('userNotes').doc(currentUser.uid);
        const doc = await docRef.get();
        if (doc.exists) {
            const firestoreData = doc.data().savedWords || {};
            savedWords = parseFirestoreData(firestoreData);
            console.log("Notes loaded from Firestore.");
        } else {
            console.log("No notes found in Firestore for this user.");
            savedWords = {};
        }
    } catch (error) {
        console.error("Error loading notes from Firestore:", error);
        // 不要在這裡清空 savedWords，而是向上拋出錯誤
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

function saveLastPlaybackState() {
    if (currentStoryIndex > -1 && currentStoryList[currentStoryIndex]) {
        const state = { title: currentStoryList[currentStoryIndex]['標題'], time: audio.currentTime };
        localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(state));
    }
}

function clearLastPlaybackState() {
    localStorage.removeItem(LAST_SESSION_KEY);
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


function renderNoteView(level = 'categories', categoryName = null, titleName = null) {
    const noteContentWrapper = document.getElementById('note-content-wrapper');
    addWordForm.hidden = true;
    backToStoryFromNoteBtn.hidden = true;
    exportWordsBtn.hidden = true;

    const createListItem = (text, clickHandler, container) => {
        const item = document.createElement('div');
        item.className = 'category-item';
        item.textContent = text;
        item.addEventListener('click', clickHandler);
        container.appendChild(item);
    };

    if (level === 'categories' || level === 'titles') {
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
        noteContentWrapper.innerHTML = `
            <div class="note-section-header is-expanded" data-target="note-list-words"><h3>Words</h3><span class="toggle-icon"></span></div>
            <div id="note-list-words" class="list"></div>
            <div class="note-section-header is-expanded" data-target="note-list-phrases"><h3>Phrases</h3><span class="toggle-icon"></span></div>
            <div id="note-list-phrases" class="list"></div>
            <div class="note-section-header is-expanded" data-target="note-list-sentences"><h3>Sentences</h3><span class="toggle-icon"></span></div>
            <div id="note-list-sentences" class="list"></div>
        `;
        noteViewCategory = categoryName;
        noteViewTitle = titleName;
        backToStoryFromNoteBtn.hidden = false;
        exportWordsBtn.hidden = false;
        addWordForm.hidden = false;

        const noteData = savedWords[categoryName]?.[titleName] || { words: new Set(), phrases: new Set(), sentences: new Set() };
        const sortItems = (set) => Array.from(set).sort((a, b) => a.localeCompare(b));

        const createWordItem = (itemText, type, container) => {
            const item = document.createElement('div');
            item.className = 'word-item';
            const wordTextEl = document.createElement('span');
            wordTextEl.className = 'word-text';
            wordTextEl.textContent = itemText;
            const actions = document.createElement('div');
            actions.className = 'word-item-actions';

            // Conditionally add buttons based on type
            if (type === 'words' || type === 'phrases') {
                // Voice Button (for words and phrases only)
                const voiceBtn = document.createElement('button');
                voiceBtn.textContent = 'Voice';
                voiceBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const audioSrc = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(itemText.trim().toLowerCase())}.mp3`;
                    const wordAudio = new Audio(audioSrc);
                    wordAudio.play().catch(() => showNotification(`Audio for "${itemText}" was not found.`, 'error'));
                });

                // Word Button (for words and phrases only)
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

                actions.appendChild(voiceBtn);
                actions.appendChild(wordBtn);
            }

            // Copy Button (for all types: words, phrases, sentences)
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
                }).catch(err => {
                    console.error('Could not copy text: ', err);
                });
                const newWordInput = document.getElementById('new-word-input');
                if (newWordInput) {
                    newWordInput.value = itemText;
                    newWordInput.focus();
                }
            });

            // Delete Button (for all types: words, phrases, sentences)
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'secondary';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                item.classList.add('is-deleting');
                setTimeout(() => {
                    if (confirm(`Delete '${itemText}'?`)) {
                        savedWords[categoryName][titleName][type].delete(itemText);
                        const titleData = savedWords[categoryName][titleName];
                        if (titleData.words.size === 0 && titleData.phrases.size === 0 && titleData.sentences.size === 0) {
                            delete savedWords[categoryName][titleName];
                        }
                        if (Object.keys(savedWords[categoryName]).length === 0) {
                            delete savedWords[categoryName];
                        }
                        persistNotes();
                        if (!savedWords[categoryName]) renderNoteView('categories');
                        else if (!savedWords[categoryName][titleName]) renderNoteView('titles', categoryName);
                        else renderNoteView('words', categoryName, titleName);
                    } else {
                        item.classList.remove('is-deleting');
                    }
                }, 50);
            });

            actions.append(copyBtn, deleteBtn);
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


// --- Event Listeners & Core App Logic ---

// Note view listeners
goToNoteBtn.addEventListener('click', () => {
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
        addWordToNote(newWord, noteViewCategory, noteViewTitle);
        newWordInput.value = '';
        newWordInput.focus();
        renderNoteView('words', noteViewCategory, noteViewTitle);
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
                const stagedWordEl = document.createElement('span');
                stagedWordEl.className = 'staged-word';
                stagedWordEl.textContent = cleanedWord;
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
function parafyAndMakeClickable(text) {
    const cleaned = String(text).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
    const paragraphs = cleaned.split(/\n+/);
    const frag = document.createDocumentFragment();
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
    timestampData.forEach(line => {
        const p = document.createElement('p');
        p.className = 'timestamp-sentence';
        p.dataset.start = line.start;
        p.dataset.end = line.end;

        // NEW: 將句子拆分為單詞並用 span 包裹
        // 這使得在音訊暫停時單詞可以被單獨點擊
        line.sentence.split(/(\s+|—|–)/).forEach(part => {
            if (!part) return;
            const span = document.createElement('span');
            // 檢查這部分是否只是空白或破折號
            if (/^(\s+|—|–)$/.test(part)) {
                span.textContent = part; // 直接附加
            } else {
                // 如果是單詞，使其可點擊
                span.className = 'clickable-word';
                span.textContent = part;
            }
            p.appendChild(span);
        });
        
        frag.appendChild(p);
    });
    textContainer.appendChild(frag);
    lastHighlightedSentence = null;
    computeScrollMax(); // 為新內容重新計算最大滾動距離
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

function tickScroll() {
  if (!isPlaying || !isFinite(audio.duration)) return;
  textContainer.scrollTop = (audio.currentTime / audio.duration) * scrollMax;
  rafId = requestAnimationFrame(tickScroll);
}

function startScroll() {
  if (rafId) cancelAnimationFrame(rafId);
  computeScrollMax();
  rafId = requestAnimationFrame(tickScroll);
}

function stopScroll() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

// --- New Predictive Smooth Scrolling and Highlight Logic ---
function timestampUpdateLoop() {
    if (!isPlaying || !isTimestampMode || !isFinite(audio.duration) || audio.duration === 0) {
        timestampUpdateRafId = null;
        return;
    }

    const currentTime = audio.currentTime;
    
    // 1. Highlight Logic (remains the same)
    let activeSentence = null;
    for (const line of timestampData) {
        if (currentTime >= line.start && currentTime <= line.end) {
            activeSentence = line;
            break;
        }
    }
    
    const sentenceElement = activeSentence ? textContainer.querySelector(`[data-start="${activeSentence.start}"]`) : null;
    
    if (sentenceElement && sentenceElement !== lastHighlightedSentence) {
        if (lastHighlightedSentence) {
            lastHighlightedSentence.classList.remove('is-current');
        }
        sentenceElement.classList.add('is-current');
        lastHighlightedSentence = sentenceElement;
    }

    // 2. Predictive Smooth Scrolling Logic
    // a. Calculate base scroll position from overall progress
    const progress = currentTime / audio.duration;
    const baseScrollTop = progress * scrollMax;

    let targetScrollTop = baseScrollTop;

    // b. If a sentence is active, calculate the corrective position
    if (lastHighlightedSentence) {
        const containerHeight = textContainer.clientHeight;
        const sentenceTop = lastHighlightedSentence.offsetTop;
        const sentenceHeight = lastHighlightedSentence.offsetHeight;
        const correctiveScrollTop = sentenceTop - (containerHeight / 2) + (sentenceHeight / 2);
        
        // c. Blend the base scroll and corrective scroll.
        // Give more weight to the corrective scroll to ensure focus.
        const weight = 0.8;
        targetScrollTop = (baseScrollTop * (1 - weight)) + (correctiveScrollTop * weight);
    }
    
    // d. Apply smoothing (easing) to the final target position
    const currentScrollTop = textContainer.scrollTop;
    const scrollDifference = targetScrollTop - currentScrollTop;
    textContainer.scrollTop += scrollDifference * 0.1; // Adjust the 0.05 factor to change "smoothness"

    timestampUpdateRafId = requestAnimationFrame(timestampUpdateLoop);
}


function startTimestampUpdateLoop() {
    if (timestampUpdateRafId) cancelAnimationFrame(timestampUpdateRafId);
    timestampUpdateRafId = requestAnimationFrame(timestampUpdateLoop);
}

function stopTimestampUpdateLoop() {
    if (timestampUpdateRafId) {
        cancelAnimationFrame(timestampUpdateRafId);
        timestampUpdateRafId = null;
    }
}


// Story loading and rendering
async function loadData() { // <--- 函式更名
  try {
    // 使用 Promise.all 同時獲取兩個 JSON 檔案
    const [storyRes, vocabRes] = await Promise.all([
        fetch('https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/story.json', { cache: 'no-store' }),
        fetch('https://boydyang-designer.github.io/English-vocabulary/audio_files/Z_total_words.json', { cache: 'no-store' })
    ]);

    if (!storyRes.ok) throw new Error(`Failed to fetch story.json: ${storyRes.statusText}`);
    if (!vocabRes.ok) throw new Error(`Failed to fetch Z_total_words.json: ${vocabRes.statusText}`);

    const storyJson = await storyRes.json();
    const vocabJson = await vocabRes.json();
    
    stories = Array.isArray(storyJson['New Words']) ? storyJson['New Words'] : [];
    vocabularyData = Array.isArray(vocabJson['New Words']) ? vocabJson['New Words'] : []; // 將單字資料存入新變數

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
    const shortRegex = /\[(\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}\.\d{3})\](.*)/; // Handle mm:ss.sss

    for (const line of lines) {
        let match = line.match(regex);
        if (!match) {
             match = line.match(shortRegex);
             if (match) {
                 // Prepend '00:' to match the longer format for the parser
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

async function loadTimestampForStory(title) {
    const url = `https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/Timestamp/${encodeURIComponent(title)} Timestamp.txt`;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const text = await response.text();
            timestampData = parseTimestampText(text);
            hasTimestampFile = timestampData.length > 0;
            toggleTimestampBtn.style.display = hasTimestampFile ? 'flex' : 'none';
        } else {
            console.warn(`Timestamp file not found for "${title}" (404)`);
            hasTimestampFile = false;
            toggleTimestampBtn.style.display = 'none';
        }
    } catch (error) {
        console.error("Error fetching timestamp file:", error);
        hasTimestampFile = false;
        toggleTimestampBtn.style.display = 'none';
    }
}


function renderCategories() {
  const categories = [...new Set(stories.flatMap(item => item['分類'] || []).map(c => c.trim()).filter(Boolean))].sort();
  categoryList.innerHTML = '';
  try {
    const lastSession = localStorage.getItem(LAST_SESSION_KEY);
    if (lastSession) {
        const { title, time } = JSON.parse(lastSession);
        if (title && typeof time === 'number') {
            const continueBtn = document.createElement('div');
            continueBtn.className = 'category-item';
            continueBtn.id = 'continue-last-session-btn';
            continueBtn.innerHTML = `<svg class="continue-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg><span>Continue Last Session</span>`;
            continueBtn.addEventListener('click', () => resumeLastPlayback(title, time));
            categoryList.appendChild(continueBtn);
        }
    }
  } catch (e) { console.error("Failed to parse last session data", e); }
  
  categories.forEach(category => {
    const div = document.createElement('div');
    div.className = 'category-item';
    div.textContent = category;
    div.addEventListener('click', () => showCategory(category));
    categoryList.appendChild(div);
  });
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
  currentStoryList = stories.filter(item => item['分類']?.map(c => c.trim()).includes(category))
                            .sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));
  currentStoryList.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'title-item';
    div.textContent = item['標題'];
    div.addEventListener('click', () => showPlayback(index));
    titleList.appendChild(div);
  });
  showView(categoryView);
}

function showPlayback(index, startTime = 0) {
  // Reset timestamp state on story change
  isTimestampMode = false;
  timestampData = [];
  hasTimestampFile = false;
  lastHighlightedSentence = null;
  toggleTimestampBtn.classList.remove('is-active');
  toggleTimestampBtn.style.display = 'none';
  stopTimestampUpdateLoop();

  stagedWordsContainer.innerHTML = '';
  currentStoryIndex = index;
  const story = currentStoryList[currentStoryIndex];
  if (!story) return;
  
  currentStoryTitle = story['標題'];
  playbackTitle.textContent = currentStoryTitle;
  
  // Render default JSON content first
  textContainer.innerHTML = '';
  textContainer.appendChild(parafyAndMakeClickable('\n\n' + story['內文']));
  textContainer.scrollTop = 0;
  progressBar.value = 0;
  
  setAudioSourceWithFallback(currentStoryTitle);
  loadTimestampForStory(currentStoryTitle); // Asynchronously load timestamp file

  prevStoryBtn.hidden = currentStoryIndex <= 0;
  nextStoryBtn.hidden = currentStoryIndex >= currentStoryList.length - 1;

  const onLoaded = () => {
    if (startTime > 0 && isFinite(audio.duration)) {
        audio.currentTime = Math.min(startTime, audio.duration);
    }
    computeScrollMax(); // Compute scroll max after content is loaded and audio is ready
    audio.play(); // Autoplay when loaded
    audio.removeEventListener('canplaythrough', onLoaded);
  };
  audio.addEventListener('canplaythrough', onLoaded);

  showView(playbackView);
}

function stopAudioAndReset() {
  stagedWordsContainer.innerHTML = '';
  stopScroll();
  stopTimestampUpdateLoop();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  isPlaying = false;
  playPauseBtn.classList.remove('is-playing');
  progressBar.value = 0;
  currentStoryTitle = null;
  currentCategoryName = null;
  playbackPositionBeforeNote = 0;

  // Reset timestamp state as well
  isTimestampMode = false;
  toggleTimestampBtn.classList.remove('is-active');
  lastHighlightedSentence = null;
}

// Button listeners
backToHomeBtn.addEventListener('click', () => { stopAudioAndReset(); showView(homeView); });
backToCategoryBtn.addEventListener('click', () => { stopAudioAndReset(); showView(categoryView); });
rewindBtn.addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 5); });
forwardBtn.addEventListener('click', () => { if(isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); });
playPauseBtn.addEventListener('click', () => { isPlaying ? audio.pause() : audio.play().catch(e => console.error("Play failed:", e)); });
prevStoryBtn.addEventListener('click', () => { if (currentStoryIndex > 0) { showPlayback(currentStoryIndex - 1); } });
nextStoryBtn.addEventListener('click', () => { if (currentStoryIndex < currentStoryList.length - 1) { showPlayback(currentStoryIndex + 1); } });

// --- New Timestamp Toggle Logic ---
toggleTimestampBtn.addEventListener('click', () => {
    if (!hasTimestampFile) {
        alert('無 Timestamp');
        return;
    }
    isTimestampMode = !isTimestampMode;
    toggleTimestampBtn.classList.toggle('is-active', isTimestampMode);

    if (isTimestampMode) {
        stopScroll();
        renderTimestampContent();
        if (isPlaying) startTimestampUpdateLoop();
    } else {
        stopTimestampUpdateLoop();
        const story = currentStoryList[currentStoryIndex];
        textContainer.innerHTML = '';
        textContainer.appendChild(parafyAndMakeClickable('\n\n' + story['內文']));
        lastHighlightedSentence = null;
        computeScrollMax();
        if (isPlaying) startScroll();
    }
});


// Note view navigation
goToStoryNoteBtn.addEventListener('click', () => {
    if (currentCategoryName && currentStoryTitle) {
        playbackPositionBeforeNote = audio.currentTime;
        audio.pause(); // Pause audio when going to notes
        renderNoteView('words', currentCategoryName, currentStoryTitle);
        showView(noteView);
    }
});

backToStoryFromNoteBtn.addEventListener('click', () => {
    if (noteViewCategory && noteViewTitle) {
        // Find the story in the master list to get its category
        const story = stories.find(s => s['標題'] === noteViewTitle);
        const category = story?.['分類']?.[0];
        if (category) {
            // Re-establish context
            currentStoryList = stories.filter(item => item['分類']?.map(c => c.trim()).includes(category))
                                      .sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));
            const indexInList = currentStoryList.findIndex(s => s['標題'] === noteViewTitle);
            if (indexInList > -1) {
                showCategory(category); // Go to title list view first
                showPlayback(indexInList, playbackPositionBeforeNote); // Then open playback
            }
        }
    }
});

// Audio and progress bar listeners
audio.addEventListener('play', () => { 
    isPlaying = true; 
    playPauseBtn.classList.add('is-playing'); 
    saveLastPlaybackState(); 
    if (isTimestampMode) {
        startTimestampUpdateLoop();
    } else {
        startScroll();
    }
});
audio.addEventListener('pause', () => { 
    isPlaying = false; 
    playPauseBtn.classList.remove('is-playing'); 
    saveLastPlaybackState(); 
    stopScroll(); 
    stopTimestampUpdateLoop();
});
audio.addEventListener('ended', () => { clearLastPlaybackState(); stopAudioAndReset(); document.getElementById('continue-last-session-btn')?.remove(); });
audio.addEventListener('timeupdate', () => { 
    if (isFinite(audio.duration)) progressBar.value = (audio.currentTime / audio.duration) * 100;
});
progressBar.addEventListener('input', () => { if (isFinite(audio.duration)) audio.currentTime = (progressBar.value / 100) * audio.duration; });

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
  if (!playbackView.classList.contains('is-hidden')) {
    if (event.target.tagName === 'INPUT') return; // Don't interfere with text input
    if (event.code === 'Space') { event.preventDefault(); playPauseBtn.click(); }
    if (event.code === 'ArrowLeft') { event.preventDefault(); rewindBtn.click(); }
    if (event.code === 'ArrowRight') { event.preventDefault(); forwardBtn.click(); }
  }
});

// --- App Initialization ---
function init() {
  // Collapsible note sections listener
  document.getElementById('note-content-wrapper').addEventListener('click', (e) => {
      const header = e.target.closest('.note-section-header');
      if (header?.dataset.target) {
          const targetList = document.getElementById(header.dataset.target);
          if (targetList) {
              header.classList.toggle('is-expanded');
              targetList.style.display = targetList.style.display === 'none' ? '' : 'none';
          }
      }
  });

  googleSigninBtn.addEventListener('click', signIn);
  guestModeBtn.addEventListener('click', enterGuestMode);

  // App Header actions
  signOutBtn.addEventListener('click', signOutUser);

  // NEW: Sign In from Guest Mode button logic
  if (signInFromGuestBtn) {
      signInFromGuestBtn.addEventListener('click', signIn);
  }
 
  window.addEventListener('resize', computeScrollMax, { passive: true });
}

// --- Firebase Auth State Listener (The App's Entry Point) ---
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        currentUser = user;

        try {
            // --- START: NEW TRY BLOCK ---
            const guestNotesRaw = localStorage.getItem(SAVED_WORDS_KEY);
            
            await loadWordsFromFirestore(); // 如果這裡失敗，會直接跳到 catch

            if (guestNotesRaw) {
                console.log("Found guest notes in local storage. Merging...");
                
                const guestNotesParsed = JSON.parse(guestNotesRaw);
                const guestNotes = parseFirestoreData(guestNotesParsed);

                savedWords = mergeNotes(guestNotes, savedWords);

                await saveWordsToFirestore(); // 只有在成功載入後，才進行合併儲存
                
                localStorage.removeItem(SAVED_WORDS_KEY);
                console.log("Merge successful and local guest notes cleared.");
            }
            
            // 成功載入（或合併）後，顯示 App
            await showAppView(user);
            // --- END: NEW TRY BLOCK ---

        } catch (error) {
            // --- START: NEW CATCH BLOCK ---
            console.error("Critical error during user session initialization:", error);
            alert("Could not load your saved notes. Please check your internet connection and try again. Your notes will not be saved until the issue is resolved.");
            
            // 可以在這裡顯示一個錯誤畫面，或者直接登出使用者以保護資料
            showLoginView(); 
            // --- END: NEW CATCH BLOCK ---
        }

    } else {
        // User is signed out
        console.log("Auth state changed: User is logged out.");
        currentUser = null;
        savedWords = {};
        showLoginView();
    }
});

// Start the application
init();
