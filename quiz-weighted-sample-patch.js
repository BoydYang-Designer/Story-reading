// ============================================================
//  weightedSample 替換補丁 — 間隔重複 (Spaced Repetition) 版本
//
//  修改目標：
//    1. 未測驗的題目「保證優先」出題，而非僅概率優先
//    2. 測驗過且答對的題目，依衰減曲線下降，但有「記憶底板」
//       → 即使很久沒測驗，有效熟悉度最多只降到 decayFloor（預設 30%）
//       → 永遠不會回到跟「從未測驗」一樣的狀態
//
//  使用方式：
//    將此檔案的 SR_CONFIG、calcEffectiveFamiliarity、weightedSample
//    三段程式碼，取代 quiz.js 中原本的 weightedSample 函式。
//    其餘程式碼無需改動。
// ============================================================


// ── 衰減參數設定（可依需求調整）────────────────────────────────
const SR_CONFIG = {
    // ── 記憶底板（最重要的新參數）──────────────────────────────
    // 即使再久沒複習，有效熟悉度最多只降到這個值，不會再低。
    // 代表「學過就是學過，不會完全忘記」。
    // 建議範圍：20–40。設 30 表示最差仍保留 30% 的熟悉度。
    decayFloor: 30,             // 0–100

    // ── 艾賓浩斯半衰期（天）────────────────────────────────────
    // 熟悉度越高記得越久；半衰期是「從 rawFam 衰減到 (rawFam+floor)/2 所需天數」
    halfLifeHigh:   30,         // 原始熟悉度 ≥ 70%
    halfLifeMid:    14,         // 原始熟悉度 40–69%
    halfLifeLow:     7,         // 原始熟悉度 < 40%

    // ── 桶加權（剩餘配額分配用）────────────────────────────────
    weightNeedWork:  0.70,      // 桶 B：有效熟悉度 < 40%
    weightOk:        0.20,      // 桶 C：有效熟悉度 40–69%
    weightFamiliar:  0.05,      // 桶 D：有效熟悉度 ≥ 70%

    // ── 桶 A（未測驗）優先填滿比例（0–1）───────────────────────
    // 0.95 = 只要有未測驗題，95% 的題數保證從桶 A 取
    // 已測驗過的題（即使衰減）永遠不會進入桶 A
    untestedFillRatio: 0.95,
};


/**
 * 計算題目的「有效熟悉度」（已考慮時間衰減，但有記憶底板）
 *
 * 衰減公式（帶底板）：
 *   effectiveFam = floor + (rawFam - floor) × 2^(-days / halfLife)
 *
 *   → days = 0 時：effectiveFam = rawFam（剛測完，全保留）
 *   → days → ∞ 時：effectiveFam → floor（最多衰減到底板，不再下降）
 *   → 底板預設 30%，即學過的題永遠比未測驗（null）更優先
 *
 * @param {object|null} rec        itemScores 的單一 item record
 * @param {string}      itemType   'noteWords'|'noteSentences'|'articleWords'|'articleSentences'
 * @returns {{ rawFam: number|null, effectiveFam: number|null, daysSince: number }}
 *   rawFam       : 原始熟悉度（null = 未測驗）
 *   effectiveFam : 衰減後有效熟悉度（null = 未測驗；學過的最低為 decayFloor）
 *   daysSince    : 距上次測驗天數（Infinity = 未測驗）
 */
function calcEffectiveFamiliarity(rec, itemType) {
    if (!rec || !_recHasPractice(rec)) {
        return { rawFam: null, effectiveFam: null, daysSince: Infinity };
    }

    // 取得原始熟悉度
    let rawFam;
    if (typeof calcWeightedFamiliarity === 'function' && itemType) {
        rawFam = calcWeightedFamiliarity(rec, itemType);
    } else {
        const sources = ['fc','fcplus','dictation','reorder','articleListen'];
        const vals = sources.map(s => {
            const sr = rec[s];
            if (!sr) return null;
            const total = (sr.correct || 0) + (sr.wrong || 0);
            return total > 0 ? Math.round((1 - sr.wrong / total) * 100) : null;
        }).filter(v => v !== null);
        rawFam = vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    }

    // 取得上次測驗日期
    const lastSeen = rec.lastSeen || null;
    const days = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 86400000) : 0;

    // 依原始熟悉度選擇半衰期
    let halfLife;
    if (rawFam >= 70)      halfLife = SR_CONFIG.halfLifeHigh;
    else if (rawFam >= 40) halfLife = SR_CONFIG.halfLifeMid;
    else                   halfLife = SR_CONFIG.halfLifeLow;

    // 帶底板的衰減公式：
    //   effectiveFam = floor + (rawFam - floor) × 2^(-days / halfLife)
    // 若 rawFam 本身低於 floor（答錯率高），直接用 rawFam，不強制拉高
    const floor = Math.min(SR_CONFIG.decayFloor, rawFam);
    const decayFactor = Math.pow(2, -days / halfLife);
    const effectiveFam = Math.round(floor + (rawFam - floor) * decayFactor);

    return { rawFam, effectiveFam, daysSince: days };
}


/**
 * 分桶優先抽題（間隔重複版 weightedSample）
 *
 * 桶優先順序：
 *   桶 A（untestedFillRatio = 95%）：effectiveFam === null（從未測驗過）
 *   桶 B（剩餘配額 × 70%）         ：有效熟悉度 < 40%（含底板衰減後仍低）
 *   桶 C（剩餘配額 × 20%）         ：有效熟悉度 40–69%
 *   桶 D（剩餘配額 × 5%）          ：有效熟悉度 ≥ 70%（幾乎不出）
 *
 * ⚠️ 學過的題（effectiveFam 有值）永遠不會進入桶 A，
 *    即使衰減到底板（30%），仍落在桶 B，出題優先度低於未測驗。
 *
 * 若桶 A 題數不足（已全部測驗過），自動從 B/C/D 依加權補足。
 */
function weightedSample(pool, n, keyFn, categoryName, titleName, itemType) {
    if (!pool || pool.length === 0) return [];
    n = Math.min(n, pool.length);

    // ── 讀取 itemScores ────────────────────────────────────────
    let itemScores = {};
    try { itemScores = JSON.parse(localStorage.getItem('readingChallengeItemScores') || '{}'); } catch (e) {}

    const storeKey    = `${categoryName}||${titleName}`;
    const typeDataMap = (itemScores[storeKey] && itemType)
        ? (itemScores[storeKey][itemType] || {})
        : {};

    // ── 將每題分到對應的桶 ─────────────────────────────────────
    const bucketA = []; // 從未測驗（effectiveFam === null）
    const bucketB = []; // 有效熟悉度 < 40%
    const bucketC = []; // 有效熟悉度 40–69%
    const bucketD = []; // 有效熟悉度 ≥ 70%

    for (const item of pool) {
        const text = keyFn ? keyFn(item) : String(item);
        const rec  = typeDataMap[text] || null;
        const { effectiveFam } = calcEffectiveFamiliarity(rec, itemType);

        if (effectiveFam === null) {
            // 從未測驗 → 最高優先桶
            bucketA.push(item);
        } else if (effectiveFam < 40) {
            // 學過但熟悉度低（含衰減後停在底板的題）
            bucketB.push(item);
        } else if (effectiveFam < 70) {
            bucketC.push(item);
        } else {
            bucketD.push(item);
        }
    }

    // ── 計算各桶應取的題數 ─────────────────────────────────────
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
        const extras = pool.filter(item => !used.has(item));
        total.push(...shuffle(extras).slice(0, n - total.length));
    }

    return shuffle(total.slice(0, n));
}
// ============================================================
//  衰減對照表（供你參考，非程式碼）
//  公式：effectiveFam = floor + (rawFam - floor) × 2^(-days / halfLife)
//  底板 decayFloor = 30（預設）
//
//  原始熟悉度 100%（半衰期 30 天）：
//    ├─  0 天後：100%
//    ├─  7 天後：86%
//    ├─ 14 天後：74%
//    ├─ 30 天後：65%  ← 衰減到一半（從 100 到 (100+30)/2 = 65）
//    ├─ 60 天後：48%
//    ├─ 90 天後：38%
//    └─ 無論多久：最低 30%（底板）永遠不再下降
//
//  原始熟悉度 80%（半衰期 30 天）：
//    ├─ 30 天後：55%
//    └─ 無論多久：最低 30%
//
//  原始熟悉度 60%（半衰期 14 天）：
//    ├─ 14 天後：45%
//    ├─ 30 天後：35%
//    └─ 無論多久：最低 30%
//
//  原始熟悉度 40%（半衰期 7 天）：
//    ├─  7 天後：35%
//    └─ 無論多久：最低 30%（底板 = rawFam 時不再衰減）
//
//  ── 若 rawFam 本身低於底板（答錯率高，如 20%）：
//    → floor 自動調整為 min(decayFloor, rawFam) = 20%
//    → 不會因底板而被「拉高」到 30%
//
//  ── 調整建議 ───────────────────────────────────────────────
//  想讓底板更高（更寬鬆）：調高 decayFloor（如 40）
//  想讓底板更低（更嚴格）：調低 decayFloor（如 20）
//  想讓衰減更慢：調高 halfLifeHigh / halfLifeMid / halfLifeLow
//  想讓衰減更快：調低 halfLifeHigh / halfLifeMid / halfLifeLow
// ============================================================
