# story.js 修改說明 — 支援中英文雙行 Timestamp

## 修改總覽
只需改動 **3 個地方**，改動量很小：
1. `parseTimestampText` — 解析時把中文翻譯行也存起來
2. `renderTimestampContent` — 渲染時加一個中文翻譯區塊
3. HTML — 加一個「顯示中文」Toggle 按鈕

---

## 修改 1：`parseTimestampText`（約第 2879 行）

**原本：**
```js
function parseTimestampText(text) {
    const lines = text.trim().split('\n');
    const data = [];
    const regex = /\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\](.*)/;
    const shortRegex = /\[(\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}\.\d{3})\](.*)/;

    for (const line of lines) {
        let match = line.match(regex);
        if (!match) {
             match = line.match(shortRegex);
             if (match) {
                 match[1] = '00:' + match[1];
                 match[2] = '00:' + match[2];
             }
        }
        
        if (match) {
            data.push({
                start: timeToSeconds(match[1]),
                end: timeToSeconds(match[2]),
                sentence: match[3].trim()
            });
        }
    }
    return data;
}
```

**改成：**
```js
function parseTimestampText(text) {
    const lines = text.trim().split('\n');
    const data = [];
    const regex = /\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\](.*)/;
    const shortRegex = /\[(\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}\.\d{3})\](.*)/;
    const zhRegex = /[\u4e00-\u9fff]/; // 偵測中文字元

    for (const line of lines) {
        let match = line.match(regex);
        if (!match) {
            match = line.match(shortRegex);
            if (match) {
                match[1] = '00:' + match[1];
                match[2] = '00:' + match[2];
            }
        }

        if (match) {
            const sentenceText = match[3].trim();
            const startSec = timeToSeconds(match[1]);
            const endSec = timeToSeconds(match[2]);

            if (zhRegex.test(sentenceText)) {
                // 這是中文翻譯行 → 附加到上一筆資料的 translation 欄位
                if (data.length > 0 && data[data.length - 1].start === startSec) {
                    data[data.length - 1].translation = sentenceText;
                }
            } else {
                // 這是英文原文行 → 新增一筆
                data.push({
                    start: startSec,
                    end: endSec,
                    sentence: sentenceText,
                    translation: '' // 預設空，等下一行中文填入
                });
            }
        }
    }
    return data;
}
```

---

## 修改 2：`renderTimestampContent`（約第 2473 行）

在每個 `<p>` 段落後面，加一個中文翻譯的 `<p>` 元素。

找到這段（約第 2551 行）：
```js
        frag.appendChild(p);
    });
```

**改成：**
```js
        frag.appendChild(p);

        // 如果有中文翻譯，加一個翻譯行
        if (line.translation) {
            const pZh = document.createElement('p');
            pZh.className = 'timestamp-translation';
            pZh.dataset.start = line.start;
            pZh.textContent = line.translation;
            frag.appendChild(pZh);
        }
    });
```

---

## 修改 3：加 Toggle 按鈕的 State 變數

在 State Variables 區塊（約第 76 行附近）加入：
```js
let showTranslation = false; // 控制是否顯示中文翻譯
```

---

## 修改 4：Toggle 按鈕邏輯

在適當位置（例如播放器控制區）加入按鈕事件：
```js
const toggleTranslationBtn = document.getElementById('toggle-translation-btn');
if (toggleTranslationBtn) {
    toggleTranslationBtn.addEventListener('click', () => {
        showTranslation = !showTranslation;
        // 切換所有翻譯行的顯示
        document.querySelectorAll('.timestamp-translation').forEach(el => {
            el.style.display = showTranslation ? 'block' : 'none';
        });
        toggleTranslationBtn.textContent = showTranslation ? '隱藏中文' : '顯示中文';
    });
}
```

---

## 修改 5：CSS 樣式（加在你的 CSS 裡）

```css
/* 中文翻譯行 — 預設隱藏 */
.timestamp-translation {
    display: none;
    font-size: 0.9em;
    color: #888;
    margin-top: -0.6em;
    margin-bottom: 0.8em;
    padding-left: 0.5em;
    border-left: 2px solid #ccc;
    line-height: 1.5;
}
```

---

## 修改 6：HTML 加按鈕（在 index.html 播放器控制區）

```html
<button id="toggle-translation-btn">顯示中文</button>
```

---

## 流程總結

```
英文 Timestamp.txt
       ↓ (translate_timestamp.py)
中英雙行 Timestamp.txt（覆蓋原檔）
       ↓ (上傳到 GitHub audio/ 資料夾)
APP 載入 → parseTimestampText 自動識別中英行
       ↓
使用者按「顯示中文」→ 每句英文下方顯示中文翻譯
```
