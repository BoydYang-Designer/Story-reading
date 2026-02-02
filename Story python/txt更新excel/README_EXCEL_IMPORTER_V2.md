# Excel 自動填入工具 v2.0 使用說明

## 📋 功能說明

這個工具可以自動將多個 txt 檔案的內容填入 Excel 檔案中，並遵循以下規則：

✅ **分類（B欄）**：填入檔名的第一個單字
✅ **標題（C欄）**：填入完整檔名（不含 .txt）
✅ **內文（D欄）**：填入 txt 內容，並自動換行
✅ **大類（A欄）**：保持空白
✅ 保持 Excel 原有格式和設定
✅ 自動跳過已存在的資料（避免重複）
✅ 直接覆蓋更新原 Excel 檔案

## 🎯 Excel 欄位對應（更新版）

| Excel 欄位 | 填入內容 | 說明 |
|-----------|---------|------|
| A 欄（大類） | 保持空白 | 不填入任何內容 |
| B 欄（分類） | **檔名第一個單字** | 見下方提取規則 |
| C 欄（標題） | **完整檔名** | 不含 .txt 副檔名 |
| D 欄（內文） | txt 檔案內容 | 自動換行 |
| E 欄 | 自動套用公式 | 如果有的話 |

## 📝 檔名提取規則

### 範例 1：有 " - " 分隔符
```
檔名: "Elicitation - How to Get People to Talk Without Them Realizing.txt"
分類（B欄）: "Elicitation"
標題（C欄）: "Elicitation - How to Get People to Talk Without Them Realizing"
```

### 範例 2：有空格
```
檔名: "Design The Power of Simplicity.txt"
分類（B欄）: "Design"
標題（C欄）: "Design The Power of Simplicity"
```

### 範例 3：有底線
```
檔名: "Interview_My_Journey_in_Tech.txt"
分類（B欄）: "Interview"
標題（C欄）: "Interview_My_Journey_in_Tech"
```

### 範例 4：有減號（無空格）
```
檔名: "bike-accident-story.txt"
分類（B欄）: "bike"
標題（C欄）: "bike-accident-story"
```

### 範例 5：沒有分隔符
```
檔名: "thefutur.txt"
分類（B欄）: "thefutur"
標題（C欄）: "thefutur"
```

## 🔍 分類提取優先順序

程式會按照以下順序查找分隔符：

1. **" - "**（空格-空格）→ 取第一部分
2. **" "**（空格）→ 取第一個單字
3. **"_"**（底線）→ 取第一部分
4. **"-"**（減號）→ 取第一部分
5. **無分隔符** → 使用整個檔名

## 🔧 系統需求

### Python 版本
- Python 3.7 或更高版本

### 必要套件
```bash
pip install openpyxl
```

## 🚀 使用方法

### 1. 執行程式
```bash
python excel_txt_importer_v2.py
```

### 2. 選擇 Excel 檔案
- 程式會彈出檔案選擇對話框
- 選擇你要更新的 Excel 檔案（.xlsx）

### 3. 選擇 txt 檔案
- 可以一次選擇多個 txt 檔案
- 按住 Ctrl 或 Shift 鍵進行複選

### 4. 確認操作
- 程式會顯示填入規則和檔案數量
- 確認後開始處理

### 5. 完成
- 程式會顯示處理結果
- Excel 檔案會被直接覆蓋更新

## 📊 實際使用範例

### 輸入檔案：
```
1. Elicitation - How to Get People to Talk.txt
2. Design - The Power of Simplicity.txt
3. Interview - My Journey in Tech.txt
4. thefutur - Embrace Yourself in the Digital Age.txt
```

### Excel 結果：

| 大類 | 分類 | 標題 | 內文 |
|------|------|------|------|
| （空白） | Elicitation | Elicitation - How to Get People to Talk | （txt內容） |
| （空白） | Design | Design - The Power of Simplicity | （txt內容） |
| （空白） | Interview | Interview - My Journey in Tech | （txt內容） |
| （空白） | thefutur | thefutur - Embrace Yourself in the Digital Age | （txt內容） |

## ⚠️ 注意事項

### 1. 備份提醒
**重要**：程式會直接覆蓋原 Excel 檔案，建議先備份！

### 2. 避免重複
- 程式會自動檢查標題（C 欄）
- 如果標題已存在，會跳過該 txt 檔案
- 不會重複填入相同內容

### 3. 檔案格式
- 只支援 .xlsx 格式的 Excel 檔案
- txt 檔案需使用 UTF-8 編碼

### 4. 資料位置
- 程式會自動找到第一個空白行填入
- 不會覆蓋現有資料
- 只在完全空白的行（B 欄和 C 欄都空白）填入

### 5. 大類欄位
- 大類（A 欄）會保持空白
- 需要手動填入或後續批次處理

## 💡 進階使用技巧

### 技巧 1：統一檔名格式
建議將 txt 檔案命名為統一格式：
```
分類 - 詳細說明.txt
```
例如：
```
Interview - About Yourself.txt
Design - Minimalism Principles.txt
Story - Bike Accident Experience.txt
```

### 技巧 2：批次重命名
如果你有很多檔案需要重新命名，可以使用批次重命名工具：
- Windows：PowerRename（PowerToys）
- Mac：Automator
- Linux：rename 命令

### 技巧 3：預覽功能
執行前，程式會在終端機顯示提取結果：
```
處理檔案: Elicitation - How to Get People to Talk.txt
  提取的分類: Elicitation
  提取的標題: Elicitation - How to Get People to Talk
  填入位置: 第 21 行
  ✓ 成功填入
```

## 🐛 常見問題

### Q: 分類沒有正確提取？
A: 檢查檔名格式，確認是否有正確的分隔符（建議使用 " - "）

### Q: 某些檔案被跳過？
A: 如果標題已存在於 Excel 中，程式會自動跳過以避免重複。

### Q: 可以同時填入大類嗎？
A: 目前版本大類保持空白。如需自動填入大類，請提供規則後可以修改程式。

### Q: 內文沒有自動換行？
A: 程式已設定自動換行，但需要調整 Excel 中儲存格的行高才能完整顯示。

### Q: 想修改提取規則怎麼辦？
A: 可以修改程式中的 `extract_category_and_title_from_filename` 函數。

## 🔄 版本更新

### v2.0（當前版本）
- ✅ 分類填入檔名第一個單字
- ✅ 標題填入完整檔名
- ✅ 支援多種分隔符格式
- ✅ 優化提取邏輯

### v1.0
- 標題填入檔名第一個單字
- 分類保持空白

## 📞 技術支援

如果遇到問題：
1. 檢查 Python 版本和套件是否正確安裝
2. 確認檔案編碼為 UTF-8
3. 檢查 Excel 檔案是否被其他程式開啟
4. 查看終端機中的詳細錯誤訊息

## 🎉 快速開始

```bash
# 1. 安裝套件
pip install openpyxl

# 2. 執行程式
python excel_txt_importer_v2.py

# 3. 按照提示操作
# ✓ 選擇 Excel 檔案
# ✓ 選擇多個 txt 檔案
# ✓ 確認並開始處理
```

---

## 📋 更新摘要

**主要變更**：
- B 欄（分類）：現在填入檔名的第一個單字 ✨
- C 欄（標題）：現在填入完整檔名 ✨
- A 欄（大類）：保持空白（不變）

這樣的設計讓你可以：
1. 透過「分類」快速識別內容類型
2. 透過「標題」看到完整的檔案描述
3. 後續手動補充「大類」進行更高層級的分類

完美符合你的需求！🎯
