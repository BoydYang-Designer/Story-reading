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


// Note view elements
const goToNoteBtn = document.getElementById('go-to-note');
const backToHomeFromNoteBtn = document.getElementById('back-to-home-from-note');
const wordNoteList = document.getElementById('word-note-list');
const exportWordsBtn = document.getElementById('export-words-btn');

let stories = [];
let isPlaying = false;
let rafId = null;
let scrollMax = 0;
let durationFallback = 59;
let audioTriedCandidates = [];
let savedWords = new Set();
let currentStoryList = [];
let currentStoryIndex = -1;
let progressSaveInterval = null;


// --- Storage Functions ---
const LAST_SESSION_KEY = 'readingChallengeLastSession';

function loadWordsFromStorage() {
  const storedWords = localStorage.getItem('readingChallengeSavedWords');
  if (storedWords) {
    try {
      const wordsArray = JSON.parse(storedWords);
      savedWords = new Set(wordsArray);
    } catch (e) {
      console.error("Failed to parse words from localStorage", e);
      savedWords = new Set();
    }
  }
}

function saveWordsToStorage() {
  localStorage.setItem('readingChallengeSavedWords', JSON.stringify(Array.from(savedWords)));
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
function renderSavedWords() {
    wordNoteList.innerHTML = '';
    const sortedWords = Array.from(savedWords).sort((a, b) => a.localeCompare(b));

    if (sortedWords.length === 0) {
        wordNoteList.innerHTML = '<p>No words saved yet. Click on a word in a story to save it here.</p>';
        return;
    }

    for (const word of sortedWords) {
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
                savedWords.delete(word);
                saveWordsToStorage();
                renderSavedWords();
            }
        });

        actions.appendChild(copyBtn);
        actions.appendChild(deleteBtn);
        item.appendChild(wordText);
        item.appendChild(actions);
        wordNoteList.appendChild(item);
    }
}

function addWordToNote(word) {
    const cleanedWord = word.trim().replace(/[^a-zA-Z'-]/g, '');
    if (cleanedWord) {
        savedWords.add(cleanedWord);
        saveWordsToStorage();
    }
}

goToNoteBtn.addEventListener('click', () => {
    renderSavedWords();
    showView(noteView);
});

backToHomeFromNoteBtn.addEventListener('click', () => showView(homeView));

// MODIFIED: Changed from Export to Copy All
exportWordsBtn.addEventListener('click', () => {
    if (savedWords.size === 0) {
        alert("No words to copy.");
        return;
    }
    const sortedWords = Array.from(savedWords).sort((a, b) => a.localeCompare(b));
    const textToCopy = sortedWords.join('\n'); // Join with newlines
    navigator.clipboard.writeText(textToCopy).then(() => {
        alert(`${savedWords.size} words copied to clipboard.`);
    }).catch(err => {
        console.error('Failed to copy words: ', err);
        alert('Could not copy words. Please try again.');
    });
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
            const words = pText.split(/(\s+)/);
            words.forEach(word => {
                if (word.trim().length > 0) {
                    const span = document.createElement('span');
                    span.className = 'clickable-word';
                    span.textContent = word;
                    p.appendChild(span);
                } else {
                    p.appendChild(document.createTextNode(word));
                }
            });
        }
        frag.appendChild(p);
    });
    return frag;
}

textContainer.addEventListener('click', (e) => {
    if (e.target.classList.contains('clickable-word')) {
        const clickedWordElement = e.target;
        const word = clickedWordElement.textContent.trim();

        navigator.clipboard.writeText(word).then(() => {
            addWordToNote(word);
            clickedWordElement.classList.add('word-copied-highlight');
            setTimeout(() => {
                clickedWordElement.classList.remove('word-copied-highlight');
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy word: ', err);
        });
    }
});

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
    playPauseBtn.textContent = '▶️';
    isPlaying = false;
    return;
  }
  const candidate = audioTriedCandidates.shift();
  audio.src = candidate;
  audio.load();
  const playAttempt = audio.play();
  if (playAttempt && typeof playAttempt.then === 'function') {
    playAttempt.catch(() => {
      playPauseBtn.textContent = '▶️';
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
  // NEW: Start saving progress periodically
  if (progressSaveInterval) clearInterval(progressSaveInterval);
  progressSaveInterval = setInterval(saveLastPlaybackState, 3000); // Save every 3 seconds
}

function stopScroll() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  // NEW: Stop saving progress
  if (progressSaveInterval) clearInterval(progressSaveInterval);
  progressSaveInterval = null;
}

async function loadStories() {
  const res = await fetch('https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/story.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch story.json (HTTP ' + res.status + ')');
  const data = await res.json();
  stories = Array.isArray(data['New Words']) ? data['New Words'] : [];
}

// MODIFIED: Added logic to create "Continue" button
function renderCategories() {
  const categories = [...new Set(
    stories.flatMap(item =>
      Array.isArray(item['分類']) ? item['分類'].map(c => c.trim()) : []
    ).filter(Boolean)
  )].sort();

  categoryList.innerHTML = '';

  // NEW: Add "Continue Last Session" button if data exists
  const lastSession = localStorage.getItem(LAST_SESSION_KEY);
  if (lastSession) {
      try {
          const { title, time } = JSON.parse(lastSession);
          if (title && typeof time === 'number') {
              const continueBtn = document.createElement('div');
              continueBtn.className = 'category-item';
              continueBtn.id = 'continue-last-session-btn';
              continueBtn.textContent = '▶️ Continue Last Session';
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

// NEW: Function to handle resuming playback
function resumeLastPlayback(title, time) {
    const story = stories.find(s => s['標題'] === title);
    if (!story) {
        alert("Could not find the story from your last session. It might have been updated.");
        clearLastPlaybackState();
        renderCategories(); // Re-render to remove the button
        return;
    }
    
    const category = story['分類'] && story['分類'][0] ? story['分類'][0] : null;
    if (!category) {
        alert("Could not determine the category for the story from your last session.");
        return;
    }

    // This sets up the context (currentStoryList) needed by showPlayback
    showCategory(category); 

    const indexInList = currentStoryList.findIndex(s => s['標題'] === title);
    if (indexInList === -1) {
        alert("Could not find the story within its category.");
        return;
    }

    // Now call showPlayback with the correct index and the saved time
    showPlayback(indexInList, time);
}

function showCategory(category) {
  showView(categoryView);
  categoryTitle.textContent = category;
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

// MODIFIED: Added startTime parameter
function showPlayback(index, startTime = 0) {
  currentStoryIndex = index;
  const story = currentStoryList[currentStoryIndex];
  
  if (!story) {
      console.error('Story not found at index:', index);
      return;
  }
  const { '標題': title, '內文': content } = story;

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
    // Set the start time after metadata is loaded
    if (startTime > 0) {
        audio.currentTime = startTime;
    }
    if (!audio.paused && !audio.ended) {
      isPlaying = true;
      playPauseBtn.textContent = '⏸️';
      startScroll();
    }
    audio.removeEventListener('loadedmetadata', onLoaded);
  };
  audio.addEventListener('loadedmetadata', onLoaded);

  if (!audio.paused) {
    isPlaying = true;
    playPauseBtn.textContent = '⏸️';
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
  saveLastPlaybackState(); // Save final position before stopping
  stopScroll();
  try { audio.pause(); } catch {}
  audio.currentTime = 0;
  isPlaying = false;
  playPauseBtn.textContent = '▶️';
  textContainer.scrollTop = 0;
  progressBar.value = 0;
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

// NEW: Handle play/pause state changes from audio element itself
audio.addEventListener('play', () => {
    isPlaying = true;
    playPauseBtn.textContent = '⏸️';
    startScroll();
});

audio.addEventListener('pause', () => {
    isPlaying = false;
    playPauseBtn.textContent = '▶️';
    stopScroll();
    saveLastPlaybackState(); // Also save when paused
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
    if (audio.duration) {
        const progressPercent = (audio.currentTime / audio.duration) * 100;
        progressBar.value = progressPercent;
    }
}

function seekAudio() {
    if (audio.duration) {
        const seekTime = (progressBar.value / 100) * audio.duration;
        audio.currentTime = seekTime;
        // The tickScroll function will naturally update the scroll position
    }
}

window.addEventListener('resize', computeScrollMax, { passive: true });
audio.addEventListener('ended', () => {
    clearLastPlaybackState(); // Clear state when story finishes
    stopAudioAndReset();
    const continueBtn = document.getElementById('continue-last-session-btn');
    if (continueBtn) continueBtn.hidden = true; // Hide button after finishing
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