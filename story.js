/* Reading Challenge SPA (external JSON + audio in story folder)
 */

// ---------- DOM ----------
const homeView = document.getElementById('home-view');
const categoryView = document.getElementById('category-view');
const playbackView = document.getElementById('playback-view');
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

// ---------- State ----------
let stories = [];
let isPlaying = false;
let rafId = null;
let scrollMax = 0;
let durationFallback = 59;
let audioTriedCandidates = [];

// ---------- Utils ----------
function showView(view) {
  for (const el of [homeView, categoryView, playbackView]) {
    el.hidden = true;
  }
  view.hidden = false;
}

function parafy(text) {
  const cleaned = String(text)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
  const parts = cleaned.split(/\n\n+/);
  const frag = document.createDocumentFragment();
  for (const part of parts) {
    const p = document.createElement('p');
    p.textContent = part.trim();
    frag.appendChild(p);
  }
  return frag;
}

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
  const candidates = [];
  const basePath = 'story/';  // 音檔資料夾
  candidates.push(basePath + encodeURIComponent(title.toLowerCase().trim()) + '.mp3');
  const s = sanitizeTitleBasic(title);
  if (s && s !== title.toLowerCase().trim()) {
    candidates.push(basePath + encodeURIComponent(s) + '.mp3');
  }
  return candidates;
}

function setAudioSourceWithFallback(title) {
  audioTriedCandidates = buildAudioCandidates(title);
  tryNextAudioCandidate();
}

function tryNextAudioCandidate() {
  if (!audioTriedCandidates.length) {
    alert('Audio file not found.');
    playPauseBtn.textContent = 'Play';
    isPlaying = false;
    return;
  }
  const candidate = audioTriedCandidates.shift();
  audio.src = candidate;
  audio.load();
  const playAttempt = audio.play();
  if (playAttempt && typeof playAttempt.then === 'function') {
    playAttempt.catch(() => {
      playPauseBtn.textContent = 'Play';
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

// ---------- JSON 載入 ----------
async function loadStories() {
  const res = await fetch('story/story.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch story.json (HTTP ' + res.status + ')');
  const data = await res.json();
  stories = Array.isArray(data['New Words']) ? data['New Words'] : [];
}

function renderCategories() {
  const categories = [...new Set(stories.map(item => item['分類']).filter(Boolean))].sort();
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
  const titles = stories.filter(item => item['分類'] === category);
  titles.sort((a, b) => String(a['標題']).localeCompare(String(b['標題'])));
  for (const item of titles) {
    const div = document.createElement('div');
    div.className = 'title-item';
    div.textContent = item['標題'];
    div.tabIndex = 0;
    div.addEventListener('click', () => showPlayback(item['標題'], item['內文']));
    titleList.appendChild(div);
  }
}

function showPlayback(title, content) {
  showView(playbackView);
  playbackTitle.textContent = title;
  textContainer.innerHTML = '';
  textContainer.appendChild(parafy(content));
  textContainer.scrollTop = 0;

  setAudioSourceWithFallback(title);

  const onLoaded = () => {
    if (!audio.paused && !audio.ended) {
      isPlaying = true;
      playPauseBtn.textContent = 'Pause';
      startScroll();
    }
    audio.removeEventListener('loadedmetadata', onLoaded);
  };
  audio.addEventListener('loadedmetadata', onLoaded);

  if (!audio.paused) {
    isPlaying = true;
    playPauseBtn.textContent = 'Pause';
    startScroll();
  }
}

// ---------- Navigation ----------
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
  playPauseBtn.textContent = 'Play';
  textContainer.scrollTop = 0;
}

// ---------- Controls ----------
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
    playPauseBtn.textContent = 'Play';
    stopScroll();
  } else {
    audio.play().catch(err => {
      console.log('Autoplay blocked:', err);
    });
    isPlaying = true;
    playPauseBtn.textContent = 'Pause';
    startScroll();
  }
});

window.addEventListener('resize', computeScrollMax, { passive: true });
audio.addEventListener('ended', stopAudioAndReset);

// ---------- Boot ----------
(async function init() {
  try {
    await loadStories();
    renderCategories();
    showView(homeView);
  } catch (err) {
    console.error('Error loading JSON:', err);
    alert('Failed to load story.json.');
  }
})();
