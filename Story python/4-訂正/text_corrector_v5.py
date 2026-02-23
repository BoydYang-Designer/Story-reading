# 自動切換虛擬環境啟動器
# 直接雙擊或執行此程式，會自動使用 D:/my_venv 的 Python。
# 不需要手動 activate。
import sys
import os
import subprocess

VENV_PYTHON = r"D:\my_venv\Scripts\python.exe"

# 如果目前不是用虛擬環境的 Python，就重新用虛擬環境啟動自己
if sys.executable.lower() != VENV_PYTHON.lower():
    if not os.path.exists(VENV_PYTHON):
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror(
            "找不到虛擬環境",
            f"找不到虛擬環境：{VENV_PYTHON}\n\n"
            "請先在 cmd 執行：\n"
            "python -m venv D:\\my_venv\n"
            "D:\\my_venv\\Scripts\\activate\n"
            "pip install pdfplumber google-generativeai"
        )
        sys.exit(1)
    # 用虛擬環境重新執行自己，傳遞所有參數
    subprocess.run([VENV_PYTHON] + sys.argv)
    sys.exit(0)

"""
Text Corrector V5
─────────────────
新增功能：
  - 啟動時手動輸入 Gemini API Key（可選擇記住）
  - 審閱視窗每列三行：
      第一行（紅）：TXT 原句，錯誤詞標紅底線
      第二行（綠）：PDF 對應句，正確詞標綠粗體
      第三行（藍）：AI 建議（文法／拼字判斷）
  - 分析完批次呼叫 Gemini，全部完成後開審閱視窗
  - 超過速率限制自動等待重試

安裝依賴：
  pip install pdfplumber google-generativeai
"""

import tkinter as tk
from tkinter import filedialog, messagebox, ttk, scrolledtext
import os
import re
import difflib
import datetime
import time
import threading
import json

try:
    import pdfplumber
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install",
                           "pdfplumber", "--break-system-packages", "-q"])
    import pdfplumber


# ══════════════════════════════════════════════
#  常數
# ══════════════════════════════════════════════

STOPWORDS = {
    "a","an","the","and","or","but","in","on","at","to","for","of","by",
    "with","from","as","is","it","be","he","she","we","i","me","my","you",
    "so","if","up","do","no","not","its","was","are","has","had","have",
    "his","her","our","their","your","this","that","who","what","which",
    "will","can","may","just","all","one","two","out","now","then","they",
    "him","them","been","were","did","got","get","go","oh","said","says",
    "am","does","each","few","how","more","most","other","some","than",
    "too","very","s","t","re","ve","ll","d",
}

TIMESTAMP_RE = re.compile(
    r"(\[\d{2}:\d{2}:\d{2}[.,]\d+\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d+\]\s*)"
)

PDF_SENT_SPLIT   = re.compile(r'(?<=[.!?])\s+|\n')
SENT_MATCH_THRESHOLD = 0.45
WORD_SIM_THRESHOLD   = 0.72

# Key 儲存路徑（與程式同目錄）
KEY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".gemini_key")


# ══════════════════════════════════════════════
#  Gemini API Key 管理
# ══════════════════════════════════════════════

def load_saved_key() -> str:
    """讀取已儲存的 Key"""
    try:
        if os.path.exists(KEY_FILE):
            with open(KEY_FILE, "r", encoding="utf-8") as f:
                return f.read().strip()
    except Exception:
        pass
    return ""


def save_key(key: str):
    """儲存 Key 到本地檔案"""
    try:
        with open(KEY_FILE, "w", encoding="utf-8") as f:
            f.write(key.strip())
    except Exception:
        pass


def delete_saved_key():
    """刪除已儲存的 Key"""
    try:
        if os.path.exists(KEY_FILE):
            os.remove(KEY_FILE)
    except Exception:
        pass


# ══════════════════════════════════════════════
#  API Key 輸入視窗
# ══════════════════════════════════════════════

class ApiKeyWindow(tk.Toplevel):
    """啟動時詢問 Gemini API Key"""

    def __init__(self, parent):
        super().__init__(parent)
        self.title("🔑 輸入 Gemini API Key")
        self.geometry("520x280")
        self.configure(bg="#f0f4f8")
        self.resizable(False, False)
        self.result_key  = None   # None = 取消
        self.result_save = False

        self._build()
        self.grab_set()
        self.wait_window()

    def _build(self):
        tk.Label(self, text="🔑  Gemini API Key 設定",
                 font=("Arial", 14, "bold"),
                 bg="#f0f4f8", fg="#2c3e50").pack(pady=(20, 4))

        tk.Label(self,
                 text="請輸入你的 Gemini API Key（以 AIzaSy 開頭）",
                 font=("Arial", 10), bg="#f0f4f8", fg="#7f8c8d").pack()

        # Key 輸入框
        entry_frame = tk.Frame(self, bg="#f0f4f8")
        entry_frame.pack(pady=14, padx=30, fill="x")

        self.key_var = tk.StringVar()
        saved = load_saved_key()
        if saved:
            self.key_var.set(saved)

        self.entry = tk.Entry(entry_frame, textvariable=self.key_var,
                              font=("Courier New", 10),
                              show="•", width=44,
                              relief="solid", bd=1)
        self.entry.pack(side="left", fill="x", expand=True, ipady=4)

        # 顯示/隱藏切換
        self.show_var = tk.BooleanVar(value=False)
        tk.Checkbutton(entry_frame, text="顯示",
                       variable=self.show_var,
                       command=self._toggle_show,
                       bg="#f0f4f8",
                       font=("Arial", 9)).pack(side="left", padx=(6, 0))

        # 記住選項
        self.save_var = tk.BooleanVar(value=bool(saved))
        tk.Checkbutton(self, text="記住 Key（儲存在本機，下次不需再輸入）",
                       variable=self.save_var,
                       bg="#f0f4f8",
                       font=("Arial", 9),
                       fg="#555").pack()

        # 不使用 AI 選項
        self.skip_var = tk.BooleanVar(value=False)
        tk.Checkbutton(self,
                       text="不使用 AI 建議（跳過此步驟，直接進入審閱）",
                       variable=self.skip_var,
                       command=self._on_skip,
                       bg="#f0f4f8",
                       font=("Arial", 9),
                       fg="#888").pack(pady=(6, 0))

        # 按鈕
        btn_row = tk.Frame(self, bg="#f0f4f8")
        btn_row.pack(pady=18)

        tk.Button(btn_row, text="確認",
                  command=self._confirm,
                  bg="#8e44ad", fg="white",
                  font=("Arial", 11, "bold"),
                  relief="flat", padx=20, pady=6,
                  cursor="hand2").pack(side="left", padx=8)

        tk.Button(btn_row, text="取消",
                  command=self._cancel,
                  bg="#95a5a6", fg="white",
                  font=("Arial", 10),
                  relief="flat", padx=14, pady=6,
                  cursor="hand2").pack(side="left")

        # 說明連結
        tk.Label(self,
                 text="申請 Key：aistudio.google.com → Get API Key",
                 font=("Arial", 8), bg="#f0f4f8",
                 fg="#aaa").pack(pady=(0, 8))

    def _toggle_show(self):
        self.entry.config(show="" if self.show_var.get() else "•")

    def _on_skip(self):
        state = "disabled" if self.skip_var.get() else "normal"
        self.entry.config(state=state)

    def _confirm(self):
        if self.skip_var.get():
            self.result_key  = ""    # 空字串 = 跳過 AI
            self.result_save = False
            self.destroy()
            return

        key = self.key_var.get().strip()
        if not key.startswith("AIza"):
            messagebox.showwarning("格式錯誤",
                "Key 格式不正確，應以 AIzaSy 開頭。\n"
                "如不使用 AI 建議請勾選「不使用 AI 建議」。",
                parent=self)
            return

        self.result_key  = key
        self.result_save = self.save_var.get()

        if self.result_save:
            save_key(key)
        else:
            delete_saved_key()

        self.destroy()

    def _cancel(self):
        self.result_key = None
        self.destroy()


# ══════════════════════════════════════════════
#  Gemini AI 判斷
# ══════════════════════════════════════════════

def get_ai_suggestion(api_key: str, candidates: list) -> list:
    """
    批次呼叫 Gemini，為每個候選修正產生 AI 建議。
    回傳與 candidates 等長的建議字串列表。
    每分鐘最多 14 次（留 1 次緩衝），超過自動等待。
    """
    try:
        import google.generativeai as genai
    except ImportError:
        return ["⚠️ 請先安裝：pip install google-generativeai"] * len(candidates)

    genai.configure(api_key=api_key)
    model    = genai.GenerativeModel("gemini-1.5-flash")
    results  = []
    interval = 60 / 14   # 每次請求間隔約 4.3 秒

    for i, cand in enumerate(candidates):
        prompt = f"""You are an English grammar and spelling expert.

A speech-to-text transcript (TXT) may have a misrecognized word compared to the original book text (PDF).

TXT sentence : {cand['tgt_frag']}
PDF sentence : {cand['pdf_sent']}
TXT word     : "{cand['raw_word']}"
PDF word     : "{cand['corrected']}"

Question: Should the TXT word "{cand['raw_word']}" be corrected to "{cand['corrected']}"?

Consider:
1. Grammar correctness (tense, part of speech)
2. Whether the PDF word might be a truncated extraction (e.g. "help" vs "helped")
3. Context and meaning

Reply in Traditional Chinese, maximum 25 words.
Format: 建議[保留/修正] + 簡短原因
Example: 建議修正，"publised" 為 "published" 的拼字錯誤
Example: 建議保留，PDF的 "help" 疑為截字，文法上應為 "helped"
"""
        for attempt in range(4):
            try:
                resp = model.generate_content(prompt)
                results.append(resp.text.strip())
                break
            except Exception as e:
                err = str(e)
                if "429" in err or "quota" in err.lower():
                    wait = 60 if attempt < 2 else 120
                    time.sleep(wait)
                else:
                    results.append(f"⚠️ AI 無法判斷：{err[:40]}")
                    break
        else:
            results.append("⚠️ 超過速率限制，請稍後再試")

        # 控制速率
        if i < len(candidates) - 1:
            time.sleep(interval)

    return results


# ══════════════════════════════════════════════
#  工具函式
# ══════════════════════════════════════════════

def normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[''`´]", "'", text)
    text = re.sub(r'[""«»]', '"', text)
    text = re.sub(r"[^\w\s']", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def preserve_case(original: str, replacement: str) -> str:
    if original.isupper():
        return replacement.upper()
    if original and original[0].isupper():
        return replacement.capitalize()
    return replacement.lower()


# ══════════════════════════════════════════════
#  文字提取
# ══════════════════════════════════════════════

def extract_pdf_sentences(path: str) -> list:
    parts = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            t = page.extract_text()
            if t:
                parts.append(t)
    full  = "\n".join(parts)
    sents = PDF_SENT_SPLIT.split(full)
    return [s.strip() for s in sents
            if len(s.strip()) > 8 and re.search(r'[A-Za-z]{3,}', s)]


def load_txt(path: str) -> str:
    for enc in ("utf-8", "utf-8-sig", "big5", "gbk", "latin-1"):
        try:
            with open(path, encoding=enc) as f:
                return f.read()
        except (UnicodeDecodeError, LookupError):
            pass
    return ""


# ══════════════════════════════════════════════
#  時間戳處理
# ══════════════════════════════════════════════

def parse_segments(txt: str) -> list:
    segments = []
    for line in txt.splitlines():
        m    = TIMESTAMP_RE.match(line)
        ts   = m.group(1) if m else ""
        frag = line[m.end():] if m else line
        if frag.strip():
            segments.append((ts, frag))
    return segments


def rebuild_txt(segments: list, corrections: dict) -> str:
    lines = []
    for seg_idx, (ts, frag) in enumerate(segments):
        tokens  = re.split(r'([A-Za-z]+)', frag)
        alpha_n = 0
        for i, tok in enumerate(tokens):
            if tok.isalpha():
                if (seg_idx, alpha_n) in corrections:
                    tokens[i] = corrections[(seg_idx, alpha_n)]
                alpha_n += 1
        lines.append(ts + "".join(tokens))
    return "\n".join(lines)


# ══════════════════════════════════════════════
#  句對句比對
# ══════════════════════════════════════════════

def find_best_pdf_sentence(tgt_norm: str,
                           pdf_norms: list,
                           pdf_raws:  list) -> tuple:
    best_score, best_raw = 0.0, ""
    tgt_words = tgt_norm.split()
    for pn, pr in zip(pdf_norms, pdf_raws):
        pw = pn.split()
        r  = len(tgt_words) / max(len(pw), 1)
        if r < 0.4 or r > 2.5:
            continue
        score = difflib.SequenceMatcher(
            None, tgt_words, pw, autojunk=False).ratio()
        if score > best_score:
            best_score, best_raw = score, pr
    return best_raw, best_score


def _find_alpha_idx(sent: str, word_norm: str, hint: int) -> int:
    words = re.findall(r"[A-Za-z']+", sent)
    for offset in range(len(words)):
        for sign in (1, -1):
            idx = hint + sign * offset
            if 0 <= idx < len(words):
                if normalize(words[idx]).strip("'") == word_norm:
                    return idx
    return hint


def _make_parts(sent: str, target_alpha_idx: int, tag: str) -> list:
    parts   = []
    tokens  = re.split(r'([A-Za-z]+)', sent)
    alpha_n = 0
    for tok in tokens:
        if tok.isalpha():
            parts.append((tok, tag if alpha_n == target_alpha_idx else "normal"))
            alpha_n += 1
        else:
            parts.append((tok, "normal"))
    return parts


def diff_sentences(tgt_frag: str, pdf_sent: str, seg_idx: int) -> list:
    tgt_wn = normalize(tgt_frag).split()
    pdf_wn = normalize(pdf_sent).split()
    tgt_rw = re.findall(r"[A-Za-z']+", tgt_frag)

    sm   = difflib.SequenceMatcher(None, tgt_wn, pdf_wn, autojunk=False)
    cands = []

    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op != "replace":
            continue
        tc = tgt_wn[i1:i2]
        rc = pdf_wn[j1:j2]
        if len(tc) != len(rc):
            continue

        for k, (tw, rw) in enumerate(zip(tc, rc)):
            tw_c = tw.strip("'")
            rw_c = rw.strip("'")

            if tw_c in STOPWORDS or rw_c in STOPWORDS:
                continue
            if len(tw_c) <= 2 or len(rw_c) <= 2:
                continue
            if abs(len(tw_c) - len(rw_c)) > max(2, int(len(tw_c) * 0.45)):
                continue

            sim = difflib.SequenceMatcher(None, tw_c, rw_c).ratio()
            if sim < WORD_SIM_THRESHOLD or tw_c == rw_c:
                continue

            alpha_idx = i1 + k
            if alpha_idx >= len(tgt_rw):
                continue
            raw_word  = tgt_rw[alpha_idx]
            corrected = preserve_case(raw_word, rw_c)
            if corrected == raw_word:
                continue

            pdf_alpha = _find_alpha_idx(pdf_sent, rw_c, j1 + k)

            cands.append({
                "seg_idx":   seg_idx,
                "alpha_idx": alpha_idx,
                "raw_word":  raw_word,
                "corrected": corrected,
                "sim":       sim,
                "tgt_frag":  tgt_frag,
                "pdf_sent":  pdf_sent,
                "tgt_parts": _make_parts(tgt_frag, alpha_idx,  "del"),
                "pdf_parts": _make_parts(pdf_sent,  pdf_alpha, "ins"),
                "ai_suggest": "",   # 稍後填入
            })

    return cands


def analyze_file(tgt_path: str, pdf_raws: list, pdf_norms: list) -> tuple:
    raw_txt  = load_txt(tgt_path)
    segments = parse_segments(raw_txt)
    all_cands = []

    for seg_idx, (ts, frag) in enumerate(segments):
        frag_norm = normalize(frag)
        if len(frag_norm.split()) < 2:
            continue
        best_pdf, score = find_best_pdf_sentence(frag_norm, pdf_norms, pdf_raws)
        if score < SENT_MATCH_THRESHOLD or not best_pdf:
            continue
        all_cands.extend(diff_sentences(frag, best_pdf, seg_idx))

    return segments, all_cands


# ══════════════════════════════════════════════
#  進度視窗（批次 AI 分析用）
# ══════════════════════════════════════════════

class ProgressWindow(tk.Toplevel):
    def __init__(self, parent, total: int):
        super().__init__(parent)
        self.title("🤖 AI 分析中...")
        self.geometry("420x160")
        self.configure(bg="#f0f4f8")
        self.resizable(False, False)

        tk.Label(self, text="🤖  正在呼叫 Gemini AI 分析...",
                 font=("Arial", 12, "bold"),
                 bg="#f0f4f8", fg="#2c3e50").pack(pady=(20, 8))

        self.progress = ttk.Progressbar(self, length=360,
                                        maximum=total, mode="determinate")
        self.progress.pack(padx=30)

        self.label = tk.StringVar(value=f"0 / {total}")
        tk.Label(self, textvariable=self.label,
                 font=("Arial", 10), bg="#f0f4f8",
                 fg="#7f8c8d").pack(pady=6)

        self.total = total

    def update_progress(self, done: int):
        self.progress["value"] = done
        self.label.set(f"{done} / {self.total}")
        self.update()


# ══════════════════════════════════════════════
#  審閱視窗
# ══════════════════════════════════════════════

class ReviewWindow(tk.Toplevel):
    def __init__(self, parent, all_candidates: dict, use_ai: bool):
        super().__init__(parent)
        self.title("📋 審閱修正項目")
        self.geometry("1020x700")
        self.configure(bg="#f0f4f8")
        self.result     = None
        self.use_ai     = use_ai
        self.check_vars = {}
        self.row_frames = {}

        self._build(all_candidates)
        self.grab_set()
        self.wait_window()

    def _build(self, all_candidates):
        # 頂部
        hdr = tk.Frame(self, bg="#2c3e50", pady=8)
        hdr.pack(fill="x")

        total = sum(len(v) for v in all_candidates.values())
        tk.Label(hdr, text="📋  審閱修正項目",
                 font=("Arial", 14, "bold"),
                 bg="#2c3e50", fg="white").pack(side="left", padx=14)
        tk.Label(hdr, text=f"共 {total} 項候選修正",
                 font=("Arial", 10),
                 bg="#2c3e50", fg="#bdc3c7").pack(side="left")

        btn_hdr = tk.Frame(hdr, bg="#2c3e50")
        btn_hdr.pack(side="right", padx=14)
        tk.Button(btn_hdr, text="全選",   command=self._select_all,
                  bg="#27ae60", fg="white", font=("Arial", 9),
                  relief="flat", padx=8, pady=2,
                  cursor="hand2").pack(side="left", padx=3)
        tk.Button(btn_hdr, text="全不選", command=self._deselect_all,
                  bg="#e74c3c", fg="white", font=("Arial", 9),
                  relief="flat", padx=8, pady=2,
                  cursor="hand2").pack(side="left")

        # 圖例
        legend = tk.Frame(self, bg="#eaf0fb", pady=4)
        legend.pack(fill="x", padx=8)
        for text, color in [
            ("  TXT 原句（紅色底線=疑似誤拼）", "#c0392b"),
            ("    PDF 對應句（綠色粗體=正確詞）", "#27ae60"),
            ("    AI 建議", "#2471a3"),
        ]:
            tk.Label(legend, text=text,
                     font=("Courier New", 9),
                     bg="#eaf0fb", fg=color).pack(side="left")

        # 捲動區域
        wrap = tk.Frame(self, bg="#f0f4f8")
        wrap.pack(fill="both", expand=True, padx=8, pady=4)

        canvas = tk.Canvas(wrap, bg="#f0f4f8", highlightthickness=0)
        vsb = ttk.Scrollbar(wrap, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=vsb.set)
        vsb.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)

        self._inner = tk.Frame(canvas, bg="#f0f4f8")
        win_id = canvas.create_window((0, 0), window=self._inner, anchor="nw")
        self._inner.bind("<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>",
            lambda e: canvas.itemconfig(win_id, width=e.width))
        canvas.bind_all("<MouseWheel>",
            lambda e: canvas.yview_scroll(int(-1*(e.delta/120)), "units"))

        # 資料列
        row_num = 0
        for filepath, candidates in all_candidates.items():
            fname = os.path.basename(filepath)

            fhdr = tk.Frame(self._inner, bg="#d5e8f5", pady=4)
            fhdr.pack(fill="x", pady=(10, 2))
            tk.Label(fhdr,
                     text=f"  📄  {fname}   （{len(candidates)} 項）",
                     font=("Arial", 10, "bold"),
                     bg="#d5e8f5", fg="#1a5276",
                     anchor="w").pack(side="left", padx=8)

            for idx, cand in enumerate(candidates):
                key = (filepath, idx)
                var = tk.BooleanVar(value=True)
                self.check_vars[key] = var

                bg  = "#ffffff" if row_num % 2 == 0 else "#f7f9fc"
                row = tk.Frame(self._inner, bg=bg, pady=4,
                               highlightthickness=1,
                               highlightbackground="#dde3ea")
                row.pack(fill="x", padx=4, pady=2)
                self.row_frames[key] = (row, bg)

                # 勾選框
                left = tk.Frame(row, bg=bg, width=32)
                left.pack(side="left", fill="y")
                left.pack_propagate(False)
                tk.Checkbutton(left, variable=var, bg=bg,
                               activebackground=bg, cursor="hand2",
                               command=lambda k=key: self._on_toggle(k)
                               ).pack(expand=True)

                # 三行文字區
                right = tk.Frame(row, bg=bg)
                right.pack(side="left", fill="x", expand=True, padx=(0, 10))

                # 第一行：TXT
                self._make_text_row(right, bg, "TXT", "#fdecea", "#c0392b",
                                    cand["tgt_parts"])
                # 第二行：PDF
                self._make_text_row(right, bg, "PDF", "#e9f7ef", "#27ae60",
                                    cand["pdf_parts"])
                # 第三行：AI 建議
                ai_text = cand.get("ai_suggest", "")
                if not ai_text:
                    ai_text = "（未取得 AI 建議）" if self.use_ai else "（未啟用 AI 建議）"
                self._make_ai_row(right, bg, ai_text)

                row_num += 1

        # 底部
        bot = tk.Frame(self, bg="#ecf0f1", pady=10)
        bot.pack(fill="x")

        tk.Button(bot, text="✅  確認套用勾選項目",
                  command=self._confirm,
                  bg="#8e44ad", fg="white",
                  font=("Arial", 12, "bold"),
                  relief="flat", padx=22, pady=8,
                  cursor="hand2").pack(side="left", padx=16)

        tk.Button(bot, text="✕  取消",
                  command=self._cancel,
                  bg="#95a5a6", fg="white",
                  font=("Arial", 11),
                  relief="flat", padx=14, pady=8,
                  cursor="hand2").pack(side="left")

        self._count_var = tk.StringVar()
        self._update_count()
        tk.Label(bot, textvariable=self._count_var,
                 bg="#ecf0f1", fg="#7f8c8d",
                 font=("Arial", 10)).pack(side="right", padx=16)

    def _make_text_row(self, parent, bg, label, label_bg, label_fg, parts):
        row = tk.Frame(parent, bg=bg)
        row.pack(fill="x", pady=1)
        tk.Label(row, text=label,
                 font=("Arial", 7, "bold"),
                 bg=label_bg, fg=label_fg,
                 padx=4, pady=1).pack(side="left", padx=(0, 4))
        t = tk.Text(row, height=1, wrap="none",
                    font=("Courier New", 10),
                    bg=bg, relief="flat", bd=0, cursor="arrow")
        t.pack(side="left", fill="x", expand=True)
        t.tag_config("normal", foreground="#333333")
        t.tag_config("del",  foreground="#c0392b",
                     font=("Courier New", 10, "bold underline"))
        t.tag_config("ins",  foreground="#27ae60",
                     font=("Courier New", 10, "bold"))
        for text, tag in parts:
            t.insert("end", text, tag)
        t.config(state="disabled")

    def _make_ai_row(self, parent, bg, ai_text: str):
        row = tk.Frame(parent, bg=bg)
        row.pack(fill="x", pady=1)
        tk.Label(row, text=" AI",
                 font=("Arial", 7, "bold"),
                 bg="#d6eaf8", fg="#2471a3",
                 padx=4, pady=1).pack(side="left", padx=(0, 4))
        tk.Label(row, text=ai_text,
                 font=("Arial", 9, "italic"),
                 bg=bg, fg="#2471a3",
                 anchor="w").pack(side="left", fill="x", expand=True)

    def _on_toggle(self, key):
        row, orig_bg = self.row_frames[key]
        if self.check_vars[key].get():
            row.configure(bg=orig_bg, highlightbackground="#dde3ea")
        else:
            row.configure(bg="#fff8e1", highlightbackground="#f39c12")
        self._update_count()

    def _update_count(self):
        checked = sum(1 for v in self.check_vars.values() if v.get())
        total   = len(self.check_vars)
        self._count_var.set(f"已勾選 {checked} / {total} 項")

    def _select_all(self):
        for key, var in self.check_vars.items():
            var.set(True)
            row, bg = self.row_frames[key]
            row.configure(bg=bg, highlightbackground="#dde3ea")
        self._update_count()

    def _deselect_all(self):
        for key, var in self.check_vars.items():
            var.set(False)
            row, _ = self.row_frames[key]
            row.configure(bg="#fff8e1", highlightbackground="#f39c12")
        self._update_count()

    def _confirm(self):
        self.result = {}
        for (fp, idx), var in self.check_vars.items():
            if var.get():
                self.result.setdefault(fp, set()).add(idx)
        self.destroy()

    def _cancel(self):
        self.result = None
        self.destroy()


# ══════════════════════════════════════════════
#  完成摘要視窗
# ══════════════════════════════════════════════

class SummaryWindow(tk.Toplevel):
    def __init__(self, parent, log_lines: list):
        super().__init__(parent)
        self.title("✅ 修改完成")
        self.geometry("700x500")
        self.configure(bg="#f0f4f8")

        tk.Label(self, text="✅  修改完成",
                 font=("Arial", 14, "bold"),
                 bg="#f0f4f8", fg="#27ae60").pack(pady=(14, 4))

        txt = scrolledtext.ScrolledText(self,
                                        font=("Courier New", 9),
                                        wrap=tk.WORD)
        txt.pack(fill="both", expand=True, padx=12, pady=6)
        txt.insert("end", "\n".join(log_lines))
        txt.config(state="disabled")

        tk.Button(self, text="關閉", command=self.destroy,
                  bg="#2980b9", fg="white", font=("Arial", 11),
                  relief="flat", padx=20, pady=6,
                  cursor="hand2").pack(pady=(0, 12))


# ══════════════════════════════════════════════
#  主視窗
# ══════════════════════════════════════════════

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("文本修正工具 V5")
        self.geometry("660x500")
        self.configure(bg="#f0f4f8")
        self.ref_path   = tk.StringVar(value="（尚未選擇）")
        self.tgt_paths  = []
        self.api_key    = ""
        self._build_ui()

    def _build_ui(self):
        tk.Label(self, text="📄  文本修正工具 V5",
                 font=("Arial", 18, "bold"),
                 bg="#f0f4f8", fg="#2c3e50").pack(pady=(18, 2))
        tk.Label(self,
                 text="句對句比對 · TXT/PDF/AI 三行對照審閱 · 直接覆蓋原檔",
                 font=("Arial", 10),
                 bg="#f0f4f8", fg="#7f8c8d").pack(pady=(0, 14))

        # 參考 PDF
        rf = tk.LabelFrame(self, text=" 參考文本 (PDF) ",
                           font=("Arial", 11, "bold"),
                           bg="#f0f4f8", fg="#2980b9",
                           padx=10, pady=8)
        rf.pack(fill="x", padx=24, pady=4)
        tk.Label(rf, textvariable=self.ref_path,
                 bg="#f0f4f8", fg="#555", font=("Arial", 9),
                 wraplength=460, anchor="w").pack(side="left", expand=True)
        tk.Button(rf, text="選擇檔案", command=self._choose_ref,
                  bg="#2980b9", fg="white", font=("Arial", 10),
                  relief="flat", padx=10, pady=4,
                  cursor="hand2").pack(side="right")

        # 目標 TXT
        tf = tk.LabelFrame(self, text=" 目標文本 (TXT，可複選) ",
                           font=("Arial", 11, "bold"),
                           bg="#f0f4f8", fg="#27ae60",
                           padx=10, pady=8)
        tf.pack(fill="both", expand=True, padx=24, pady=4)

        br = tk.Frame(tf, bg="#f0f4f8")
        br.pack(fill="x")
        tk.Button(br, text="新增檔案", command=self._add_targets,
                  bg="#27ae60", fg="white", font=("Arial", 10),
                  relief="flat", padx=10, pady=4,
                  cursor="hand2").pack(side="left")
        tk.Button(br, text="清除全部", command=self._clear_targets,
                  bg="#e74c3c", fg="white", font=("Arial", 10),
                  relief="flat", padx=10, pady=4,
                  cursor="hand2").pack(side="left", padx=8)

        lf = tk.Frame(tf, bg="#f0f4f8")
        lf.pack(fill="both", expand=True, pady=(6, 0))
        self.listbox = tk.Listbox(lf, font=("Arial", 9),
                                  selectmode="extended", height=7,
                                  bg="white", fg="#2c3e50",
                                  selectbackground="#2980b9",
                                  relief="solid", borderwidth=1)
        sb = ttk.Scrollbar(lf, orient="vertical",
                           command=self.listbox.yview)
        self.listbox.configure(yscrollcommand=sb.set)
        self.listbox.pack(side="left", fill="both", expand=True)
        sb.pack(side="right", fill="y")

        self.run_btn = tk.Button(self, text="▶  分析並開始審閱",
                                 command=self._run,
                                 bg="#8e44ad", fg="white",
                                 font=("Arial", 13, "bold"),
                                 relief="flat", padx=20, pady=10,
                                 cursor="hand2")
        self.run_btn.pack(pady=12)

        self.status = tk.StringVar(value="就緒")
        tk.Label(self, textvariable=self.status,
                 bg="#f0f4f8", fg="#95a5a6",
                 font=("Arial", 9)).pack(pady=(0, 10))

    def _choose_ref(self):
        p = filedialog.askopenfilename(
            title="選擇參考 PDF",
            filetypes=[("PDF", "*.pdf"), ("所有檔案", "*.*")])
        if p:
            self.ref_path.set(p)
            self.status.set(f"參考：{os.path.basename(p)}")

    def _add_targets(self):
        paths = filedialog.askopenfilenames(
            title="選擇目標 TXT（可多選）",
            filetypes=[("文字檔", "*.txt"), ("所有檔案", "*.*")])
        for p in paths:
            if p not in self.tgt_paths:
                self.tgt_paths.append(p)
                self.listbox.insert("end", os.path.basename(p))
        self.status.set(f"已選 {len(self.tgt_paths)} 個目標檔案")

    def _clear_targets(self):
        self.tgt_paths.clear()
        self.listbox.delete(0, "end")
        self.status.set("已清除")

    def _run(self):
        ref = self.ref_path.get()
        if not os.path.exists(ref):
            messagebox.showwarning("提示", "請先選擇參考 PDF！")
            return
        if not self.tgt_paths:
            messagebox.showwarning("提示", "請選擇至少一個目標 TXT！")
            return

        # ── 詢問 API Key ──
        key_win = ApiKeyWindow(self)
        if key_win.result_key is None:
            return   # 使用者按取消
        self.api_key = key_win.result_key
        use_ai = bool(self.api_key)

        self.run_btn.config(state="disabled")
        self.status.set("提取 PDF 句子中…")
        self.update()

        try:
            pdf_raws = extract_pdf_sentences(ref)
        except Exception as e:
            messagebox.showerror("PDF 讀取失敗", str(e))
            self.run_btn.config(state="normal")
            return

        if not pdf_raws:
            messagebox.showerror("錯誤", "PDF 提取結果為空！")
            self.run_btn.config(state="normal")
            return

        pdf_norms = [normalize(s) for s in pdf_raws]

        all_candidates = {}
        all_segments   = {}

        for i, tgt_path in enumerate(self.tgt_paths):
            self.status.set(
                f"比對 ({i+1}/{len(self.tgt_paths)})：{os.path.basename(tgt_path)}")
            self.update()
            segments, candidates = analyze_file(tgt_path, pdf_raws, pdf_norms)
            all_candidates[tgt_path] = candidates
            all_segments[tgt_path]   = segments

        total = sum(len(v) for v in all_candidates.values())

        if total == 0:
            messagebox.showinfo("結果", "未發現需要修正的詞，所有文本已正確！")
            self.run_btn.config(state="normal")
            return

        # ── 批次 AI 分析 ──
        if use_ai:
            all_cands_flat = [c for cands in all_candidates.values()
                              for c in cands]
            prog = ProgressWindow(self, len(all_cands_flat))
            self.status.set(f"AI 分析中（共 {len(all_cands_flat)} 項）…")
            self.update()

            suggestions = []
            for i, cand in enumerate(all_cands_flat):
                prog.update_progress(i)
                # 單項呼叫
                s = get_ai_suggestion(self.api_key, [cand])
                suggestions.extend(s)

            prog.update_progress(len(all_cands_flat))
            prog.destroy()

            # 寫回各候選
            idx = 0
            for cands in all_candidates.values():
                for cand in cands:
                    cand["ai_suggest"] = suggestions[idx] if idx < len(suggestions) else ""
                    idx += 1

        self.status.set(f"分析完成，{total} 項候選修正，開啟審閱視窗…")
        self.update()

        # ── 審閱視窗 ──
        review = ReviewWindow(self, all_candidates, use_ai)

        if review.result is None:
            self.status.set("已取消，沒有任何修改。")
            self.run_btn.config(state="normal")
            return

        # ── 套用並存檔 ──
        log = [
            "【文本校對修正紀錄 V5】",
            f"參考：{os.path.basename(ref)}",
            f"時間：{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            "=" * 60, ""
        ]
        total_applied = 0

        for tgt_path, candidates in all_candidates.items():
            selected = review.result.get(tgt_path, set())
            if not selected:
                continue

            segments    = all_segments[tgt_path]
            corrections = {}
            applied     = []

            for idx in sorted(selected):
                c = candidates[idx]
                corrections[(c["seg_idx"], c["alpha_idx"])] = c["corrected"]
                applied.append(c)

            new_txt = rebuild_txt(segments, corrections)
            with open(tgt_path, "w", encoding="utf-8") as f:
                f.write(new_txt)

            fname = os.path.basename(tgt_path)
            log.append(f"📄 {fname}  （套用 {len(applied)} 項）")
            for c in applied:
                log.append(f"   [{c['raw_word']}] → [{c['corrected']}]")
                log.append(f"   TXT: {c['tgt_frag']}")
                log.append(f"   PDF: {c['pdf_sent']}")
                if c.get("ai_suggest"):
                    log.append(f"   AI : {c['ai_suggest']}")
                log.append("")
            total_applied += len(applied)

        log += ["=" * 60, f"總計套用 {total_applied} 項修正。"]

        log_dir  = os.path.dirname(self.tgt_paths[0])
        log_name = f"修改紀錄_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        with open(os.path.join(log_dir, log_name), "w", encoding="utf-8") as f:
            f.write("\n".join(log))

        self.status.set(f"完成！套用 {total_applied} 項，紀錄已儲存至同資料夾。")
        self.run_btn.config(state="normal")
        SummaryWindow(self, log)


# ══════════════════════════════════════════════
if __name__ == "__main__":
    App().mainloop()
