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
    
    // Load story data if not already loaded
    if (stories.length === 0) {
        await loadStories();
    }
    renderCategories();
    showView(homeView);
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
            const firestoreData = doc.data().savedWords || {};
            savedWords = parseFirestoreData(firestoreData);
            console.log("Notes loaded from Firestore.");
        } else {
            console.log("No notes found in Firestore for this user.");
            savedWords = {};
        }
    } catch (error) {
        console.error("Error loading notes from Firestore:", error);
        savedWords = {};
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
        await docRef.set({ savedWords: serializableWords });
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
    if (wordCount > 4 || hasEndingPunctuation) return 'sentences';
    if (wordCount > 1) return 'phrases';
    return 'words';
}


// --- Word Note Functions ---
function addWordToNote(text, category, title) {
    const cleanedText = text.trim();
    if (!cleanedText || !category || !title) return;

    if (!savedWords[category]) savedWords[category] = {};
    if (!savedWords[category][title]) {
        savedWords[category][title] = { words: new Set(), phrases: new Set(), sentences: new Set() };
    }

    const type = classifyEntry(cleanedText);
    savedWords[category][title][type].add(cleanedText);
    persistNotes(); // Use the new unified save function
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
            
            // Voice Button
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

            // Word Button
            const wordBtn = document.createElement('button');
            wordBtn.textContent = 'Word';
            wordBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const wordForUrl = itemText.trim().toLowerCase();
                if (wordForUrl.includes(' ')) {
                    alert("「Word」查詢功能僅適用於單一單字。");
                    return;
                }
                window.open(`https://boydyang-designer.github.io/English-vocabulary/?word=${wordForUrl}&from=story`, '_blank');
            });

            // Copy Button
            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(itemText).then(() => {
                    copyBtn.classList.add('btn-success-feedback');
                    setTimeout(() => copyBtn.classList.remove('btn-success-feedback'), 500);
                });
            });

            // Delete Button
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
                    persistNotes(); // Use unified save
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
    if (window.getSelection().toString().length > 0) return; // Ignore if user is selecting text
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

// Story loading and rendering
async function loadStories() {
  try {
    const res = await fetch('https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/story.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to fetch story.json: ${res.statusText}`);
    const data = await res.json();
    stories = Array.isArray(data['New Words']) ? data['New Words'] : [];
  } catch (error) {
    console.error(error);
    alert("Could not load story data. Please check your internet connection and try again.");
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
  stagedWordsContainer.innerHTML = '';
  currentStoryIndex = index;
  const story = currentStoryList[currentStoryIndex];
  if (!story) return;
  
  currentStoryTitle = story['標題'];
  playbackTitle.textContent = currentStoryTitle;
  textContainer.innerHTML = '';
  textContainer.appendChild(parafyAndMakeClickable('\n\n' + story['內文']));
  textContainer.scrollTop = 0;
  progressBar.value = 0;
  
  setAudioSourceWithFallback(currentStoryTitle);

  prevStoryBtn.hidden = currentStoryIndex <= 0;
  nextStoryBtn.hidden = currentStoryIndex >= currentStoryList.length - 1;

  const onLoaded = () => {
    if (startTime > 0 && isFinite(audio.duration)) {
        audio.currentTime = Math.min(startTime, audio.duration);
    }
    audio.play(); // Autoplay when loaded
    audio.removeEventListener('canplaythrough', onLoaded);
  };
  audio.addEventListener('canplaythrough', onLoaded);

  showView(playbackView);
}

function stopAudioAndReset() {
  stagedWordsContainer.innerHTML = '';
  stopScroll();
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  isPlaying = false;
  playPauseBtn.classList.remove('is-playing');
  progressBar.value = 0;
  currentStoryTitle = null;
  currentCategoryName = null;
  playbackPositionBeforeNote = 0;
}

// Button listeners
backToHomeBtn.addEventListener('click', () => { stopAudioAndReset(); showView(homeView); });
backToCategoryBtn.addEventListener('click', () => { stopAudioAndReset(); showView(categoryView); });
rewindBtn.addEventListener('click', () => { audio.currentTime = Math.max(0, audio.currentTime - 5); });
forwardBtn.addEventListener('click', () => { if(isFinite(audio.duration)) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); });
playPauseBtn.addEventListener('click', () => { isPlaying ? audio.pause() : audio.play().catch(e => console.error("Play failed:", e)); });
prevStoryBtn.addEventListener('click', () => { if (currentStoryIndex > 0) { stopAudioAndReset(); showPlayback(currentStoryIndex - 1); } });
nextStoryBtn.addEventListener('click', () => { if (currentStoryIndex < currentStoryList.length - 1) { stopAudioAndReset(); showPlayback(currentStoryIndex + 1); } });

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
audio.addEventListener('play', () => { isPlaying = true; playPauseBtn.classList.add('is-playing'); startScroll(); saveLastPlaybackState(); });
audio.addEventListener('pause', () => { isPlaying = false; playPauseBtn.classList.remove('is-playing'); stopScroll(); saveLastPlaybackState(); });
audio.addEventListener('ended', () => { clearLastPlaybackState(); stopAudioAndReset(); document.getElementById('continue-last-session-btn')?.remove(); });
audio.addEventListener('timeupdate', () => { if (isFinite(audio.duration)) progressBar.value = (audio.currentTime / audio.duration) * 100; });
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

  // Auth button listeners
  googleSigninBtn.addEventListener('click', signIn);
  signOutBtn.addEventListener('click', signOutUser);
  guestModeBtn.addEventListener('click', enterGuestMode);
  
  window.addEventListener('resize', computeScrollMax, { passive: true });
}

// --- Firebase Auth State Listener (The App's Entry Point) ---
firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        // User is signed in.
        console.log("Auth state changed: User is logged in.", user);
        currentUser = user;
        await loadWordsFromFirestore(); // Load user's notes from the cloud
        await showAppView(user);
    } else {
        // User is signed out or has never logged in.
        console.log("Auth state changed: User is logged out.");
        currentUser = null;
        savedWords = {}; // Clear any local data
        showLoginView();
    }
});

// Start the application
init();