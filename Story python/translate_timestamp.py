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
EMAIL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".translate_email.txt")
# ──────────────────────────────────────────────────────

LINE_REGEX = re.compile(r'(\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\])(.*)')
ZH_REGEX = re.compile(r'[\u4e00-\u9fff]')


# ── 工具函數 ───────────────────────────────────────────

class QuotaExceededError(Exception):
    pass


def is_chinese(text: str) -> bool:
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

        if translated and translated.upper().startswith("MYMEMORY WARNING"):
            raise QuotaExceededError("MyMemory 每日額度已用完（WARNING 訊息）")

        if translated and not is_chinese(translated):
            raise QuotaExceededError(f"翻譯結果不含中文，疑似額度用完：{translated[:40]}")

        if translated:
            return translated

        matches = data.get("matches", [])
        for m in matches:
            t = m.get("translation", "")
            if t and is_chinese(t):
                return t

        raise QuotaExceededError("無法取得中文翻譯結果")

    except QuotaExceededError:
        raise
    except Exception:
        return ""


def load_saved_email() -> str:
    if os.path.exists(EMAIL_FILE):
        with open(EMAIL_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""


def save_email(email: str):
    with open(EMAIL_FILE, "w", encoding="utf-8") as f:
        f.write(email.strip())


# ── 翻譯主邏輯 ─────────────────────────────────────────

def process_file(filepath: str, email: str,
                 log_fn, progress_fn, stop_flag: list) -> str:
    """
    回傳：
      'done'    → 全部完成
      'stopped' → 使用者手動停止
      'quota'   → 額度用完（已存檔）

    邏輯：
      - 逐行掃描，若英文行的「下一行」已是中文行 → 直接保留，不呼叫 API
      - 只有英文行後面沒有對應中文行，才翻譯
    """
    with open(filepath, "r", encoding="utf-8") as f:
        raw_lines = f.read().splitlines()

    def already_has_chinese(lines, idx):
        next_idx = idx + 1
        if next_idx >= len(lines):
            return False
        nm = LINE_REGEX.match(lines[next_idx])
        return bool(nm and ZH_REGEX.search(nm.group(2)))

    total = sum(
        1 for idx, l in enumerate(raw_lines)
        if LINE_REGEX.match(l)
        and not ZH_REGEX.search(LINE_REGEX.match(l).group(2))
        and not already_has_chinese(raw_lines, idx)
    )
    done = 0
    output_lines = []

    i = 0
    while i < len(raw_lines):
        if stop_flag[0]:
            remaining = raw_lines[i:]
            with open(filepath, "w", encoding="utf-8") as f:
                f.write("\n".join(output_lines + remaining))
            return 'stopped'

        line = raw_lines[i]

        if not line.strip():
            output_lines.append(line)
            i += 1
            continue

        m = LINE_REGEX.match(line)
        if not m:
            output_lines.append(line)
            i += 1
            continue

        ts = m.group(1)
        sentence = m.group(2).strip()

        # 中文行：直接保留
        if ZH_REGEX.search(sentence):
            output_lines.append(line)
            i += 1
            continue

        # 英文行
        output_lines.append(line)

        # 下一行已有中文 → 跳過
        if already_has_chinese(raw_lines, i):
            log_fn(f"  ⏭️  (已翻) {sentence[:45]}")
            output_lines.append(raw_lines[i + 1])
            i += 2
            continue

        # 需要翻譯
        try:
            zh = translate_text(sentence, email)

            if not zh:
                log_fn(f"  ⚠️  網路錯誤，跳過：{sentence[:40]}")
                done += 1
                progress_fn(done, total)
                i += 1
                continue

            log_fn(f"  🌐 {sentence[:35]}... → {zh[:25]}...")
            output_lines.append(f"{ts} {zh}")
            done += 1
            progress_fn(done, total)
            time.sleep(DELAY_SECONDS)
            i += 1

        except QuotaExceededError as e:
            log_fn(f"  ⚠️  {e}")
            log_fn("  💾 儲存目前進度...")
            remaining = raw_lines[i + 1:]
            with open(filepath, "w", encoding="utf-8") as f:
                f.write("\n".join(output_lines + remaining))
            log_fn(f"  ✔️  已儲存：{os.path.basename(filepath)}")
            return 'quota'

    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(output_lines))
    return 'done'


# ── GUI ───────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Timestamp 中英翻譯工具")
        self.geometry("740x580")
        self.resizable(True, True)
        self.configure(bg="#1e1e2e")

        self.selected_files: list[str] = []
        self.stop_flag = [False]
        self.current_email = load_saved_email()

        self._build_ui()
        self._ask_email_on_start()

    # ── 執行緒安全的 GUI 更新方法 ──────────────────────
    # 所有從背景執行緒呼叫 GUI 的地方，都必須透過這兩個方法，
    # 利用 self.after(0, ...) 將實際操作排程回主執行緒執行，
    # 避免 tkinter 的 Race Condition 造成偶發性崩潰。

    def safe_log(self, msg: str):
        """執行緒安全版 log：透過 after() 排程到主執行緒"""
        self.after(0, lambda: self.log(msg))

    def safe_progress(self, done: int, total: int, filename: str = ""):
        """執行緒安全版 progress：透過 after() 排程到主執行緒"""
        self.after(0, lambda: self.set_progress(done, total, filename))

    # ──────────────────────────────────────────────────

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

        # 「更換 Email」按鈕：翻譯進行中時會被 disable，避免中途更換造成混亂
        self.change_email_btn = tk.Button(
            self, text="🔄  更換 Email", font=("Arial", 9),
            bg=BTN_BG, fg="#a6adc8", relief="flat", cursor="hand2", pady=2,
            command=self._ask_email_on_start)
        self.change_email_btn.pack(pady=(2, 10))

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
        # 翻譯進行中，鎖定「更換 Email」避免中途變更
        self.change_email_btn.config(state="disabled")
        self.log(f"\n🚀 開始翻譯（Email：{self.current_email or '未設定'}）")
        threading.Thread(target=self._run_translation, daemon=True).start()

    def stop_translation(self):
        self.stop_flag[0] = True
        self.log("⏹  使用者中止，完成目前句子後停止並存檔...")

    def _run_translation(self):
        """
        背景執行緒：所有 GUI 操作都透過 safe_log / safe_progress 排程回主執行緒，
        確保 tkinter 執行緒安全。
        """
        for i, filepath in enumerate(self.selected_files):
            fname = os.path.basename(filepath)
            self.safe_log(f"\n📄 [{i+1}/{len(self.selected_files)}] {fname}")

            result = process_file(
                filepath=filepath,
                email=self.current_email,
                log_fn=self.safe_log,                                              # ← 改用 safe_log
                progress_fn=lambda d, t, fn=fname: self.safe_progress(d, t, fn),  # ← 改用 safe_progress
                stop_flag=self.stop_flag
            )

            if result == 'done':
                self.safe_log(f"  ✔️  完成：{fname}")
            elif result == 'stopped':
                self.safe_log("⏹  已停止並存檔。下次選同一個檔案可繼續。")
                break
            elif result == 'quota':
                self.safe_log("\n⚠️  每日翻譯額度已用完！")
                self.safe_log("💡  明天再開啟，程式會自動從未翻譯的句子繼續。")
                self.after(0, lambda: messagebox.showinfo(
                    "額度用完",
                    "每日翻譯額度已用完！\n\n"
                    "✅ 目前進度已儲存\n"
                    "📅 明天再開啟，程式會自動從未翻譯的句子繼續"
                ))
                break

        self.safe_log("\n🎉 本次作業結束！")
        # 翻譯結束後，UI 狀態恢復也排程回主執行緒
        self.after(0, self._on_translation_done)

    def _on_translation_done(self):
        """翻譯完成後，在主執行緒恢復 UI 狀態"""
        self.start_btn.config(state="normal")
        self.stop_btn.config(state="disabled")
        self.change_email_btn.config(state="normal")  # 解鎖「更換 Email」
        self.progress_label.config(text="")
        self.progress_bar["value"] = 0


if __name__ == "__main__":
    app = App()
    app.mainloop()
