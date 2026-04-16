/**
 * router.js — Hash-based Router for Reading Challenge
 *
 * URL 格式：
 *   #/                                      → 首頁
 *   #/major/:major                          → 大類 (subCategoryView)
 *   #/category/:major/:sub                  → 文章列表 (categoryView)
 *   #/story/:major/:sub/:index              → 閱讀播放 (playbackView)
 *   #/note                                  → 筆記總覽
 *   #/quiz                                  → Quiz
 *   #/scores                                → 成績儀表板
 *
 * 使用方式：
 *   Router.push({ view: 'home' })
 *   Router.push({ view: 'story', major: 'Books', sub: 'Atomic Habits', index: 3 })
 *   Router.replace(state)   // 取代目前歷史，不新增一筆
 */

const Router = (() => {

    // ── 建立 hash 字串 ─────────────────────────────────────────
    function buildHash(state) {
        if (!state || state.view === 'home') return '#/';
        const enc = s => encodeURIComponent(s ?? '');

        switch (state.view) {
            case 'major':
                return `#/major/${enc(state.major)}`;
            case 'category':
                return `#/category/${enc(state.major)}/${enc(state.sub)}`;
            case 'story':
                return `#/story/${enc(state.major)}/${enc(state.sub)}/${state.index ?? 0}`;
            case 'note':
                return `#/note`;
            case 'quiz':
                return `#/quiz`;
            case 'scores':
                return `#/scores`;
            default:
                return '#/';
        }
    }

    // ── 解析 hash 字串 ─────────────────────────────────────────
    function parseHash(hash) {
        const raw = (hash || '#/').replace(/^#\/?/, '');
        if (!raw) return { view: 'home' };

        const parts = raw.split('/').map(decodeURIComponent);
        const segment = parts[0];

        switch (segment) {
            case 'major':
                return { view: 'major', major: parts[1] || '' };
            case 'category':
                return { view: 'category', major: parts[1] || '', sub: parts[2] || '' };
            case 'story':
                return { view: 'story', major: parts[1] || '', sub: parts[2] || '', index: parseInt(parts[3] ?? '0', 10) || 0 };
            case 'note':
                return { view: 'note' };
            case 'quiz':
                return { view: 'quiz' };
            case 'scores':
                return { view: 'scores' };
            default:
                return { view: 'home' };
        }
    }

    // ── 寫入 URL（新增歷史記錄） ────────────────────────────────
    function push(state) {
        const hash = buildHash(state);
        if (location.hash !== hash) {
            history.pushState(state, '', hash);
        }
    }

    // ── 寫入 URL（取代目前記錄，不新增） ──────────────────────
    function replace(state) {
        const hash = buildHash(state);
        history.replaceState(state, '', hash);
    }

    // ── 讀取目前 URL 狀態 ──────────────────────────────────────
    function current() {
        return parseHash(location.hash);
    }

    return { push, replace, current, parseHash, buildHash };
})();
