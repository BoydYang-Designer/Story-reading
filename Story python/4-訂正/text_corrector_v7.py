# Text Corrector V7

"""
Text Corrector V7
─────────────────
新增功能（V7）：
  - 參考文本支援 PDF 或 TXT 兩種格式（自動偵測副檔名）
  - 審閱視窗第二行標籤依參考格式顯示「PDF」或「REF」

原有功能：
  - 啟動時手動輸入 Gemini API Key（可選擇記住）
  - 審閱視窗每列三行：
      第一行（紅）：TXT 原句，錯誤詞標紅底線
      第二行（綠）：參考對應句，正確詞標綠粗體
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
    "a","an","the","and","or","but","at","for","of","by",
    "with","as","is","it","be","he","she","we","i","me","my","you",
    "so","if","do","no","not","its","was","are","has","had","have",
    "his","her","our","their","your","this","that","who","what","which",
    "will","can","may","just","all","one","two","now","then","they",
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
    try:
        if os.path.exists(KEY_FILE):
            with open(KEY_FILE, "r", encoding="utf-8") as f:
                return f.read().strip()
    except Exception:
        pass
    return ""


def save_key(key: str):
    try:
        with open(KEY_FILE, "w", encoding="utf-8") as f:
            f.write(key.strip())
    except Exception:
        pass


def delete_saved_key():
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
        self.result_key  = None
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

        self.show_var = tk.BooleanVar(value=False)
        tk.Checkbutton(entry_frame, text="顯示",
                       variable=self.show_var,
                       command=self._toggle_show,
                       bg="#f0f4f8",
                       font=("Arial", 9)).pack(side="left", padx=(6, 0))

        self.save_var = tk.BooleanVar(value=bool(saved))
        tk.Checkbutton(self, text="記住 Key（儲存在本機，下次不需再輸入）",
                       variable=self.save_var,
                       bg="#f0f4f8",
                       font=("Arial", 9),
                       fg="#555").pack()

        self.skip_var = tk.BooleanVar(value=False)
        tk.Checkbutton(self,
                       text="不使用 AI 建議（跳過此步驟，直接進入審閱）",
                       variable=self.skip_var,
                       command=self._on_skip,
                       bg="#f0f4f8",
                       font=("Arial", 9),
                       fg="#888").pack(pady=(6, 0))

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
            self.result_key  = ""
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
#  文字提取（PDF 與 TXT 參考）
# ══════════════════════════════════════════════

def extract_pdf_sentences(path: str) -> list:
    """從 PDF 提取句子列表"""
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


def extract_txt_sentences(path: str) -> list:
    """從參考 TXT 提取句子列表（忽略時間戳，按句號/換行分割）"""
    raw = load_txt(path)
    lines = []
    for line in raw.splitlines():
        # 去除時間戳前綴
        m = TIMESTAMP_RE.match(line)
        text = line[m.end():] if m else line
        text = text.strip()
        if text:
            lines.append(text)
    full  = " ".join(lines)
    sents = PDF_SENT_SPLIT.split(full)
    return [s.strip() for s in sents
            if len(s.strip()) > 8 and re.search(r'[A-Za-z]{3,}', s)]


def extract_ref_sentences(path: str) -> list:
    """依副檔名自動選擇提取方式"""
    ext = os.path.splitext(path)[1].lower()
    if ext == ".pdf":
        return extract_pdf_sentences(path)
    else:
        return extract_txt_sentences(path)


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
    tokens  = re.split(r"([A-Za-z][A-Za-z']*[A-Za-z]|[A-Za-z])", sent)
    alpha_n = 0
    for tok in tokens:
        if re.fullmatch(r"[A-Za-z][A-Za-z']*[A-Za-z]|[A-Za-z]", tok):
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

            SHORT_PREP = {"in","into","on","onto","to","up","out","off",
                          "over","under","from","upon","within","without"}
            is_prep_pair = (tw_c in SHORT_PREP or rw_c in SHORT_PREP) and (
                tw_c.startswith(rw_c) or rw_c.startswith(tw_c))

            if not is_prep_pair:
                if len(tw_c) <= 2 or len(rw_c) <= 2:
                    continue
                if abs(len(tw_c) - len(rw_c)) > max(2, int(len(tw_c) * 0.45)):
                    continue

            sim = difflib.SequenceMatcher(None, tw_c, rw_c).ratio()
            if sim < WORD_SIM_THRESHOLD or tw_c == rw_c:
                continue

            hint_idx = i1 + k
            if hint_idx >= len(tgt_rw):
                continue
            alpha_idx = _find_alpha_idx(tgt_frag, tw_c, hint_idx)
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
                "ai_suggest": "",
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
#  進度視窗
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
    def __init__(self, parent, all_candidates: dict, use_ai: bool, ref_label: str = "REF"):
        super().__init__(parent)
        self.title("📋 審閱修正項目")
        self.geometry("1020x700")
        self.configure(bg="#f0f4f8")
        self.result      = None
        self.use_ai      = use_ai
        self.ref_label   = ref_label   # "PDF" 或 "REF"
        self.check_vars  = {}
        self.row_frames  = {}
        self.edit_vars   = {}

        self._build(all_candidates)
        self.grab_set()
        self.wait_window()

    def _build(self, all_candidates):
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

        # 圖例（依參考類型顯示）
        ref_desc = f"    {self.ref_label} 對應句（綠色粗體=正確詞）"
        legend = tk.Frame(self, bg="#eaf0fb", pady=4)
        legend.pack(fill="x", padx=8)
        for text, color in [
            ("  TXT 原句（紅色底線=疑似誤拼）", "#c0392b"),
            (ref_desc, "#27ae60"),
            ("    AI 建議", "#2471a3"),
        ]:
            tk.Label(legend, text=text,
                     font=("Courier New", 9),
                     bg="#eaf0fb", fg=color).pack(side="left")

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

                left = tk.Frame(row, bg=bg, width=32)
                left.pack(side="left", fill="y")
                left.pack_propagate(False)
                tk.Checkbutton(left, variable=var, bg=bg,
                               activebackground=bg, cursor="hand2",
                               command=lambda k=key: self._on_toggle(k)
                               ).pack(expand=True)

                right = tk.Frame(row, bg=bg)
                right.pack(side="left", fill="x", expand=True, padx=(0, 10))

                # 第一行：TXT
                self._make_text_row(right, bg, "TXT", "#fdecea", "#c0392b",
                                    cand["tgt_parts"])
                # 第二行：REF/PDF
                self._make_text_row(right, bg, self.ref_label, "#e9f7ef", "#27ae60",
                                    cand["pdf_parts"])
                # 第三行：AI 建議
                ai_text = cand.get("ai_suggest", "")
                if not ai_text:
                    ai_text = "（未取得 AI 建議）" if self.use_ai else "（未啟用 AI 建議）"
                self._make_ai_row(right, bg, ai_text)

                # 第四行：手動編輯
                edit_var = tk.StringVar(value=cand["corrected"])
                self.edit_vars[key] = edit_var
                self._make_edit_row(right, bg, cand["raw_word"], edit_var)

                row_num += 1

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

    def _make_edit_row(self, parent, bg, raw_word: str, edit_var: tk.StringVar):
        row = tk.Frame(parent, bg=bg)
        row.pack(fill="x", pady=(2, 3))
        tk.Label(row, text="✏️",
                 font=("Arial", 7, "bold"),
                 bg="#fef9e7", fg="#d35400",
                 padx=4, pady=1).pack(side="left", padx=(0, 4))
        tk.Label(row, text=f"原詞：{raw_word}   修改為：",
                 font=("Arial", 9),
                 bg=bg, fg="#7f8c8d").pack(side="left")
        entry = tk.Entry(row, textvariable=edit_var,
                         font=("Courier New", 10, "bold"),
                         fg="#d35400", bg="#fffde7",
                         relief="solid", bd=1, width=22)
        entry.pack(side="left", ipady=2)
        original_corrected = edit_var.get()
        tk.Button(row, text="↺",
                  font=("Arial", 8),
                  bg="#ecf0f1", fg="#555",
                  relief="flat", padx=4, pady=1,
                  cursor="hand2",
                  command=lambda v=edit_var, orig=original_corrected: v.set(orig)
                  ).pack(side="left", padx=(4, 0))
        tk.Label(row, text="（可自行修改）",
                 font=("Arial", 8),
                 bg=bg, fg="#aaa").pack(side="left", padx=4)

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
        self.edited_words = {key: ev.get().strip()
                             for key, ev in self.edit_vars.items()
                             if ev.get().strip()}
        self.destroy()

    def _cancel(self):
        self.result      = None
        self.edited_words = {}
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
        self.title("文本修正工具 V7")
        self.geometry("680x540")
        self.configure(bg="#f0f4f8")
        self.ref_path   = tk.StringVar(value="（尚未選擇）")
        self.tgt_paths  = []
        self.api_key    = ""
        self._build_ui()

    def _build_ui(self):
        tk.Label(self, text="📄  文本修正工具 V7",
                 font=("Arial", 18, "bold"),
                 bg="#f0f4f8", fg="#2c3e50").pack(pady=(18, 2))
        tk.Label(self,
                 text="句對句比對 · 支援 PDF 或 TXT 參考文本 · AI 三行對照審閱",
                 font=("Arial", 10),
                 bg="#f0f4f8", fg="#7f8c8d").pack(pady=(0, 14))

        # 參考文本（PDF 或 TXT）
        rf = tk.LabelFrame(self, text=" 參考文本 (PDF 或 TXT) ",
                           font=("Arial", 11, "bold"),
                           bg="#f0f4f8", fg="#2980b9",
                           padx=10, pady=8)
        rf.pack(fill="x", padx=24, pady=4)

        tk.Label(rf, textvariable=self.ref_path,
                 bg="#f0f4f8", fg="#555", font=("Arial", 9),
                 wraplength=460, anchor="w").pack(side="left", expand=True)

        btn_row_ref = tk.Frame(rf, bg="#f0f4f8")
        btn_row_ref.pack(side="right")
        tk.Button(btn_row_ref, text="選擇 PDF",
                  command=lambda: self._choose_ref("pdf"),
                  bg="#2980b9", fg="white", font=("Arial", 10),
                  relief="flat", padx=10, pady=4,
                  cursor="hand2").pack(side="left", padx=(0, 4))
        tk.Button(btn_row_ref, text="選擇 TXT",
                  command=lambda: self._choose_ref("txt"),
                  bg="#16a085", fg="white", font=("Arial", 10),
                  relief="flat", padx=10, pady=4,
                  cursor="hand2").pack(side="left")

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

    def _choose_ref(self, mode: str):
        if mode == "pdf":
            filetypes = [("PDF 文件", "*.pdf"), ("所有檔案", "*.*")]
            title = "選擇參考 PDF"
        else:
            filetypes = [("文字檔", "*.txt"), ("所有檔案", "*.*")]
            title = "選擇參考 TXT"

        p = filedialog.askopenfilename(title=title, filetypes=filetypes)
        if p:
            self.ref_path.set(p)
            ext = os.path.splitext(p)[1].upper()
            self.status.set(f"參考（{ext}）：{os.path.basename(p)}")

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
            messagebox.showwarning("提示", "請先選擇參考文本（PDF 或 TXT）！")
            return
        if not self.tgt_paths:
            messagebox.showwarning("提示", "請選擇至少一個目標 TXT！")
            return

        # 判斷參考類型
        ref_ext   = os.path.splitext(ref)[1].lower()
        is_pdf    = (ref_ext == ".pdf")
        ref_label = "PDF" if is_pdf else "REF"

        # 詢問 API Key
        key_win = ApiKeyWindow(self)
        if key_win.result_key is None:
            return
        self.api_key = key_win.result_key
        use_ai = bool(self.api_key)

        self.run_btn.config(state="disabled")
        self.status.set(f"提取參考句子中（{ref_label}）…")
        self.update()

        try:
            pdf_raws = extract_ref_sentences(ref)
        except Exception as e:
            messagebox.showerror("參考文本讀取失敗", str(e))
            self.run_btn.config(state="normal")
            return

        if not pdf_raws:
            messagebox.showerror("錯誤", "參考文本提取結果為空！")
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

        # 批次 AI 分析
        if use_ai:
            all_cands_flat = [c for cands in all_candidates.values()
                              for c in cands]
            total_ai = len(all_cands_flat)
            prog = ProgressWindow(self, total_ai)
            self.status.set(f"AI 分析中（共 {total_ai} 項）…")
            self.update()

            suggestions = []
            done_flag   = [False]
            error_flag  = [None]

            def ai_worker():
                try:
                    from google import genai as google_genai
                    client   = google_genai.Client(api_key=self.api_key)
                    interval = 60 / 14
                    for i, cand in enumerate(all_cands_flat):
                        ref_type_hint = "original book text (PDF)" if is_pdf else "reference transcript (TXT)"
                        prompt = (
                            "You are an English grammar and spelling expert.\n"
                            "A speech-to-text transcript may have a misrecognized word.\n"
                            f"TXT sentence: {cand['tgt_frag']}\n"
                            f"REF sentence ({ref_type_hint}): {cand['pdf_sent']}\n"
                            f"TXT word: {cand['raw_word']}\n"
                            f"REF word: {cand['corrected']}\n"
                            "Should the TXT word be corrected to the REF word?\n"
                            "Consider: grammar, tense, possible truncation.\n"
                            "Reply in Traditional Chinese, max 20 words.\n"
                            "Format: 建議[保留/修正] + 簡短原因"
                        )
                        for attempt in range(4):
                            try:
                                resp = client.models.generate_content(
                                    model="gemini-2.5-flash-lite",
                                    contents=prompt
                                )
                                suggestions.append(resp.text.strip())
                                break
                            except Exception as e:
                                err = str(e)
                                if "429" in err or "quota" in err.lower() or "RESOURCE_EXHAUSTED" in err:
                                    time.sleep(60 if attempt < 2 else 120)
                                else:
                                    suggestions.append("AI 無法判斷：" + err[:50])
                                    break
                        else:
                            suggestions.append("超過速率限制，請稍後再試")
                        progress_queue.put(i + 1)
                        if i < total_ai - 1:
                            time.sleep(interval)
                except Exception as e:
                    error_flag[0] = str(e)
                finally:
                    done_flag[0] = True

            import queue
            progress_queue = queue.Queue()
            t = threading.Thread(target=ai_worker, daemon=True)
            t.start()

            while not done_flag[0] or not progress_queue.empty():
                try:
                    val = progress_queue.get_nowait()
                    prog.update_progress(val)
                except:
                    pass
                self.update()
                time.sleep(0.05)

            prog.destroy()

            if error_flag[0]:
                messagebox.showwarning("AI 分析錯誤", "AI 分析時發生錯誤：\n" + str(error_flag[0]))

            idx = 0
            for cands in all_candidates.values():
                for cand in cands:
                    cand["ai_suggest"] = suggestions[idx] if idx < len(suggestions) else ""
                    idx += 1

        self.status.set(f"分析完成，{total} 項候選修正，開啟審閱視窗…")
        self.update()

        review = ReviewWindow(self, all_candidates, use_ai, ref_label=ref_label)

        if review.result is None:
            self.status.set("已取消，沒有任何修改。")
            self.run_btn.config(state="normal")
            return

        # 套用並存檔
        log = [
            "【文本校對修正紀錄 V7】",
            f"參考：{os.path.basename(ref)}  （{'PDF' if is_pdf else 'TXT'}）",
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
                key = (tgt_path, idx)
                final_word = review.edited_words.get(key, "").strip()
                if not final_word:
                    final_word = c["corrected"]
                corrections[(c["seg_idx"], c["alpha_idx"])] = final_word
                c["_applied_word"] = final_word
                applied.append(c)

            new_txt = rebuild_txt(segments, corrections)
            with open(tgt_path, "w", encoding="utf-8") as f:
                f.write(new_txt)

            fname = os.path.basename(tgt_path)
            log.append(f"📄 {fname}  （套用 {len(applied)} 項）")
            for c in applied:
                applied_word = c.get("_applied_word", c["corrected"])
                marker = " ✏️手動" if applied_word != c["corrected"] else ""
                log.append(f"   [{c['raw_word']}] → [{applied_word}]{marker}")
                log.append(f"   TXT: {c['tgt_frag']}")
                log.append(f"   REF: {c['pdf_sent']}")
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
