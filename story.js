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

// Note view elements
const goToNoteBtn = document.getElementById('go-to-note');
const backToHomeFromNoteBtn = document.getElementById('back-to-home-from-note');
const wordNoteList = document.getElementById('word-note-list');
const exportWordsBtn = document.getElementById('export-words-btn');
const goToStoryNoteBtn = document.getElementById('go-to-story-note-btn');
const backToStoryFromNoteBtn = document.getElementById('back-to-story-from-note-btn');
// START: New elements for manual word adding
const addWordForm = document.getElementById('add-word-form');
const newWordInput = document.getElementById('new-word-input');
const addManualWordBtn = document.getElementById('add-manual-word-btn');
// END: New elements

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

function loadWordsFromStorage() {
  const storedWords = localStorage.getItem(SAVED_WORDS_KEY);
  if (storedWords) {
    try {
      const parsed = JSON.parse(storedWords);
      for (const category in parsed) {
        if (typeof parsed[category] === 'object') {
          for (const title in parsed[category]) {
            if (Array.isArray(parsed[category][title])) {
              if (!savedWords[category]) {
                savedWords[category] = {};
              }
              savedWords[category][title] = new Set(parsed[category][title]);
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
            serializableWords[category][title] = Array.from(savedWords[category][title]);
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
        console.log('Playback state saved:', state);
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
    wordNoteList.innerHTML = '';
    const noteActions = document.querySelector('.note-actions');
    
    // Hide the manual add form by default
    addWordForm.hidden = true;

    if (level === 'words' && categoryName && titleName) {
        backToStoryFromNoteBtn.hidden = false;
        noteViewCategory = categoryName;
        noteViewTitle = titleName;
        // Show the manual add form ONLY when viewing a word list
        addWordForm.hidden = false;
    } else {
        backToStoryFromNoteBtn.hidden = true;
        noteViewCategory = null;
        noteViewTitle = null;
    }

    const createItem = (text, clickHandler) => {
        const item = document.createElement('div');
        item.className = 'category-item';
        item.textContent = text;
        item.addEventListener('click', clickHandler);
        wordNoteList.appendChild(item);
    };

    if (level === 'categories') {
        const categories = Object.keys(savedWords).sort((a, b) => a.localeCompare(b));
        if (categories.length === 0) {
            wordNoteList.innerHTML = '<p>No words saved yet. Click on a word in a story to save it here.</p>';
        } else {
            categories.forEach(category => createItem(category, () => renderNoteView('titles', category)));
        }
        backToHomeFromNoteBtn.textContent = 'Back to Home';
        backToHomeFromNoteBtn.onclick = () => showView(homeView);
        noteActions.style.display = 'flex';

    } else if (level === 'titles' && categoryName) {
        const titles = Object.keys(savedWords[categoryName]).sort((a, b) => a.localeCompare(b));
        titles.forEach(title => createItem(title, () => renderNoteView('words', categoryName, title)));
        backToHomeFromNoteBtn.textContent = 'Back to Categories';
        backToHomeFromNoteBtn.onclick = () => renderNoteView('categories');

    } else if (level === 'words' && categoryName && titleName) {
        const words = savedWords[categoryName]?.[titleName] 
            ? Array.from(savedWords[categoryName][titleName]).sort((a, b) => a.localeCompare(b))
            : [];

        if (words.length === 0) {
            const p = document.createElement('p');
            p.textContent = 'No words saved for this story yet.';
            wordNoteList.appendChild(p);
        }

        for (const word of words) {
            const item = document.createElement('div');
            item.className = 'word-item';
            const wordText = document.createElement('span');
            wordText.className = 'word-text';
            wordText.textContent = word;
            const actions = document.createElement('div');
            actions.className = 'word-item-actions';
            const copyBtn = document.createElement('button');
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(word).then(() => {
                    alert(`'${word}' copied to clipboard.`);
                });
            });
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'secondary';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`Are you sure you want to delete '${word}'?`)) {
                    savedWords[categoryName][titleName].delete(word);
                    if (savedWords[categoryName][titleName].size === 0) {
                        delete savedWords[categoryName][titleName];
                    }
                    if (Object.keys(savedWords[categoryName]).length === 0) {
                        delete savedWords[categoryName];
                    }
                    saveWordsToStorage();
                    if (!savedWords[categoryName]) {
                        renderNoteView('categories');
                    } else if (!savedWords[categoryName][titleName]) {
                        renderNoteView('titles', categoryName);
                    } else {
                        renderNoteView('words', categoryName, titleName);
                    }
                }
            });
            actions.appendChild(copyBtn);
            actions.appendChild(deleteBtn);
            item.appendChild(wordText);
            item.appendChild(actions);
            wordNoteList.appendChild(item);
        }
        backToHomeFromNoteBtn.textContent = 'Back to Titles';
        backToHomeFromNoteBtn.onclick = () => renderNoteView('titles', categoryName);
    }
}

// MODIFIED: This function now accepts category and title for more flexibility.
function addWordToNote(text, category, title) {
    const cleanedText = text.trim();
    if (cleanedText && category && title) {
        if (!savedWords[category]) {
            savedWords[category] = {};
        }
        if (!savedWords[category][title]) {
            savedWords[category][title] = new Set();
        }
        savedWords[category][title].add(cleanedText);
        saveWordsToStorage();
    }
}


goToNoteBtn.addEventListener('click', () => {
    renderNoteView('categories');
    showView(noteView);
});

exportWordsBtn.addEventListener('click', () => {
    const allWords = new Set();
    for (const category in savedWords) {
        for (const title in savedWords[category]) {
            savedWords[category][title].forEach(word => allWords.add(word));
        }
    }
    if (allWords.size === 0) {
        alert("No words to copy.");
        return;
    }
    const sortedWords = Array.from(allWords).sort((a, b) => a.localeCompare(b));
    const textToCopy = sortedWords.join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
        alert(`${allWords.size} total words copied to clipboard.`);
    }).catch(err => {
        console.error('Failed to copy words: ', err);
        alert('Could not copy words. Please try again.');
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
        alert("Staging area is empty. Click words from the story to add them first.");
        return;
    }

    const textToAdd = stagedWords.map(el => el.textContent).join(' ');

    if (textToAdd) {
        // MODIFIED: Call the updated function with current story context
        addWordToNote(textToAdd, currentCategoryName, currentStoryTitle);
        navigator.clipboard.writeText(textToAdd).then(() => {
            alert(`'${textToAdd}' has been added to your notes and copied to the clipboard.`);
        }).catch(err => {
            console.error('Clipboard write failed: ', err);
            alert(`'${textToAdd}' was added to your notes, but failed to copy to the clipboard.`);
        });
        
        stagedWordsContainer.innerHTML = '';
    }
});

// START: New event listener for the manual add button
addManualWordBtn.addEventListener('click', () => {
    const newWord = newWordInput.value.trim();
    if (newWord === '') {
        alert('Please enter a word or sentence.');
        return;
    }

    // Use the category/title of the currently viewed note list
    if (noteViewCategory && noteViewTitle) {
        addWordToNote(newWord, noteViewCategory, noteViewTitle);
        newWordInput.value = ''; // Clear the input
        newWordInput.focus(); // Keep focus on the input for quick adding
        // Re-render the current list to show the new word
        renderNoteView('words', noteViewCategory, noteViewTitle);
    } else {
        alert('Could not determine the note category. Please navigate to a specific story\'s note list.');
    }
});

// Also allow adding by pressing Enter in the input field
newWordInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        event.preventDefault(); // Prevent any default form submission behavior
        addManualWordBtn.click();
    }
});
// END: New event listener

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
        if (savedWords[currentCategoryName] && savedWords[currentCategoryName][currentStoryTitle]) {
             renderNoteView('words', currentCategoryName, currentStoryTitle);
             showView(noteView);
        } else {
             // If no notes exist, still go to the view so the user can add one manually
             renderNoteView('words', currentCategoryName, currentStoryTitle);
             showView(noteView);
        }
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