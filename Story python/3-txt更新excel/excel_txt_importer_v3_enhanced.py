import os
import openpyxl
from openpyxl.styles import Alignment
from tkinter import Tk, messagebox, Toplevel, Label, Button, Radiobutton, StringVar, Entry, Listbox, Scrollbar, SINGLE, Frame
from tkinter.filedialog import askopenfilename, askopenfilenames, askdirectory
import re
import difflib


def extract_category_and_title_from_filename(filename):
    """
    從檔名提取分類和標題（v3.4 更新）
    - 自動移除 Timestamp 字樣
    - 只對 The Alchemist 系列做特殊處理：分類固定為 "The Alchemist"
    - 其他檔名（包含 James Clear）維持原本智慧提取邏輯
    """
    name_without_ext = os.path.splitext(filename)[0].strip()

    # 移除 Timestamp 相關字樣
    timestamp_patterns = [
        r'(?i)\s*[-_ ]*timestamp\s*[-_ ]*',
        r'(?i)^timestamp\s*[-_ ]*',
        r'(?i)\s*[-_ ]*timestamp$',
        r'(?i)timestamp\s*[-_ ]*',
    ]
    cleaned_name = name_without_ext
    for pattern in timestamp_patterns:
        cleaned_name = re.sub(pattern, ' ', cleaned_name)

    # 清理多餘空格與分隔符
    cleaned_name = re.sub(r'\s+', ' ', cleaned_name)
    cleaned_name = re.sub(r'[-_ ]{2,}', ' ', cleaned_name)
    cleaned_name = cleaned_name.strip(' -_')

    title = cleaned_name if cleaned_name else name_without_ext

    # ==================== 特別規則：僅 The Alchemist 系列 ====================
    if "The Alchemist of Part" in title or "the alchemist of part" in title.lower():
        category = "The Alchemist"
        return category, title
    # ====================================================================

    # 一般檔名提取分類（原本邏輯）
    if " - " in title:
        category = title.split(" - ")[0].strip()
    elif " " in title:
        category = title.split(" ")[0].strip()
    elif "_" in title:
        category = title.split("_")[0].strip()
    elif "-" in title:
        category = title.split("-")[0].strip()
    else:
        category = title.strip()

    return category, title


def clean_timestamp_content(content: str) -> str:
    """移除 Timestamp 字幕檔的時間戳記"""
    lines = content.splitlines()
    cleaned_lines = []
    timestamp_pattern = re.compile(r'^\s*\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*')
    
    for line in lines:
        clean_line = timestamp_pattern.sub('', line).strip()
        if clean_line:
            cleaned_lines.append(clean_line)
    
    return '\n'.join(cleaned_lines)


def get_existing_categories(sheet):
    categories = set()
    for row in range(2, sheet.max_row + 1):
        category = sheet.cell(row=row, column=1).value
        if category and isinstance(category, str) and category.strip():
            categories.add(category.strip())
    return sorted(list(categories))


class CategoryDialog:
    def __init__(self, parent, existing_categories):
        self.result = None
        self.mode = None
        self.dialog = Toplevel(parent)
        self.dialog.title("大類設定")
        self.dialog.resizable(False, False)
        
        self.dialog.update_idletasks()
        screen_width = self.dialog.winfo_screenwidth()
        screen_height = self.dialog.winfo_screenheight()
        x = (screen_width - 500) // 2
        y = (screen_height - 450) // 2
        self.dialog.geometry(f"500x450+{x}+{y}")
        
        self.dialog.lift()
        self.dialog.focus_force()
        self.dialog.grab_set()
        self.dialog.attributes('-topmost', True)
        self.dialog.update()
        self.dialog.attributes('-topmost', False)
        
        Label(self.dialog, text="設定大類（A 欄）", font=('微軟正黑體', 12, 'bold')).pack(pady=10)
        Label(self.dialog, text="請選擇如何處理新增資料的大類：", font=('微軟正黑體', 10)).pack(pady=5)
        
        self.choice = StringVar(value="blank")
        
        Radiobutton(self.dialog, text="保持空白", variable=self.choice, value="blank", font=('微軟正黑體', 10)).pack(anchor='w', padx=30, pady=5)
        Radiobutton(self.dialog, text="自訂大類（手動輸入）", variable=self.choice, value="custom", font=('微軟正黑體', 10)).pack(anchor='w', padx=30, pady=5)
        
        self.custom_entry = Entry(self.dialog, font=('微軟正黑體', 10), width=30)
        self.custom_entry.pack(padx=50, pady=5)
        self.custom_entry.config(state='disabled')
        
        if existing_categories:
            Radiobutton(self.dialog, text="從現有大類中選擇", variable=self.choice, value="existing", font=('微軟正黑體', 10)).pack(anchor='w', padx=30, pady=5)
            list_frame = Frame(self.dialog)
            list_frame.pack(padx=50, pady=5)
            Label(list_frame, text="現有大類：", font=('微軟正黑體', 9)).pack(anchor='w')
            
            scrollbar = Scrollbar(list_frame)
            scrollbar.pack(side='right', fill='y')
            self.category_listbox = Listbox(list_frame, height=6, width=35, font=('微軟正黑體', 10), yscrollcommand=scrollbar.set, selectmode=SINGLE)
            self.category_listbox.pack(side='left')
            scrollbar.config(command=self.category_listbox.yview)
            
            for cat in existing_categories:
                self.category_listbox.insert('end', cat)
            if existing_categories:
                self.category_listbox.select_set(0)
            self.category_listbox.config(state='disabled')
        else:
            self.category_listbox = None
        
        self.choice.trace('w', self.on_choice_change)
        
        button_frame = Frame(self.dialog)
        button_frame.pack(pady=20)
        Button(button_frame, text="確定", command=self.on_ok, width=10, font=('微軟正黑體', 10)).pack(side='left', padx=10)
        Button(button_frame, text="取消", command=self.on_cancel, width=10, font=('微軟正黑體', 10)).pack(side='left', padx=10)
        
        self.dialog.wait_window()
    
    def on_choice_change(self, *args):
        choice = self.choice.get()
        self.custom_entry.config(state='normal' if choice == "custom" else 'disabled')
        if self.category_listbox:
            self.category_listbox.config(state='normal' if choice == "existing" else 'disabled')
    
    def on_ok(self):
        choice = self.choice.get()
        if choice == "blank":
            self.result = None
            self.mode = "blank"
        elif choice == "custom":
            custom_text = self.custom_entry.get().strip()
            if not custom_text:
                messagebox.showwarning("警告", "請輸入自訂大類，或選擇其他選項")
                return
            self.result = custom_text
            self.mode = "custom"
        elif choice == "existing":
            if self.category_listbox:
                selection = self.category_listbox.curselection()
                if not selection:
                    messagebox.showwarning("警告", "請選擇一個現有大類，或選擇其他選項")
                    return
                self.result = self.category_listbox.get(selection[0])
                self.mode = "existing"
        self.dialog.destroy()
    
    def on_cancel(self):
        self.result = None
        self.mode = None
        self.dialog.destroy()


def scan_folder_for_txt(folder_path):
    txt_files = []
    for file in os.listdir(folder_path):
        file_path = os.path.join(folder_path, file)
        if os.path.isfile(file_path) and file.lower().endswith('.txt'):
            txt_files.append(file_path)
    return sorted(txt_files)


def find_next_empty_row(sheet, start_row=2):
    current_row = start_row
    max_row = sheet.max_row
    while current_row <= max_row + 1:
        if sheet.cell(row=current_row, column=2).value is None and sheet.cell(row=current_row, column=3).value is None:
            return current_row
        current_row += 1
    return current_row


def find_title_row(sheet, title):
    for row in range(2, sheet.max_row + 1):
        if sheet.cell(row=row, column=3).value == title:
            return row
    return None


def fill_excel_with_txt(excel_path, txt_files, major_category=None):
    wb = openpyxl.load_workbook(excel_path)
    sheet = wb.active
    success_count = 0
    skip_same_count = 0

    for txt_file in txt_files:
        try:
            filename = os.path.basename(txt_file)
            print(f"\n處理檔案: {filename}")
            
            with open(txt_file, 'r', encoding='utf-8') as f:
                content_raw = f.read().strip()
            
            is_timestamp_file = 'timestamp' in filename.lower()
            content = clean_timestamp_content(content_raw) if is_timestamp_file else content_raw
            
            category, title = extract_category_and_title_from_filename(filename)
            print(f"  分類: {category} | 標題: {title}")
            
            existing_row = find_title_row(sheet, title)
            
            if existing_row:
                existing_content = (sheet.cell(row=existing_row, column=4).value or "").strip()
                new_content = content.strip()
                
                if existing_content == new_content:
                    print(f"  ✓ 內容完全相同，跳過")
                    skip_same_count += 1
                    continue
                
                diff = list(difflib.unified_diff(
                    existing_content.splitlines(keepends=True),
                    new_content.splitlines(keepends=True),
                    fromfile='現有內容', tofile='新內容', lineterm=''
                ))
                diff_text = ''.join(diff)[:2500] + ("\n...（差異過長）" if len(diff) > 100 else "")
                
                if messagebox.askyesno("內容差異偵測", 
                    f"標題「{title}」已存在於第 {existing_row} 行。\n\n"
                    f"D欄內容不同！是否覆蓋？\n\n差異預覽：\n{diff_text}"):
                    target_row = existing_row
                else:
                    skip_same_count += 1
                    continue
            else:
                target_row = find_next_empty_row(sheet)
            
            if major_category:
                sheet.cell(row=target_row, column=1).value = major_category
            sheet.cell(row=target_row, column=2).value = category
            sheet.cell(row=target_row, column=3).value = title
            cell_d = sheet.cell(row=target_row, column=4)
            cell_d.value = content
            cell_d.alignment = Alignment(wrap_text=True, vertical='top')
            
            for check_row in range(2, min(10, sheet.max_row + 1)):
                check_cell = sheet.cell(row=check_row, column=5)
                if isinstance(check_cell.value, str) and check_cell.value.startswith('=HYPERLINK'):
                    new_formula = re.sub(r'C\d+', f'C{target_row}', check_cell.value)
                    sheet.cell(row=target_row, column=5).value = new_formula
                    break
            
            print(f"  ✓ 成功填入/更新 第 {target_row} 行")
            success_count += 1
            
        except Exception as e:
            print(f"  ✗ 錯誤: {e}")
            continue
    
    wb.save(excel_path)
    return success_count, skip_same_count


def main():
    print("=" * 70)
    print("Excel 自動填入工具 v3.4（僅 The Alchemist 特殊分類版）")
    print("=" * 70)
    
    root = Tk()
    root.withdraw()
    
    excel_path = askopenfilename(title="選擇要更新的 Excel 檔案", filetypes=[("Excel 檔案", "*.xlsx")])
    if not excel_path:
        messagebox.showinfo("提示", "未選擇 Excel 檔案")
        return
    
    mode = messagebox.askquestion("處理模式", "Yes = 手動選檔案\nNo = 選擇資料夾（自動掃描所有 txt）")
    
    if mode == "yes":
        txt_files = list(askopenfilenames(title="選擇 txt 檔案", filetypes=[("文字檔案", "*.txt")]))
    else:
        folder = askdirectory(title="選擇資料夾")
        if not folder:
            return
        txt_files = scan_folder_for_txt(folder)
    
    if not txt_files:
        messagebox.showinfo("提示", "沒有找到 txt 檔案")
        return
    
    wb_temp = openpyxl.load_workbook(excel_path)
    existing = get_existing_categories(wb_temp.active)
    wb_temp.close()
    
    dialog = CategoryDialog(root, existing)
    if dialog.mode is None:
        return
    major_category = dialog.result
    
    if not messagebox.askyesno("確認執行", 
        f"即將處理 {len(txt_files)} 個檔案\n"
        f"Excel: {os.path.basename(excel_path)}\n"
        f"大類: {major_category if major_category else '(空白)'}\n\n"
        f"The Alchemist → 分類自動設為「The Alchemist」\n"
        f"Timestamp 自動移除時間戳記與標題字樣\n\n是否繼續？"):
        return
    
    success, skipped = fill_excel_with_txt(excel_path, txt_files, major_category)
    
    messagebox.showinfo("完成", 
        f"處理完成！\n\n"
        f"成功填入/更新: {success} 個\n"
        f"跳過（內容相同）: {skipped} 個\n\n"
        f"檔案已更新：{excel_path}")

if __name__ == "__main__":
    main()