import tkinter as tk
from tkinter import filedialog, messagebox
import pandas as pd
import json
import os
import uuid
from datetime import datetime

def select_files():
    root = tk.Tk()
    root.withdraw()  # 隱藏主視窗
    file_paths = filedialog.askopenfilenames(
        title="請選擇 Excel 或 CSV 檔案",
        filetypes=[("Excel/CSV Files", "*.xlsx *.xls *.csv")]
    )
    return file_paths

def clean_value(val):
    """清理數值，移除 NaN 或空字串"""
    if pd.isna(val) or val == "":
        return ""
    return str(val).strip()

def parse_price(val):
    """強制將價格轉為數字"""
    try:
        # 移除逗號或其他非數字字符
        clean_str = str(val).replace(',', '').replace('$', '').replace('元', '')
        return int(float(clean_str))
    except:
        return 0

def process_dataframe(df, filename):
    items = []
    
    # 標準化欄位名稱映射 (處理不同分頁/檔案的欄位命名差異)
    # 格式: '目標欄位': ['可能的來源欄位1', '可能的來源欄位2'...]
    col_map = {
        'date': ['購買日期', '參觀日期', 'Date'],
        'store': ['賣場', '購買地點', '地點', 'Store'],
        'name': ['品項', '品名', '博物館', 'Name'],
        'price': ['價格', '金額', '費用', 'Price'],
        'spec': ['產品重量總重', '容量', '規格'],
        'note': ['使用心得', '心得', '備註']
    }

    # 找出目前 DataFrame 對應的欄位
    current_cols = {}
    for target, sources in col_map.items():
        for source in sources:
            if source in df.columns:
                current_cols[target] = source
                break
    
    # 如果找不到關鍵欄位(如品名或價格)，可能不是正確的資料表，跳過
    if 'name' not in current_cols or 'price' not in current_cols:
        print(f"  警告: 檔案或分頁中找不到對應的品名或價格欄位，跳過處理。")
        return []

    # 遍歷每一行資料
    for _, row in df.iterrows():
        # 必填欄位檢查
        name = clean_value(row.get(current_cols.get('name')))
        if not name: continue # 沒品名就跳過

        # 處理日期
        raw_date = row.get(current_cols.get('date'))
        try:
            date_obj = pd.to_datetime(raw_date)
            date_str = date_obj.strftime('%Y-%m-%d')
        except:
            date_str = datetime.now().strftime('%Y-%m-%d') # 如果日期格式錯誤，預設今天

        # 處理賣場 (如果欄位裡沒有，嘗試從檔名推測，例如檔名包含 Costco)
        store = clean_value(row.get(current_cols.get('store')))
        if not store:
            if 'Costco' in filename: store = 'Costco'
            elif 'POYA' in filename or '寶雅' in filename: store = 'POYA'
            elif 'Carrefour' in filename or '家樂福' in filename: store = 'Carrefour'
            elif 'IKEA' in filename: store = 'IKEA'
            else: store = 'Other'

        # 處理標籤 (針對 Costco 特殊欄位)
        tags = []
        # 檢查是否有 Home/Family/舅舅 這些欄位，且內容標記為 "●" 或有值
        for tag_col in ['Home', 'Family Home', '舅舅']:
            if tag_col in df.columns:
                val = str(row[tag_col]).strip()
                if val == '●' or val.lower() == 'v' or val == '1':
                    # 統一標籤名稱
                    if tag_col == 'Family Home': tags.append('Family')
                    elif tag_col == '舅舅': tags.append('Uncle')
                    else: tags.append('Home')

        # 建立資料物件
        item = {
            "id": str(uuid.uuid4()), # 產生唯一 ID
            "date": date_str,
            "store": store,
            "name": name,
            "price": parse_price(row.get(current_cols.get('price'))),
            "spec": clean_value(row.get(current_cols.get('spec'))),
            "tags": tags,
            "note": clean_value(row.get(current_cols.get('note')))
        }
        items.append(item)
    
    return items

def main():
    files = select_files()
    if not files:
        return

    all_data = []
    print("開始處理檔案...")

    for file_path in files:
        filename = os.path.basename(file_path)
        print(f"讀取: {filename}")
        
        try:
            if file_path.endswith('.csv'):
                # 嘗試不同的編碼讀取 CSV
                try:
                    df = pd.read_csv(file_path, encoding='utf-8-sig')
                except:
                    df = pd.read_csv(file_path, encoding='cp950') # 常見的 Excel CSV 編碼
                all_data.extend(process_dataframe(df, filename))

            elif file_path.endswith(('.xls', '.xlsx')):
                xls = pd.ExcelFile(file_path)
                for sheet_name in xls.sheet_names:
                    print(f"  處理分頁: {sheet_name}")
                    df = pd.read_excel(xls, sheet_name=sheet_name)
                    all_data.extend(process_dataframe(df, filename))
        except Exception as e:
            print(f"  錯誤: 無法讀取 {filename}. 原因: {e}")

    # 輸出 JSON
    output_filename = "shopping_data_import.json"
    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(all_data, f, ensure_ascii=False, indent=2)

    messagebox.showinfo("完成", f"已成功轉換 {len(all_data)} 筆資料！\n檔案已儲存為: {output_filename}\n請使用網頁的「匯入資料」功能讀取此檔案。")

if __name__ == "__main__":
    main()