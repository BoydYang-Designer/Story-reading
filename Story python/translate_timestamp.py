"""
translate_timestamp.py
用 GUI 視窗複選要翻譯的 Timestamp.txt，翻譯成中英文雙行格式並覆蓋原檔。

使用方式：
  python translate_timestamp.py

依賴（只需安裝這一個）：
  pip install requests

tkinter 是 Python 內建，不需要安裝。
翻譯 API：MyMemory（免費，不需要 API key，每天約 5000 字）
"""

import re
import time
import json
import os
import threading
import requests
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

# ── 設定 ──────────────────────────────────────────────
MYMEMORY_URL = "https://api.mymemory.translated.net/get"
SRC_LANG = "en"
TGT_LANG = "zh-TW"
DELAY_SECONDS = 0.5
PROGRESS_FILE = ".translate_progress.json"
# ──────────────────────────────────────────────────────

LINE_REGEX = re.compile(r'(\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\])(.*)')
ZH_REGEX = re.compile(r'[\u4e00-\u9fff]')


# ── 翻譯核心邏輯 ───────────────────────────────────────

def translate_text(text: str) -> str:
    text = text.strip()
    if not text:
        return ""
    try:
        resp = requests.get(MYMEMORY_URL, params={
            "q": text,
            "langpair": f"{SRC_LANG}|{TGT_LANG}"
        }, timeout=10)
        data = resp.json()
        translated = data.get("responseData", {}).get("translatedText", "")
        if translated and not translated.upper().startswith("MYMEMORY WARNING"):
            return translated
        matches = data.get("matches", [])
        if matches:
            return matches[0].get("translation", text)
        return text
    except Exception as e:
        return text


def load_cache() -> dict:
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: dict):
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def process_file(filepath: str, cache: dict, log_fn, progress_fn, stop_flag: list) -> bool:
    """
    翻譯單一檔案。
    log_fn(msg)        → 輸出到 GUI 日誌
    progress_fn(v, t)  → 更新進度條 (目前句數, 總句數)
    stop_flag          → [False]，若變成 [True] 則中止
    回傳 True=成功, False=中止
    """
    with open(filepath, "r", encoding="utf-8") as f:
        raw_lines = f.read().splitlines()

    # 過濾掉舊的中文翻譯行
    en_lines = []
    for line in raw_lines:
        if not line.strip():
            en_lines.append(line)
            continue
        m = LINE_REGEX.match(line)
        if m and ZH_REGEX.search(m.group(2)):
            continue  # 舊的中文行，跳過
        en_lines.append(line)

    total = sum(1 for l in en_lines if LINE_REGEX.match(l))
    done = 0
    output_lines = []

    for line in en_lines:
        if stop_flag[0]:
            return False

        if not line.strip():
            output_lines.append(line)
            continue

        m = LINE_REGEX.match(line)
        if not m:
            output_lines.append(line)
            continue

        ts = m.group(1)
        sentence = m.group(2).strip()
        output_lines.append(line)

        file_key = os.path.basename(filepath)
        cache_key = f"{file_key}||{sentence}"

        if cache_key in cache:
            zh = cache[cache_key]
            log_fn(f"  ✅ (快取) {sentence[:45]}...")
        else:
            zh = translate_text(sentence)
            cache[cache_key] = zh
            save_cache(cache)
            log_fn(f"  🌐 {sentence[:35]}... → {zh[:25]}...")
            time.sleep(DELAY_SECONDS)

        output_lines.append(f"{ts} {zh}")
        done += 1
        progress_fn(done, total)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(output_lines))

    return True


# ── GUI ───────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Timestamp 中英翻譯工具")
        self.geometry("720x580")
        self.resizable(True, True)
        self.configure(bg="#1e1e2e")

        self.selected_files: list[str] = []
        self.stop_flag = [False]
        self.cache = load_cache()

        self._build_ui()

    def _build_ui(self):
        FONT = ("Arial", 11)
        BG = "#1e1e2e"
        FG = "#cdd6f4"
        BTN_BG = "#313244"
        BTN_FG = "#cdd6f4"
        ACC = "#89b4fa"

        # 標題
        tk.Label(self, text="📄 Timestamp 中英翻譯工具", font=("Arial", 15, "bold"),
                 bg=BG, fg=ACC).pack(pady=(18, 4))
        tk.Label(self, text="選擇檔案 → 開始翻譯（覆蓋原檔）",
                 font=("Arial", 10), bg=BG, fg="#a6adc8").pack(pady=(0, 10))

        # 選檔按鈕
        tk.Button(self, text="📂  選擇 Timestamp.txt 檔案（可複選）",
                  font=FONT, bg=BTN_BG, fg=BTN_FG, activebackground=ACC,
                  cursor="hand2", relief="flat", padx=12, pady=6,
                  command=self.choose_files).pack(pady=(0, 6))

        # 已選檔案清單
        list_frame = tk.Frame(self, bg=BG)
        list_frame.pack(fill="x", padx=20)
        tk.Label(list_frame, text="已選檔案：", font=("Arial", 10),
                 bg=BG, fg="#a6adc8").pack(anchor="w")

        self.file_listbox = tk.Listbox(list_frame, height=5, font=("Arial", 10),
                                       bg="#313244", fg=FG, selectbackground=ACC,
                                       relief="flat", bd=0)
        self.file_listbox.pack(fill="x", pady=(2, 8))

        # 進度條
        prog_frame = tk.Frame(self, bg=BG)
        prog_frame.pack(fill="x", padx=20, pady=(0, 4))
        self.progress_label = tk.Label(prog_frame, text="", font=("Arial", 10),
                                       bg=BG, fg="#a6adc8")
        self.progress_label.pack(anchor="w")
        self.progress_bar = ttk.Progressbar(prog_frame, mode="determinate", length=680)
        self.progress_bar.pack(fill="x", pady=(2, 0))

        # 按鈕列
        btn_frame = tk.Frame(self, bg=BG)
        btn_frame.pack(pady=8)
        self.start_btn = tk.Button(btn_frame, text="▶  開始翻譯", font=FONT,
                                   bg="#a6e3a1", fg="#1e1e2e", activebackground="#94e2d5",
                                   cursor="hand2", relief="flat", padx=16, pady=6,
                                   command=self.start_translation)
        self.start_btn.pack(side="left", padx=6)

        self.stop_btn = tk.Button(btn_frame, text="⏹  停止", font=FONT,
                                  bg="#f38ba8", fg="#1e1e2e", activebackground="#eba0ac",
                                  cursor="hand2", relief="flat", padx=16, pady=6,
                                  state="disabled", command=self.stop_translation)
        self.stop_btn.pack(side="left", padx=6)

        tk.Button(btn_frame, text="🗑  清除快取", font=FONT,
                  bg=BTN_BG, fg=BTN_FG, cursor="hand2", relief="flat",
                  padx=12, pady=6, command=self.clear_cache).pack(side="left", padx=6)

        # 日誌區
        log_frame = tk.Frame(self, bg=BG)
        log_frame.pack(fill="both", expand=True, padx=20, pady=(0, 16))
        tk.Label(log_frame, text="執行紀錄：", font=("Arial", 10),
                 bg=BG, fg="#a6adc8").pack(anchor="w")

        log_inner = tk.Frame(log_frame, bg="#313244")
        log_inner.pack(fill="both", expand=True)
        self.log_box = tk.Text(log_inner, font=("Courier", 9), bg="#313244", fg=FG,
                               relief="flat", bd=0, state="disabled", wrap="word")
        scrollbar = tk.Scrollbar(log_inner, command=self.log_box.yview)
        self.log_box.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.log_box.pack(fill="both", expand=True, padx=6, pady=6)

    def choose_files(self):
        files = filedialog.askopenfilenames(
            title="選擇要翻譯的 Timestamp 檔案",
            filetypes=[("Timestamp 文字檔", "*Timestamp*.txt"), ("所有文字檔", "*.txt")]
        )
        if files:
            self.selected_files = list(files)
            self.file_listbox.delete(0, "end")
            for f in self.selected_files:
                self.file_listbox.insert("end", os.path.basename(f))
            self.log(f"✔️  已選 {len(self.selected_files)} 個檔案")

    def log(self, msg: str):
        self.log_box.configure(state="normal")
        self.log_box.insert("end", msg + "\n")
        self.log_box.see("end")
        self.log_box.configure(state="disabled")

    def set_progress(self, done: int, total: int, filename: str = ""):
        pct = int(done / total * 100) if total else 0
        self.progress_bar["value"] = pct
        self.progress_label.config(text=f"{filename}  {done} / {total} 句  ({pct}%)")
        self.update_idletasks()

    def start_translation(self):
        if not self.selected_files:
            messagebox.showwarning("尚未選擇檔案", "請先點選「選擇檔案」選取要翻譯的 Timestamp.txt")
            return
        self.stop_flag[0] = False
        self.start_btn.config(state="disabled")
        self.stop_btn.config(state="normal")
        self.log("\n🚀 開始翻譯...")
        threading.Thread(target=self._run_translation, daemon=True).start()

    def stop_translation(self):
        self.stop_flag[0] = True
        self.log("⏹  使用者中止，目前句子翻譯完後停止...")

    def _run_translation(self):
        total_files = len(self.selected_files)
        for i, filepath in enumerate(self.selected_files):
            fname = os.path.basename(filepath)
            self.log(f"\n📄 [{i+1}/{total_files}] {fname}")

            def progress_fn(done, total, fn=fname):
                self.set_progress(done, total, fn)

            ok = process_file(
                filepath, self.cache,
                log_fn=self.log,
                progress_fn=progress_fn,
                stop_flag=self.stop_flag
            )
            if not ok:
                self.log("⏹  已中止。")
                break
            self.log(f"  ✔️  完成：{fname}")

        self.log("\n🎉 全部處理完畢！")
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.set_progress(0, 1, "")
        self.progress_label.config(text="完成")

    def clear_cache(self):
        if messagebox.askyesno("確認", "清除所有翻譯快取？（下次會重新翻譯）"):
            self.cache = {}
            if os.path.exists(PROGRESS_FILE):
                os.remove(PROGRESS_FILE)
            self.log("🗑  快取已清除")


if __name__ == "__main__":
    app = App()
    app.mainloop()
