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
        return _ctx;
    }

    /**
     * 確保 AudioContext 處於 running 狀態
     * iOS Safari 在特定情況下會將 context 暫停為 suspended
     */
    async function _resumeContext(ctx) {
        if (ctx.state === 'suspended') {
            try {
                await ctx.resume();
                console.log('[WebAudioEngine] AudioContext resumed.');
            } catch (e) {
                console.error('[WebAudioEngine] Failed to resume AudioContext:', e);
            }
        }
    }

    // ── Buffer 載入與快取 ────────────────────────────────────

    /**
     * 載入並解碼 MP3，結果快取至 _bufferCache
     * 同一個 src 若同時呼叫多次，只會發出一次 fetch
     * @param {string} src  音檔路徑
     * @returns {Promise<AudioBuffer>}
     */
    async function _loadBuffer(src) {
        // 已快取 → 直接回傳
        if (_bufferCache[src]) {
            return _bufferCache[src];
        }

        // 正在載入中 → 等同一個 Promise
        if (_loadingPromises[src]) {
            return _loadingPromises[src];
        }

        const ctx = _getContext();
        if (!ctx) throw new Error('Web Audio API not supported');

        console.log(`[WebAudioEngine] Fetching & decoding: ${src}`);

        _loadingPromises[src] = (async () => {
            const response = await fetch(src);
            if (!response.ok) {
                throw new Error(`[WebAudioEngine] fetch failed: ${response.status} ${src}`);
            }
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            _bufferCache[src] = audioBuffer;
            delete _loadingPromises[src];
            console.log(`[WebAudioEngine] Decoded & cached: ${src} (${audioBuffer.duration.toFixed(1)}s)`);
            return audioBuffer;
        })();

        return _loadingPromises[src];
    }

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
        _currentOnEnd  = null;
        _stopScheduled = false;
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

        // 確保 context 是 running（iOS Safari 可能是 suspended）
        await _resumeContext(ctx);

        // 驗證時間參數
        const duration = end - start;
        if (duration <= 0) {
            const msg = `Invalid snippet duration: start=${start}, end=${end}`;
            console.warn('[WebAudioEngine]', msg);
            if (onError) onError(new Error(msg));
            return;
        }

        try {
            // 載入（或從快取取得）AudioBuffer
            const buffer = await _loadBuffer(src);

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
            source.onended = () => {
                // 確認是同一個 source（避免 stop() 後的殘留事件）
                if (_currentSource === source) {
                    _currentSource = null;
                    _stopScheduled = true;
                }
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

    /**
     * 預先載入並快取音檔（不播放）
     * 建議在使用者進入章節頁面時呼叫，讓播放按鈕按下時能即時回應
     * @param {string} src  音檔路徑
     * @returns {Promise<void>}
     */
    async function preload(src) {
        if (_bufferCache[src]) {
            console.log(`[WebAudioEngine] Already cached: ${src}`);
            return;
        }
        try {
            await _loadBuffer(src);
        } catch (err) {
            console.warn(`[WebAudioEngine] Preload failed for: ${src}`, err);
        }
    }

    /**
     * 清除快取（釋放記憶體）
     * @param {string} [src]  若指定則只清除該檔案的快取，否則清除全部
     */
    function clearCache(src) {
        if (src) {
            delete _bufferCache[src];
            console.log(`[WebAudioEngine] Cache cleared: ${src}`);
        } else {
            Object.keys(_bufferCache).forEach(k => delete _bufferCache[k]);
            console.log('[WebAudioEngine] All cache cleared.');
        }
    }

    /**
     * 回傳目前快取狀態（供 debug 用）
     */
    function getCacheStatus() {
        return Object.keys(_bufferCache).map(src => ({
            src,
            duration: _bufferCache[src].duration.toFixed(1) + 's',
            channels: _bufferCache[src].numberOfChannels,
            sampleRate: _bufferCache[src].sampleRate
        }));
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
