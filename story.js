/* Reading Challenge SPA (external JSON + audio in root folder) */
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

let stories = [];
let isPlaying = false;
let rafId = null;
let scrollMax = 0;
let durationFallback = 59;
let audioTriedCandidates = [];

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
    .replace(/^"|"$/g, '')
    .trim();
  // 修改：將 split 的條件從雙換行 (\n\n+) 改為單換行 (\n+)，讓文章更好分段
  const parts = cleaned.split(/\n+/);
  const frag = document.createDocumentFragment();
  for (const part of parts) {
    const p = document.createElement('p');
    const trimmedPart = part.trim();
    if (trimmedPart === '') {
      // 對於空白行，使用 &nbsp; 確保其能被渲染出來佔據空間
      p.innerHTML = '&nbsp;';
    } else {
      p.textContent = trimmedPart;
    }
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
  // 修改：讀取同層 story.json
const res = await fetch('https://raw.githubusercontent.com/BoydYang-Designer/Story-reading/main/story.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch story.json (HTTP ' + res.status + ')');
  const data = await res.json();
  stories = Array.isArray(data['New Words']) ? data['New Words'] : [];
}

function renderCategories() {
  // 修改：由於 "分類" 是陣列，使用 flatMap 攤平所有分類並整理
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

  // 修改：篩選時，檢查項目的 "分類" 陣列中是否 "包含" 指定的分類
  const titles = stories.filter(item =>
    Array.isArray(item['分類']) && item['分類'].map(c => c.trim()).includes(category)
  );

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

  // 修改：在文章內容前加入換行符，以在開頭產生空白區域
  const contentWithPadding = '\n\n' + content;
  textContainer.appendChild(parafy(contentWithPadding));

  textContainer.scrollTop = 0;
  setAudioSourceWithFallback(title);
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

window.addEventListener('resize', computeScrollMax, { passive: true });
audio.addEventListener('ended', stopAudioAndReset);

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

document.addEventListener('keydown', (event) => {
  // 檢查當前是否在 playbackView
  if (playbackView.hidden === false) {
    switch (event.code) {
      case 'Space':
        event.preventDefault(); // 防止空白鍵滾動頁面
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