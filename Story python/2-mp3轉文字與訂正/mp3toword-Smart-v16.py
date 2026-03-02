import os
import re
import torch
import difflib
import tkinter as tk
from tkinter import Tk, messagebox, simpledialog, scrolledtext, ttk
from tkinter.filedialog import askopenfilenames, askdirectory

# ── spaCy（詞性標注，用於智慧斷句）──
try:
    import spacy
    _nlp = spacy.load("en_core_web_sm")
    SPACY_AVAILABLE = True
except Exception:
    _nlp = None
    SPACY_AVAILABLE = False

def parse_ts_line(line):
    """解析時間戳記行，回傳 (start_sec, end_sec, text) 或 None。"""
    m = re.match(r'\[(\d+):(\d+):(\d+\.\d+) --> (\d+):(\d+):(\d+\.\d+)\]\s*(.*)', line.strip())
    if not m:
        return None
    def s(h, mi, sc): return int(h)*3600 + int(mi)*60 + float(sc)
    return s(m.group(1),m.group(2),m.group(3)), s(m.group(4),m.group(5),m.group(6)), m.group(7).strip()


def word_diff_widgets(parent, old_txt, new_txt, bg):
    """
    在 parent Frame 裡，用詞級 diff 顯示兩段文字的差異。
    相同的詞灰色，舊版刪除的詞紅色刪除線，新版新增的詞綠色底線。
    回傳 (old_frame, new_frame)。
    """
    old_words = old_txt.split()
    new_words = new_txt.split()
    matcher   = difflib.SequenceMatcher(None, old_words, new_words, autojunk=False)

    def make_word_row(parent_f, words_tags):
        """words_tags: list of (word, tag)  tag= 'same'|'del'|'ins'"""
        f = tk.Frame(parent_f, bg=bg)
        f.pack(fill=tk.X, padx=4, pady=1)
        for word, tag in words_tags:
            if tag == 'same':
                tk.Label(f, text=word+' ', bg=bg, fg='#aaaaaa',
                         font=('Microsoft JhengHei', 9)).pack(side=tk.LEFT)
            elif tag == 'del':
                lbl = tk.Label(f, text=word+' ', bg='#3a1010', fg='#ff6b6b',
                               font=('Microsoft JhengHei', 9, 'overstrike'))
                lbl.pack(side=tk.LEFT)
            elif tag == 'ins':
                lbl = tk.Label(f, text=word+' ', bg='#103a10', fg='#6bff6b',
                               font=('Microsoft JhengHei', 9, 'underline'))
                lbl.pack(side=tk.LEFT)
        return f

    old_tagged, new_tagged = [], []
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == 'equal':
            for w in old_words[i1:i2]: old_tagged.append((w, 'same'))
            for w in new_words[j1:j2]: new_tagged.append((w, 'same'))
        elif op == 'replace':
            for w in old_words[i1:i2]: old_tagged.append((w, 'del'))
            for w in new_words[j1:j2]: new_tagged.append((w, 'ins'))
        elif op == 'delete':
            for w in old_words[i1:i2]: old_tagged.append((w, 'del'))
        elif op == 'insert':
            for w in new_words[j1:j2]: new_tagged.append((w, 'ins'))

    return old_tagged, new_tagged


def show_diff_dialog(filename, old_text, new_text):
    """
    視覺化差異比對視窗 v2：
    - 時間戳記檔：以時間軸對齊，自動偵測斷句變化（合併/拆分），
      詞級 diff 標出真正修改的詞（紅色刪除線 / 綠色底線）
    - 純文字檔：傳統並排 + unified diff
    回傳 'new' / 'old' / 'skip'
    """
    result = {'choice': 'skip'}
    is_ts = 'Timestamp' in filename

    win = tk.Toplevel()
    win.title(f"差異比對 - {filename}")
    win.geometry("1300x780")
    win.resizable(True, True)
    win.grab_set()

    # ── 標題 ──
    hdr = tk.Frame(win, bg='#1a252f', pady=8)
    hdr.pack(fill=tk.X)
    tk.Label(hdr, text=f"📄  {filename}", font=('Microsoft JhengHei', 13, 'bold'),
             fg='white', bg='#1a252f').pack()
    tk.Label(hdr, text='請確認要使用哪個版本', font=('Microsoft JhengHei', 10),
             fg='#95a5a6', bg='#1a252f').pack()

    # ── 統計 ──
    old_lines = old_text.splitlines()
    new_lines = new_text.splitlines()

    # 純文字統計（去掉時間戳記）
    def strip_ts(lines):
        out = []
        for l in lines:
            p = parse_ts_line(l)
            out.append(p[2] if p else l)
        return ' '.join(out)

    old_words_all = strip_ts(old_lines).split()
    new_words_all = strip_ts(new_lines).split()
    sm = difflib.SequenceMatcher(None, old_words_all, new_words_all, autojunk=False)
    changed_words = sum(max(i2-i1, j2-j1)
                        for op,i1,i2,j1,j2 in sm.get_opcodes() if op != 'equal')
    only_resplit  = (aborting := ' '.join(old_words_all) == ' '.join(new_words_all))

    stat = tk.Frame(win, bg='#ecf0f1', pady=5)
    stat.pack(fill=tk.X, padx=10, pady=(5,0))
    status_txt = ('✅ 文字內容完全相同，只有斷句位置改變' if only_resplit
                  else f'📝 文字有變動：約 {changed_words} 個詞不同')
    tk.Label(stat,
             text=f'舊版：{len(old_lines)} 條　新版：{len(new_lines)} 條　{status_txt}',
             font=('Microsoft JhengHei', 10), bg='#ecf0f1', fg='#333').pack()

    # ── 分頁 ──
    nb = ttk.Notebook(win)
    nb.pack(fill=tk.BOTH, expand=True, padx=8, pady=5)

    # ════════════════════════════════════════════════════════════
    # Tab 1：智慧比對（時間對齊 + 詞級 diff）
    # ════════════════════════════════════════════════════════════
    tab_smart = tk.Frame(nb, bg='#0d1117')
    nb.add(tab_smart, text='  🔍 智慧比對  ')

    # 圖例
    leg = tk.Frame(tab_smart, bg='#161b22', pady=4)
    leg.pack(fill=tk.X)
    for txt, bg_c, fg_c in [
        ('  ██ 相同文字 ',      '#161b22', '#6e7681'),
        ('  ██ 舊版刪除 ',      '#3a1010', '#ff6b6b'),
        ('  ██ 新版新增 ',      '#103a10', '#6bff6b'),
        ('  ══ 只有斷句改變 ',  '#161b22', '#e8c44a'),
        ('  ◀▶ 合併/拆分 ',    '#161b22', '#58a6ff'),
    ]:
        tk.Label(leg, text=txt, bg=bg_c, fg=fg_c,
                 font=('Microsoft JhengHei', 9), padx=6, pady=2).pack(side=tk.LEFT)

    # Canvas + scrollbar
    outer = tk.Frame(tab_smart, bg='#0d1117')
    outer.pack(fill=tk.BOTH, expand=True)
    canvas = tk.Canvas(outer, bg='#0d1117', highlightthickness=0)
    vsb    = tk.Scrollbar(outer, orient=tk.VERTICAL, command=canvas.yview)
    canvas.configure(yscrollcommand=vsb.set)
    vsb.pack(side=tk.RIGHT, fill=tk.Y)
    canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    inner = tk.Frame(canvas, bg='#0d1117')
    cwin  = canvas.create_window((0,0), window=inner, anchor='nw')
    canvas.bind('<Configure>', lambda e: canvas.itemconfig(cwin, width=e.width))
    inner.bind('<Configure>', lambda e: canvas.configure(scrollregion=canvas.bbox('all')))
    canvas.bind_all('<MouseWheel>', lambda e: canvas.yview_scroll(int(-1*(e.delta/120)),'units'))

    # 欄位標題
    col_hdr = tk.Frame(inner, bg='#21262d', pady=4)
    col_hdr.pack(fill=tk.X, padx=2, pady=(2,0))
    for txt, w in [('  時間', 18), ('舊版文字', 0), (' ', 3), ('新版文字', 0)]:
        tk.Label(col_hdr, text=txt, width=w, anchor='w',
                 bg='#21262d', fg='#8b949e',
                 font=('Consolas', 9, 'bold')).pack(side=tk.LEFT,
                 expand=(w==0), fill=tk.X if w==0 else tk.NONE)

    # ── 解析時間戳記行 ──
    old_parsed = [parse_ts_line(l) for l in old_lines]
    new_parsed = [parse_ts_line(l) for l in new_lines]
    old_segs   = [p for p in old_parsed if p]
    new_segs   = [p for p in new_parsed if p]

    # ── 用時間軸對齊：找出每條新段對應的舊段 ──
    def find_overlapping(new_s, new_e, old_list):
        """找所有與 [new_s, new_e] 時間重疊的舊段。"""
        return [i for i,(os,oe,ot) in enumerate(old_list)
                if os < new_e and oe > new_s]

    used_old = set()
    groups   = []   # list of (new_indices, old_indices)

    for ni, (ns, ne, nt) in enumerate(new_segs):
        oi_list = find_overlapping(ns, ne, old_segs)
        oi_list = [i for i in oi_list if i not in used_old]
        if oi_list:
            for i in oi_list: used_old.add(i)
        groups.append(([ni], oi_list))

    # 合併連續使用同一批舊段的新段
    merged = []
    for new_ids, old_ids in groups:
        if merged and set(merged[-1][1]) == set(old_ids) and old_ids:
            merged[-1][0].extend(new_ids)
        else:
            merged.append((new_ids, old_ids))

    # ── 逐組渲染 ──
    for grp_idx, (new_ids, old_ids) in enumerate(merged):
        n_segs = [new_segs[i] for i in new_ids]
        o_segs = [old_segs[i] for i in old_ids] if old_ids else []

        old_full = ' '.join(ot for _,_,ot in o_segs)
        new_full = ' '.join(nt for _,_,nt in n_segs)

        # 判斷變化類型
        text_same   = old_full.strip() == new_full.strip()
        split_change = len(n_segs) != len(o_segs)

        if text_same and not split_change:
            row_bg = '#0d1117'   # 完全相同 → 低調灰
            badge  = ''
        elif text_same and split_change:
            row_bg = '#1c1a0a'   # 只有斷句變 → 淡黃
            badge  = '✂ 斷句改變' if len(n_segs) > len(o_segs) else '⊕ 合併' if len(n_segs) < len(o_segs) else '↔ 重排'
        else:
            row_bg = '#0d1a0d'   # 文字有改變 → 淡綠底
            badge  = '📝 文字改變'

        # 時間標籤（取新版第一條的開始時間）
        ts_start = n_segs[0][0]
        m_  = int(ts_start//60); s_ = ts_start%60
        ts_lbl = f'{m_:02d}:{s_:05.2f}'

        # 分隔線
        sep = tk.Frame(inner, bg='#21262d', height=1)
        sep.pack(fill=tk.X, padx=2, pady=(4,0))

        # 組標題列（時間 + 徽章）
        title_row = tk.Frame(inner, bg='#161b22', pady=2)
        title_row.pack(fill=tk.X, padx=2)
        tk.Label(title_row, text=f'  {ts_lbl}', bg='#161b22', fg='#58a6ff',
                 font=('Consolas', 9, 'bold'), width=10, anchor='w').pack(side=tk.LEFT)
        if badge:
            badge_colors = {
                '✂ 斷句改變': ('#2d2a0a', '#e8c44a'),
                '⊕ 合併'   : ('#0a1a2d', '#58a6ff'),
                '↔ 重排'   : ('#0a1a2d', '#58a6ff'),
                '📝 文字改變': ('#0d1a0d', '#3fb950'),
            }
            bc, fc = badge_colors.get(badge, ('#1a1a1a', '#ffffff'))
            tk.Label(title_row, text=f' {badge} ', bg=bc, fg=fc,
                     font=('Microsoft JhengHei', 9, 'bold'), padx=6, pady=1).pack(side=tk.LEFT, padx=4)

        # 內容區（舊版在上、新版在下）
        content = tk.Frame(inner, bg=row_bg)
        content.pack(fill=tk.X, padx=2, pady=(0,2))

        # 舊版標籤
        old_hdr = tk.Frame(content, bg='#2a1a1a')
        old_hdr.pack(fill=tk.X)
        tk.Label(old_hdr, text='  舊版', bg='#2a1a1a', fg='#ff6b6b',
                 font=('Microsoft JhengHei', 8, 'bold'), pady=1).pack(side=tk.LEFT)
        old_col = tk.Frame(content, bg=row_bg)
        old_col.pack(fill=tk.X)

        # 分隔線
        sep_row = tk.Frame(content, bg='#30363d', height=1)
        sep_row.pack(fill=tk.X, pady=2)

        # 新版標籤
        new_hdr = tk.Frame(content, bg='#0d2a1a')
        new_hdr.pack(fill=tk.X)
        tk.Label(new_hdr, text='  新版', bg='#0d2a1a', fg='#56d364',
                 font=('Microsoft JhengHei', 8, 'bold'), pady=1).pack(side=tk.LEFT)
        new_col = tk.Frame(content, bg=row_bg)
        new_col.pack(fill=tk.X)

        if text_same:
            # 相同文字：只顯示灰色文字，每條一行
            for _, _, ot in o_segs:
                tk.Label(old_col, text=ot, anchor='w', bg=row_bg,
                         fg='#6e7681' if not split_change else '#c9ae56',
                         font=('Microsoft JhengHei', 10),
                         wraplength=1100, justify=tk.LEFT).pack(fill=tk.X, padx=10, pady=1)
            for _, _, nt in n_segs:
                tk.Label(new_col, text=nt, anchor='w', bg=row_bg,
                         fg='#6e7681' if not split_change else '#c9ae56',
                         font=('Microsoft JhengHei', 10),
                         wraplength=1100, justify=tk.LEFT).pack(fill=tk.X, padx=10, pady=1)
        else:
            # 文字有改變：用詞級 diff
            old_tagged, new_tagged = word_diff_widgets(content, old_full, new_full, row_bg)

            def render_tagged(col_frame, tagged):
                line_frame = tk.Frame(col_frame, bg=row_bg)
                line_frame.pack(fill=tk.X, padx=8, pady=3)
                for word, tag in tagged:
                    if tag == 'same':
                        tk.Label(line_frame, text=word+' ', bg=row_bg, fg='#8b949e',
                                 font=('Microsoft JhengHei', 10)).pack(side=tk.LEFT)
                    elif tag == 'del':
                        tk.Label(line_frame, text=word+' ', bg='#3d1010', fg='#ff6b6b',
                                 font=('Microsoft JhengHei', 10, 'overstrike')).pack(side=tk.LEFT)
                    elif tag == 'ins':
                        tk.Label(line_frame, text=word+' ', bg='#10301a', fg='#56d364',
                                 font=('Microsoft JhengHei', 10, 'underline')).pack(side=tk.LEFT)

            render_tagged(old_col, old_tagged)
            render_tagged(new_col, new_tagged)

            # 顯示各自的斷句條數
            if len(o_segs) > 1:
                tk.Label(old_col, text=f'  ↑ {len(o_segs)} 條', bg=row_bg,
                         fg='#58a6ff', font=('Microsoft JhengHei', 8)).pack(anchor='w', padx=8)
            if len(n_segs) > 1:
                tk.Label(new_col, text=f'  ↑ {len(n_segs)} 條', bg=row_bg,
                         fg='#58a6ff', font=('Microsoft JhengHei', 8)).pack(anchor='w', padx=8)

    # ════════════════════════════════════════════════════════════
    # Tab 2：上下全文（舊版在上、新版在下）
    # ════════════════════════════════════════════════════════════
    tab_side = tk.Frame(nb)
    nb.add(tab_side, text='  並排全文  ')
    paned = tk.PanedWindow(tab_side, orient=tk.VERTICAL, sashwidth=5, bg='#555')
    paned.pack(fill=tk.BOTH, expand=True)

    def make_panel(parent, title, color):
        f = tk.Frame(parent)
        tk.Label(f, text=title, font=('Microsoft JhengHei', 10, 'bold'),
                 bg=color, fg='white', pady=4).pack(fill=tk.X)
        t = scrolledtext.ScrolledText(f, wrap=tk.WORD, font=('Consolas', 10),
                                      bg='#fdfefe', relief=tk.FLAT)
        t.pack(fill=tk.BOTH, expand=True)
        return f, t

    tf, ot  = make_panel(paned, '　舊版（原有檔案）', '#c0392b')
    bf, nt_ = make_panel(paned, '　新版（剛轉錄結果）', '#27ae60')
    paned.add(tf, minsize=80)
    paned.add(bf, minsize=80)
    ot.insert(tk.END, old_text);  ot.config(state=tk.DISABLED)
    nt_.insert(tk.END, new_text); nt_.config(state=tk.DISABLED)

    # ── 預設顯示智慧比對 ──
    nb.select(0)

    # ── 按鈕區 ──
    btn = tk.Frame(win, bg='#f0f0f0', pady=10)
    btn.pack(fill=tk.X)

    def choose(val):
        result['choice'] = val
        win.destroy()

    tk.Button(btn, text='✅ 使用新版本（覆蓋舊檔）',
              font=('Microsoft JhengHei',11,'bold'),
              bg='#27ae60', fg='white', padx=20, pady=6,
              command=lambda: choose('new')).pack(side=tk.LEFT, padx=20)
    tk.Button(btn, text='🔒 保留舊版本（不覆蓋）',
              font=('Microsoft JhengHei',11,'bold'),
              bg='#c0392b', fg='white', padx=20, pady=6,
              command=lambda: choose('old')).pack(side=tk.LEFT, padx=5)
    tk.Button(btn, text='⏭ 略過此檔',
              font=('Microsoft JhengHei',10),
              bg='#7f8c8d', fg='white', padx=15, pady=6,
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


def smart_sentence_split(segments, max_gap=0.5, max_duration=5.0, max_words=15, min_words=4):
    """
    智能斷句 v6：spaCy 詞性標注 + 語意安全斷點
    ═══════════════════════════════════════════════════════
    【句號必斷】  . ! ? → 無條件立刻斷，不受任何保護

    【spaCy 語意斷點判斷】（有 spaCy 時）
      在逗號後斷句前，用詞性標注判斷下一個 token 的角色：
        ✅ 安全：CCONJ 並列連接詞（and/but/or）
        ✅ 安全：新主語開始（PROPN/大寫 NOUN/PRON）
        ✅ 安全：ADV 副詞（however/then/suddenly）
        ❌ 不安全：SCONJ 從屬連接詞（that/for/which/because）
        ❌ 不安全：ADP 介詞延續上文（of/in/with/to）
        ❌ 不安全：DET 冠詞（the/a）→ 名詞片語被切斷

    【純規則備用】（無 spaCy 時自動降級，行為與 v15 相同）

    【待斷模式】詞數 ≥ max_words 或時長 ≥ max_duration 後積極找斷點
    【緊急模式】詞數 ≥ 25 時語意保護全解除
    【殘句合併】小寫接續介詞開頭 → 併入前一條；大寫開頭 → 永遠是新句
    ═══════════════════════════════════════════════════════
    """
    SE  = {'.', '!', '?', '。', '！', '？'}
    PP  = {',', ';', ':', '，', '；', '：'}

    SUBORD = {
        'that', 'for', 'which', 'who', 'whom', 'whose',
        'because', 'although', 'though', 'while', 'as',
        'if', 'unless', 'until', 'since', 'after', 'before',
        'when', 'where', 'whether', 'how',
    }
    COORD = {'and', 'but', 'or', 'nor', 'so', 'yet'}
    JW    = SUBORD | COORD
    CS    = {'with', 'to', 'of', 'from', 'in', 'at', 'for', 'on',
             'about', 'into', 'by', 'than', 'through'}

    _pos_cache = {}

    def get_pos(word):
        """取得單詞的 spaCy POS tag，帶快取。"""
        if not SPACY_AVAILABLE or not _nlp:
            return None
        w = word.strip()
        key = w.lower()
        if key not in _pos_cache:
            doc = _nlp(w)
            _pos_cache[key] = doc[0].pos_ if doc else 'X'
        return _pos_cache[key]

    def is_safe_break(next_word_raw):
        """
        判斷在逗號後斷句，下句開頭語意是否完整。
        有 spaCy：用詞性判斷（精準）
        無 spaCy：用字串規則（備用）
        """
        if not next_word_raw:
            return True

        nw_clean = next_word_raw.lower().rstrip('.,!?;:')
        pos = get_pos(next_word_raw)

        if SPACY_AVAILABLE and pos and pos != 'X':
            if pos == 'CCONJ':           return True    # and/but/or → 並列，安全
            if pos == 'SCONJ':           return False   # that/for/which → 從屬，不安全
            if pos == 'ADP' and nw_clean in CS:
                                          return False   # 介詞延續上文，不安全
            if pos == 'DET':             return False   # 冠詞，名詞片語被切，不安全
            if pos == 'ADV':             return True    # 副詞開頭新子句，安全
            if pos in ('PROPN', 'NOUN', 'PRON') and next_word_raw[0].isupper():
                                          return True    # 大寫主語，安全
            if next_word_raw[0].isupper(): return True   # 其餘大寫，安全
            return False                                 # 其餘小寫，保守不安全
        else:
            # 純規則降級
            if nw_clean in COORD:   return True
            if nw_clean in SUBORD:  return False
            return next_word_raw[0].isupper() if next_word_raw else True

    new_segments = []
    st = {'s': None, 'e': None, 't': '', 'wc': 0, 'lw': '', 'waiting': False}

    def do_flush():
        txt = st['t'].strip()
        if not txt:
            return
        ws = txt.split()
        fw_raw   = ws[0] if ws else ''
        fw_clean = fw_raw.lower().rstrip('.,!?;:')
        is_fragment = (
            len(ws) < min_words or
            (fw_raw[0].islower() and fw_clean in CS)
        )
        if is_fragment and new_segments:
            new_segments[-1]['text'] = new_segments[-1]['text'].rstrip() + ' ' + txt
            new_segments[-1]['end']  = st['e']
        else:
            new_segments.append({'start': st['s'], 'end': st['e'], 'text': txt})
        st['s'] = None; st['e'] = None; st['t'] = ''
        st['wc'] = 0;   st['lw'] = '';  st['waiting'] = False

    def peek_next(word_list, pos):
        """取 pos 之後第一個非空詞，保留原始大小寫，去掉標點。"""
        for wi in word_list[pos:]:
            nw = (wi.get('word','') if isinstance(wi,dict) else wi.word).strip()
            if nw:
                return nw.rstrip('.,!?;:')
        return ''

    for segment in segments:
        words = None
        if hasattr(segment, 'words') and segment.words:
            words = [{'word': w.word, 'start': w.start, 'end': w.end}
                     for w in segment.words]
        elif isinstance(segment, dict) and 'words' in segment and segment['words']:
            words = segment['words']

        if not words:
            text      = (segment.text  if hasattr(segment,'text')  else segment['text']).strip()
            seg_start = (segment.start if hasattr(segment,'start') else segment['start'])
            seg_end   = (segment.end   if hasattr(segment,'end')   else segment['end'])
            parts = re.split(r'([.!?,;:])', text)
            subs, tmp = [], ''
            for p in parts:
                tmp += p
                if p in '.!?,;:' and tmp.strip():
                    subs.append(tmp.strip()); tmp = ''
            if tmp.strip():
                subs.append(tmp.strip())
            dur = seg_end - seg_start
            tpp = dur / max(len(subs), 1)
            for i, sub in enumerate(subs):
                new_segments.append({
                    'start': seg_start + i * tpp,
                    'end':   seg_start + (i+1) * tpp,
                    'text':  sub,
                })
            continue

        for idx, wi in enumerate(words):
            w  = (wi.get('word','') if isinstance(wi,dict) else wi.word).strip()
            if not w:
                continue
            ws = wi.get('start') if isinstance(wi,dict) else wi.start
            we = wi.get('end')   if isinstance(wi,dict) else wi.end
            if ws is None:
                ts = wi.get('timestamp',[None,None]); ws,we = ts[0],ts[1]
            if ws is None:
                continue
            if we is None:
                we = ws

            wclean = w.lower().rstrip('.,!?;:')
            es = w[-1] in SE
            ep = w[-1] in PP

            if st['s'] is None:
                st['s'] = ws; st['e'] = we

            nw_raw = peek_next(words, idx + 1)

            # ══ 規則 A：句尾標點 → 無條件立刻斷 ══
            if es:
                st['e'] = we; st['t'] += ' ' + w; st['lw'] = wclean
                do_flush(); continue

            # ── 觸發待斷模式 ──
            if (st['wc'] >= max_words) or ((we - st['s']) > max_duration):
                st['waiting'] = True

            # ══ 規則 B：待斷模式 ══
            if st['waiting']:
                emergency = st['wc'] >= 25
                if ep and (emergency or is_safe_break(nw_raw)):
                    st['e'] = we; st['t'] += ' ' + w; st['lw'] = wclean
                    do_flush(); continue
                if st['t'] and (ws - st['e']) > max_gap:
                    st['e'] = we; st['t'] += ' ' + w; st['lw'] = wclean
                    do_flush(); continue

            # ══ 規則 C：正常模式，時間間隔斷句 ══
            if st['t'] and (ws - st['e']) > max_gap:
                jg = (st['lw'] in JW) and (st['wc'] < 6)
                if not jg:
                    do_flush()
                    st['s'] = ws; st['e'] = we; st['t'] = w; st['wc'] = 1; st['lw'] = wclean
                    continue

            # ── 正常加詞 ──
            st['e'] = we; st['t'] += ' ' + w; st['wc'] += 1; st['lw'] = wclean

    if st['t'].strip():
        new_segments.append({'start': st['s'], 'end': st['e'], 'text': st['t'].strip()})

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
