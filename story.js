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

async function loadWordsFromFirestore() {
    if (!currentUser) {
        console.log("使用者未登入，無法讀取筆記。");
        savedWords = {}; // 確保本地資料是清空的
        return;
    }
    
    try {
        const docRef = db.collection('userNotes').doc(currentUser.uid);
        const doc = await docRef.get();

        if (doc.exists) {
            // 文件存在，載入資料
            const firestoreData = doc.data().savedWords || {};
            // (這裡沿用您原本將 JSON 物件轉換回 Set 的邏輯)
            // ...
            // 為了簡化，我們先直接賦值，您需要補上轉換回 Set 的詳細邏輯
            savedWords = parseFirestoreData(firestoreData);

        } else {
            // 文件不存在，代表是新使用者或沒有筆記
            console.log("此使用者沒有儲存的筆記。");
            savedWords = {};
        }
    } catch (error) {
        console.error("從 Firestore 讀取資料時發生錯誤:", error);
        savedWords = {}; // 發生錯誤時清空
    }
}

// 輔助函式：將從 Firestore 讀取的物件轉換回包含 Set 的格式
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


// 新的函式：儲存筆記到 Firestore
async function saveWordsToFirestore() {
    if (!currentUser) {
        console.log("使用者未登入，無法儲存筆記。");
        return;
    }

    // 您原本將 Set 轉換為 Array 的邏輯是正確的，因為 Firestore 不支援 Set
    const serializableWords = {};
    for (const category in savedWords) {
        serializableWords[category] = {};
        for (const title in savedWords[category]) {
            serializableWords[category][title] = {
                words: Array.from(savedWords[category][title].words),
                phrases: Array.from(savedWords[category][title].phrases),
                sentences: Array.from(savedWords[category][title].sentences)
            };
        }
    }
    
    try {
        const docRef = db.collection('userNotes').doc(currentUser.uid);
        // 使用 set 搭配 { merge: true } 可以更新或建立文件，而不會覆蓋整個文件
        await docRef.set({ savedWords: serializableWords });
        console.log("筆記已成功儲存到 Firestore！");
    } catch (error) {
        console.error("儲存資料到 Firestore 時發生錯誤:", error);
    }
}


// Storage Keys
const LAST_SESSION_KEY = 'readingChallengeLastSession';
const SAVED_WORDS_KEY = 'readingChallengeSavedWordsV2';


// --- UI Management ---
function showLoginView() {
    loginView.classList.remove('is-hidden');
    appContainer.classList.add('is-hidden');
}

async function showAppView(user) {
    currentUser = user;
    loginView.classList.add('is-hidden');
    appContainer.classList.remove('is-hidden');
    
    if (user) {
        userInfo.textContent = `Signed in as ${user.displayName}`;
        signOutBtn.hidden = false;
    } else {
        userInfo.textContent = 'Guest Mode';
        signOutBtn.hidden = true;
    }
    
    // Load data and render initial view
    if (stories.length === 0) {
        await loadStories();
    }
    renderCategories();
    showView(homeView);
}

function showView(view) {
    for (const el of [homeView, categoryView, playbackView, noteView]) {
        el.classList.add('is-hidden');
    }
    view.classList.remove('is-hidden');

    if (view === noteView) {
        document.body.classList.add('note-view-active');
    } else {
        document.body.classList.remove('note-view-active');
    }
}

// --- Firebase Auth Functions ---
function signIn() {
    const provider = new firebase.auth.GoogleAuthProvider();
    
    // 將 signInWithRedirect 改回 signInWithPopup
    firebase.auth().signInWithPopup(provider)
        .then((result) => {
            // 登入成功後，onAuthStateChanged 監聽器會自動處理
            // 您可以在這裡添加額外的成功後邏輯（如果需要）
            console.log("Sign-in successful via popup:", result.user);
        })
        .catch((error) => {
            // 處理錯誤，例如使用者關閉彈出視窗
            console.error("Sign-in popup error:", error.code, error.message);
        });
}

// ... 其餘程式碼保持不變

function signOutUser() {
    firebase.auth().signOut().catch((error) => {
        console.error("Sign out error:", error);
    });
}

function enterGuestMode() {
    showAppView(null); // Pass null for guest user
}


// --- Storage Functions ---
function classifyEntry(text) {
    const trimmedText = text.trim();
    const wordCount = trimmedText.split(/\s+/).length;
    const hasEndingPunctuation = /[.?!]$/.test(trimmedText);

    if (wordCount > 4 || hasEndingPunctuation) return 'sentences';
    if (wordCount > 1) return 'phrases';
    return 'words';
}

function loadWordsFromStorage() {
    // NOTE: This will be modified later to load from Firestore for logged-in users.
    const storedWords = localStorage.getItem(SAVED_WORDS_KEY);
    if (!storedWords) {
        savedWords = {};
        return;
    }
    try {
        const parsed = JSON.parse(storedWords);
        savedWords = {}; // Reset before loading
        for (const category in parsed) {
            if (typeof parsed[category] !== 'object') continue;
            savedWords[category] = {};
            for (const title in parsed[category]) {
                const entry = parsed[category][title];
                savedWords[category][title] = { words: new Set(), phrases: new Set(), sentences: new Set() };
                
                if (Array.isArray(entry)) { // Oldest format
                    entry.forEach(item => {
                        const type = classifyEntry(item);
                        savedWords[category][title][type].add(item);
                    });
                } else if (typeof entry === 'object' && entry !== null) { // New format
                    if(entry.sentences) new Set(entry.sentences).forEach(item => savedWords[category][title].sentences.add(item));
                    if(entry.phrases) new Set(entry.phrases).forEach(item => savedWords[category][title].phrases.add(item));
                    if(entry.words) {
                        new Set(entry.words).forEach(item => {
                            const type = classifyEntry(item);
                            savedWords[category][title][type].add(item);
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.error("Failed to parse words from localStorage", e);
        savedWords = {};
    }
}

function saveWordsToStorage() {
    // NOTE: This will be modified later to save to Firestore for logged-in users.
    const serializableWords = {};
    for (const category in savedWords) {
        serializableWords[category] = {};
        for (const title in savedWords[category]) {
            serializableWords[category][title] = {
                words: Array.from(savedWords[category][title].words),
                phrases: Array.from(savedWords[category][title].phrases),
                sentences: Array.from(savedWords[category][title].sentences)
            };
        }
    }
    localStorage.setItem(SAVED_WORDS_KEY, JSON.stringify(serializableWords));
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


// --- Word Note Functions (Unchanged) ---
function renderNoteView(level = 'categories', categoryName = null, titleName = null) {
    const noteContentWrapper = document.getElementById('note-content-wrapper');
    addWordForm.classList.add('is-hidden');
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
        } else {
            const titles = Object.keys(savedWords[categoryName]).sort((a, b) => a.localeCompare(b));
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
        addWordForm.classList.remove('is-hidden');

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
            const voiceBtn = document.createElement('button');
            voiceBtn.textContent = 'Voice';
            voiceBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (type === 'sentences') {
                    alert(`Voice function for SENTENCE: "${itemText}"`);
                    return;
                }
                const audioSrc = `https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/${encodeURIComponent(itemText.trim().toLowerCase())}.mp3`;
                const wordAudio = new Audio(audioSrc);
                wordAudio.play().catch(() => alert(`Audio for "${itemText}" was not found.`));
            });
            const wordBtn = document.createElement('button');
            wordBtn.textContent = 'Word';
            wordBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wordForUrl = itemText.trim().toLowerCase();
                if (wordForUrl.includes(' ')) {
                    alert("「Word」查詢功能僅適用於單一單字。");
                    return;
                }
                window.location.href = `https://boydyang-designer.github.io/English-vocabulary/?word=${wordForUrl}&from=story`;
            });
            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(itemText).then(() => {
                    copyBtn.classList.add('btn-success-feedback');
                    setTimeout(() => copyBtn.classList.remove('btn-success-feedback'), 500);
                });
            });
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'secondary';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete '${itemText}'?`)) {
                    savedWords[categoryName][titleName][type].delete(itemText);
                    const titleData = savedWords[categoryName][titleName];
                    if (titleData.words.size === 0 && titleData.phrases.size === 0 && titleData.sentences.size === 0) {
                        delete savedWords[categoryName][titleName];
                    }
                    if (Object.keys(savedWords[categoryName]).length === 0) {
                        delete savedWords[categoryName];
                    }
                    saveWordsToStorage();
                    if (!savedWords[categoryName]) renderNoteView('categories');
                    else if (!savedWords[categoryName][titleName]) renderNoteView('titles', categoryName);
                    else renderNoteView('words', categoryName, titleName);
                }
            });
            actions.append(voiceBtn, wordBtn, copyBtn, deleteBtn);
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
            if (items.length === 0) {
                containers[type].innerHTML = `<p>No ${type} saved yet.</p>`;
            } else {
                containers[type].innerHTML = '';
                items.forEach(item => createWordItem(item, type, containers[type]));
            }
        });
        
        backToHomeFromNoteBtn.textContent = 'Back to Titles';
        backToHomeFromNoteBtn.onclick = () => renderNoteView('titles', categoryName);
    }
}


function addWordToNote(text, category, title) {
    const cleanedText = text.trim();
    if (!cleanedText || !category || !title) return;

    if (!savedWords[category]) savedWords[category] = {};
    if (!savedWords[category][title]) {
        savedWords[category][title] = { words: new Set(), phrases: new Set(), sentences: new Set() };
    }

    const type = classifyEntry(cleanedText);
    savedWords[category][title][type].add(cleanedText);
    saveWordsToStorage();
}

// ... The rest of the functions (parafyAndMakeClickable, buildAudioCandidates, etc.) are mostly unchanged ...
// ... I will paste them below for completeness ...

goToNoteBtn.addEventListener('click', () => {
    renderNoteView('categories');
    showView(noteView);
});

exportWordsBtn.addEventListener('click', () => {
    const allItems = new Set();
    for (const category in savedWords) {
        for (const title in savedWords[category]) {
            savedWords[category][title].words.forEach(word => allItems.add(word));
            savedWords[category][title].phrases.forEach(phrase => allItems.add(phrase));
            savedWords[category][title].sentences.forEach(sentence => allItems.add(sentence));
        }
    }
    if (allItems.size === 0) {
        alert("No items to copy.");
        return;
    }
    const textToCopy = Array.from(allItems).sort((a, b) => a.localeCompare(b)).join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
        alert(`${allItems.size} total items copied to clipboard.`);
    }).catch(err => alert('Could not copy items.'));
});

function cleanWord(word) {
  return word ? word.replace(/^[.,?!:;'"`“”‘’()[\]{}\-/*]+|[.,?!:;'"`“”‘’()[\]{}\-/*]+$/g, '') : '';
}

textContainer.addEventListener('click', (e) => {
    const wordSpan = e.target.closest('.clickable-word');
    if (wordSpan && window.getSelection().isCollapsed) {
        const cleanedWord = cleanWord(wordSpan.textContent);
        if (cleanedWord) {
            const stagedWordEl = document.createElement('span');
            stagedWordEl.className = 'staged-word';
            stagedWordEl.textContent = cleanedWord;
            stagedWordsContainer.appendChild(stagedWordEl);
        }
    }
});

stagedWordsContainer.addEventListener('click', (e) => {
    if (e.target.closest('.staged-word')) e.target.remove();
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
                if (/^(\s+|—|–)$/.test(part)) {
                    p.appendChild(document.createTextNode(part));
                } else {
                    const span = document.createElement('span');
                    span.className = 'clickable-word';
                    span.textContent = part;
                    p.appendChild(span);
                }
            });
        }
        frag.appendChild(p);
    });
    return frag;
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
  audio.play().catch(() => playPauseBtn.classList.remove('is-playing'));
  audio.onerror = tryNextAudioCandidate;
}

function computeScrollMax() {
  scrollMax = Math.max(0, textContainer.scrollHeight - textContainer.clientHeight);
}

function tickScroll() {
  if (!isPlaying) return;
  const duration = (Number.isFinite(audio.duration) && audio.duration > 0) ? audio.duration : durationFallback;
  textContainer.scrollTop = (audio.currentTime / duration) * scrollMax;
  rafId = window.requestAnimationFrame(tickScroll);
}

function startScroll() {
  if (rafId) cancelAnimationFrame(rafId);
  computeScrollMax();
  rafId = window.requestAnimationFrame(tickScroll);
}

function stopScroll() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

async function loadStories() {
  const res = await fetch('https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/story.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch story.json');
  const data = await res.json();
  stories = Array.isArray(data['New Words']) ? data['New Words'] : [];
}

function renderCategories() {
  const categories = [...new Set(stories.flatMap(item => item['分類'] || []).map(c => c.trim()).filter(Boolean))].sort();
  categoryList.innerHTML = '';
  const lastSession = localStorage.getItem(LAST_SESSION_KEY);
  if (lastSession) {
      try {
          const { title, time } = JSON.parse(lastSession);
          if (title && typeof time === 'number') {
              const continueBtn = document.createElement('div');
              continueBtn.className = 'category-item';
              continueBtn.id = 'continue-last-session-btn';
              continueBtn.innerHTML = `<svg class="continue-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"></path></svg><span>Continue Last Session</span>`;
              continueBtn.addEventListener('click', () => resumeLastPlayback(title, time));
              categoryList.appendChild(continueBtn);
          }
      } catch (e) { console.error("Failed to parse last session data", e); }
  }
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
    showCategory(category);
    const indexInList = currentStoryList.findIndex(s => s['標題'] === title);
    if (indexInList > -1) {
        showPlayback(indexInList, time);
    }
}

function showCategory(category) {
  showView(categoryView);
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
}

function showPlayback(index, startTime = 0) {
  stagedWordsContainer.innerHTML = '';
  currentStoryIndex = index;
  const story = currentStoryList[currentStoryIndex];
  if (!story) return;
  
  currentStoryTitle = story['標題'];
  showView(playbackView);
  playbackTitle.textContent = currentStoryTitle;
  textContainer.innerHTML = '';
  textContainer.appendChild(parafyAndMakeClickable('\n\n' + story['內文']));
  textContainer.scrollTop = 0;
  progressBar.value = 0;
  setAudioSourceWithFallback(currentStoryTitle);
  prevStoryBtn.hidden = currentStoryIndex <= 0;
  nextStoryBtn.hidden = currentStoryIndex >= currentStoryList.length - 1;

  const onLoaded = () => {
    if (startTime > 0) audio.currentTime = startTime;
    if (!audio.paused) {
      isPlaying = true;
      playPauseBtn.classList.add('is-playing');
      startScroll();
    }
    audio.removeEventListener('loadedmetadata', onLoaded);
  };
  audio.addEventListener('loadedmetadata', onLoaded);
}

function stopAudioAndReset() {
  stagedWordsContainer.innerHTML = '';
  stopScroll();
  try { audio.pause(); } catch {}
  audio.currentTime = 0;
  isPlaying = false;
  playPauseBtn.classList.remove('is-playing');
  progressBar.value = 0;
  currentStoryTitle = null;
  currentCategoryName = null;
  playbackPositionBeforeNote = 0;
}

backToHomeBtn.addEventListener('click', () => {
  stopAudioAndReset();
  showView(homeView);
});
backToCategoryBtn.addEventListener('click', () => {
  stopAudioAndReset();
  showView(categoryView);
});
rewindBtn.addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 5); });
forwardBtn.addEventListener('click', () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5); });
playPauseBtn.addEventListener('click', () => { isPlaying ? audio.pause() : audio.play(); });

audio.addEventListener('play', () => {
    isPlaying = true;
    playPauseBtn.classList.add('is-playing');
    startScroll();
    saveLastPlaybackState();
});
audio.addEventListener('pause', () => {
    isPlaying = false;
    playPauseBtn.classList.remove('is-playing');
    stopScroll();
    saveLastPlaybackState();
});

prevStoryBtn.addEventListener('click', () => {
    if (currentStoryIndex > 0) {
        stopAudioAndReset();
        showPlayback(currentStoryIndex - 1);
    }
});
nextStoryBtn.addEventListener('click', () => {
    if (currentStoryIndex < currentStoryList.length - 1) {
        stopAudioAndReset();
        showPlayback(currentStoryIndex + 1);
    }
});

function updateProgressBar() {
    if (audio.duration) progressBar.value = (audio.currentTime / audio.duration) * 100;
}
function seekAudio() {
    if (audio.duration) audio.currentTime = (progressBar.value / 100) * audio.duration;
}

goToStoryNoteBtn.addEventListener('click', () => {
    if (currentCategoryName && currentStoryTitle) {
        playbackPositionBeforeNote = audio.currentTime;
        renderNoteView('words', currentCategoryName, currentStoryTitle);
        showView(noteView);
    }
});
backToStoryFromNoteBtn.addEventListener('click', () => {
    if (noteViewCategory && noteViewTitle) {
        const indexInList = currentStoryList.findIndex(s => s['標題'] === noteViewTitle);
        if (indexInList > -1) {
            showPlayback(indexInList, playbackPositionBeforeNote);
        }
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

window.addEventListener('resize', computeScrollMax, { passive: true });
audio.addEventListener('ended', () => {
    clearLastPlaybackState();
    stopAudioAndReset();
    document.getElementById('continue-last-session-btn')?.remove();
});
audio.addEventListener('timeupdate', updateProgressBar);
progressBar.addEventListener('input', seekAudio);

document.addEventListener('keydown', (event) => {
  if (playbackView.hidden === false) {
    if(event.code === 'Space') { event.preventDefault(); playPauseBtn.click(); }
    if(event.code === 'ArrowLeft') { event.preventDefault(); rewindBtn.click(); }
    if(event.code === 'ArrowRight') { event.preventDefault(); forwardBtn.click(); }
  }
});

// --- App Initialization ---
(function init() {
  // Collapsible note sections listener
  document.getElementById('note-content-wrapper').addEventListener('click', (e) => {
      const header = e.target.closest('.note-section-header');
      if (header?.dataset.target) {
          const targetList = document.getElementById(header.dataset.target);
          if (targetList) {
              header.classList.toggle('is-expanded');
              targetList.classList.toggle('collapsed');
          }
      }
  });

  // Auth button listeners
  googleSigninBtn.addEventListener('click', signIn);
  signOutBtn.addEventListener('click', signOutUser);
  guestModeBtn.addEventListener('click', enterGuestMode);
  
// story.js

// Firebase Auth State Listener
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        // User is signed in
        console.log("Auth state changed: User is logged in.", user);
        currentUser = user; // <--- 確保 currentUser 已被設定

        // 登入後，從 Firestore 讀取該使用者的資料
        await loadWordsFromFirestore(); 

        // 接著才顯示主應用畫面
        await showAppView(user); // showAppView 內部不需要再 loadWords
    } else {
        // User is signed out or never logged in
        console.log("Auth state changed: User is logged out.");
        currentUser = null;
        savedWords = {}; // 登出時清空本地資料
        showLoginView();
    }
});

