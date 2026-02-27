// ============================================================
//  WEB AUDIO ENGINE  —  web-audio-engine.js
//  精確音檔片段播放引擎（Web Audio API）
//
//  取代原本 HTMLAudioElement + setTimeout 的播放方式
//  精確度：毫秒級，手機與 PC 完全一致
//
//  主要 API：
//    WebAudioEngine.playSnippet(src, start, end, callbacks)
//    WebAudioEngine.stop()
//    WebAudioEngine.preload(src)
//    WebAudioEngine.clearCache(src?)
// ============================================================

var WebAudioEngine = (() => {

    // ── 內部狀態 ─────────────────────────────────────────────

    let _ctx = null;                    // AudioContext（延遲建立，需使用者互動）
    const _bufferCache = {};            // { [src]: AudioBuffer }
    const _loadingPromises = {};        // { [src]: Promise<AudioBuffer> } 避免重複 fetch

    let _currentSource = null;         // 目前播放中的 AudioBufferSourceNode
    let _currentOnEnd  = null;         // 播放結束 callback
    let _stopScheduled = false;        // 是否已由引擎自動停止

    // BUG-A02 修正：取消旗標，防止 stop() 後非同步 loadBuffer 完成仍開始播放
    let _currentPlayToken = null;

    // BUG-A04 修正：LRU 快取上限，防止大量音檔堆積造成手機記憶體溢出
    const MAX_CACHE_SIZE = 4;          // 最多同時快取 4 個 AudioBuffer
    const _cacheOrder = [];            // LRU 存取順序 (src 字串陣列)

    // ── AudioContext 管理 ────────────────────────────────────

    /**
     * 取得（或建立）AudioContext
     * iOS Safari 需要在使用者互動後建立，此處採用延遲初始化
     */
    function _getContext() {
        if (_ctx && _ctx.state !== 'closed') {
            return _ctx;
        }
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
            console.error('[WebAudioEngine] Web Audio API not supported in this browser.');
            return null;
        }
        _ctx = new AudioCtx();
        console.log('[WebAudioEngine] AudioContext created, state:', _ctx.state);
        _attachContextStateWatcher(_ctx);
        return _ctx;
    }

    /**
     * 確保 AudioContext 處於 running 狀態
     * BUG-A03 修正：同時處理 'suspended' 與 'interrupted'（iOS 16+ 接電話/切 App 後的狀態）
     */
    async function _resumeContext(ctx) {
        if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
            try {
                await ctx.resume();
                console.log('[WebAudioEngine] AudioContext resumed, state:', ctx.state);
            } catch (e) {
                console.error('[WebAudioEngine] Failed to resume AudioContext:', e);
            }
        }
    }

    /**
     * BUG-A03 補充：監聽 AudioContext statechange
     * 使用者從電話或其他 App 返回時自動記錄狀態，供 debug 使用
     */
    function _attachContextStateWatcher(ctx) {
        ctx.addEventListener('statechange', () => {
            console.log('[WebAudioEngine] AudioContext statechange:', ctx.state);
        });
    }

    // ── Buffer 載入與快取 ─────────────────────────────────────
    // （實作已整合至下方「預載 API」區塊，包含 BUG-A01/A04/A05 修正）

    // ── 停止目前播放 ─────────────────────────────────────────

    /**
     * 停止目前正在播放的片段（若有）
     */
    function stop() {
        if (_currentSource) {
            try {
                _currentSource.onended = null;   // 取消 onended，避免觸發 callback
                _currentSource.stop();
            } catch (e) {
                // 已停止的 source 呼叫 stop() 會拋出，忽略
            }
            _currentSource = null;
        }
        _currentOnEnd    = null;
        _stopScheduled   = false;
        // BUG-A02 修正：重置 token，使任何正在等待 loadBuffer 的 playSnippet 失效
        _currentPlayToken = null;
    }

    // ── 播放片段（主要 API）─────────────────────────────────

    /**
     * 精確播放 MP3 的指定片段
     *
     * @param {object} options
     *   src      {string}    音檔路徑（e.g. "audio/The Alchemist.mp3"）
     *   start    {number}    起始秒數
     *   end      {number}    結束秒數
     *   onStart  {function}  播放開始時的 callback（可選）
     *   onEnd    {function}  播放結束時的 callback（可選）
     *   onError  {function}  錯誤時的 callback（可選）
     *
     * @returns {Promise<void>}
     */
    async function playSnippet({ src, start, end, onStart, onEnd, onError }) {
        // 停止任何正在播放的片段
        stop();

        const ctx = _getContext();
        if (!ctx) {
            const msg = 'Web Audio API is not supported in this browser.';
            console.error('[WebAudioEngine]', msg);
            if (onError) onError(new Error(msg));
            return;
        }

        // 確保 context 是 running（iOS Safari 可能是 suspended / interrupted）
        await _resumeContext(ctx);

        // 驗證時間參數
        const duration = end - start;
        if (duration <= 0) {
            const msg = `Invalid snippet duration: start=${start}, end=${end}`;
            console.warn('[WebAudioEngine]', msg);
            if (onError) onError(new Error(msg));
            return;
        }

        // BUG-A02 修正：為本次播放建立唯一 token
        // 若在 await _loadBuffer 期間呼叫了 stop()，token 會被重置為 null
        // loadBuffer 完成後比對 token，確保不在已取消的情況下繼續播放
        const token = Symbol('playToken');
        _currentPlayToken = token;

        try {
            // 載入（或從快取取得）AudioBuffer
            const buffer = await _loadBuffer(src);

            // BUG-A02 修正：載入完成後檢查 token，若已被 stop() 重置則放棄播放
            if (_currentPlayToken !== token) {
                console.log('[WebAudioEngine] Playback cancelled (stop() was called during load).');
                return;
            }

            // 邊界檢查：確保 start/end 不超出音檔長度
            const safeStart = Math.max(0, Math.min(start, buffer.duration - 0.01));
            const safeEnd   = Math.max(safeStart + 0.01, Math.min(end, buffer.duration));
            const safeDuration = safeEnd - safeStart;

            // 建立播放節點
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(ctx.destination);

            // 儲存目前播放的 source
            _currentSource = source;
            _currentOnEnd  = onEnd || null;
            _stopScheduled = false;

            // onended：由引擎自然停止時觸發
            // BUG-03 修正：加入 Guard 確認是同一個 source 才執行 callback，
            // 防止 stop() 之後瀏覽器仍觸發 onended 造成 callback 誤觸發（競態條件）
            source.onended = () => {
                if (_currentSource !== source) return; // Guard：已被外部 stop() 停止
                _currentSource = null;
                _stopScheduled = true;
                if (_currentOnEnd) {
                    const cb = _currentOnEnd;
                    _currentOnEnd = null;
                    cb();
                }
            };

            // 開始播放
            // AudioBufferSourceNode.start(when, offset, duration)
            // when=0 → 立刻播放
            // offset → 從 buffer 的第幾秒開始
            // duration → 播放幾秒
            source.start(0, safeStart, safeDuration);

            console.log(`[WebAudioEngine] Playing: ${src} [${safeStart.toFixed(3)}s → ${safeEnd.toFixed(3)}s] (${safeDuration.toFixed(3)}s)`);

            if (onStart) onStart();

        } catch (err) {
            console.error('[WebAudioEngine] playSnippet error:', err);
            _currentSource = null;
            _currentOnEnd  = null;
            if (onError) onError(err);
        }
    }

    // ── 預載 API ─────────────────────────────────────────────

    // BUG-A05 修正：preload 只 fetch 並快取原始 ArrayBuffer，
    // 不建立 AudioContext（不觸發 AutoPlay Policy），也不執行 decodeAudioData。
    // 等使用者真正按下播放鍵（互動事件）時，playSnippet 內才建立 ctx 並解碼。
    // 這樣 iOS Safari 完全符合 AutoPlay 限制，不會出現「按播放沒聲音」的問題。
    const _rawBufferCache = {};   // { [src]: ArrayBuffer }（未解碼的原始資料）

    /**
     * 預先下載音檔並快取原始 ArrayBuffer（不播放、不解碼）
     * @param {string} src  音檔路徑
     * @returns {Promise<void>}
     */
    async function preload(src) {
        if (!isSupported()) {
            console.warn('[WebAudioEngine] preload() skipped: Web Audio API not supported.');
            return;
        }
        // 已有解碼快取或原始快取 → 跳過
        if (_bufferCache[src] || _rawBufferCache[src]) {
            console.log(`[WebAudioEngine] Already cached: ${src}`);
            return;
        }
        // 正在載入中 → 等同一個 Promise
        if (_loadingPromises[src]) {
            return _loadingPromises[src];
        }
        try {
            console.log(`[WebAudioEngine] Preloading (fetch only): ${src}`);
            const response = await fetch(src);
            if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
            _rawBufferCache[src] = await response.arrayBuffer();
            console.log(`[WebAudioEngine] Prefetched: ${src}`);
        } catch (err) {
            console.warn(`[WebAudioEngine] Preload failed for: ${src}`, err);
        }
    }

    /**
     * BUG-A05 修正版 _loadBuffer：
     * 若有已預載的 rawBuffer，直接解碼，跳過 fetch 步驟（省時 2–5 秒）
     */
    async function _loadBuffer(src) {
        // 已有解碼快取 → 更新 LRU 順序後直接回傳
        if (_bufferCache[src]) {
            const idx = _cacheOrder.indexOf(src);
            if (idx !== -1) _cacheOrder.splice(idx, 1);
            _cacheOrder.push(src);
            return _bufferCache[src];
        }

        // 正在載入中 → 等同一個 Promise
        if (_loadingPromises[src]) {
            return _loadingPromises[src];
        }

        const ctx = _getContext();
        if (!ctx) throw new Error('Web Audio API not supported');

        console.log(`[WebAudioEngine] Loading buffer: ${src}`);

        _loadingPromises[src] = (async () => {
            try {
                let arrayBuffer;

                if (_rawBufferCache[src]) {
                    // 已預載的原始 ArrayBuffer → 直接解碼（最快路徑）
                    console.log(`[WebAudioEngine] Decoding prefetched buffer: ${src}`);
                    arrayBuffer = _rawBufferCache[src];
                    delete _rawBufferCache[src]; // 解碼後釋放原始快取
                } else {
                    // 需要重新 fetch
                    console.log(`[WebAudioEngine] Fetching & decoding: ${src}`);
                    const response = await fetch(src);
                    if (!response.ok) {
                        throw new Error(`[WebAudioEngine] fetch failed: ${response.status} ${src}`);
                    }
                    arrayBuffer = await response.arrayBuffer();
                }

                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

                // BUG-A04 修正：LRU 淘汰 — 超過上限時移除最舊的快取
                if (!_bufferCache[src]) {
                    _cacheOrder.push(src);
                    while (_cacheOrder.length > MAX_CACHE_SIZE) {
                        const oldest = _cacheOrder.shift();
                        delete _bufferCache[oldest];
                        console.log(`[WebAudioEngine] LRU evicted: ${oldest}`);
                    }
                }

                _bufferCache[src] = audioBuffer;
                delete _loadingPromises[src];
                console.log(`[WebAudioEngine] Decoded & cached: ${src} (${audioBuffer.duration.toFixed(1)}s)`);
                return audioBuffer;

            } catch (err) {
                // BUG-A01 修正：失敗時也要清除 _loadingPromises，讓下次呼叫能重新嘗試
                delete _loadingPromises[src];
                throw err;
            }
        })();

        return _loadingPromises[src];
    }

    /**
     * 清除快取（釋放記憶體）
     * @param {string} [src]  若指定則只清除該檔案的快取，否則清除全部
     */
    function clearCache(src) {
        if (src) {
            delete _bufferCache[src];
            delete _rawBufferCache[src];
            const idx = _cacheOrder.indexOf(src);
            if (idx !== -1) _cacheOrder.splice(idx, 1);
            console.log(`[WebAudioEngine] Cache cleared: ${src}`);
        } else {
            Object.keys(_bufferCache).forEach(k => delete _bufferCache[k]);
            Object.keys(_rawBufferCache).forEach(k => delete _rawBufferCache[k]);
            _cacheOrder.length = 0;
            console.log('[WebAudioEngine] All cache cleared.');
        }
    }

    /**
     * 回傳目前快取狀態（供 debug 用）
     */
    function getCacheStatus() {
        return {
            contextState: _ctx ? _ctx.state : 'not created',
            decodedBuffers: Object.keys(_bufferCache).map(src => ({
                src,
                duration: _bufferCache[src].duration.toFixed(1) + 's',
                channels: _bufferCache[src].numberOfChannels,
                sampleRate: _bufferCache[src].sampleRate
            })),
            prefetchedBuffers: Object.keys(_rawBufferCache),
            loadingBuffers: Object.keys(_loadingPromises),
            isPlaying: !!_currentSource,
            lruOrder: [..._cacheOrder]
        };
    }

    /**
     * 偵測瀏覽器是否支援 Web Audio API
     */
    function isSupported() {
        return !!(window.AudioContext || window.webkitAudioContext);
    }

    // ── 公開 API ─────────────────────────────────────────────
    return {
        playSnippet,
        stop,
        preload,
        clearCache,
        getCacheStatus,
        isSupported
    };

})();

console.log('✅ Web Audio Engine loaded. Supported:', WebAudioEngine.isSupported());
