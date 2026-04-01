import pandas as pd
import json
import tkinter as tk
from tkinter import filedialog, messagebox
import os

# ── 設定哪些分類有縮圖（hasThumb）────────────────────────────────────────────
# 在這裡維護即可，不需要動 Excel。
# True  = 該分類有圖片（images/<分類名>.jpg 或 .png 存在）
# False = 該分類沒有圖片（省略也等於 False，程式會 fallback 到 HEAD 請求）
#
# 新增分類時：在下方加一行 '分類名稱': True/False 即可。
CATEGORY_THUMB_MAP = {
    'AI':                                True,
    "Alice's adventures in wonderland":  True,
    'Brian Cox':                         True,
    'Design':                            True,
    'Dylan Page':                        True,
    'Interview':                         False,
    'James Clear – Atomic Habits':       True,  # 注意：這裡是 – (en dash U+2013)，跟 Excel 一致
    'Lit Breakdown':                     True,
    'Phrase':                            False,
    'The Alchemist':                     True,
    'greybearDesign':                    True,
    'icipalpsychology':                  True,
    'session in cholet':                 True,
    'thefutur':                          True,
    '生活':                              False,
    '鼓勵':                              False,
}
# ─────────────────────────────────────────────────────────────────────────────


def clean_data(record):
    """ 移除空白欄位（例如 NaN 或 None），並將多個分類欄位合併為陣列 """
    cleaned = {}
    categories = []
    for key, value in record.items():
        if pd.notna(value) and value != "":
            if key.startswith("分類"):
                categories.append(str(value).strip())
            else:
                cleaned[key] = value
    cleaned["分類"] = categories if categories else []
    return cleaned


def build_categories_list(df):
    """
    從 DataFrame 自動收集所有出現過的分類，
    並搭配 CATEGORY_THUMB_MAP 產生 Categories 陣列。
    新分類若不在 CATEGORY_THUMB_MAP 中，hasThumb 預設為 False。
    """
    seen = []
    for col in df.columns:
        if col.startswith('分類'):
            for val in df[col].dropna():
                val = str(val).strip()
                if val and val not in seen:
                    seen.append(val)

    categories = []
    for cat_name in seen:
        has_thumb = CATEGORY_THUMB_MAP.get(cat_name, False)
        categories.append({
            '分類':     cat_name,
            'hasThumb': has_thumb,
        })

    return categories


def convert_excel_to_json():
    file_path = filedialog.askopenfilename(filetypes=[("Excel files", "*.xlsx;*.xls")])

    if not file_path:
        return

    try:
        df = pd.read_excel(file_path, engine="openpyxl")
        filtered_data = [clean_data(row) for _, row in df.iterrows()]
        categories_list = build_categories_list(df)

        json_data = {
            "New Words":  filtered_data,
            "Categories": categories_list,
        }

        json_filename = os.path.splitext(file_path)[0] + ".json"

        with open(json_filename, "w", encoding="utf-8") as json_file:
            json.dump(json_data, json_file, indent=4, ensure_ascii=False)

        thumb_count = sum(1 for c in categories_list if c['hasThumb'])
        messagebox.showinfo(
            "成功",
            f"轉換完成！\nJSON 檔案已儲存為：{json_filename}\n\n"
            f"共 {len(filtered_data)} 篇文章\n"
            f"共 {len(categories_list)} 個分類（其中 {thumb_count} 個有縮圖）"
        )

    except Exception as e:
        messagebox.showerror("錯誤", f"轉換失敗！\n{str(e)}")


if __name__ == "__main__":
    root = tk.Tk()
    root.withdraw()
    convert_excel_to_json()
