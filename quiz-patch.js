// ============================================================
//  quiz.js PATCH — 配合 scores-dashboard.js 四欄重構版
//
//  只需替換以下兩個函式：
//    1. calcEffectiveFamiliarity  （約第 631 行）
//    2. weightedSample            （約第 688 行）
//
//  其餘程式碼完全不動。
// ============================================================

/**
 * 計算題目的「有效熟悉度」（per-source 版）
 *
 * 新版邏輯：
 *   - 直接讀取 rec[quizSource] 的 correct/wrong/lastSeen
 *   - 每個 source 獨立衰減，互不影響
 *   - 若 rec[quizSource] 無資料 → effectiveFam = null（未測驗）
 *
 * quizSource: 'fcplus' | 'dictation' | 'reorder' | 'voiceReorder'
 */
function calcEffectiveFamiliarity(rec, itemType, quizSource) {
    // 決定要看哪個 source
    // itemType 對應關係：
    //   noteWords / articleWords    → fcplus
    //   noteSentences               → reorder（預設）或 dictation
    //   articleSentences            → reorder（預設）或 dictation
    //   直接傳 quizSource 時優先使用 quizSource
    let sourceKey = quizSource;
    if (!sourceKey) {
        if (itemType === 'noteWords' || itemType === 'articleWords') {
            sourceKey = 'fcplus';
        } else {
            sourceKey = 'reorder';
        }
    }

    // 取得 per-source 記錄
    const srcRec = rec?.[sourceKey];
    if (!srcRec || (srcRec.correct + srcRec.wrong) === 0) {
        return { rawFam: null, effectiveFam: null, daysSince: Infinity };
    }

    const total  = srcRec.correct + srcRec.wrong;
    const rawFam = Math.round((srcRec.correct / total) * 100);

    // per-source lastSeen（新版），fallback 到 global lastSeen
    const lastSeenStr = srcRec.lastSeen || rec?.lastSeen || null;
    const days = lastSeenStr
        ? Math.floor((Date.now() - new Date(lastSeenStr).getTime()) / 86400000)
        : 0;

    // 艾賓浩斯半衰期
    let halfLife;
    if (rawFam >= 70)      halfLife = SR_CONFIG.halfLifeHigh;
    else if (rawFam >= 40) halfLife = SR_CONFIG.halfLifeMid;
    else                   halfLife = SR_CONFIG.halfLifeLow;

    // VR 使用較低底板（15），其餘 20
    const baseFloor = (sourceKey === 'voiceReorder')
        ? SR_CONFIG.decayFloorVoiceReorder
        : SR_CONFIG.decayFloor;

    const floor = Math.min(baseFloor, rawFam);
    const decayFactor = Math.pow(2, -days / halfLife);
    const effectiveFam = Math.round(floor + (rawFam - floor) * decayFactor);

    return { rawFam, effectiveFam, daysSince: days };
}

/**
 * 分桶優先抽題（間隔重複版，per-source 版）
 *
 * quizSource 決定查哪個 source 的記錄：
 *   flashcard/flashcard+ → 'fcplus'
 *   dictation            → 'dictation'
 *   reorder              → 'reorder'
 *   voiceReorder         → 'voiceReorder'
 *
 * 未測驗判斷：rec[quizSource] 無資料 → 桶 A
 */
function weightedSample(pool, n, keyFn, categoryName, titleName, itemType, quizSource) {
    if (!pool || pool.length === 0) return [];
    n = Math.min(n, pool.length);

    let itemScores = {};
    try { itemScores = JSON.parse(localStorage.getItem('readingChallengeItemScores') || '{}'); } catch (e) {}

    const storeKey    = `${categoryName}||${titleName}`;
    const typeDataMap = (itemScores[storeKey] && itemType)
        ? (itemScores[storeKey][itemType] || {})
        : {};

    // 決定 sourceKey（與 calcEffectiveFamiliarity 保持一致）
    let sourceKey = quizSource;
    if (!sourceKey) {
        sourceKey = (itemType === 'noteWords' || itemType === 'articleWords') ? 'fcplus' : 'reorder';
    }

    const bucketA = []; // 從未測驗（此 source 無資料）
    const bucketB = []; // 有效熟悉度 < 40%
    const bucketC = []; // 有效熟悉度 40–69%
    const bucketD = []; // 有效熟悉度 ≥ 70%

    const _isSentenceType = (itemType === 'noteSentences' || itemType === 'articleSentences');

    for (const item of pool) {
        const rawText = keyFn ? keyFn(item) : String(item);
        const text = _isSentenceType
            ? (typeof normSentence === 'function'
                ? normSentence(rawText)
                : rawText.trim().replace(/[.,?!'"`\u201c\u201d\u2018\u2019;:（）【】「」]/g, '').toLowerCase())
            : rawText;

        const rec = typeDataMap[text] || null;

        // 只看此 source 的記錄
        const srcRec = rec?.[sourceKey];
        const hasSrcData = !!(srcRec && (srcRec.correct + srcRec.wrong) > 0);

        if (!hasSrcData) {
            // 未測驗此 source → 桶 A
            bucketA.push(item);
        } else {
            const { effectiveFam } = calcEffectiveFamiliarity(rec, itemType, sourceKey);
            if (effectiveFam === null)   bucketA.push(item);
            else if (effectiveFam < 40)  bucketB.push(item);
            else if (effectiveFam < 70)  bucketC.push(item);
            else                         bucketD.push(item);
        }
    }

    const wantFromA = Math.min(bucketA.length, Math.ceil(n * SR_CONFIG.untestedFillRatio));
    const remaining = n - wantFromA;

    function weightedPickFromBuckets(buckets, weights, totalWant) {
        if (totalWant <= 0) return [];
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        let allocs = weights.map(w => Math.round(totalWant * w / totalWeight));
        let diff = totalWant - allocs.reduce((a, b) => a + b, 0);
        for (let i = 0; diff !== 0; i = (i + 1) % allocs.length) {
            if (diff > 0 && allocs[i] < buckets[i].length) { allocs[i]++; diff--; }
            if (diff < 0 && allocs[i] > 0)                 { allocs[i]--; diff++; }
        }
        const result = [];
        for (let i = 0; i < buckets.length; i++) {
            result.push(...shuffle(buckets[i]).slice(0, Math.min(allocs[i], buckets[i].length)));
        }
        const shortage = totalWant - result.length;
        if (shortage > 0) {
            const extras = [];
            for (let i = 0; i < buckets.length; i++) {
                extras.push(...buckets[i].slice(Math.min(allocs[i], buckets[i].length)));
            }
            result.push(...shuffle(extras).slice(0, shortage));
        }
        return result;
    }

    const fromA   = shuffle(bucketA).slice(0, wantFromA);
    const fromBCD = weightedPickFromBuckets(
        [bucketB, bucketC, bucketD],
        [SR_CONFIG.weightNeedWork, SR_CONFIG.weightOk, SR_CONFIG.weightFamiliar],
        remaining
    );

    const total = [...fromA, ...fromBCD];
    if (total.length < n) {
        const used = new Set(total);
        total.push(...shuffle(pool.filter(item => !used.has(item))).slice(0, n - total.length));
    }

    return shuffle(total.slice(0, n));
}
