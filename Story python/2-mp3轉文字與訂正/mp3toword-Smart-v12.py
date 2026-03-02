import os
import re
import torch
import difflib
import tkinter as tk
from tkinter import Tk, messagebox, simpledialog, scrolledtext, ttk
from tkinter.filedialog import askopenfilenames, askdirectory

def parse_timestamp_line(line):
    """解析時間戳記行，回傳 (timestamp_part, text_part)"""
    m = re.match(r'^(\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\])\s*(.*)', line)
    if m:
        return m.group(1), m.group(2)
    return None, line


def show_diff_dialog(filename, old_text, new_text):
    """
    顯示新舊文本的差異比對視窗，讓使用者選擇保留哪個版本。
    時間戳記檔案會顯示「逐條對照」分頁，讓每條舊/新並排清晰比對。
    回傳值：'new' 表示使用新文本，'old' 表示保留舊文本，'skip' 表示略過。
    """
    result = {'choice': 'skip'}
    is_timestamp_file = filename.endswith("Timestamp.txt")

    win = tk.Toplevel()
    win.title(f"差異比對 - {filename}")
    win.geometry("1200x750")
    win.resizable(True, True)
    win.grab_set()

    # ── 標題 ──
    header = tk.Frame(win, bg="#2c3e50", pady=8)
    header.pack(fill=tk.X)
    tk.Label(header, text=f"📄  {filename}　差異比對",
             font=("Microsoft JhengHei", 13, "bold"), fg="white", bg="#2c3e50").pack()
    tk.Label(header, text="請確認要使用哪個版本",
             font=("Microsoft JhengHei", 10), fg="#bdc3c7", bg="#2c3e50").pack()

    # ── 統計 ──
    old_lines = old_text.splitlines()
    new_lines = new_text.splitlines()
    diff_all  = list(difflib.unified_diff(old_lines, new_lines, lineterm=''))
    added     = sum(1 for l in diff_all if l.startswith('+') and not l.startswith('+++'))
    removed   = sum(1 for l in diff_all if l.startswith('-') and not l.startswith('---'))
    changed   = min(added, removed)

    stats_frame = tk.Frame(win, bg="#ecf0f1", pady=5)
    stats_frame.pack(fill=tk.X, padx=10, pady=(5, 0))
    tk.Label(stats_frame,
             text=(f"舊文本：{len(old_lines)} 條　新文本：{len(new_lines)} 條　"
                   f"修改：{changed} 條　新增：{added - changed} 條　刪除：{removed - changed} 條"),
             font=("Microsoft JhengHei", 10), bg="#ecf0f1", fg="#444").pack()

    # ── 分頁 ──
    notebook = ttk.Notebook(win)
    notebook.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

    # ════════════════════════════════════════════════
    # Tab A：逐條對照（時間戳記專用，最清晰）
    # ════════════════════════════════════════════════
    if is_timestamp_file:
        tab_ts = tk.Frame(notebook, bg="#1a1a2e")
        notebook.add(tab_ts, text="  ⏱ 逐條對照（時間戳記）  ")

        # 說明列
        legend = tk.Frame(tab_ts, bg="#16213e", pady=4)
        legend.pack(fill=tk.X)
        for txt, bg, fg in [
            ("  ● 相同（無變化）", "#1e1e2e", "#888888"),
            ("  ● 舊內容（已變更）", "#3a1a1a", "#ff8080"),
            ("  ● 新內容（已變更）", "#1a3a1a", "#80e080"),
            ("  ● 僅舊版有（刪除）", "#3a2a1a", "#ffaa55"),
            ("  ● 僅新版有（新增）", "#1a2a3a", "#55aaff"),
        ]:
            tk.Label(legend, text=txt, bg=bg, fg=fg,
                     font=("Microsoft JhengHei", 9), padx=8, pady=2).pack(side=tk.LEFT)

        # Canvas + Scrollbar（讓每行高度可彈性）
        outer = tk.Frame(tab_ts)
        outer.pack(fill=tk.BOTH, expand=True)

        canvas = tk.Canvas(outer, bg="#1a1a2e", highlightthickness=0)
        vbar   = tk.Scrollbar(outer, orient=tk.VERTICAL, command=canvas.yview)
        canvas.configure(yscrollcommand=vbar.set)
        vbar.pack(side=tk.RIGHT, fill=tk.Y)
        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        inner = tk.Frame(canvas, bg="#1a1a2e")
        canvas_win = canvas.create_window((0, 0), window=inner, anchor="nw")

        def on_resize(event):
            canvas.itemconfig(canvas_win, width=event.width)
        canvas.bind("<Configure>", on_resize)

        def on_frame_configure(event):
            canvas.configure(scrollregion=canvas.bbox("all"))
        inner.bind("<Configure>", on_frame_configure)

        def on_mousewheel(event):
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        canvas.bind_all("<MouseWheel>", on_mousewheel)

        # ── 欄位標題 ──
        hdr_row = tk.Frame(inner, bg="#0f3460", pady=4)
        hdr_row.pack(fill=tk.X, padx=2, pady=(2, 0))
        tk.Label(hdr_row, text="  #", width=4, anchor="w",
                 bg="#0f3460", fg="#ffffff", font=("Consolas", 9, "bold")).pack(side=tk.LEFT)
        tk.Label(hdr_row, text="時間戳記", width=26, anchor="w",
                 bg="#0f3460", fg="#ffffff", font=("Consolas", 9, "bold")).pack(side=tk.LEFT)
        tk.Label(hdr_row, text="舊版文字", anchor="w",
                 bg="#0f3460", fg="#ff9090", font=("Microsoft JhengHei", 9, "bold")).pack(side=tk.LEFT, expand=True, fill=tk.X)
        tk.Label(hdr_row, text="  ", width=2, bg="#0f3460").pack(side=tk.LEFT)
        tk.Label(hdr_row, text="新版文字", anchor="w",
                 bg="#0f3460", fg="#90e890", font=("Microsoft JhengHei", 9, "bold")).pack(side=tk.LEFT, expand=True, fill=tk.X)

        # ── 使用 SequenceMatcher 做逐行對齊 ──
        matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
        row_num = 0

        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == 'equal':
                for k in range(i2 - i1):
                    row_num += 1
                    ts, txt = parse_timestamp_line(old_lines[i1 + k])
                    row = tk.Frame(inner, bg="#1e1e2e", pady=1)
                    row.pack(fill=tk.X, padx=2, pady=1)
                    tk.Label(row, text=f"  {row_num}", width=4, anchor="w",
                             bg="#1e1e2e", fg="#555", font=("Consolas", 9)).pack(side=tk.LEFT)
                    tk.Label(row, text=ts if ts else "", width=26, anchor="w",
                             bg="#1e1e2e", fg="#556677", font=("Consolas", 9)).pack(side=tk.LEFT)
                    tk.Label(row, text=txt, anchor="w", wraplength=380,
                             bg="#1e1e2e", fg="#888888", font=("Microsoft JhengHei", 9)).pack(side=tk.LEFT, expand=True, fill=tk.X)
                    tk.Label(row, text="  ", width=2, bg="#1e1e2e").pack(side=tk.LEFT)
                    tk.Label(row, text=txt, anchor="w", wraplength=380,
                             bg="#1e1e2e", fg="#888888", font=("Microsoft JhengHei", 9)).pack(side=tk.LEFT, expand=True, fill=tk.X)

            elif tag == 'replace':
                # 配對舊/新行，一對一顯示
                pairs = list(zip(
                    [old_lines[i1 + k] for k in range(i2 - i1)],
                    [new_lines[j1 + k] for k in range(j2 - j1)]
                ))
                extra_old = [old_lines[i1 + k] for k in range(len(pairs), i2 - i1)]
                extra_new = [new_lines[j1 + k] for k in range(len(pairs), j2 - j1)]

                for old_l, new_l in pairs:
                    row_num += 1
                    old_ts, old_t = parse_timestamp_line(old_l)
                    new_ts, new_t = parse_timestamp_line(new_l)
                    # 用字元 diff 高亮差異
                    row = tk.Frame(inner, bg="#2a1a1a", pady=2)
                    row.pack(fill=tk.X, padx=2, pady=1)
                    tk.Label(row, text=f"  {row_num}", width=4, anchor="w",
                             bg="#2a1a1a", fg="#aa6655", font=("Consolas", 9)).pack(side=tk.LEFT)
                    # 時間戳記（顯示新的）
                    ts_show = new_ts if new_ts else (old_ts if old_ts else "")
                    tk.Label(row, text=ts_show, width=26, anchor="w",
                             bg="#2a1a1a", fg="#aa8866", font=("Consolas", 9)).pack(side=tk.LEFT)
                    # 舊文字
                    old_txt_lbl = tk.Label(row, text=old_t, anchor="w", wraplength=380,
                                           bg="#3a1a1a", fg="#ff8080",
                                           font=("Microsoft JhengHei", 9), relief=tk.FLAT, padx=4)
                    old_txt_lbl.pack(side=tk.LEFT, expand=True, fill=tk.X)
                    tk.Label(row, text=" → ", bg="#2a1a1a", fg="#aaaaaa",
                             font=("Consolas", 9)).pack(side=tk.LEFT)
                    # 新文字
                    new_txt_lbl = tk.Label(row, text=new_t, anchor="w", wraplength=380,
                                           bg="#1a3a1a", fg="#80e880",
                                           font=("Microsoft JhengHei", 9), relief=tk.FLAT, padx=4)
                    new_txt_lbl.pack(side=tk.LEFT, expand=True, fill=tk.X)

                for old_l in extra_old:
                    row_num += 1
                    old_ts, old_t = parse_timestamp_line(old_l)
                    row = tk.Frame(inner, bg="#3a2a1a", pady=2)
                    row.pack(fill=tk.X, padx=2, pady=1)
                    tk.Label(row, text=f"  {row_num}", width=4, anchor="w",
                             bg="#3a2a1a", fg="#cc8844", font=("Consolas", 9)).pack(side=tk.LEFT)
                    tk.Label(row, text=old_ts if old_ts else "", width=26, anchor="w",
                             bg="#3a2a1a", fg="#aa7733", font=("Consolas", 9)).pack(side=tk.LEFT)
                    tk.Label(row, text=f"[已刪除] {old_t}", anchor="w", wraplength=380,
                             bg="#3a2a1a", fg="#ffaa55", font=("Microsoft JhengHei", 9), padx=4).pack(side=tk.LEFT, expand=True, fill=tk.X)
                    tk.Label(row, text=" → ", bg="#3a2a1a", fg="#555").pack(side=tk.LEFT)
                    tk.Label(row, text="（無對應新行）", bg="#1a2a1a", fg="#557755",
                             font=("Microsoft JhengHei", 9), padx=4).pack(side=tk.LEFT, expand=True, fill=tk.X)

                for new_l in extra_new:
                    row_num += 1
                    new_ts, new_t = parse_timestamp_line(new_l)
                    row = tk.Frame(inner, bg="#1a2a3a", pady=2)
                    row.pack(fill=tk.X, padx=2, pady=1)
                    tk.Label(row, text=f"  {row_num}", width=4, anchor="w",
                             bg="#1a2a3a", fg="#4488cc", font=("Consolas", 9)).pack(side=tk.LEFT)
                    tk.Label(row, text=new_ts if new_ts else "", width=26, anchor="w",
                             bg="#1a2a3a", fg="#336699", font=("Consolas", 9)).pack(side=tk.LEFT)
                    tk.Label(row, text="（無對應舊行）", bg="#2a1a1a", fg="#775555",
                             font=("Microsoft JhengHei", 9), padx=4).pack(side=tk.LEFT, expand=True, fill=tk.X)
                    tk.Label(row, text=" → ", bg="#1a2a3a", fg="#555").pack(side=tk.LEFT)
                    tk.Label(row, text=f"[新增] {new_t}", anchor="w", wraplength=380,
                             bg="#1a2a3a", fg="#55aaff", font=("Microsoft JhengHei", 9), padx=4).pack(side=tk.LEFT, expand=True, fill=tk.X)

            elif tag == 'delete':
                for k in range(i2 - i1):
                    row_num += 1
                    old_ts, old_t = parse_timestamp_line(old_lines[i1 + k])
                    row = tk.Frame(inner, bg="#3a2a1a", pady=2)
                    row.pack(fill=tk.X, padx=2, pady=1)
                    tk.Label(row, text=f"  {row_num}", width=4, anchor="w",
                             bg="#3a2a1a", fg="#cc8844", font=("Consolas", 9)).pack(side=tk.LEFT)
                    tk.Label(row, text=old_ts if old_ts else "", width=26, anchor="w",
                             bg="#3a2a1a", fg="#aa7733", font=("Consolas", 9)).pack(side=tk.LEFT)
                    tk.Label(row, text=f"[已刪除] {old_t}", anchor="w", wraplength=380,
                             bg="#3a2a1a", fg="#ffaa55", font=("Microsoft JhengHei", 9), padx=4).pack(side=tk.LEFT, expand=True, fill=tk.X)
                    tk.Label(row, text=" → ", bg="#3a2a1a", fg="#555").pack(side=tk.LEFT)
                    tk.Label(row, text="（新版無此行）", bg="#1a1a1a", fg="#555",
                             font=("Microsoft JhengHei", 9), padx=4).pack(side=tk.LEFT, expand=True, fill=tk.X)

            elif tag == 'insert':
                for k in range(j2 - j1):
                    row_num += 1
                    new_ts, new_t = parse_timestamp_line(new_lines[j1 + k])
                    row = tk.Frame(inner, bg="#1a2a3a", pady=2)
                    row.pack(fill=tk.X, padx=2, pady=1)
                    tk.Label(row, text=f"  {row_num}", width=4, anchor="w",
                             bg="#1a2a3a", fg="#4488cc", font=("Consolas", 9)).pack(side=tk.LEFT)
                    tk.Label(row, text=new_ts if new_ts else "", width=26, anchor="w",
                             bg="#1a2a3a", fg="#336699", font=("Consolas", 9)).pack(side=tk.LEFT)
                    tk.Label(row, text="（舊版無此行）", bg="#1a1a1a", fg="#555",
                             font=("Microsoft JhengHei", 9), padx=4).pack(side=tk.LEFT, expand=True, fill=tk.X)
                    tk.Label(row, text=" → ", bg="#1a2a3a", fg="#555").pack(side=tk.LEFT)
                    tk.Label(row, text=f"[新增] {new_t}", anchor="w", wraplength=380,
                             bg="#1a2a3a", fg="#55aaff", font=("Microsoft JhengHei", 9), padx=4).pack(side=tk.LEFT, expand=True, fill=tk.X)

    # ════════════════════════════════════════════════
    # Tab B：並排全文
    # ════════════════════════════════════════════════
    tab_side = tk.Frame(notebook)
    notebook.add(tab_side, text="  並排全文  ")

    paned = tk.PanedWindow(tab_side, orient=tk.HORIZONTAL, sashwidth=5, bg="#95a5a6")
    paned.pack(fill=tk.BOTH, expand=True)

    def make_panel(parent, title, color):
        frame = tk.Frame(parent, bd=0)
        tk.Label(frame, text=title, font=("Microsoft JhengHei", 10, "bold"),
                 bg=color, fg="white", pady=4).pack(fill=tk.X)
        txt = scrolledtext.ScrolledText(frame, wrap=tk.WORD, font=("Consolas", 10),
                                        bg="#fdfefe", relief=tk.FLAT, bd=1)
        txt.pack(fill=tk.BOTH, expand=True)
        return frame, txt

    lf, old_txt = make_panel(paned, "　舊版（原有檔案）", "#c0392b")
    rf, new_txt = make_panel(paned, "　新版（剛轉錄結果）", "#27ae60")
    paned.add(lf, minsize=200)
    paned.add(rf, minsize=200)
    old_txt.insert(tk.END, old_text)
    new_txt.insert(tk.END, new_text)
    old_txt.config(state=tk.DISABLED)
    new_txt.config(state=tk.DISABLED)

    # ════════════════════════════════════════════════
    # Tab C：unified diff
    # ════════════════════════════════════════════════
    tab_diff = tk.Frame(notebook)
    notebook.add(tab_diff, text="  Unified Diff  ")

    diff_txt = scrolledtext.ScrolledText(tab_diff, wrap=tk.WORD, font=("Consolas", 10),
                                          bg="#1e1e1e", fg="#d4d4d4", relief=tk.FLAT)
    diff_txt.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)
    diff_txt.tag_configure("add",    foreground="#6ec17a", background="#1e3a1e")
    diff_txt.tag_configure("remove", foreground="#f47678", background="#3a1e1e")
    diff_txt.tag_configure("header", foreground="#569cd6")
    diff_txt.tag_configure("same",   foreground="#606060")

    for line in difflib.unified_diff(old_lines, new_lines,
                                     fromfile="舊版", tofile="新版", lineterm=''):
        if line.startswith(('+++', '---')):
            diff_txt.insert(tk.END, line + "\n", "header")
        elif line.startswith('@@'):
            diff_txt.insert(tk.END, line + "\n", "header")
        elif line.startswith('+'):
            diff_txt.insert(tk.END, line + "\n", "add")
        elif line.startswith('-'):
            diff_txt.insert(tk.END, line + "\n", "remove")
        else:
            diff_txt.insert(tk.END, line + "\n", "same")
    diff_txt.config(state=tk.DISABLED)

    # ── 預設顯示「逐條對照」分頁（時間戳記檔） ──
    if is_timestamp_file:
        notebook.select(0)

    # ── 按鈕區 ──
    btn_frame = tk.Frame(win, bg="#f0f0f0", pady=10)
    btn_frame.pack(fill=tk.X)

    def choose(val):
        result['choice'] = val
        win.destroy()

    tk.Button(btn_frame, text="✅ 使用新版本（覆蓋舊檔）",
              font=("Microsoft JhengHei", 11, "bold"),
              bg="#27ae60", fg="white", padx=20, pady=6,
              command=lambda: choose('new')).pack(side=tk.LEFT, padx=20)

    tk.Button(btn_frame, text="🔒 保留舊版本（不覆蓋）",
              font=("Microsoft JhengHei", 11, "bold"),
              bg="#c0392b", fg="white", padx=20, pady=6,
              command=lambda: choose('old')).pack(side=tk.LEFT, padx=5)

    tk.Button(btn_frame, text="⏭ 略過此檔",
              font=("Microsoft JhengHei", 10),
              bg="#7f8c8d", fg="white", padx=15, pady=6,
              command=lambda: choose('skip')).pack(side=tk.RIGHT, padx=20)

    win.protocol("WM_DELETE_WINDOW", lambda: choose('skip'))
    win.wait_window()
    return result['choice']


def format_timestamp(seconds: float) -> str:
    assert seconds >= 0, "non-negative timestamp expected"
    milliseconds = round(seconds * 1000.0)
    hours = milliseconds // 3_600_000
    milliseconds %= 3_600_000
    minutes = milliseconds // 60_000
    milliseconds %= 60_000
    seconds_int = milliseconds // 1_000
    milliseconds_rem = milliseconds % 1_000
    return f"{hours:02}:{minutes:02}:{seconds_int:02}.{milliseconds_rem:03}"


def smart_sentence_split(segments, max_gap=0.6, max_duration=6.0, max_words=18, min_words=6):
    """
    智能斷句 v3：
    - 連接詞保護：不在 that/and/but/which/when... 等詞後斷句（僅對時間間隔有效）
    - 殘句合併：小寫開頭、詞數<6、或以接續介詞開頭的行，自動合併到前一句
    - 時長/詞數超限時強制斷句（不受連接詞保護影響）
    - 支援原版 Whisper 和 faster-whisper 格式
    """
    sentence_endings = {'.', '!', '?', '。', '！', '？'}
    pause_punctuations = {',', ';', ':', '，', '；', '：'}
    joining_words = {
        'that', 'and', 'but', 'or', 'nor', 'so', 'yet',
        'which', 'who', 'whom', 'whose', 'when', 'where',
        'because', 'although', 'though', 'while', 'as',
        'if', 'unless', 'until', 'since', 'after', 'before',
    }
    continuation_starters = {
        'with', 'to', 'of', 'from', 'in', 'at', 'for', 'on',
        'about', 'into', 'by', 'than', 'through',
    }

    new_segments = []
    current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0, 'last_word_clean': ''}

    def flush(cs, segs):
        text = cs['text'].strip()
        if not text:
            return
        words = text.split()
        first_word = words[0].lower().rstrip('.,!?;:') if words else ''
        first_char_lower = text[0].islower()
        # 殘句條件：詞數太少、小寫開頭（表示是接續片段）、或以接續介詞開頭
        is_fragment = (
            len(words) < min_words or
            first_char_lower or
            first_word in continuation_starters
        )
        if is_fragment and segs:
            prev = segs[-1]
            segs[-1] = {
                'start': prev['start'],
                'end': cs['end'],
                'text': prev['text'].rstrip() + ' ' + text
            }
        else:
            segs.append({'start': cs['start'], 'end': cs['end'], 'text': text})

    for segment in segments:
        words = None
        if hasattr(segment, 'words') and segment.words:
            words = [{'word': w.word, 'start': w.start, 'end': w.end} for w in segment.words]
        elif isinstance(segment, dict) and 'words' in segment and segment['words']:
            words = segment['words']

        if not words:
            if hasattr(segment, 'text'):
                text = segment.text.strip()
                seg_start = segment.start
                seg_end = segment.end
            else:
                text = segment['text'].strip()
                seg_start = segment['start']
                seg_end = segment['end']
            parts = re.split(r'([.!?,;:])', text)
            sub_sentences, temp = [], ""
            for part in parts:
                temp += part
                if part in ['.', '!', '?', ',', ';', ':']:
                    if temp.strip():
                        sub_sentences.append(temp.strip())
                        temp = ""
            if temp.strip():
                sub_sentences.append(temp.strip())
            duration = seg_end - seg_start
            time_per = duration / max(len(sub_sentences), 1)
            for idx, sub_text in enumerate(sub_sentences):
                new_segments.append({
                    'start': seg_start + idx * time_per,
                    'end': seg_start + (idx + 1) * time_per,
                    'text': sub_text
                })
            continue

        for word_info in words:
            word = word_info.get('word', '').strip()
            if not word:
                continue
            word_start = word_info.get('start')
            word_end = word_info.get('end')
            if word_start is None:
                ts = word_info.get('timestamp', [None, None])
                word_start = ts[0]
                word_end = ts[1]
            if word_start is None:
                continue
            if word_end is None:
                word_end = word_start
            word_clean = word.lower().rstrip('.,!?;:')

            if current_sentence['start'] is None:
                current_sentence['start'] = word_start
                current_sentence['end'] = word_end

            # 1. 時間間隔過大 → 斷句（連接詞保護有效）
            if current_sentence['text'] and (word_start - current_sentence['end']) > max_gap:
                if current_sentence['last_word_clean'] not in joining_words:
                    flush(current_sentence, new_segments)
                    current_sentence = {'start': word_start, 'end': word_end, 'text': word, 'word_count': 1, 'last_word_clean': word_clean}
                    continue

            # 2. 時長過長 → 遇標點強制斷句（連接詞保護無效）
            if (word_end - current_sentence['start']) > max_duration:
                if word[-1] in sentence_endings | pause_punctuations:
                    current_sentence['end'] = word_end
                    current_sentence['text'] += ' ' + word
                    current_sentence['last_word_clean'] = word_clean
                    flush(current_sentence, new_segments)
                    current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0, 'last_word_clean': ''}
                    continue

            # 3. 詞數過多 → 遇標點強制斷句（連接詞保護無效）
            if current_sentence['word_count'] >= max_words:
                if word[-1] in sentence_endings | pause_punctuations:
                    current_sentence['end'] = word_end
                    current_sentence['text'] += ' ' + word
                    current_sentence['last_word_clean'] = word_clean
                    flush(current_sentence, new_segments)
                    current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0, 'last_word_clean': ''}
                    continue

            # 正常加入詞
            current_sentence['end'] = word_end
            current_sentence['text'] += ' ' + word
            current_sentence['word_count'] += 1
            current_sentence['last_word_clean'] = word_clean

            # 遇句尾標點 → 斷句（連接詞保護有效）
            if word[-1] in sentence_endings:
                if current_sentence['last_word_clean'] not in joining_words:
                    flush(current_sentence, new_segments)
                    current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0, 'last_word_clean': ''}

    if current_sentence['text'].strip():
        flush(current_sentence, new_segments)

    return new_segments

def scan_folder_for_mp3(folder_path):
    audio_extensions = ['.mp3', '.wav', '.m4a']
    files = []
    for f in os.listdir(folder_path):
        fp = os.path.join(folder_path, f)
        if os.path.isfile(fp) and os.path.splitext(f)[1].lower() in audio_extensions:
            files.append(fp)
    return sorted(files)


def process_audio_file(file_path, model, engine, save_plain, save_timestamp, recheck=False):
    WHISPER_SAMPLE_RATE = 16000
    try:
        directory = os.path.dirname(file_path)
        clean_filename = os.path.splitext(os.path.basename(file_path))[0].strip()
        base_path = os.path.join(directory, clean_filename)

        # 跳過已存在的檔案（recheck 模式下不跳過）
        if not recheck:
            files_to_check = []
            if save_plain:
                files_to_check.append(base_path + ".txt")
            if save_timestamp:
                files_to_check.append(base_path + " Timestamp.txt")
            if files_to_check and all(os.path.exists(f) for f in files_to_check):
                print(f"  [跳過] 檔案已存在: {clean_filename}")
                return 'skip_exist'

        # 取得音訊時長
        if engine == "whisper":
            import whisper as whisper_lib
            audio = whisper_lib.load_audio(file_path)
            duration = audio.shape[0] / WHISPER_SAMPLE_RATE
        else:
            # faster-whisper 直接吃檔案路徑，用 ffprobe 或預設略過長度檢查
            try:
                import soundfile as sf
                info = sf.info(file_path)
                duration = info.duration
            except Exception:
                duration = 99

        if duration < 10:
            print(f"  [跳過] 檔案長度 ({duration:.2f} 秒) 小於 10 秒。")
            return 'skip_short'

        print(f"檔案長度: {duration:.2f} 秒。開始轉錄...")

        # 轉錄
        if engine == "whisper":
            result = model.transcribe(
                audio,
                language="en",
                verbose=False,
                word_timestamps=True,
                beam_size=5,
                best_of=5,
                temperature=0.0,
                condition_on_previous_text=True,
                compression_ratio_threshold=2.4,
                no_speech_threshold=0.6,
            )
            segments = result["segments"]

        else:  # faster-whisper
            segments_gen, _ = model.transcribe(
                file_path,
                language="en",
                word_timestamps=True,
                beam_size=5,
                best_of=5,
                temperature=0.0,
                condition_on_previous_text=True,
                compression_ratio_threshold=2.4,
                no_speech_threshold=0.6,
                vad_filter=True,        # 靜音過濾（faster-whisper 專屬）
            )
            segments = list(segments_gen)

        print("轉錄完成。")

        smart_segments = smart_sentence_split(segments, max_gap=0.6, max_duration=5.0, max_words=15)

        # 儲存純文字
        if save_plain:
            txt_path = base_path + ".txt"
            try:
                new_lines = [s['text'].strip() for s in smart_segments if s['text'].strip()]
                new_content = '\n'.join(new_lines)

                if recheck and os.path.exists(txt_path):
                    with open(txt_path, "r", encoding="utf-8") as f:
                        old_content = f.read()
                    if old_content.strip() == new_content.strip():
                        print(f"  [相同] 純文字內容一致，無需更新: {os.path.basename(txt_path)}")
                    else:
                        print(f"  [差異] 純文字有差異，開啟比對視窗...")
                        choice = show_diff_dialog(os.path.basename(txt_path), old_content, new_content)
                        if choice == 'new':
                            with open(txt_path, "w", encoding="utf-8") as f:
                                f.write(new_content)
                            print(f"  [覆蓋] 已使用新文本: {os.path.basename(txt_path)}")
                        elif choice == 'old':
                            print(f"  [保留] 維持舊文本: {os.path.basename(txt_path)}")
                        else:
                            print(f"  [略過] 使用者略過此檔: {os.path.basename(txt_path)}")
                else:
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    print(f"  [成功] 純文字: {os.path.basename(txt_path)}")
            except Exception as e:
                print(f"  [失敗] 純文字儲存失敗: {e}")

        # 儲存時間戳記
        if save_timestamp:
            ts_path = base_path + " Timestamp.txt"
            try:
                new_ts_lines = []
                for seg in smart_segments:
                    s = format_timestamp(seg['start'])
                    e = format_timestamp(seg['end'])
                    new_ts_lines.append(f"[{s} --> {e}] {seg['text'].strip()}")
                new_ts_content = '\n'.join(new_ts_lines)

                if recheck and os.path.exists(ts_path):
                    with open(ts_path, "r", encoding="utf-8") as f:
                        old_ts_content = f.read()
                    if old_ts_content.strip() == new_ts_content.strip():
                        print(f"  [相同] 時間戳記內容一致，無需更新: {os.path.basename(ts_path)}")
                    else:
                        print(f"  [差異] 時間戳記有差異，開啟比對視窗...")
                        choice = show_diff_dialog(os.path.basename(ts_path), old_ts_content, new_ts_content)
                        if choice == 'new':
                            with open(ts_path, "w", encoding="utf-8") as f:
                                f.write(new_ts_content)
                            print(f"  [覆蓋] 已使用新時間戳記: {os.path.basename(ts_path)}")
                        elif choice == 'old':
                            print(f"  [保留] 維持舊時間戳記: {os.path.basename(ts_path)}")
                        else:
                            print(f"  [略過] 使用者略過此檔: {os.path.basename(ts_path)}")
                else:
                    with open(ts_path, "w", encoding="utf-8") as f:
                        f.write(new_ts_content)
                    print(f"  [成功] 時間戳記: {os.path.basename(ts_path)}")
            except Exception as e:
                print(f"  [失敗] 時間戳記儲存失敗: {e}")

        return 'success'

    except Exception as e:
        print(f"[錯誤] 處理 {file_path} 時發生錯誤: {e}")
        import traceback
        traceback.print_exc()
        return 'error'


# ─── 主程式 ───────────────────────────────────────────

root = Tk()
root.withdraw()

# 步驟 1：選擇檔案或資料夾
mode = messagebox.askquestion(
    "選擇處理模式",
    "請選擇處理模式：\n\n● Yes：選擇單個或多個 MP3 檔案\n● No：選擇資料夾（自動掃描）"
)

file_paths = []
if mode == "yes":
    file_paths = list(askopenfilenames(
        title="選擇音訊檔案",
        filetypes=[("音訊檔案", "*.mp3 *.wav *.m4a")]
    ))
else:
    folder = askdirectory(title="選擇包含音訊檔案的資料夾")
    if folder:
        file_paths = scan_folder_for_mp3(folder)
        print(f"找到 {len(file_paths)} 個音訊檔案。")

if not file_paths:
    print("未選擇檔案。程式結束。")
    exit()

# 步驟 2：儲存格式
save_plain = messagebox.askyesno("儲存選項", "儲存「純文字」版本？\n(例: MyAudio.txt)")
save_timestamp = messagebox.askyesno("儲存選項", "儲存「時間戳記」版本？\n(例: MyAudio Timestamp.txt)")

if not save_plain and not save_timestamp:
    print("未選擇儲存格式。程式結束。")
    exit()

# 步驟 2.5：是否啟用重新轉錄並比對差異
recheck_mode = messagebox.askyesno(
    "重新轉錄比對模式",
    "是否啟用「重新轉錄比對」模式？\n\n"
    "✅ 是（Yes）：\n"
    "  • 即使檔案已有文檔，仍重新執行轉錄\n"
    "  • 轉錄完成後，顯示新舊文本的差異比對\n"
    "  • 由您決定要覆蓋還是保留舊文本\n\n"
    "❌ 否（No）：\n"
    "  • 一般模式，已有文檔的檔案直接跳過"
)

# 步驟 3：篩選需要處理的檔案
files_to_process, files_done = [], []
for fp in file_paths:
    base = os.path.join(os.path.dirname(fp), os.path.splitext(os.path.basename(fp))[0].strip())
    checks = []
    if save_plain: checks.append(base + ".txt")
    if save_timestamp: checks.append(base + " Timestamp.txt")
    if checks and all(os.path.exists(c) for c in checks):
        if recheck_mode:
            files_to_process.append(fp)  # recheck 模式：已有文檔也要重新處理
        else:
            files_done.append(os.path.basename(fp))
    else:
        files_to_process.append(fp)

recheck_count = sum(
    1 for fp in files_to_process
    if any(os.path.exists(
        os.path.join(os.path.dirname(fp), os.path.splitext(os.path.basename(fp))[0].strip()) + ext
    ) for ext in ([".txt"] if save_plain else []) + ([" Timestamp.txt"] if save_timestamp else []))
) if recheck_mode else 0

print(f"\n總計: {len(file_paths)} 個 | 已完成: {len(files_done)} 個 | 需處理: {len(files_to_process)} 個"
      + (f" (其中 {recheck_count} 個將進行差異比對)" if recheck_mode and recheck_count else ""))

if not files_to_process:
    messagebox.showinfo("完成", "所有檔案都已有對應的文本檔！")
    exit()

if not messagebox.askyesno("確認", f"將處理 {len(files_to_process)} 個檔案，是否開始？"):
    print("使用者取消。程式結束。")
    exit()

# 步驟 4：選擇引擎 + 模型（合併為單一列表）
combo_choice = simpledialog.askstring(
    "選擇引擎與模型",
    "請輸入編號（直接按 Enter 預設選 1）：\n\n"
    "  ── faster-whisper（速度快 4~8 倍，推薦）──────────────────────\n"
    "  編號  模型名稱              準確度       速度          大小\n"
    "  ──────────────────────────────────────────────────────────\n"
    "  1     large-v3-turbo       ⭐⭐⭐⭐⭐    ⚡⚡⚡⚡      ~1.6GB  ★推薦\n"
    "  2     large-v3             ⭐⭐⭐⭐⭐    ⚡⚡⚡        ~3.0GB\n"
    "  3     large-v2             ⭐⭐⭐⭐      ⚡⚡⚡        ~3.0GB\n"
    "  4     medium               ⭐⭐⭐        ⚡⚡⚡⚡      ~1.5GB\n"
    "  5     small                ⭐⭐          ⚡⚡⚡⚡⚡    ~0.5GB\n"
    "  6     base                 ⭐            ⚡⚡⚡⚡⚡    ~0.1GB\n"
    "\n"
    "  ── 原版 Whisper（OpenAI 官方）─────────────────────────────────\n"
    "  編號  模型名稱              準確度       速度          大小\n"
    "  ──────────────────────────────────────────────────────────\n"
    "  7     large-v3-turbo       ⭐⭐⭐⭐⭐    ⚡⚡          ~1.6GB\n"
    "  8     large-v3             ⭐⭐⭐⭐⭐    ⚡            ~3.0GB\n"
    "  9     large-v2             ⭐⭐⭐⭐      ⚡            ~3.0GB\n"
    " 10     medium               ⭐⭐⭐        ⚡⚡          ~1.5GB\n"
    " 11     small                ⭐⭐          ⚡⚡⚡        ~0.5GB\n"
    " 12     base                 ⭐            ⚡⚡⚡⚡      ~0.1GB\n"
    "\n輸入 1~12：",
    initialvalue="1"
)

combo_map = {
    "1":  ("faster",  "large-v3-turbo"),
    "2":  ("faster",  "large-v3"),
    "3":  ("faster",  "large-v2"),
    "4":  ("faster",  "medium"),
    "5":  ("faster",  "small"),
    "6":  ("faster",  "base"),
    "7":  ("whisper", "large-v3-turbo"),
    "8":  ("whisper", "large-v3"),
    "9":  ("whisper", "large-v2"),
    "10": ("whisper", "medium"),
    "11": ("whisper", "small"),
    "12": ("whisper", "base"),
}
key = combo_choice.strip() if combo_choice else "1"
engine, model_name = combo_map.get(key, ("faster", "large-v3-turbo"))
print(f"\n使用引擎：{'faster-whisper' if engine == 'faster' else '原版 Whisper'} | 模型：{model_name}")

# 步驟 5：載入模型
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"使用裝置: {device}")
print(f"載入 '{model_name}' 模型...")

if engine == "faster":
    try:
        from faster_whisper import WhisperModel
        compute_type = "float16" if device == "cuda" else "int8"
        model = WhisperModel(model_name, device=device, compute_type=compute_type)
        print(f"faster-whisper 模型載入完成（compute_type={compute_type}）\n")
    except ImportError:
        print("\n[錯誤] 找不到 faster-whisper，請先執行：pip install faster-whisper")
        messagebox.showerror(
            "缺少套件",
            "找不到 faster-whisper！\n\n請先在終端機執行：\npip install faster-whisper\n\n目前改用原版 Whisper 繼續。"
        )
        engine = "whisper"
        import whisper as whisper_lib
        model = whisper_lib.load_model(model_name, device=device)
        print("原版 Whisper 模型載入完成。\n")
else:
    import whisper as whisper_lib
    model = whisper_lib.load_model(model_name, device=device)
    print("原版 Whisper 模型載入完成。\n")

# 步驟 6：處理檔案
stats = {'success': 0, 'skip_exist': 0, 'skip_short': 0, 'error': 0}
for i, fp in enumerate(files_to_process):
    print(f"\n{'='*50}")
    print(f"處理 {i+1}/{len(files_to_process)}: {os.path.basename(fp)}")
    print('='*50)
    result = process_audio_file(fp, model, engine, save_plain, save_timestamp, recheck=recheck_mode)
    stats[result] += 1

print(f"\n{'='*50}")
print(f"完成！成功:{stats['success']} 跳過(已存在):{stats['skip_exist']} 跳過(太短):{stats['skip_short']} 錯誤:{stats['error']}")
print('='*50)
