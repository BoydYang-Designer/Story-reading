/* Reading Challenge SPA (external JSON + audio in root folder) */
const homeView = document.getElementById('home-view');
const categoryView = document.getElementById('category-view');
const playbackView = document.getElementById('playback-view');
const noteView = document.getElementById('note-view');

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
// START: New note list elements
const noteListWords = document.getElementById('note-list-words');
const noteListSentences = document.getElementById('note-list-sentences');
// END: New note list elements
const exportWordsBtn = document.getElementById('export-words-btn');
const goToStoryNoteBtn = document.getElementById('go-to-story-note-btn');
const backToStoryFromNoteBtn = document.getElementById('back-to-story-from-note-btn');
const addWordForm = document.getElementById('add-word-form');
const newWordInput = document.getElementById('new-word-input');
const addManualWordBtn = document.getElementById('add-manual-word-btn');

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


// --- Storage Functions ---
const LAST_SESSION_KEY = 'readingChallengeLastSession';
const SAVED_WORDS_KEY = 'readingChallengeSavedWordsV2';

// START: New function to classify entries
/**
 * Classifies text as 'words', 'phrases', or 'sentences'.
 * @param {string} text The text to classify.
 * @returns {'words'|'phrases'|'sentences'} The classification type.
 */
function classifyEntry(text) {
    const trimmedText = text.trim();
    const wordCount = trimmedText.split(/\s+/).length;
    const hasEndingPunctuation = /[.?!]$/.test(trimmedText);

    if (wordCount > 4 || hasEndingPunctuation) {
        return 'sentences';
    } else if (wordCount > 1) { // 2 to 4 words
        return 'phrases';
    } else { // 1 word
        return 'words';
    }
}
// END: New classification function

function loadWordsFromStorage() {
    const storedWords = localStorage.getItem(SAVED_WORDS_KEY);
    if (storedWords) {
        try {
            const parsed = JSON.parse(storedWords);
            for (const category in parsed) {
                if (typeof parsed[category] !== 'object') continue;
                savedWords[category] = {};
                for (const title in parsed[category]) {
                    const entry = parsed[category][title];
                    // Initialize with the new three-category structure
                    savedWords[category][title] = { words: new Set(), phrases: new Set(), sentences: new Set() };
                    
                    if (Array.isArray(entry)) {
                        // **Migration logic for oldest format (simple array)**
                        entry.forEach(item => {
                            const type = classifyEntry(item);
                            savedWords[category][title][type].add(item);
                        });
                    } else if (typeof entry === 'object' && entry !== null) {
                        // **Handle new format and migrate from 2-category format**
                        // Add sentences first
                        if(entry.sentences) new Set(entry.sentences).forEach(item => savedWords[category][title].sentences.add(item));
                        
                        // Re-classify everything that was in the old 'words' array
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
}


function saveWordsToStorage() {
    const serializableWords = {};
    for (const category in savedWords) {
        serializableWords[category] = {};
        for (const title in savedWords[category]) {
            // Save in the new format { words: [], phrases: [], sentences: [] }
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
        const currentStory = currentStoryList[currentStoryIndex];
        const state = {
            title: currentStory['標題'],
            time: audio.currentTime
        };
        localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(state));
    }
}

function clearLastPlaybackState() {
    localStorage.removeItem(LAST_SESSION_KEY);
}


function showView(view) {
  for (const el of [homeView, categoryView, playbackView, noteView]) {
    el.hidden = true;
  }
  view.hidden = false;
}

// --- Word Note Functions ---

function renderNoteView(level = 'categories', categoryName = null, titleName = null) {
    const noteContentWrapper = document.getElementById('note-content-wrapper');

    // Default state for navigation and forms
    addWordForm.hidden = true;
    backToStoryFromNoteBtn.hidden = true;

    // Helper function to create a list item for categories or titles
    const createListItem = (text, clickHandler, container) => {
        const item = document.createElement('div');
        item.className = 'category-item';
        item.textContent = text;
        item.addEventListener('click', clickHandler);
        container.appendChild(item);
    };

    if (level === 'categories' || level === 'titles') {
        // For high-level views, create a temporary container
        noteContentWrapper.innerHTML = '<div class="list" id="temp-list-container"></div>';
        const tempListContainer = document.getElementById('temp-list-container');

        if (level === 'categories') {
            const categories = Object.keys(savedWords).sort((a, b) => a.localeCompare(b));
            if (categories.length === 0) {
                tempListContainer.innerHTML = '<p>No notes saved yet. Click on a word in a story to save it here.</p>';
            } else {
                categories.forEach(category => createListItem(category, () => renderNoteView('titles', category), tempListContainer));
            }
            backToHomeFromNoteBtn.textContent = 'Back to Home';
            backToHomeFromNoteBtn.onclick = () => showView(homeView);
        } else { // 'titles' level
            const titles = Object.keys(savedWords[categoryName]).sort((a, b) => a.localeCompare(b));
            titles.forEach(title => createListItem(title, () => renderNoteView('words', categoryName, title), tempListContainer));
            backToHomeFromNoteBtn.textContent = 'Back to Categories';
            backToHomeFromNoteBtn.onclick = () => renderNoteView('categories'); 
        }

    } else if (level === 'words' && categoryName && titleName) {
        // For the detailed word/sentence view, set up the three-list structure with collapsible headers
        noteContentWrapper.innerHTML = `
            <div class="note-section-header is-expanded" data-target="note-list-words">
                <h3>Words</h3>
                <span class="toggle-icon"></span>
            </div>
            <div id="note-list-words" class="list"></div>

            <div class="note-section-header is-expanded" data-target="note-list-phrases">
                <h3>Phrases</h3>
                <span class="toggle-icon"></span>
            </div>
            <div id="note-list-phrases" class="list"></div>

            <div class="note-section-header is-expanded" data-target="note-list-sentences">
                <h3>Sentences</h3>
                <span class="toggle-icon"></span>
            </div>
            <div id="note-list-sentences" class="list"></div>
        `;
        // Get references to the newly created containers
        const noteListWordsContainer = document.getElementById('note-list-words');
        const noteListPhrasesContainer = document.getElementById('note-list-phrases');
        const noteListSentencesContainer = document.getElementById('note-list-sentences');

        // Configure UI elements for this view
        noteViewCategory = categoryName;
        noteViewTitle = titleName;
        backToStoryFromNoteBtn.hidden = false;
        addWordForm.hidden = false;

        const noteData = savedWords[categoryName]?.[titleName] || { words: new Set(), phrases: new Set(), sentences: new Set() };

        const sortItems = (set) => Array.from(set).sort((a, b) => {
            const lengthDifference = a.length - b.length;
            if (lengthDifference !== 0) return lengthDifference;
            return a.localeCompare(b);
        });

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

                if (type === 'words' || type === 'phrases') {
                    // Use the raw content URL from GitHub
                    const baseUrl = 'https://raw.githubusercontent.com/BoydYang-Designer/English-vocabulary/main/audio_files/';
                    // Convert to lowercase for case-insensitive matching
                    const audioSrc = baseUrl + encodeURIComponent(itemText.trim().toLowerCase()) + '.mp3';

                    const wordAudio = new Audio(audioSrc);

                    wordAudio.play().catch(err => {
                        console.error(`Could not play audio for "${itemText}":`, err);
                        // The alert here is removed to prevent a second message.
                    });

                    wordAudio.onerror = () => {
                        console.error(`Audio file not found for "${itemText}" at ${audioSrc}`);
                        alert(`Audio for "${itemText}" was not found.`);
                    };

                } else { // type === 'sentences'
                    // Placeholder for future functionality for sentences
                    alert(`Voice function for SENTENCE: "${itemText}"`);
                }
            });
            
            const wordBtn = document.createElement('button');
            wordBtn.textContent = 'Word';
            wordBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const baseUrl = 'https://boydyang-designer.github.io/English-vocabulary/';
                const wordForUrl = itemText.trim().toLowerCase();
                
                if (wordForUrl.includes(' ')) {
                    alert("「Word」查詢功能僅適用於單一單字。");
                    return;
                }
                
                const finalUrl = `${baseUrl}?word=${wordForUrl}&from=story`;
                window.location.href = finalUrl;
            });

            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(itemText).then(() => {
                    copyBtn.classList.add('btn-success-feedback');
                    setTimeout(() => copyBtn.classList.remove('btn-success-feedback'), 500);
                }).catch(err => console.error('Failed to copy item:', err));
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'secondary';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete '${itemText}'?`)) {
                    savedWords[categoryName][titleName][type].delete(itemText);
                    const category = savedWords[categoryName];
                    const title = category[titleName];
                    if (title.words.size === 0 && title.phrases.size === 0 && title.sentences.size === 0) delete category[titleName];
                    if (Object.keys(category).length === 0) delete savedWords[categoryName];
                    saveWordsToStorage();

                    if (!savedWords[categoryName]) renderNoteView('categories');
                    else if (!savedWords[categoryName][titleName]) renderNoteView('titles', categoryName);
                    else renderNoteView('words', categoryName, titleName);
                }
            });

            actions.appendChild(voiceBtn);
            actions.appendChild(wordBtn);
            actions.appendChild(copyBtn);
            actions.appendChild(deleteBtn);
            item.appendChild(wordTextEl);
            item.appendChild(actions);
            container.appendChild(item);
        };

        const words = sortItems(noteData.words);
        if (words.length === 0) {
            noteListWordsContainer.innerHTML = '<p>No words saved yet.</p>';
        } else {
            words.forEach(word => createWordItem(word, 'words', noteListWordsContainer));
        }

        const phrases = sortItems(noteData.phrases);
        if (phrases.length === 0) {
            noteListPhrasesContainer.innerHTML = '<p>No phrases saved yet.</p>';
        } else {
            phrases.forEach(phrase => createWordItem(phrase, 'phrases', noteListPhrasesContainer));
        }

        const sentences = sortItems(noteData.sentences);
        if (sentences.length === 0) {
            noteListSentencesContainer.innerHTML = '<p>No sentences saved yet.</p>';
        } else {
            sentences.forEach(sentence => createWordItem(sentence, 'sentences', noteListSentencesContainer));
        }

        backToHomeFromNoteBtn.textContent = 'Back to Titles';
        backToHomeFromNoteBtn.onclick = () => renderNoteView('titles', categoryName);
    }
}


function addWordToNote(text, category, title) {
    const cleanedText = text.trim();
    if (!cleanedText || !category || !title) return;

    if (!savedWords[category]) savedWords[category] = {};
    if (!savedWords[category][title]) {
        // Initialize with the new structure
        savedWords[category][title] = { words: new Set(), phrases: new Set(), sentences: new Set() };
    }

    // Classify and add to the correct Set
    const type = classifyEntry(cleanedText);
    savedWords[category][title][type].add(cleanedText);

    saveWordsToStorage();
}


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
    const sortedItems = Array.from(allItems).sort((a, b) => a.localeCompare(b));
    const textToCopy = sortedItems.join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
        alert(`${allItems.size} total items copied to clipboard.`);
    }).catch(err => {
        console.error('Failed to copy items: ', err);
        alert('Could not copy items. Please try again.');
    });
});

function cleanWord(word) {
  if (!word) return '';
  const punctuationRegex = /^[.,?!:;'"`“”‘’()[\]{}\-/*]+|[.,?!:;'"`“”‘’()[\]{}\-/*]+$/g;
  return word.replace(punctuationRegex, '');
}


textContainer.addEventListener('click', (e) => {
    const wordSpan = e.target.closest('.clickable-word');
    const selection = window.getSelection();
    if (wordSpan && selection.isCollapsed) {
        const rawWord = wordSpan.textContent;
        const cleanedWord = cleanWord(rawWord);

        if (cleanedWord) {
            const stagedWordEl = document.createElement('span');
            stagedWordEl.className = 'staged-word';
            stagedWordEl.textContent = cleanedWord;
            stagedWordsContainer.appendChild(stagedWordEl);
        }
    }
});


stagedWordsContainer.addEventListener('click', (e) => {
    const targetWord = e.target.closest('.staged-word');
    if (targetWord) {
        targetWord.remove();
    }
});

clearStagingBtn.addEventListener('click', () => {
    stagedWordsContainer.innerHTML = '';
});


addToNoteBtn.addEventListener('click', () => {
    const stagedWords = Array.from(stagedWordsContainer.querySelectorAll('.staged-word'));

    if (stagedWords.length === 0) {
        console.warn("Staging area is empty. Click words from the story to add them first.");
        return;
    }

    const textToAdd = stagedWords.map(el => el.textContent).join(' ');

    if (textToAdd) {
        addWordToNote(textToAdd, currentCategoryName, currentStoryTitle);
        navigator.clipboard.writeText(textToAdd).then(() => {
            console.log(`'${textToAdd}' has been added to notes and copied.`);
        }).catch(err => {
            console.error('Clipboard write failed: ', err);
        });

        stagedWordsContainer.innerHTML = '';
    }
});

addManualWordBtn.addEventListener('click', () => {
    const newWord = newWordInput.value.trim();
    if (newWord === '') {
        alert('Please enter a word or sentence.');
        return;
    }
    if (noteViewCategory && noteViewTitle) {
        addWordToNote(newWord, noteViewCategory, noteViewTitle);
        newWordInput.value = '';
        newWordInput.focus();
        renderNoteView('words', noteViewCategory, noteViewTitle);
    } else {
        alert('Could not determine the note category. Please navigate to a specific story\'s note list.');
    }
});

newWordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault();
        addManualWordBtn.click();
    }
});

function parafyAndMakeClickable(text) {
    const cleaned = String(text)
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .trim();
    const paragraphs = cleaned.split(/\n+/);
    const frag = document.createDocumentFragment();

    paragraphs.forEach(pText => {
        const p = document.createElement('p');
        if (pText.trim() === '') {
            p.innerHTML = '&nbsp;';
        } else {
            const parts = pText.split(/(\s+|—|–)/);

            parts.forEach(part => {
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
  const base = 'audio/';
  const candidates = [];
  candidates.push(base + encodeURIComponent(title.trim()) + '.mp3');
  return candidates;
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
  const candidate = audioTriedCandidates.shift();
  audio.src = candidate;
  audio.load();
  const playAttempt = audio.play();
  if (playAttempt && typeof playAttempt.then === 'function') {
    playAttempt.catch(() => {
      playPauseBtn.classList.remove('is-playing');
    });
  }
  audio.onerror = () => {
    tryNextAudioCandidate();
  };
}

function computeScrollMax() {
  scrollMax = Math.max(0, textContainer.scrollHeight - textContainer.clientHeight);
}

function tickScroll() {
  if (!isPlaying) return;
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : durationFallback;
  const progress = duration ? (audio.currentTime / duration) : 0;
  textContainer.scrollTop = progress * scrollMax;
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
  if (!res.ok) throw new Error('Failed to fetch story.json (HTTP ' + res.status + ')');
  const data = await res.json();
  stories = Array.isArray(data['New Words']) ? data['New Words'] : [];
}

function renderCategories() {
  const categories = [...new Set(
    stories.flatMap(item =>
      Array.isArray(item['分類']) ? item['分類'].map(c => c.trim()) : []
    ).filter(Boolean)
  )].sort();
  categoryList.innerHTML = '';
  const lastSession = localStorage.getItem(LAST_SESSION_KEY);
  if (lastSession) {
      try {
          const { title, time } = JSON.parse(lastSession);
          if (title && typeof time === 'number') {
              const continueBtn = document.createElement('div');
              continueBtn.className = 'category-item';
              continueBtn.id = 'continue-last-session-btn';
              continueBtn.innerHTML = `
                <svg class="continue-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <path d="M8 5v14l11-7z"></path>
                </svg>
                <span>Continue Last Session</span>
              `;
              continueBtn.tabIndex = 0;
              continueBtn.addEventListener('click', () => resumeLastPlayback(title, time));
              categoryList.appendChild(continueBtn);
          }
      } catch (e) {
          console.error("Failed to parse last session data", e);
      }
  }
  for (const category of categories) {
    const div = document.createElement('div');
    div.className = 'category-item';
    div.textContent = category;
    div.tabIndex = 0;
    div.addEventListener('click', () => showCategory(category));
    categoryList.appendChild(div);
  }
}

function resumeLastPlayback(title, time) {
    const story = stories.find(s => s['標題'] === title);
    if (!story) {
        alert("Could not find the story from your last session. It might have been updated.");
        clearLastPlaybackState();
        renderCategories();
        return;
    }
    const category = story['分類'] && story['分類'][0] ? story['分類'][0] : null;
    if (!category) {
        alert("Could not determine the category for the story from your last session.");
        return;
    }
    showCategory(category);
    const indexInList = currentStoryList.findIndex(s => s['標題'] === title);
    if (indexInList === -1) {
        alert("Could not find the story within its category.");
        return;
    }
    showPlayback(indexInList, time);
}

function showCategory(category) {
  showView(categoryView);
  categoryTitle.textContent = category;
  currentCategoryName = category;
  titleList.innerHTML = '';
  const titles = stories.filter(item =>
    Array.isArray(item['分類']) && item['分類'].map(c => c.trim()).includes(category)
  );
  titles.sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));
  currentStoryList = titles;
  titles.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'title-item';
    div.textContent = item['標題'];
    div.tabIndex = 0;
    div.addEventListener('click', () => showPlayback(index));
    titleList.appendChild(div);
  });
}

function showPlayback(index, startTime = 0) {
  stagedWordsContainer.innerHTML = '';
  currentStoryIndex = index;
  const story = currentStoryList[currentStoryIndex];
  if (!story) {
      console.error('Story not found at index:', index);
      return;
  }
  const { '標題': title, '內文': content } = story;
  currentStoryTitle = title;
  showView(playbackView);
  playbackTitle.textContent = title;
  textContainer.innerHTML = '';
  const contentWithPadding = '\n\n' + content;
  textContainer.appendChild(parafyAndMakeClickable(contentWithPadding));
  textContainer.scrollTop = 0;
  progressBar.value = 0;
  setAudioSourceWithFallback(title);
  prevStoryBtn.hidden = currentStoryIndex <= 0;
  nextStoryBtn.hidden = currentStoryIndex >= currentStoryList.length - 1;
  const onLoaded = () => {
    if (startTime > 0) {
        audio.currentTime = startTime;
    }
    if (!audio.paused && !audio.ended) {
      isPlaying = true;
      playPauseBtn.classList.add('is-playing');
      startScroll();
    }
    audio.removeEventListener('loadedmetadata', onLoaded);
  };
  audio.addEventListener('loadedmetadata', onLoaded);
  if (!audio.paused) {
    isPlaying = true;
    playPauseBtn.classList.add('is-playing');
    startScroll();
  }
}

backToHomeBtn.addEventListener('click', () => {
  stopAudioAndReset();
  showView(homeView);
});

backToCategoryBtn.addEventListener('click', () => {
  stopAudioAndReset();
  showView(categoryView);
});

function stopAudioAndReset() {
  stagedWordsContainer.innerHTML = '';
  stopScroll();
  try { audio.pause(); } catch {}
  audio.currentTime = 0;
  isPlaying = false;
  playPauseBtn.classList.remove('is-playing');
  textContainer.scrollTop = 0;
  progressBar.value = 0;
  currentStoryTitle = null;
  currentCategoryName = null;
  playbackPositionBeforeNote = 0;
}

rewindBtn.addEventListener('click', () => {
  audio.currentTime = Math.max(0, audio.currentTime - 5);
});

forwardBtn.addEventListener('click', () => {
  audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
});

playPauseBtn.addEventListener('click', () => {
  if (isPlaying) {
    audio.pause();
  } else {
    audio.play().catch(err => {
      console.log('Autoplay blocked:', err);
    });
  }
});

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
        currentCategoryName = categoryTitle.textContent;
        showPlayback(currentStoryIndex - 1);
    }
});

nextStoryBtn.addEventListener('click', () => {
    if (currentStoryIndex < currentStoryList.length - 1) {
        stopAudioAndReset();
        currentCategoryName = categoryTitle.textContent;
        showPlayback(currentStoryIndex + 1);
    }
});

function updateProgressBar() {
    if (audio.duration) {
        const progressPercent = (audio.currentTime / audio.duration) * 100;
        progressBar.value = progressPercent;
    }
}

function seekAudio() {
    if (audio.duration) {
        const seekTime = (progressBar.value / 100) * audio.duration;
        audio.currentTime = seekTime;
    }
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
        const story = stories.find(s => s['標題'] === noteViewTitle);
        if (!story) {
            alert("Could not find the story to return to.");
            return;
        }
        showCategory(noteViewCategory);
        const indexInList = currentStoryList.findIndex(s => s['標題'] === noteViewTitle);
        if (indexInList === -1) {
            alert("Could not find the story within its category list.");
            return;
        }
        showPlayback(indexInList, playbackPositionBeforeNote);
    }
});

copyStagedBtn.addEventListener('click', () => {
    const stagedWords = Array.from(stagedWordsContainer.querySelectorAll('.staged-word'));
    if (stagedWords.length === 0) {
        console.warn("Staging area is empty.");
        return;
    }
    const textToCopy = stagedWords.map(el => el.textContent).join(' ');
    navigator.clipboard.writeText(textToCopy).then(() => {
        copyStagedBtn.classList.add('btn-success-feedback');
        setTimeout(() => {
            copyStagedBtn.classList.remove('btn-success-feedback');
        }, 500);
    }).catch(err => {
        console.error('Failed to copy staged words:', err);
    });
});


window.addEventListener('resize', computeScrollMax, { passive: true });
audio.addEventListener('ended', () => {
    clearLastPlaybackState();
    stopAudioAndReset();
    const continueBtn = document.getElementById('continue-last-session-btn');
    if (continueBtn) continueBtn.remove();
});
audio.addEventListener('timeupdate', updateProgressBar);
progressBar.addEventListener('input', seekAudio);

(async function init() {
  try {
    // Add event listener for collapsible note sections
    const noteContentWrapper = document.getElementById('note-content-wrapper');
    noteContentWrapper.addEventListener('click', (e) => {
        const header = e.target.closest('.note-section-header');
        if (!header) return;

        const targetId = header.dataset.target;
        if (!targetId) return;

        const targetList = document.getElementById(targetId);
        if (targetList) {
            header.classList.toggle('is-expanded');
            targetList.classList.toggle('collapsed');
        }
    });

    loadWordsFromStorage();
    await loadStories();
    renderCategories();
    showView(homeView);
  } catch (err) {
    console.error('Error loading JSON:', err);
    alert('Failed to load story.json.');
  }
})();

document.addEventListener('keydown', (event) => {
  if (playbackView.hidden === false) {
    switch (event.code) {
      case 'Space':
        event.preventDefault();
        playPauseBtn.click();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        rewindBtn.click();
        break;
      case 'ArrowRight':
        event.preventDefault();
        forwardBtn.click();
        break;
    }
  }
});