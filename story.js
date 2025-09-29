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


// --- Storage Functions ---
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

exportWordsBtn.addEventListener('click', () => {
    if (savedWords.size === 0) {
        alert("No words to export.");
        return;
    }
    const data = JSON.stringify(Array.from(savedWords), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my_words.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
            // Split by space to wrap each word in a span
            const words = pText.split(/(\s+)/); // Keep spaces
            words.forEach(word => {
                if (word.trim().length > 0) {
                    const span = document.createElement('span');
                    span.className = 'clickable-word';
                    span.textContent = word;
                    p.appendChild(span);
                } else {
                    // Append spaces as text nodes
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
        const word = e.target.textContent.trim();
        navigator.clipboard.writeText(word).then(() => {
            addWordToNote(word);
            alert(`'${word}' copied and added to notes!`);
        }).catch(err => {
            console.error('Failed to copy word: ', err);
        });
    }
});


function sanitizeTitleBasic(title) {
  return title
    .toLowerCase()
    .replace(/[“”‘’]/g, '')
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/[^a-z0-9\-\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAudioCandidates(title) {
  const base = 'audio/'; // mp3 檔案都放在 audio 資料夾
  const candidates = [];
  // 直接使用 JSON 的標題當檔名
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
  for (const category of categories) {
    const div = document.createElement('div');
    div.className = 'category-item';
    div.textContent = category;
    div.tabIndex = 0;
    div.addEventListener('click', () => showCategory(category));
    categoryList.appendChild(div);
  }
}

function showCategory(category) {
  showView(categoryView);
  categoryTitle.textContent = category;
  titleList.innerHTML = '';

  const titles = stories.filter(item =>
    Array.isArray(item['分類']) && item['分類'].map(c => c.trim()).includes(category)
  );

  titles.sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));
  
  // Store the filtered and sorted list for navigation
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

function showPlayback(index) {
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
  setAudioSourceWithFallback(title);

  // Update button visibility
  prevStoryBtn.hidden = currentStoryIndex <= 0;
  nextStoryBtn.hidden = currentStoryIndex >= currentStoryList.length - 1;

  const onLoaded = () => {
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
  stopScroll();
  try { audio.pause(); } catch {}
  audio.currentTime = 0;
  isPlaying = false;
  playPauseBtn.textContent = '▶️';
  textContainer.scrollTop = 0;
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
    isPlaying = false;
    playPauseBtn.textContent = '▶️';
    stopScroll();
  } else {
    audio.play().catch(err => {
      console.log('Autoplay blocked:', err);
    });
    isPlaying = true;
    playPauseBtn.textContent = '⏸️';
    startScroll();
  }
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


window.addEventListener('resize', computeScrollMax, { passive: true });
audio.addEventListener('ended', stopAudioAndReset);

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