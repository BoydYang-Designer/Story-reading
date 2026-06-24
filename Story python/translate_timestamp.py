"""
translate_timestamp.py
用 GUI 視窗複選要翻譯的 Timestamp.txt，翻譯成中英文雙行格式並覆蓋原檔。

使用方式：雙擊執行即可

依賴（只需安裝這一個）：
  pip install requests

tkinter 是 Python 內建，不需要安裝。
翻譯 API：MyMemory（免費，加 email 每天 50,000 字）
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
DELAY_SECONDS = 0.3
PROGRESS_FILE = ".translate_progress.json"
EMAIL_FILE = ".translate_email.txt"
# ──────────────────────────────────────────────────────

LINE_REGEX = re.compile(r'(\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\])(.*)')
ZH_REGEX = re.compile(r'[\u4e00-\u9fff]')


# ── 工具函數 ───────────────────────────────────────────

class QuotaExceededError(Exception):
    pass


def is_chinese(text: str) -> bool:
    """確認翻譯結果含有中文字元"""
    return bool(ZH_REGEX.search(text))


def translate_text(text: str, email: str = "") -> str:
    """
    呼叫 MyMemory API 翻譯。
    - 額度用完 → 拋出 QuotaExceededError
    - 結果不含中文（英翻英）→ 拋出 QuotaExceededError
    - 網路錯誤 → 回傳空字串
    """
    text = text.strip()
    if not text:
        return ""

    params = {"q": text, "langpair": f"{SRC_LANG}|{TGT_LANG}"}
    if email:
        params["de"] = email

    try:
        resp = requests.get(MYMEMORY_URL, params=params, timeout=10)
        data = resp.json()
        translated = data.get("responseData", {}).get("translatedText", "")

        # 1. 明確的額度警告
        if translated and translated.upper().startswith("MYMEMORY WARNING"):
            raise QuotaExceededError("MyMemory 每日額度已用完（WARNING 訊息）")

        # 2. 有翻譯結果但不含中文 → 視為英翻英，額度可能用完
        if translated and not is_chinese(translated):
            raise QuotaExceededError(f"翻譯結果不含中文，疑似額度用完：{translated[:40]}")

        if translated:
            return translated

        # fallback：嘗試 matches
        matches = data.get("matches", [])
        for m in matches:
            t = m.get("translation", "")
            if t and is_chinese(t):
                return t

        # 都沒有中文結果
        raise QuotaExceededError("無法取得中文翻譯結果")

    except QuotaExceededError:
        raise
    except Exception as e:
        return ""  # 純網路錯誤，回傳空字串讓呼叫端決定


def load_cache() -> dict:
    if os.path.exists(PROGRESS_FILE):
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(cache: dict):
    with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def clean_bad_cache(cache: dict) -> tuple[dict, int]:
    """移除快取中英翻英的錯誤條目，回傳 (新快取, 刪除數量)"""
    bad_keys = [k for k, v in cache.items() if not is_chinese(str(v))]
    for k in bad_keys:
        del cache[k]
    return cache, len(bad_keys)


def load_saved_email() -> str:
    if os.path.exists(EMAIL_FILE):
        with open(EMAIL_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""


def save_email(email: str):
    with open(EMAIL_FILE, "w", encoding="utf-8") as f:
        f.write(email.strip())


# ── 翻譯主邏輯 ─────────────────────────────────────────

def process_file(filepath: str, email: str, cache: dict,
                 log_fn, progress_fn, stop_flag: list) -> str:
    """
    回傳：
      'done'    → 全部完成
      'stopped' → 使用者手動停止
      'quota'   → 額度用完（已存檔）
    """
    with open(filepath, "r", encoding="utf-8") as f:
        raw_lines = f.read().splitlines()

    # 過濾舊的中文翻譯行（保留英文行）
    en_lines = []
    for line in raw_lines:
        if not line.strip():
            en_lines.append(line)
            continue
        m = LINE_REGEX.match(line)
        if m and ZH_REGEX.search(m.group(2)):
            continue
        en_lines.append(line)

    total = sum(1 for l in en_lines if LINE_REGEX.match(l))
    done = 0
    output_lines = []
    file_key = os.path.basename(filepath)

    for i, line in enumerate(en_lines):
        if stop_flag[0]:
            _save_partial(filepath, output_lines, en_lines, i)
            return 'stopped'

        if not line.strip():
            output_lines.append(line)
            continue

        m = LINE_REGEX.match(line)
        if not m:
            output_lines.append(line)
            continue

        ts = m.group(1)
        sentence = m.group(2).strip()
        cache_key = f"{file_key}||{sentence}"

        output_lines.append(line)  # 英文行

        # 快取命中
        if cache_key in cache:
            zh = cache[cache_key]
            log_fn(f"  ✅ (快取) {sentence[:45]}...")
            output_lines.append(f"{ts} {zh}")
            done += 1
            progress_fn(done, total)
            continue

        # 需要翻譯
        try:
            zh = translate_text(sentence, email)

            if not zh:
                # 網路錯誤，跳過這句（保留英文）
                log_fn(f"  ⚠️  網路錯誤，跳過：{sentence[:40]}")
                done += 1
                progress_fn(done, total)
                continue

            cache[cache_key] = zh
            save_cache(cache)
            log_fn(f"  🌐 {sentence[:35]}... → {zh[:25]}...")
            output_lines.append(f"{ts} {zh}")
            done += 1
            progress_fn(done, total)
            time.sleep(DELAY_SECONDS)

        except QuotaExceededError as e:
            log_fn(f"  ⚠️  {e}")
            log_fn("  💾 儲存目前進度...")

            # output_lines 最後已 append 了這行英文但沒有中文，
            # 後面的英文行（en_lines[i+1:]）也要補回來
            remaining_en = en_lines[i + 1:]
            final = output_lines + remaining_en
            with open(filepath, "w", encoding="utf-8") as f:
                f.write("\n".join(final))

            log_fn(f"  ✔️  已儲存：{os.path.basename(filepath)}")
            return 'quota'

    # 全部完成
    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(output_lines))
    return 'done'


def _save_partial(filepath, output_lines, en_lines, current_idx):
    """手動停止時存檔：已翻的保留，剩餘的補回英文"""
    try:
        # output_lines 最後一行是當前英文行（尚未翻譯），
        # en_lines[current_idx+1:] 是後面還沒跑到的行
        remaining_en = en_lines[current_idx + 1:]
        final = output_lines + remaining_en
        with open(filepath, "w", encoding="utf-8") as f:
            f.write("\n".join(final))
    except Exception:
        pass


# ── GUI ───────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Timestamp 中英翻譯工具")
        self.geometry("740x640")
        self.resizable(True, True)
        self.configure(bg="#1e1e2e")

        self.selected_files: list[str] = []
        self.stop_flag = [False]
        self.cache = load_cache()
        self.current_email = load_saved_email()

        self._build_ui()
        self._ask_email_on_start()

    def _ask_email_on_start(self):
        dialog = tk.Toplevel(self)
        dialog.title("設定 Email（可提高每日額度）")
        dialog.geometry("480x230")
        dialog.configure(bg="#1e1e2e")
        dialog.grab_set()
        dialog.resizable(False, False)

        BG, FG, ACC = "#1e1e2e", "#cdd6f4", "#89b4fa"

        tk.Label(dialog,
                 text="📧 輸入 Email 可將每日額度從 5,000 字提升至 50,000 字",
                 font=("Arial", 10), bg=BG, fg=ACC, wraplength=440).pack(pady=(18, 4))
        tk.Label(dialog,
                 text="Google email 可用。MyMemory 不會寄信給你，留空則使用免費額度。",
                 font=("Arial", 9), bg=BG, fg="#a6adc8", wraplength=440).pack(pady=(0, 12))

        entry_frame = tk.Frame(dialog, bg=BG)
        entry_frame.pack()
        tk.Label(entry_frame, text="Email：", font=("Arial", 11), bg=BG, fg=FG).pack(side="left")
        email_var = tk.StringVar(value=self.current_email)
        entry = tk.Entry(entry_frame, textvariable=email_var, font=("Arial", 11),
                         width=30, bg="#313244", fg=FG, insertbackground=FG, relief="flat")
        entry.pack(side="left", padx=(4, 0))

        def confirm():
            email = email_var.get().strip()
            self.current_email = email
            if email:
                save_email(email)
                self.email_label.config(text=f"📧 Email：{email}")
                self.log(f"✅ 使用 Email：{email}（高額度模式）")
            else:
                self.email_label.config(text="📧 Email：未設定（免費額度 5,000 字/天）")
                self.log("ℹ️  未設定 Email，使用免費額度（5,000 字/天）")
            dialog.destroy()

        def skip():
            self.current_email = ""
            self.email_label.config(text="📧 Email：未設定（免費額度 5,000 字/天）")
            self.log("ℹ️  跳過 Email 設定，使用免費額度")
            dialog.destroy()

        btn_frame = tk.Frame(dialog, bg=BG)
        btn_frame.pack(pady=16)
        tk.Button(btn_frame, text="✅  確認使用", font=("Arial", 11),
                  bg="#a6e3a1", fg="#1e1e2e", relief="flat", padx=14, pady=5,
                  cursor="hand2", command=confirm).pack(side="left", padx=8)
        tk.Button(btn_frame, text="跳過（不填）", font=("Arial", 11),
                  bg="#313244", fg=FG, relief="flat", padx=14, pady=5,
                  cursor="hand2", command=skip).pack(side="left", padx=8)

        self.wait_window(dialog)

    def _build_ui(self):
        BG, FG, ACC = "#1e1e2e", "#cdd6f4", "#89b4fa"
        BTN_BG = "#313244"
        FONT = ("Arial", 11)

        tk.Label(self, text="📄 Timestamp 中英翻譯工具",
                 font=("Arial", 15, "bold"), bg=BG, fg=ACC).pack(pady=(16, 2))

        self.email_label = tk.Label(self,
            text=f"📧 Email：{self.current_email or '未設定（免費額度 5,000 字/天）'}",
            font=("Arial", 9), bg=BG, fg="#a6adc8")
        self.email_label.pack()

        tk.Button(self, text="🔄  更換 Email", font=("Arial", 9),
                  bg=BTN_BG, fg="#a6adc8", relief="flat", cursor="hand2", pady=2,
                  command=self._ask_email_on_start).pack(pady=(2, 10))

        tk.Button(self, text="📂  選擇 Timestamp.txt 檔案（可複選）",
                  font=FONT, bg=BTN_BG, fg=FG,
                  cursor="hand2", relief="flat", padx=12, pady=6,
                  command=self.choose_files).pack(pady=(0, 6))

        list_frame = tk.Frame(self, bg=BG)
        list_frame.pack(fill="x", padx=20)
        tk.Label(list_frame, text="已選檔案：", font=("Arial", 10), bg=BG, fg="#a6adc8").pack(anchor="w")
        self.file_listbox = tk.Listbox(list_frame, height=4, font=("Arial", 10),
                                       bg="#313244", fg=FG, selectbackground=ACC,
                                       relief="flat", bd=0)
        self.file_listbox.pack(fill="x", pady=(2, 8))

        prog_frame = tk.Frame(self, bg=BG)
        prog_frame.pack(fill="x", padx=20, pady=(0, 4))
        self.progress_label = tk.Label(prog_frame, text="", font=("Arial", 10), bg=BG, fg="#a6adc8")
        self.progress_label.pack(anchor="w")
        self.progress_bar = ttk.Progressbar(prog_frame, mode="determinate", length=700)
        self.progress_bar.pack(fill="x", pady=(2, 0))

        btn_frame = tk.Frame(self, bg=BG)
        btn_frame.pack(pady=8)

        self.start_btn = tk.Button(btn_frame, text="▶  開始翻譯",
                                   font=FONT, bg="#a6e3a1", fg="#1e1e2e",
                                   cursor="hand2", relief="flat", padx=16, pady=6,
                                   command=self.start_translation)
        self.start_btn.pack(side="left", padx=6)

        self.stop_btn = tk.Button(btn_frame, text="⏹  停止",
                                  font=FONT, bg="#f38ba8", fg="#1e1e2e",
                                  cursor="hand2", relief="flat", padx=16, pady=6,
                                  state="disabled", command=self.stop_translation)
        self.stop_btn.pack(side="left", padx=6)

        tk.Button(btn_frame, text="🧹  清除錯誤快取",
                  font=FONT, bg="#fab387", fg="#1e1e2e",
                  cursor="hand2", relief="flat", padx=12, pady=6,
                  command=self.clean_bad_cache).pack(side="left", padx=6)

        tk.Button(btn_frame, text="🗑  清除全部快取",
                  font=FONT, bg=BTN_BG, fg=FG,
                  cursor="hand2", relief="flat", padx=12, pady=6,
                  command=self.clear_all_cache).pack(side="left", padx=6)

        log_frame = tk.Frame(self, bg=BG)
        log_frame.pack(fill="both", expand=True, padx=20, pady=(0, 16))
        tk.Label(log_frame, text="執行紀錄：", font=("Arial", 10), bg=BG, fg="#a6adc8").pack(anchor="w")
        log_inner = tk.Frame(log_frame, bg="#313244")
        log_inner.pack(fill="both", expand=True)
        self.log_box = tk.Text(log_inner, font=("Courier", 9), bg="#313244", fg=FG,
                               relief="flat", bd=0, state="disabled", wrap="word")
        sb = tk.Scrollbar(log_inner, command=self.log_box.yview)
        self.log_box.configure(yscrollcommand=sb.set)
        sb.pack(side="right", fill="y")
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
        self.log(f"\n🚀 開始翻譯（Email：{self.current_email or '未設定'}）")
        threading.Thread(target=self._run_translation, daemon=True).start()

    def stop_translation(self):
        self.stop_flag[0] = True
        self.log("⏹  使用者中止，完成目前句子後停止並存檔...")

    def _run_translation(self):
        for i, filepath in enumerate(self.selected_files):
            fname = os.path.basename(filepath)
            self.log(f"\n📄 [{i+1}/{len(self.selected_files)}] {fname}")

            result = process_file(
                filepath=filepath,
                email=self.current_email,
                cache=self.cache,
                log_fn=self.log,
                progress_fn=lambda d, t, fn=fname: self.set_progress(d, t, fn),
                stop_flag=self.stop_flag
            )

            if result == 'done':
                self.log(f"  ✔️  完成：{fname}")
            elif result == 'stopped':
                self.log("⏹  已停止並存檔。下次選同一個檔案可繼續。")
                break
            elif result == 'quota':
                self.log("\n⚠️  每日翻譯額度已用完！")
                self.log("💡  可點「🔄 更換 Email」使用另一個 Email 繼續，或明天再跑。")
                self.after(0, lambda: messagebox.showinfo(
                    "額度用完",
                    "每日翻譯額度已用完！\n\n"
                    "✅ 目前進度已儲存\n"
                    "💡 可點「更換 Email」換另一個 Google Email 繼續\n"
                    "📅 或明天再開啟，系統會自動從未翻譯的句子繼續"
                ))
                break

        self.log("\n🎉 本次作業結束！")
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.progress_label.config(text="")
        self.progress_bar["value"] = 0

    def clean_bad_cache(self):
        """清除快取中英翻英的錯誤條目"""
        self.cache, removed = clean_bad_cache(self.cache)
        save_cache(self.cache)
        self.log(f"🧹  已清除 {removed} 筆錯誤快取（英翻英），下次重新翻譯這些句子")
        if removed == 0:
            messagebox.showinfo("清除完成", "沒有發現錯誤快取，快取都是正確的中文翻譯！")
        else:
            messagebox.showinfo("清除完成", f"已清除 {removed} 筆英翻英的錯誤快取。\n下次翻譯時會重新翻譯這些句子。")

    def clear_all_cache(self):
        if messagebox.askyesno("確認", "清除所有翻譯快取？\n（下次會重新翻譯所有句子）"):
            self.cache = {}
            if os.path.exists(PROGRESS_FILE):
                os.remove(PROGRESS_FILE)
            self.log("🗑  全部快取已清除")


if __name__ == "__main__":
    app = App()
    app.mainloop()
