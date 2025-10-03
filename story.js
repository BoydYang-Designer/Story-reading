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
const addToNoteBtn = document.getElementById('add-to-note-btn'); // 新增：獲取按鈕


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
// MODIFIED: savedWords is now an object to store categorized words.
let savedWords = {};
let currentStoryList = [];
let currentStoryIndex = -1;
// NEW: State for current story context
let currentCategoryName = null;
let currentStoryTitle = null;


// --- Storage Functions ---
const LAST_SESSION_KEY = 'readingChallengeLastSession';
const SAVED_WORDS_KEY = 'readingChallengeSavedWordsV2'; // New key for new data structure

function loadWordsFromStorage() {
  const storedWords = localStorage.getItem(SAVED_WORDS_KEY);
  if (storedWords) {
    try {
      const parsed = JSON.parse(storedWords);
      // Convert word arrays back to Sets for efficient operations
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
    // Create a new object to hold arrays instead of Sets for JSON compatibility
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

// --- MODIFIED: Word Note Functions ---

function renderNoteView(level = 'categories', categoryName = null, titleName = null) {
    wordNoteList.innerHTML = '';
    const noteActions = document.querySelector('.note-actions');

    // Helper to create a list item
    const createItem = (text, clickHandler) => {
        const item = document.createElement('div');
        item.className = 'category-item'; // Re-use existing style
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
        const words = Array.from(savedWords[categoryName][titleName]).sort((a, b) => a.localeCompare(b));

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
                    // Delete the word
                    savedWords[categoryName][titleName].delete(word);

                    // If title has no more words, remove title
                    if (savedWords[categoryName][titleName].size === 0) {
                        delete savedWords[categoryName][titleName];
                    }
                    // If category has no more titles, remove category
                    if (Object.keys(savedWords[categoryName]).length === 0) {
                        delete savedWords[categoryName];
                    }

                    saveWordsToStorage();
                    // Re-render the correct view
                    if (!savedWords[categoryName]) {
                        renderNoteView('categories'); // Go back to categories if category is gone
                    } else if (!savedWords[categoryName][titleName]) {
                        renderNoteView('titles', categoryName); // Go back to titles if title is gone
                    } else {
                        renderNoteView('words', categoryName, titleName); // Refresh current word list
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

// 修改後：addWordToNote 函式現在可以處理任何字串
function addWordToNote(text) {
    const cleanedText = text.trim();
    if (cleanedText && currentCategoryName && currentStoryTitle) {
        // Ensure category object exists
        if (!savedWords[currentCategoryName]) {
            savedWords[currentCategoryName] = {};
        }
        // Ensure title Set exists
        if (!savedWords[currentCategoryName][currentStoryTitle]) {
            savedWords[currentCategoryName][currentStoryTitle] = new Set();
        }
        savedWords[currentCategoryName][currentStoryTitle].add(cleanedText);
        saveWordsToStorage();
    }
}


goToNoteBtn.addEventListener('click', () => {
    renderNoteView('categories');
    showView(noteView);
});

// backToHomeFromNoteBtn is now handled by renderNoteView

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

// --- MODIFICATION START ---
// 修改後：為 "Add to Note" 按鈕添加事件監聽器，增加複製到剪貼簿功能
addToNoteBtn.addEventListener('click', () => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText) {
        // 1. 將文字加入筆記
        addWordToNote(selectedText);

        // 2. 將相同的文字複製到剪貼簿
        navigator.clipboard.writeText(selectedText).then(() => {
            // 成功後，通知使用者兩項操作皆完成
            alert(`'${selectedText}' 已加入筆記並複製到剪貼簿。`);
        }).catch(err => {
            // 如果複製失敗，仍然告知使用者文字已加入筆記
            console.error('Clipboard write failed: ', err);
            alert(`'${selectedText}' 已加入筆記，但複製失敗。`);
        });
        
        // 3. 清除畫面上的選取範圍
        selection.removeAllRanges();
        
    } else {
        // 如果沒有選取任何文字，提示使用者
        alert("Please select text from the story to add to your notes.");
    }
});
// --- MODIFICATION END ---


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

// --- Robust logic for both Mouse and Touch events ---

let pressTimer = null;
let startX, startY;
let isDragging = false;
let currentTarget = null;
const dragThreshold = 10;
const pressDelay = 250;

function handleWordCopy(targetElement) {
    if (targetElement && targetElement.classList.contains('clickable-word')) {
        const word = targetElement.textContent.trim();
        navigator.clipboard.writeText(word).then(() => {
            addWordToNote(word);
            targetElement.classList.add('word-copied-highlight');
            setTimeout(() => {
                targetElement.classList.remove('word-copied-highlight');
            }, 1500);
        }).catch(err => {
            console.error('Failed to copy word: ', err);
        });
    }
}

function handlePressStart(e) {
    if (e.type === 'mousedown' && e.button !== 0) return;
    if (!e.target.classList.contains('clickable-word')) return;

    const point = e.type === 'touchstart' ? e.touches[0] : e;
    startX = point.clientX;
    startY = point.clientY;
    isDragging = false;
    currentTarget = e.target;

    pressTimer = setTimeout(() => {
        isDragging = true;
        currentTarget = null;
    }, pressDelay);
}

function handlePressMove(e) {
    if (!pressTimer) return;

    const point = e.type === 'touchmove' ? e.touches[0] : e;
    const deltaX = Math.abs(point.clientX - startX);
    const deltaY = Math.abs(point.clientY - startY);

    if (deltaX > dragThreshold || deltaY > dragThreshold) {
        isDragging = true;
        clearTimeout(pressTimer);
        pressTimer = null;
        currentTarget = null;
    }
}

function handlePressEnd(e) {
    clearTimeout(pressTimer);
    pressTimer = null;
    
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
        isDragging = true;
    }

    if (!isDragging && currentTarget) {
        handleWordCopy(currentTarget);
    }
    isDragging = false;
    currentTarget = null;
}

function handlePressCancel() {
    clearTimeout(pressTimer);
    pressTimer = null;
    isDragging = false;
    currentTarget = null;
}

textContainer.addEventListener('mousedown', handlePressStart);
textContainer.addEventListener('touchstart', handlePressStart, { passive: true });
textContainer.addEventListener('mousemove', handlePressMove);
textContainer.addEventListener('touchmove', handlePressMove, { passive: true });
textContainer.addEventListener('mouseup', handlePressEnd);
textContainer.addEventListener('touchend', handlePressEnd);
textContainer.addEventListener('mouseleave', handlePressCancel);


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
  currentCategoryName = category; // Set current category context
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
  currentStoryIndex = index;
  const story = currentStoryList[currentStoryIndex];
  
  if (!story) {
      console.error('Story not found at index:', index);
      return;
  }
  const { '標題': title, '內文': content } = story;
  currentStoryTitle = title; // Set current title context

  showView(playbackView);
  playbackTitle.textContent = title;
  textContainer.innerHTML = '';
  const contentWithPadding = '\n\n' + content;
  textContainer.appendChild(parafyAndMakeClickable(contentWithPadding));

  textContainer.scrollTop = 0;
  progressBar.value = 0;
  setAudioSourceWithFallback(title);

  // --- FIX for navigation buttons ---
  prevStoryBtn.hidden = currentStoryIndex <= 0;
  nextStoryBtn.hidden = currentStoryIndex >= currentStoryList.length - 1; // Corrected logic

  const onLoaded = () => {
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
  stopScroll();
  try { audio.pause(); } catch {}
  audio.currentTime = 0;
  isPlaying = false;
  playPauseBtn.textContent = '▶️';
  textContainer.scrollTop = 0;
  progressBar.value = 0;
  // Clear story context when leaving playback
  currentStoryTitle = null;
  currentCategoryName = null;
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
    playPauseBtn.textContent = '⏸️';
    startScroll();
    saveLastPlaybackState();
});

audio.addEventListener('pause', () => {
    isPlaying = false;
    playPauseBtn.textContent = '▶️';
    stopScroll();
    saveLastPlaybackState();
});

prevStoryBtn.addEventListener('click', () => {
    if (currentStoryIndex > 0) {
        stopAudioAndReset();
        // We need to set the category name again before showing the next story
        currentCategoryName = categoryTitle.textContent;
        showPlayback(currentStoryIndex - 1);
    }
});

nextStoryBtn.addEventListener('click', () => {
    if (currentStoryIndex < currentStoryList.length - 1) {
        stopAudioAndReset();
        // We need to set the category name again before showing the next story
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

window.addEventListener('resize', computeScrollMax, { passive: true });
audio.addEventListener('ended', () => {
    clearLastPlaybackState();
    stopAudioAndReset();
    const continueBtn = document.getElementById('continue-last-session-btn');
    if (continueBtn) continueBtn.remove(); // Remove instead of hiding to prevent re-appearing on home view
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