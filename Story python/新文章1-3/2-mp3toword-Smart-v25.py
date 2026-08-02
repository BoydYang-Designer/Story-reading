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
    canvas.bind('<Enter>', lambda e: canvas.bind_all('<MouseWheel>',
        lambda ev: canvas.yview_scroll(int(-1*(ev.delta/120)), 'units')))
    canvas.bind('<Leave>', lambda e: canvas.unbind_all('<MouseWheel>'))

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

    # ════════════════════════════════════════════════════════════
    # Tab 3：斷點編輯器（左右雙欄 v22-r2）
    # ════════════════════════════════════════════════════════════
    tab_edit = tk.Frame(nb, bg='#0d1117')
    nb.add(tab_edit, text='  ✂ 斷點編輯  ')

    # ── seg 資料結構 ──
    # { 'start','end','text',
    #   'origins': [{'start','end','text'}, ...]  合併歷史
    #   'split_group': int | None                 同一拆分群組的 id
    #   'split_first': bool                       是否為群組第一條（顯示還原按鈕）
    #   'id': int }
    _seg_id_counter    = [0]
    _split_group_counter = [0]

    def new_id():
        _seg_id_counter[0] += 1
        return _seg_id_counter[0]

    def new_group():
        _split_group_counter[0] += 1
        return _split_group_counter[0]

    def make_seg(start, end, text, origins=None, split_group=None, split_first=False):
        o = origins if origins is not None else [{'start': start, 'end': end, 'text': text}]
        return {'start': start, 'end': end, 'text': text,
                'origins': o, 'split_group': split_group,
                'split_first': split_first, 'id': new_id()}

    # 左欄快照（固定不變，唯讀參考）
    if new_segs:
        _origin_segs = [{'start': s, 'end': e, 'text': t} for s, e, t in new_segs]
        edited_segs  = [make_seg(s, e, t) for s, e, t in new_segs]
    elif old_segs:
        _origin_segs = [{'start': s, 'end': e, 'text': t} for s, e, t in old_segs]
        edited_segs  = [make_seg(s, e, t) for s, e, t in old_segs]
    else:
        _origin_segs = []
        edited_segs  = []

    MAX_UNDO = 5

    edit_state = {
        'segs':           edited_segs,
        'card_widgets':   [],
        'hover_seg_idx':  None,
        'hover_word_idx': None,
        'undo_stack':     [],
    }

    def fmt_time(sec):
        m_ = int(sec // 60); s_ = sec % 60
        return f'{m_:02d}:{s_:05.2f}'

    # ── 顏色 ──
    COLOR = {
        'normal': {'card': '#161b22', 'txt_bg': '#1c2129', 'txt_fg': '#e6edf3',
                   'badge_bg': None,      'badge_fg': None,      'badge': ''},
        'merged': {'card': '#1e1a2e', 'txt_bg': '#231e35', 'txt_fg': '#d4b8f0',
                   'badge_bg': '#3a2060', 'badge_fg': '#c792ea', 'badge': '⊕ 已合併'},
        'split':  {'card': '#0a1e30', 'txt_bg': '#0d2438', 'txt_fg': '#7dd8f0',
                   'badge_bg': '#0a3a50', 'badge_fg': '#56c8ea', 'badge': '✂ 已拆分'},
    }

    def seg_kind(seg):
        if len(seg.get('origins', [])) > 1: return 'merged'
        if seg.get('split_group') is not None: return 'split'
        return 'normal'

    # ── 說明列 ──
    info_fr = tk.Frame(tab_edit, bg='#161b22', pady=5)
    info_fr.pack(fill=tk.X)
    tk.Label(info_fr,
             text='✂ 斷點編輯器  —  左側原始對照（唯讀），右側可編輯。完成後按底部「✏️ 使用自訂版本」',
             font=('Microsoft JhengHei', 10, 'bold'),
             bg='#161b22', fg='#e8c44a', padx=12).pack(anchor='w')
    hint_fr = tk.Frame(info_fr, bg='#161b22')
    hint_fr.pack(fill=tk.X, padx=12, pady=(1, 3))
    for txt, fg_c in [
        ('滑鼠移到詞語間隙出現 ✂，按 Enter 或點擊切斷', '#79c0ff'),
        ('  ｜  ', '#444'),
        ('🔗 合併：點兩條之間的合併按鈕', '#d4b8f0'),
        ('  ｜  ', '#444'),
        ('↩ 還原拆分 / 還原合併：卡片內按鈕', '#ff8c00'),
    ]:
        tk.Label(hint_fr, text=txt, bg='#161b22', fg=fg_c,
                 font=('Microsoft JhengHei', 9)).pack(side=tk.LEFT)

    # ── 工具列（undo / reset） ──
    toolbar = tk.Frame(tab_edit, bg='#21262d', pady=3)
    toolbar.pack(fill=tk.X)

    undo_btn = tk.Button(toolbar, text='⬅ 上一步',
                         font=('Microsoft JhengHei', 9, 'bold'),
                         bg='#2d333b', fg='#cdd9e5',
                         activebackground='#444c56', activeforeground='white',
                         bd=0, padx=12, pady=4, cursor='hand2',
                         state=tk.DISABLED)
    undo_btn.pack(side=tk.LEFT, padx=(8, 4))

    reset_btn = tk.Button(toolbar, text='🔄 重新編輯',
                          font=('Microsoft JhengHei', 9, 'bold'),
                          bg='#2d333b', fg='#cdd9e5',
                          activebackground='#444c56', activeforeground='white',
                          bd=0, padx=12, pady=4, cursor='hand2')
    reset_btn.pack(side=tk.LEFT, padx=4)

    seg_count_var = tk.StringVar(value='')
    tk.Label(toolbar, textvariable=seg_count_var,
             bg='#21262d', fg='#8b949e',
             font=('Microsoft JhengHei', 9)).pack(side=tk.RIGHT, padx=12)

    # ── 左右 PanedWindow ──
    edit_paned = tk.PanedWindow(tab_edit, orient=tk.HORIZONTAL,
                                sashwidth=5, bg='#30363d', sashrelief=tk.FLAT)
    edit_paned.pack(fill=tk.BOTH, expand=True)

    # ─── 左側（唯讀） ──────────────────────────────
    left_outer = tk.Frame(edit_paned, bg='#0d1117')
    edit_paned.add(left_outer, minsize=180)

    tk.Label(left_outer,
             text=f'  📄 新版轉錄（{len(_origin_segs)} 條）— 唯讀參考',
             font=('Microsoft JhengHei', 10, 'bold'),
             bg='#1c2f1c', fg='#56d364', pady=4).pack(fill=tk.X)

    left_canvas = tk.Canvas(left_outer, bg='#0d1117', highlightthickness=0)
    left_vsb    = tk.Scrollbar(left_outer, orient=tk.VERTICAL, command=left_canvas.yview)
    left_canvas.configure(yscrollcommand=left_vsb.set)
    left_vsb.pack(side=tk.RIGHT, fill=tk.Y)
    left_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    left_inner = tk.Frame(left_canvas, bg='#0d1117')
    _lcw = left_canvas.create_window((0, 0), window=left_inner, anchor='nw')
    left_canvas.bind('<Configure>',  lambda e: left_canvas.itemconfig(_lcw, width=e.width))
    left_inner.bind('<Configure>',   lambda e: left_canvas.configure(
                                         scrollregion=left_canvas.bbox('all')))

    # ─── 右側（編輯） ──────────────────────────────
    right_outer = tk.Frame(edit_paned, bg='#0d1117')
    edit_paned.add(right_outer, minsize=220)

    right_title_var = tk.StringVar()
    tk.Label(right_outer,
             textvariable=right_title_var,
             font=('Microsoft JhengHei', 10, 'bold'),
             bg='#1a1a2e', fg='#79c0ff', pady=4).pack(fill=tk.X)

    right_canvas = tk.Canvas(right_outer, bg='#0d1117', highlightthickness=0)
    right_vsb    = tk.Scrollbar(right_outer, orient=tk.VERTICAL, command=right_canvas.yview)
    right_canvas.configure(yscrollcommand=right_vsb.set)
    right_vsb.pack(side=tk.RIGHT, fill=tk.Y)
    right_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    right_inner = tk.Frame(right_canvas, bg='#0d1117')
    _rcw = right_canvas.create_window((0, 0), window=right_inner, anchor='nw')
    right_canvas.bind('<Configure>', lambda e: right_canvas.itemconfig(_rcw, width=e.width))
    right_inner.bind('<Configure>',  lambda e: right_canvas.configure(
                                         scrollregion=right_canvas.bbox('all')))

    # 滾輪各自作用
    def _bind_wheel(c):
        c.bind('<Enter>', lambda e, cv=c: cv.bind_all('<MouseWheel>',
               lambda ev, cv2=c: cv2.yview_scroll(int(-1*(ev.delta/120)), 'units')))
        c.bind('<Leave>', lambda e, cv=c: cv.unbind_all('<MouseWheel>'))
    _bind_wheel(left_canvas)
    _bind_wheel(right_canvas)

    # ── Snapshot / Undo ──
    def _snapshot():
        import copy
        stack = edit_state['undo_stack']
        stack.append(copy.deepcopy(edit_state['segs']))
        if len(stack) > MAX_UNDO:
            stack.pop(0)

    def _update_undo_btn():
        undo_btn.config(state=tk.NORMAL if edit_state['undo_stack'] else tk.DISABLED)

    # ── 捲動輔助 ──
    def _get_right_scroll():
        try: return right_canvas.yview()[0]
        except: return 0.0

    def _restore_right_scroll(frac):
        def _do():
            try:
                right_canvas.update_idletasks()
                right_canvas.yview_moveto(frac)
            except: pass
        right_canvas.after(40, _do)

    def _scroll_to_seg_id(seg_id):
        if seg_id is None: return
        def _do():
            for cw, si in edit_state['card_widgets']:
                segs = edit_state['segs']
                if si < len(segs) and segs[si]['id'] == seg_id:
                    try:
                        right_canvas.update_idletasks()
                        cy = cw.winfo_y()
                        ch = right_canvas.winfo_height()
                        th = right_inner.winfo_height()
                        if th > 0:
                            right_canvas.yview_moveto(
                                max(0.0, min(1.0, (cy - ch // 3) / th)))
                    except: pass
                    break
        right_canvas.after(50, _do)

    # ── 資料操作 ──
    def do_split(seg_idx, word_idx):
        """在 word_idx 後切開，產生帶同一 split_group 的兩條。"""
        segs  = edit_state['segs']
        seg   = segs[seg_idx]
        words = seg['text'].split()
        if word_idx < 0 or word_idx >= len(words) - 1:
            return
        _snapshot()
        grp      = seg.get('split_group') or new_group()
        is_first = seg.get('split_first', False) or (seg.get('split_group') is None)
        text_a   = ' '.join(words[:word_idx + 1])
        text_b   = ' '.join(words[word_idx + 1:])
        ratio    = (word_idx + 1) / len(words)
        mid      = seg['start'] + (seg['end'] - seg['start']) * ratio
        orig_origins = seg.get('origins') or [{'start': seg['start'],
                                                'end':   seg['end'],
                                                'text':  seg['text']}]
        seg_a = make_seg(seg['start'], mid,       text_a,
                         origins=orig_origins, split_group=grp, split_first=is_first)
        seg_b = make_seg(mid,          seg['end'], text_b,
                         origins=orig_origins, split_group=grp, split_first=False)
        edit_state['segs'] = segs[:seg_idx] + [seg_a, seg_b] + segs[seg_idx + 1:]
        edit_state['hover_seg_idx']  = None
        edit_state['hover_word_idx'] = None
        _update_undo_btn()
        rebuild_edit_ui(target_seg_id=seg_b['id'])

    def do_merge(idx):
        segs = edit_state['segs']
        if idx + 1 >= len(segs): return
        _snapshot()
        a, b = segs[idx], segs[idx + 1]
        merged_origins = (a.get('origins') or [{'start':a['start'],'end':a['end'],'text':a['text']}]) + \
                         (b.get('origins') or [{'start':b['start'],'end':b['end'],'text':b['text']}])
        merged = make_seg(a['start'], b['end'],
                          a['text'].rstrip() + ' ' + b['text'].lstrip(),
                          origins=merged_origins)
        edit_state['segs'] = segs[:idx] + [merged] + segs[idx + 2:]
        _update_undo_btn()
        rebuild_edit_ui(target_seg_id=merged['id'])

    def do_restore_split(seg_idx):
        """還原整個拆分群組 → 合回最原始那一條。"""
        segs = edit_state['segs']
        seg  = segs[seg_idx]
        grp  = seg.get('split_group')
        if grp is None: return
        _snapshot()
        group_indices = [i for i, s in enumerate(segs) if s.get('split_group') == grp]
        if not group_indices: return
        first    = segs[group_indices[0]]
        orig     = first.get('origins') or [{'start': first['start'],
                                              'end':   first['end'],
                                              'text':  first['text']}]
        restored_text = orig[0]['text']
        restored_seg  = make_seg(segs[group_indices[0]]['start'],
                                 segs[group_indices[-1]]['end'],
                                 restored_text)
        new_list = [s for i, s in enumerate(segs) if i not in group_indices]
        insert_at = group_indices[0]
        new_list  = new_list[:insert_at] + [restored_seg] + new_list[insert_at:]
        edit_state['segs'] = new_list
        _update_undo_btn()
        rebuild_edit_ui(target_seg_id=restored_seg['id'])

    def do_restore_merge(seg_idx):
        """還原合併 → 拆回合併前所有條。"""
        segs    = edit_state['segs']
        seg     = segs[seg_idx]
        origins = seg.get('origins', [])
        if len(origins) <= 1: return
        _snapshot()
        restored = [make_seg(o['start'], o['end'], o['text']) for o in origins]
        edit_state['segs'] = segs[:seg_idx] + restored + segs[seg_idx + 1:]
        _update_undo_btn()
        rebuild_edit_ui(target_seg_id=restored[0]['id'])

    def do_undo():
        stack = edit_state['undo_stack']
        if not stack: return
        edit_state['segs'] = stack.pop()
        edit_state['hover_seg_idx']  = None
        edit_state['hover_word_idx'] = None
        _update_undo_btn()
        rebuild_edit_ui()

    def do_reset():
        if not messagebox.askyesno('重新編輯',
                                   '確定要放棄所有編輯，重置為初始狀態嗎？',
                                   icon='warning'):
            return
        import copy
        edit_state['segs']           = [make_seg(s['start'], s['end'], s['text'])
                                        for s in _origin_segs]
        edit_state['undo_stack']     = []
        edit_state['hover_seg_idx']  = None
        edit_state['hover_word_idx'] = None
        _update_undo_btn()
        rebuild_edit_ui()

    undo_btn.config(command=do_undo)
    reset_btn.config(command=do_reset)

    # ── 左側渲染（只建一次） ──
    def build_left_panel():
        for w in left_inner.winfo_children():
            w.destroy()
        for i, seg in enumerate(_origin_segs):
            row_bg = '#161b22' if i % 2 == 0 else '#12191f'
            row = tk.Frame(left_inner, bg=row_bg, padx=8, pady=5,
                           bd=1, relief=tk.SOLID)
            row.pack(fill=tk.X, padx=6, pady=(4, 0))
            tk.Label(row,
                     text=f"[{fmt_time(seg['start'])} → {fmt_time(seg['end'])}]",
                     bg=row_bg, fg='#3a7fba',
                     font=('Consolas', 8)).pack(anchor='w')
            tk.Label(row, text=seg['text'],
                     bg=row_bg, fg='#8b949e',
                     font=('Microsoft JhengHei', 10),
                     wraplength=380, justify=tk.LEFT, anchor='w').pack(
                         fill=tk.X, padx=4, pady=(2, 0))
        tk.Frame(left_inner, bg='#0d1117', height=16).pack()
        def _refresh_left():
            try:
                left_inner.update_idletasks()
                left_canvas.configure(scrollregion=left_canvas.bbox('all'))
            except: pass
        left_canvas.after(50, _refresh_left)

    # ── 右側渲染 ──
    def rebuild_edit_ui(preserve_scroll=False, target_seg_id=None):
        scroll_frac = _get_right_scroll() if preserve_scroll else None

        for w in right_inner.winfo_children():
            w.destroy()
        edit_state['card_widgets'] = []

        segs = edit_state['segs']
        right_title_var.set(f'  ✏️ 編輯中（{len(segs)} 條）')
        seg_count_var.set(f'共 {len(segs)} 條  |  原始 {len(_origin_segs)} 條'
                          f'  |  undo {len(edit_state["undo_stack"])}/{MAX_UNDO}')

        for idx, seg in enumerate(segs):
            kind    = seg_kind(seg)
            C       = COLOR[kind]
            card_bg = C['card']
            txt_bg  = C['txt_bg']
            txt_fg  = C['txt_fg']

            card = tk.Frame(right_inner, bg=card_bg, bd=1,
                            relief=tk.SOLID, padx=6, pady=4)
            card.pack(fill=tk.X, padx=6, pady=(4, 0))
            edit_state['card_widgets'].append((card, idx))

            # ── 標頭 ──
            hdr = tk.Frame(card, bg=card_bg)
            hdr.pack(fill=tk.X)
            tk.Label(hdr,
                     text=f"  [{fmt_time(seg['start'])} → {fmt_time(seg['end'])}]",
                     bg=card_bg, fg='#58a6ff',
                     font=('Consolas', 9), anchor='w').pack(side=tk.LEFT)
            if C['badge']:
                origins = seg.get('origins', [])
                n_lbl = f' {len(origins)} 條' if kind == 'merged' else ''
                tk.Label(hdr,
                         text=f" {C['badge']}{n_lbl} ",
                         bg=C['badge_bg'], fg=C['badge_fg'],
                         font=('Microsoft JhengHei', 8, 'bold'),
                         padx=4, pady=1).pack(side=tk.LEFT, padx=6)

            # ── 文字區：tk.Text，詞語間隙 hover ✂ + Enter/點擊切斷 ──
            words = seg['text'].split()
            txt_w = tk.Text(card,
                            bg=txt_bg, fg=txt_fg,
                            font=('Microsoft JhengHei', 11),
                            wrap=tk.WORD,
                            relief=tk.FLAT,
                            cursor='arrow',
                            padx=8, pady=6,
                            height=1,
                            state=tk.NORMAL,
                            exportselection=False,
                            takefocus=False)
            txt_w.pack(fill=tk.X, pady=(3, 0))

            for wi, word in enumerate(words):
                is_last = (wi == len(words) - 1)
                wtag = f'w{idx}_{wi}'
                txt_w.insert(tk.END, word, wtag)
                if not is_last:
                    gtag = f'g{idx}_{wi}'
                    txt_w.insert(tk.END, ' ', gtag)
                else:
                    txt_w.insert(tk.END, ' ')

            txt_w.config(state=tk.DISABLED)

            # 同步調整行高
            def _fit(tw=txt_w):
                try:
                    tw.update_idletasks()
                    lines = int(tw.index('end-1c').split('.')[0])
                    tw.config(height=max(1, lines))
                except: pass
            _fit()

            # 間隙 hover 事件
            for wi in range(len(words) - 1):
                gtag = f'g{idx}_{wi}'
                wtag = f'w{idx}_{wi}'

                def _genter(e, tw=txt_w, gt=gtag, wt=wtag, si=idx, wi_=wi,
                            obg=txt_bg, ofg=txt_fg):
                    tw.tag_config(wt, background='#2a1e00', foreground='#ffb340')
                    tw.tag_config(gt, background='#b85c00', foreground='#fff',
                                  font=('Microsoft JhengHei', 10, 'bold'))
                    tw.config(state=tk.NORMAL)
                    r = tw.tag_ranges(gt)
                    if r:
                        tw.delete(r[0], r[1])
                        tw.insert(r[0], '✂', gt)
                    tw.config(state=tk.DISABLED)
                    edit_state['hover_seg_idx']  = si
                    edit_state['hover_word_idx'] = wi_

                def _gleave(e, tw=txt_w, gt=gtag, wt=wtag, obg=txt_bg, ofg=txt_fg):
                    tw.tag_config(wt, background=obg, foreground=ofg)
                    tw.tag_config(gt, background=obg, foreground=ofg,
                                  font=('Microsoft JhengHei', 11))
                    tw.config(state=tk.NORMAL)
                    r = tw.tag_ranges(gt)
                    if r:
                        tw.delete(r[0], r[1])
                        tw.insert(r[0], ' ', gt)
                    tw.config(state=tk.DISABLED)

                def _gclick(e, si=idx, wi_=wi):
                    do_split(si, wi_)

                txt_w.tag_bind(gtag, '<Enter>',    _genter)
                txt_w.tag_bind(gtag, '<Leave>',    _gleave)
                txt_w.tag_bind(gtag, '<Button-1>', _gclick)
                txt_w.tag_config(gtag, cursor='sb_h_double_arrow')

            # ── 還原拆分（只在群組第一條顯示） ──
            if kind == 'split' and seg.get('split_first', False):
                grp       = seg['split_group']
                grp_count = sum(1 for s in segs if s.get('split_group') == grp)
                orig_text = (seg.get('origins') or [{}])[0].get('text', '')
                preview   = orig_text[:40] + ('…' if len(orig_text) > 40 else '')
                sp_fr = tk.Frame(card, bg='#0a2a40', padx=6, pady=3)
                sp_fr.pack(fill=tk.X, pady=(4, 0))
                tk.Label(sp_fr,
                         text=f'原始（共拆成 {grp_count} 條）：「{preview}」',
                         bg='#0a2a40', fg='#56c8ea',
                         font=('Microsoft JhengHei', 8),
                         wraplength=500, justify=tk.LEFT).pack(
                             side=tk.LEFT, fill=tk.X, expand=True)
                tk.Button(sp_fr, text='↩ 還原拆分',
                          font=('Microsoft JhengHei', 9, 'bold'),
                          bg='#0a3a50', fg='#7dd8f0',
                          activebackground='#0e5070', activeforeground='white',
                          bd=0, padx=8, pady=2, cursor='hand2',
                          command=lambda si=idx: do_restore_split(si)).pack(
                              side=tk.RIGHT, padx=4)

            # ── 還原合併 ──
            if kind == 'merged':
                origins = seg.get('origins', [])
                preview = '  /  '.join(
                    f'「{o["text"][:20]}{"…" if len(o["text"])>20 else ""}」'
                    for o in origins[:3])
                if len(origins) > 3:
                    preview += f'  …共{len(origins)}條'
                mg_fr = tk.Frame(card, bg='#2a1e40', padx=6, pady=3)
                mg_fr.pack(fill=tk.X, pady=(4, 0))
                tk.Label(mg_fr, text=f'原始：{preview}',
                         bg='#2a1e40', fg='#9e7ac7',
                         font=('Microsoft JhengHei', 8),
                         wraplength=500, justify=tk.LEFT).pack(
                             side=tk.LEFT, fill=tk.X, expand=True)
                tk.Button(mg_fr, text='↩ 還原合併',
                          font=('Microsoft JhengHei', 9, 'bold'),
                          bg='#5a3a80', fg='#e0c9ff',
                          activebackground='#7a4aaa', activeforeground='white',
                          bd=0, padx=8, pady=2, cursor='hand2',
                          command=lambda si=idx: do_restore_merge(si)).pack(
                              side=tk.RIGHT, padx=4)

            # ── 卡片間合併按鈕 ──
            if idx < len(segs) - 1:
                mr = tk.Frame(right_inner, bg='#0d1117')
                mr.pack(fill=tk.X, padx=6)
                tk.Frame(mr, bg='#21262d', height=1).pack(
                    side=tk.LEFT, fill=tk.X, expand=True, pady=4)
                tk.Button(mr, text='🔗 合併這兩條',
                          font=('Microsoft JhengHei', 8),
                          bg='#1f3a5f', fg='#79c0ff',
                          activebackground='#2d5986', activeforeground='white',
                          bd=0, padx=8, pady=2, cursor='hand2',
                          command=lambda mi=idx: do_merge(mi)).pack(
                              side=tk.LEFT, padx=6)
                tk.Frame(mr, bg='#21262d', height=1).pack(
                    side=tk.LEFT, fill=tk.X, expand=True, pady=4)

        # 底部佔位
        tk.Frame(right_inner, bg='#0d1117', height=20).pack()

        # 強制刷新 scrollregion
        def _refresh_right():
            try:
                right_inner.update_idletasks()
                right_canvas.configure(scrollregion=right_canvas.bbox('all'))
            except: pass
        right_canvas.after(50, _refresh_right)

        # 捲動恢復
        if target_seg_id is not None:
            _scroll_to_seg_id(target_seg_id)
        elif scroll_frac is not None:
            _restore_right_scroll(scroll_frac)

    # ── Enter 鍵切斷 ──
    def _on_enter_key(event):
        si = edit_state.get('hover_seg_idx')
        wi = edit_state.get('hover_word_idx')
        if si is not None and wi is not None:
            do_split(si, wi)
    tab_edit.bind_all('<Return>', _on_enter_key)

    # ── 預設顯示智慧比對 ──
    nb.select(0)

    # ── 按鈕區 ──
    btn = tk.Frame(win, bg='#f0f0f0', pady=10)
    btn.pack(fill=tk.X)

    # 用於儲存「編輯前」snapshot，供編輯後比對用
    edit_state['snapshot_before'] = None   # list of (start,end,text)

    def _segs_to_lines(segs):
        """把 seg 列表轉成時間戳記行清單，用於比對顯示。"""
        lines = []
        for seg in segs:
            s = format_timestamp(seg['start'])
            e = format_timestamp(seg['end'])
            lines.append(f"[{s} --> {e}] {seg['text'].strip()}")
        return '\n'.join(lines)

    def on_enter_edit_tab(event):
        """進入編輯 Tab 時，記錄 snapshot_before。"""
        selected = nb.index(nb.select())
        if selected == 2:   # Tab 3 = 斷點編輯
            if edit_state['snapshot_before'] is None:
                edit_state['snapshot_before'] = [
                    {'start': s['start'], 'end': s['end'], 'text': s['text']}
                    for s in edit_state['segs']
                ]

    nb.bind('<<NotebookTabChanged>>', on_enter_edit_tab)

    def show_edit_result_diff():
        """
        顯示「編輯前 vs 編輯後」比對視窗。
        使用者在這裡決定是否採用編輯結果。
        回傳 True（採用）/ False（放棄）。
        """
        before = edit_state.get('snapshot_before')
        after  = edit_state['segs']

        before_text = _segs_to_lines(before) if before else ''
        after_text  = _segs_to_lines(after)

        if before_text.strip() == after_text.strip():
            # 沒有任何變更
            return messagebox.askyesno(
                "編輯結果",
                "你在編輯器中沒有做任何變更。\n\n仍要使用此版本嗎？",
                icon='question'
            )

        adopt = {'val': False}

        dwin = tk.Toplevel(win)
        dwin.title("📋 編輯前後比對 — 確認是否採用")
        dwin.geometry("1100x680")
        dwin.resizable(True, True)
        dwin.grab_set()

        tk.Label(dwin,
                 text='請確認編輯結果，再決定是否採用',
                 font=('Microsoft JhengHei', 12, 'bold'),
                 bg='#1a252f', fg='white', pady=8).pack(fill=tk.X)

        paned2 = tk.PanedWindow(dwin, orient=tk.VERTICAL, sashwidth=5, bg='#555')
        paned2.pack(fill=tk.BOTH, expand=True, padx=8, pady=4)

        def make_pane(parent, title, color, content):
            f = tk.Frame(parent)
            tk.Label(f, text=title,
                     font=('Microsoft JhengHei', 10, 'bold'),
                     bg=color, fg='white', pady=4).pack(fill=tk.X)
            t = scrolledtext.ScrolledText(f, wrap=tk.WORD, font=('Consolas', 10),
                                          bg='#fdfefe', relief=tk.FLAT)
            t.pack(fill=tk.BOTH, expand=True)
            t.insert(tk.END, content)
            t.config(state=tk.DISABLED)
            return f

        pane_b = make_pane(paned2, f'  編輯前（{len(before) if before else 0} 條）', '#7f8c8d', before_text)
        pane_a = make_pane(paned2, f'  編輯後（{len(after)} 條）', '#8e44ad', after_text)
        paned2.add(pane_b, minsize=80)
        paned2.add(pane_a, minsize=80)

        # 統計
        bc = len(before) if before else 0
        ac = len(after)
        diff_msg = f'段落數：{bc} → {ac}（{"+" if ac>=bc else ""}{ac-bc}）'
        tk.Label(dwin, text=diff_msg,
                 font=('Microsoft JhengHei', 10),
                 bg='#ecf0f1', fg='#555', pady=4).pack(fill=tk.X, padx=8)

        btn2 = tk.Frame(dwin, bg='#f0f0f0', pady=8)
        btn2.pack(fill=tk.X)

        def _adopt():
            adopt['val'] = True
            dwin.destroy()

        def _discard():
            adopt['val'] = False
            dwin.destroy()

        tk.Button(btn2, text='✅ 採用編輯結果',
                  font=('Microsoft JhengHei', 11, 'bold'),
                  bg='#8e44ad', fg='white', padx=20, pady=6,
                  command=_adopt).pack(side=tk.LEFT, padx=20)
        tk.Button(btn2, text='❌ 放棄編輯，回到比對視窗',
                  font=('Microsoft JhengHei', 11, 'bold'),
                  bg='#7f8c8d', fg='white', padx=20, pady=6,
                  command=_discard).pack(side=tk.LEFT, padx=5)

        dwin.wait_window()
        return adopt['val']

    def choose(val, custom_segs=None):
        result['choice'] = val
        if custom_segs is not None:
            result['custom_segs'] = custom_segs
        win.destroy()

    def on_use_custom():
        """點「使用自訂版本」：先顯示編輯前後比對，確認後才採用。"""
        if show_edit_result_diff():
            choose('custom', edit_state['segs'])

    tk.Button(btn, text='✅ 使用新版本（覆蓋舊檔）',
              font=('Microsoft JhengHei',11,'bold'),
              bg='#27ae60', fg='white', padx=20, pady=6,
              command=lambda: choose('new')).pack(side=tk.LEFT, padx=20)
    tk.Button(btn, text='🔒 保留舊版本（不覆蓋）',
              font=('Microsoft JhengHei',11,'bold'),
              bg='#c0392b', fg='white', padx=20, pady=6,
              command=lambda: choose('old')).pack(side=tk.LEFT, padx=5)
    tk.Button(btn, text='✏️ 使用自訂版本（斷點編輯結果）',
              font=('Microsoft JhengHei', 11, 'bold'),
              bg='#7d4e9e', fg='white', padx=20, pady=6,
              command=on_use_custom).pack(side=tk.LEFT, padx=5)
    tk.Button(btn, text='⏭ 略過此檔',
              font=('Microsoft JhengHei',10),
              bg='#7f8c8d', fg='white', padx=15, pady=6,
              command=lambda: choose('skip')).pack(side=tk.RIGHT, padx=20)

    win.protocol("WM_DELETE_WINDOW", lambda: choose('skip'))

    # 初始渲染
    build_left_panel()
    rebuild_edit_ui()

    win.wait_window()
    return result['choice'], result.get('custom_segs')

def build_word_index(segments):
    """
    從 Whisper segments 中把所有詞的時間資料提取成一個平坦列表。
    回傳 list of {'word': str, 'start': float, 'end': float}
    這份列表在模式4使用，用來為使用者自訂的斷句找精準時間。
    """
    words = []
    for seg in segments:
        ws = None
        if hasattr(seg, 'words') and seg.words:
            ws = [{'word': w.word.strip(), 'start': w.start, 'end': w.end}
                  for w in seg.words if w.word.strip()]
        elif isinstance(seg, dict) and seg.get('words'):
            ws = [{'word': w.get('word','').strip(),
                   'start': w.get('start', 0),
                   'end':   w.get('end', 0)}
                  for w in seg['words'] if w.get('word','').strip()]
        if ws:
            words.extend(ws)
    return words


def show_edit4_dialog(filename, initial_lines):
    """
    模式4 純文字斷句編輯器。
    initial_lines: list of str  (smart_sentence_split 已斷好的各句文字)

    介面：純文字，每句一行，不顯示時間。
    操作：
      · 游標定位後按 Enter → 在游標位置切斷成兩行
      · 行首按 Backspace  → 與上一行合併
      · 行尾按 Delete     → 與下一行合併
    完成後回傳 list of str（每個元素是一行文字），或 None（取消）。
    """
    result = {'lines': None}

    win = tk.Toplevel()
    win.title(f"✂ 模式4 斷句編輯 — {filename}")
    win.geometry("860x680")
    win.resizable(True, True)
    win.grab_set()

    # ── 標題 ──
    hdr = tk.Frame(win, bg='#1a252f', pady=8)
    hdr.pack(fill=tk.X)
    tk.Label(hdr, text=f"✂  {filename}",
             font=('Microsoft JhengHei', 13, 'bold'),
             fg='white', bg='#1a252f').pack()
    tk.Label(hdr,
             text='在句子中間點一下定位游標，按 Enter 切斷成兩句  ／  行首 Backspace 與上一句合併  ／  行尾 Delete 與下一句合併',
             font=('Microsoft JhengHei', 10), fg='#95a5a6', bg='#1a252f').pack()

    # ── 工具列 ──
    toolbar = tk.Frame(win, bg='#21262d', pady=4)
    toolbar.pack(fill=tk.X)

    line_count_var = tk.StringVar(value='')
    tk.Label(toolbar, textvariable=line_count_var,
             bg='#21262d', fg='#8b949e',
             font=('Microsoft JhengHei', 10)).pack(side=tk.LEFT, padx=12)

    undo_stack = []   # 每個元素是當時的完整文字快照（字串）

    # ── 主編輯區 ──
    edit_frame = tk.Frame(win, bg='#0d1117')
    edit_frame.pack(fill=tk.BOTH, expand=True, padx=12, pady=8)

    txt = tk.Text(edit_frame,
                  wrap=tk.WORD,
                  font=('Microsoft JhengHei', 14),
                  bg='#1c2129', fg='#e6edf3',
                  insertbackground='white',
                  selectbackground='#2d4a6e',
                  relief=tk.FLAT,
                  padx=16, pady=12,
                  spacing1=4, spacing3=4,
                  undo=False)   # 自己管 undo
    vsb = tk.Scrollbar(edit_frame, orient=tk.VERTICAL, command=txt.yview)
    txt.configure(yscrollcommand=vsb.set)
    vsb.pack(side=tk.RIGHT, fill=tk.Y)
    txt.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

    def _update_count():
        n = txt.get('1.0', tk.END).count('\n')
        # 最後一行若空不算
        content = txt.get('1.0', tk.END).rstrip('\n')
        n = len(content.split('\n')) if content.strip() else 0
        line_count_var.set(f'共 {n} 條斷句')

    def _snapshot():
        undo_stack.append(txt.get('1.0', tk.END))
        if len(undo_stack) > 20:
            undo_stack.pop(0)
        undo_btn.config(state=tk.NORMAL)

    def do_undo():
        if not undo_stack:
            return
        snap = undo_stack.pop()
        txt.delete('1.0', tk.END)
        txt.insert('1.0', snap.rstrip('\n'))
        if not undo_stack:
            undo_btn.config(state=tk.DISABLED)
        _update_count()

    undo_btn = tk.Button(toolbar, text='⬅ 上一步',
                         font=('Microsoft JhengHei', 9, 'bold'),
                         bg='#2d333b', fg='#cdd9e5',
                         activebackground='#444c56', activeforeground='white',
                         bd=0, padx=12, pady=3, cursor='hand2',
                         state=tk.DISABLED, command=do_undo)
    undo_btn.pack(side=tk.LEFT, padx=4)

    # 初始填入
    txt.insert('1.0', '\n'.join(initial_lines))
    _update_count()

    # ── 鍵盤攔截 ──
    def on_enter(event):
        """在游標位置插入換行（切斷）。"""
        _snapshot()
        # 取得游標前的文字位置
        idx = txt.index('insert')
        # 直接插入 \n，讓 Text widget 自己處理
        txt.insert('insert', '\n')
        _update_count()
        return 'break'

    def on_backspace(event):
        """行首按 Backspace：刪掉行首的 \n，即與上一行合併。"""
        idx      = txt.index('insert')
        col      = int(idx.split('.')[1])
        row      = int(idx.split('.')[0])
        if col == 0 and row > 1:
            _snapshot()
            # 刪掉這行前面的 \n（即上一行末尾的換行符）
            prev_end = f'{row - 1}.end'
            txt.delete(prev_end, f'{prev_end}+1c')
            _update_count()
            return 'break'
        # 其他情況走正常刪除
        return

    def on_delete(event):
        """行尾按 Delete：刪掉行尾的 \n，即與下一行合併。"""
        idx     = txt.index('insert')
        eol     = txt.index(f'{idx} lineend')
        if txt.index('insert') == eol:
            _snapshot()
            # 刪掉這行末尾的 \n
            txt.delete(eol, f'{eol}+1c')
            _update_count()
            return 'break'
        return

    def on_ctrl_z(event):
        do_undo()
        return 'break'

    txt.bind('<Return>',    on_enter)
    txt.bind('<BackSpace>', on_backspace)
    txt.bind('<Delete>',    on_delete)
    txt.bind('<Control-z>', on_ctrl_z)
    txt.bind('<Control-Z>', on_ctrl_z)
    # 任何輸入都更新計數
    txt.bind('<KeyRelease>', lambda e: _update_count())

    # ── 底部按鈕 ──
    btn_frame = tk.Frame(win, bg='#f0f0f0', pady=10)
    btn_frame.pack(fill=tk.X)

    def on_save():
        raw     = txt.get('1.0', tk.END).rstrip('\n')
        lines   = [ln.strip() for ln in raw.split('\n') if ln.strip()]
        result['lines'] = lines
        win.destroy()

    def on_cancel():
        result['lines'] = None
        win.destroy()

    tk.Button(btn_frame,
              text='💾 完成編輯，套用精準時間戳記',
              font=('Microsoft JhengHei', 11, 'bold'),
              bg='#27ae60', fg='white', padx=20, pady=6,
              command=on_save).pack(side=tk.LEFT, padx=20)
    tk.Button(btn_frame,
              text='❌ 取消，不儲存',
              font=('Microsoft JhengHei', 11),
              bg='#7f8c8d', fg='white', padx=16, pady=6,
              command=on_cancel).pack(side=tk.LEFT, padx=4)

    win.protocol('WM_DELETE_WINDOW', on_cancel)
    txt.focus_set()
    win.wait_window()
    return result['lines']


def assign_timestamps(edited_lines, word_index):
    """
    根據使用者編輯的斷句（edited_lines，純文字列表）
    和詞級時間索引（word_index，build_word_index 的輸出）
    回傳帶精準時間的段落列表：
    [{'text': str, 'start': float, 'end': float}, ...]

    配對策略：
    - 把 word_index 展平成一個指針序列
    - 依序掃描 edited_lines 的每個詞，在 word_index 裡找最近匹配
    - 每行的 start = 該行第一個詞的 start；end = 最後一個詞的 end
    """
    if not word_index:
        return [{'text': ln, 'start': 0.0, 'end': 0.0} for ln in edited_lines]

    ptr = 0
    N   = len(word_index)
    out = []

    for line_text in edited_lines:
        line_text = line_text.strip()
        if not line_text:
            continue
        words_in_line = line_text.split()
        matched = []

        for wt in words_in_line:
            wt_clean = wt.lower().strip('.,!?;:\'"')
            # 在 word_index 從 ptr 往前找最近匹配（最多往前搜尋 8 個）
            best_offset = None
            for offset in range(min(8, N - ptr)):
                cand = word_index[ptr + offset]['word'].lower().strip('.,!?;:\'"')
                if cand == wt_clean:
                    best_offset = offset
                    break
            if best_offset is not None:
                matched.append(word_index[ptr + best_offset])
                ptr += best_offset + 1
            else:
                # 找不到：沿用上一個詞的 end 估算
                prev_end = matched[-1]['end'] if matched else \
                           (word_index[ptr - 1]['end'] if ptr > 0 else 0.0)
                matched.append({'word': wt, 'start': prev_end, 'end': prev_end + 0.25})

        if matched:
            out.append({
                'text':  line_text,
                'start': matched[0]['start'],
                'end':   matched[-1]['end'],
            })

    return out


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


def smart_sentence_split(segments, max_gap=0.5, max_duration=5.0, max_words=15, min_words=6):
    """
    智能斷句 v7：spaCy 詞性標注 + 語意安全斷點 + 短句整合
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

    【純規則備用】（無 spaCy 時自動降級）

    【待斷模式】詞數 ≥ max_words 或時長 ≥ max_duration 後積極找斷點
    【緊急模式】詞數 ≥ 25 時語意保護全解除
    【殘句合併】小寫接續介詞開頭 → 併入前一條；大寫開頭 → 永遠是新句

    【短句整合 Pass（v7 新增）】
      所有段落產生後，對詞數 < min_words（預設 6）的短句進行整合：
        優先：合併到下一句（若下一句詞數 ≤ 2×max_words）
        次選：合併到上一句（若上一句詞數 ≤ 2×max_words）
        若上下句都超過 2×max_words → 保留短句不動
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

    # ══ 短句整合 Pass（v7）══
    # 對詞數 < min_words 的短句，優先合併到下一句，其次上一句。
    # 但若相鄰句已有 > 2×max_words 個詞，則不整合，避免句子太長。
    _merge_limit = max_words * 2
    changed = True
    while changed:
        changed = False
        i = 0
        while i < len(new_segments):
            seg = new_segments[i]
            wc  = len(seg['text'].split())
            if wc < min_words:
                merged = False
                # 優先：往下合併
                if i + 1 < len(new_segments):
                    nxt = new_segments[i + 1]
                    nxt_wc = len(nxt['text'].split())
                    if nxt_wc <= _merge_limit:
                        merged_seg = {
                            'start': seg['start'],
                            'end':   nxt['end'],
                            'text':  seg['text'].rstrip() + ' ' + nxt['text'].lstrip(),
                        }
                        new_segments = new_segments[:i] + [merged_seg] + new_segments[i + 2:]
                        changed = True
                        merged = True
                # 次選：往上合併
                if not merged and i > 0:
                    prv = new_segments[i - 1]
                    prv_wc = len(prv['text'].split())
                    if prv_wc <= _merge_limit:
                        merged_seg = {
                            'start': prv['start'],
                            'end':   seg['end'],
                            'text':  prv['text'].rstrip() + ' ' + seg['text'].lstrip(),
                        }
                        new_segments = new_segments[:i - 1] + [merged_seg] + new_segments[i + 1:]
                        changed = True
                        merged = True
                if not merged:
                    i += 1
            else:
                i += 1

    return new_segments
def scan_folder_for_mp3(folder_path):
    audio_extensions = ['.mp3', '.wav', '.m4a']
    files = []
    for f in os.listdir(folder_path):
        fp = os.path.join(folder_path, f)
        if os.path.isfile(fp) and os.path.splitext(f)[1].lower() in audio_extensions:
            files.append(fp)
    return sorted(files)


def backup_file(path):
    """將 path 備份為 原檔_filename.ext，若備份已存在則加編號。"""
    if not os.path.exists(path):
        return None
    dir_, filename = os.path.split(path)
    base, ext = os.path.splitext(filename)
    backup_path = os.path.join(dir_, "原檔_" + base + ext)
    if os.path.exists(backup_path):
        n = 2
        while os.path.exists(os.path.join(dir_, f"原檔{n}_" + base + ext)):
            n += 1
        backup_path = os.path.join(dir_, f"原檔{n}_" + base + ext)
    import shutil
    shutil.copy2(path, backup_path)
    return backup_path


def process_audio_file(file_path, model, engine, save_plain, save_timestamp,
                       recheck=False, auto_mode=False, edit_only=False):
    WHISPER_SAMPLE_RATE = 16000
    try:
        directory = os.path.dirname(file_path)
        clean_filename = os.path.splitext(os.path.basename(file_path))[0].strip()
        base_path = os.path.join(directory, clean_filename)

        # 跳過已存在的檔案（recheck / edit_only 模式下不跳過）
        if not recheck and not edit_only:
            files_to_check = []
            if save_plain:
                files_to_check.append(base_path + ".txt")
            if save_timestamp:
                files_to_check.append(base_path + " Timestamp.txt")
            if files_to_check and all(os.path.exists(f) for f in files_to_check):
                print(f"  [跳過] 檔案已存在: {clean_filename}")
                return 'skip_exist'

        # ── 模式4：轉錄 → 純文字斷句編輯 → 精準timestamp ──
        if edit_only:
            # 永遠重新轉錄，取得詞級時間（不讀取舊文檔，不做比對）
            if engine == "whisper":
                import whisper as whisper_lib
                audio    = whisper_lib.load_audio(file_path)
                duration = audio.shape[0] / WHISPER_SAMPLE_RATE
                if duration < 10:
                    print(f"  [跳過] 檔案長度 ({duration:.2f}s) 小於 10 秒。")
                    return 'skip_short'
                print(f"  [模式4] 長度 {duration:.1f}s，開始轉錄...")
                result_w = model.transcribe(
                    audio, language="en", verbose=False,
                    word_timestamps=True, beam_size=5, best_of=5,
                    temperature=0.0, condition_on_previous_text=True,
                    compression_ratio_threshold=2.4, no_speech_threshold=0.6,
                )
                segments = result_w["segments"]
            else:
                try:
                    import soundfile as sf
                    info = sf.info(file_path)
                    duration = info.duration
                except Exception:
                    duration = 99
                if duration < 10:
                    print(f"  [跳過] 檔案長度 ({duration:.2f}s) 小於 10 秒。")
                    return 'skip_short'
                print(f"  [模式4] 長度 {duration:.1f}s，開始轉錄...")
                segments_gen, _ = model.transcribe(
                    file_path, language="en", word_timestamps=True,
                    beam_size=5, best_of=5, temperature=0.0,
                    condition_on_previous_text=True,
                    compression_ratio_threshold=2.4, no_speech_threshold=0.6,
                    vad_filter=True,
                )
                segments = list(segments_gen)

            print("  [模式4] 轉錄完成，建立詞索引...")
            word_idx      = build_word_index(segments)
            smart_segs    = smart_sentence_split(segments, max_gap=0.6,
                                                 max_duration=5.0, max_words=15)
            initial_lines = [s['text'].strip() for s in smart_segs if s['text'].strip()]

            print(f"  [模式4] 共 {len(initial_lines)} 條初始斷句，開啟編輯器...")
            edited = show_edit4_dialog(os.path.basename(file_path), initial_lines)

            if edited is None:
                print(f"  [略過] 使用者取消編輯: {clean_filename}")
                return 'success'

            # 用詞索引分配精準時間
            final_segs = assign_timestamps(edited, word_idx)
            print(f"  [模式4] 編輯完成，共 {len(final_segs)} 條斷句，寫入檔案...")

            if save_timestamp:
                ts_path = base_path + " Timestamp.txt"
                ts_lines = []
                for seg in final_segs:
                    s = format_timestamp(seg['start'])
                    e = format_timestamp(seg['end'])
                    ts_lines.append(f"[{s} --> {e}] {seg['text'].strip()}")
                with open(ts_path, "w", encoding="utf-8") as f:
                    f.write('\n'.join(ts_lines))
                print(f"  [✓] 時間戳記已儲存: {os.path.basename(ts_path)}")

            if save_plain:
                txt_path = base_path + ".txt"
                with open(txt_path, "w", encoding="utf-8") as f:
                    f.write('\n'.join(seg['text'].strip() for seg in final_segs))
                print(f"  [✓] 純文字已儲存: {os.path.basename(txt_path)}")

            return 'success'

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

                if auto_mode and os.path.exists(txt_path):
                    # 全自動：備份舊檔後直接覆蓋
                    bk = backup_file(txt_path)
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    print(f"  [自動覆蓋] 純文字已備份至 {os.path.basename(bk)}，新版已寫入")
                elif recheck and os.path.exists(txt_path):
                    with open(txt_path, "r", encoding="utf-8") as f:
                        old_content = f.read()
                    # v22：即使內容相同，也開比對視窗（使用者可進入編輯模式）
                    print(f"  [比對] 開啟比對視窗: {os.path.basename(txt_path)}")
                    choice, _ = show_diff_dialog(os.path.basename(txt_path), old_content, new_content)
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

                if auto_mode and os.path.exists(ts_path):
                    # 全自動：備份舊檔後直接覆蓋
                    bk = backup_file(ts_path)
                    with open(ts_path, "w", encoding="utf-8") as f:
                        f.write(new_ts_content)
                    print(f"  [自動覆蓋] 時間戳記已備份至 {os.path.basename(bk)}，新版已寫入")
                elif recheck and os.path.exists(ts_path):
                    with open(ts_path, "r", encoding="utf-8") as f:
                        old_ts_content = f.read()
                    # v22：即使內容相同，也開比對視窗（使用者可進入編輯模式）
                    print(f"  [比對] 開啟比對視窗: {os.path.basename(ts_path)}")
                    choice, custom_segs = show_diff_dialog(os.path.basename(ts_path), old_ts_content, new_ts_content)
                    if choice == 'new':
                        with open(ts_path, "w", encoding="utf-8") as f:
                            f.write(new_ts_content)
                        print(f"  [覆蓋] 已使用新時間戳記: {os.path.basename(ts_path)}")
                    elif choice == 'old':
                        print(f"  [保留] 維持舊時間戳記: {os.path.basename(ts_path)}")
                    elif choice == 'custom' and custom_segs:
                        custom_lines = []
                        for seg in custom_segs:
                            s = format_timestamp(seg['start'])
                            e = format_timestamp(seg['end'])
                            custom_lines.append(f"[{s} --> {e}] {seg['text'].strip()}")
                        custom_content = '\n'.join(custom_lines)
                        with open(ts_path, "w", encoding="utf-8") as f:
                            f.write(custom_content)
                        print(f"  [自訂] 已使用自訂斷點版本（{len(custom_segs)} 條）: {os.path.basename(ts_path)}")
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


# ══════════════════════════════════════════════════════════════
#  模式 5：文本斷句違規檢查 + 自動重新轉錄修正
# ══════════════════════════════════════════════════════════════

def mode5_ask_rules():
    """
    詢問使用者是否修改違規判斷規則。
    回傳 (min_words, max_words) 或 None（取消）。
    預設：min_words=6, max_words=25
    """
    DEFAULT_MIN = 6
    DEFAULT_MAX = 25

    result = {'min': DEFAULT_MIN, 'max': DEFAULT_MAX, 'ok': False}

    win = tk.Toplevel()
    win.title("⚙️  模式 5 — 違規規則設定")
    win.geometry("520x420")
    win.resizable(False, False)
    win.grab_set()
    win.configure(bg='#1a252f')

    tk.Label(win, text="⚙️  斷句違規規則設定",
             font=('Microsoft JhengHei', 14, 'bold'),
             bg='#1a252f', fg='white', pady=14).pack()

    tk.Label(win,
             text="以下為違規判斷門檻，任一條句子觸犯即視為「違規」，\n程式將找對應 MP3 重新轉錄並自動覆蓋文本。",
             font=('Microsoft JhengHei', 10),
             bg='#1a252f', fg='#95a5a6', justify=tk.CENTER).pack(pady=(0, 12))

    frame = tk.Frame(win, bg='#243342', bd=1, relief=tk.SOLID)
    frame.pack(fill=tk.X, padx=30, pady=4)

    rows = [
        ("📏 最少詞數（少於此值 → 違規）", 'min', DEFAULT_MIN,
         "預設 6：一條少於 6 個詞視為太短"),
        ("📏 最多詞數（超過此值 → 違規）", 'max', DEFAULT_MAX,
         "預設 25：一條超過 25 個詞視為太長"),
    ]

    vars_ = {}
    for label, key, default, hint in rows:
        row_f = tk.Frame(frame, bg='#243342')
        row_f.pack(fill=tk.X, padx=16, pady=10)
        tk.Label(row_f, text=label,
                 font=('Microsoft JhengHei', 10, 'bold'),
                 bg='#243342', fg='#e8c44a', anchor='w').pack(anchor='w')
        tk.Label(row_f, text=hint,
                 font=('Microsoft JhengHei', 9),
                 bg='#243342', fg='#7f8c8d', anchor='w').pack(anchor='w')
        sv = tk.StringVar(value=str(default))
        vars_[key] = sv
        entry = tk.Entry(row_f, textvariable=sv,
                         font=('Consolas', 12),
                         bg='#1a252f', fg='white', insertbackground='white',
                         relief=tk.FLAT, width=8, justify=tk.CENTER)
        entry.pack(anchor='w', pady=(4, 0))

    err_var = tk.StringVar(value='')
    tk.Label(win, textvariable=err_var,
             font=('Microsoft JhengHei', 9),
             bg='#1a252f', fg='#e74c3c').pack(pady=(8, 0))

    btn_f = tk.Frame(win, bg='#1a252f')
    btn_f.pack(pady=16)

    def on_default():
        vars_['min'].set(str(DEFAULT_MIN))
        vars_['max'].set(str(DEFAULT_MAX))
        err_var.set('')

    def on_ok():
        try:
            mn = int(vars_['min'].get().strip())
            mx = int(vars_['max'].get().strip())
            if mn < 1 or mx < 1:
                err_var.set('❌ 數值必須大於 0')
                return
            if mn >= mx:
                err_var.set(f'❌ 最少詞數（{mn}）必須小於最多詞數（{mx}）')
                return
            result['min'] = mn
            result['max'] = mx
            result['ok']  = True
            win.destroy()
        except ValueError:
            err_var.set('❌ 請輸入整數')

    def on_cancel():
        win.destroy()

    tk.Button(btn_f, text='  恢復預設值  ',
              font=('Microsoft JhengHei', 10),
              bg='#2d333b', fg='#cdd9e5',
              activebackground='#444c56', activeforeground='white',
              bd=0, padx=14, pady=6, cursor='hand2',
              command=on_default).pack(side=tk.LEFT, padx=6)

    tk.Button(btn_f, text='  ✅ 確認，開始掃描  ',
              font=('Microsoft JhengHei', 11, 'bold'),
              bg='#27ae60', fg='white',
              activebackground='#2ecc71', activeforeground='white',
              bd=0, padx=18, pady=6, cursor='hand2',
              command=on_ok).pack(side=tk.LEFT, padx=6)

    tk.Button(btn_f, text='  ❌ 取消  ',
              font=('Microsoft JhengHei', 10),
              bg='#7f8c8d', fg='white',
              activebackground='#95a5a6', activeforeground='white',
              bd=0, padx=14, pady=6, cursor='hand2',
              command=on_cancel).pack(side=tk.LEFT, padx=6)

    win.protocol('WM_DELETE_WINDOW', on_cancel)
    win.wait_window()

    if not result['ok']:
        return None
    return result['min'], result['max']


def mode5_check_violations(ts_path, min_words, max_words):
    """
    讀取 Timestamp.txt，檢查每條是否違規。
    回傳 (has_violation, violation_details)
    violation_details = list of (line_no, word_count, reason, text_preview)
    """
    try:
        with open(ts_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception as e:
        return False, [f'讀取失敗: {e}']

    violations = []
    for i, line in enumerate(lines, 1):
        parsed = parse_ts_line(line)
        if not parsed:
            continue
        _, _, text = parsed
        wc = len(text.split())
        if wc < min_words:
            preview = text[:50] + ('…' if len(text) > 50 else '')
            violations.append((i, wc, f'太短（{wc} 詞 < {min_words}）', preview))
        elif wc > max_words:
            preview = text[:50] + ('…' if len(text) > 50 else '')
            violations.append((i, wc, f'太長（{wc} 詞 > {max_words}）', preview))

    return len(violations) > 0, violations



def mode5_select_files_dialog(need_update, violations_map, all_ts_files, min_words, max_words):
    """
    掃描結果勾選視窗（v2）：
    - 每列右側有「✏️ 手動編輯」按鈕，可直接讀取 Timestamp.txt 進斷點編輯器
    - 編輯後標記「已手動編輯」徽章，使用者仍可勾選讓自動轉錄覆蓋
    - 全選 / 全不選按鈕
    回傳使用者選取的 ts_path 列表，或 None（取消）
    """
    import copy

    result = {'selected': None, 'edited_set': set()}

    # 追蹤每個檔案的狀態：'pending' | 'edited'
    file_status = {ts: 'pending' for ts in need_update}

    win = tk.Toplevel()
    win.title("📋  模式 5 — 選擇要重新轉錄的文本")
    win.geometry("1020x720")
    win.resizable(True, True)
    win.grab_set()
    win.configure(bg='#1a252f')

    # ── 標題 ──
    hdr = tk.Frame(win, bg='#1a252f', pady=10)
    hdr.pack(fill=tk.X)
    tk.Label(hdr, text="📋  掃描完畢 — 請勾選要重新轉錄的文本",
             font=('Microsoft JhengHei', 13, 'bold'),
             bg='#1a252f', fg='white').pack()

    no_violation_count = len(all_ts_files) - len(need_update)
    tk.Label(hdr,
             text=f"共掃描 {len(all_ts_files)} 個文本　│　"
                  f"違規：{len(need_update)} 個　│　"
                  f"無違規（跳過）：{no_violation_count} 個",
             font=('Microsoft JhengHei', 10),
             bg='#1a252f', fg='#95a5a6').pack()

    tk.Label(hdr,
             text="💡 勾選 = 自動重新轉錄覆蓋　│　✏️ 手動編輯 = 直接修改斷句（時間用插值估算）",
             font=('Microsoft JhengHei', 9),
             bg='#1a252f', fg='#58a6ff').pack(pady=(2, 0))

    # ── 工具列（全選 / 全不選 + 已選計數）──
    toolbar = tk.Frame(win, bg='#21262d', pady=5)
    toolbar.pack(fill=tk.X)

    check_vars    = {}   # ts_path -> BooleanVar
    row_frames    = {}   # ts_path -> outer Frame
    status_labels = {}   # ts_path -> status badge Label
    edit_btns     = {}   # ts_path -> edit Button

    selected_count_var = tk.StringVar()

    def update_count():
        n = sum(1 for v in check_vars.values() if v.get())
        selected_count_var.set(f'已勾選轉錄：{n} 個　│　已手動編輯：{sum(1 for s in file_status.values() if s=="edited")} 個')
        confirm_btn.config(
            state=tk.NORMAL,
            bg='#27ae60'
        )

    def _row_bg(ts):
        if file_status[ts] == 'edited':
            return '#0a1e30'   # 已編輯 → 藍底
        if check_vars[ts].get():
            return '#0d2a1a'   # 勾選 → 綠底
        return '#1a1a1a'       # 未勾選 → 暗底

    def _refresh_row(ts):
        """重新渲染單列的背景和狀態徽章。"""
        bg = _row_bg(ts)
        frame = row_frames[ts]
        frame.configure(bg=bg)
        for child in frame.winfo_children():
            try:
                child.configure(bg=bg)
                for grandchild in child.winfo_children():
                    try:
                        grandchild.configure(bg=bg)
                    except Exception:
                        pass
            except Exception:
                pass

        # 更新徽章
        lbl = status_labels.get(ts)
        if lbl:
            if file_status[ts] == 'edited':
                lbl.config(text=' ✏️ 已手動編輯 ', bg='#0a3a50', fg='#56c8ea')
            elif check_vars[ts].get():
                lbl.config(text=' ☑ 排程轉錄 ', bg='#1a3a1a', fg='#56d364')
            else:
                lbl.config(text='', bg=bg, fg=bg)

    def _refresh_all():
        for ts in need_update:
            _refresh_row(ts)

    def select_all():
        for v in check_vars.values():
            v.set(True)
        update_count()
        _refresh_all()

    def deselect_all():
        for v in check_vars.values():
            v.set(False)
        update_count()
        _refresh_all()

    tk.Button(toolbar, text='  ☑ 全部勾選  ',
              font=('Microsoft JhengHei', 10, 'bold'),
              bg='#1f3a5f', fg='#79c0ff',
              activebackground='#2d5986', activeforeground='white',
              bd=0, padx=14, pady=4, cursor='hand2',
              command=select_all).pack(side=tk.LEFT, padx=(12, 4))

    tk.Button(toolbar, text='  ☐ 全部取消  ',
              font=('Microsoft JhengHei', 10),
              bg='#2d333b', fg='#cdd9e5',
              activebackground='#444c56', activeforeground='white',
              bd=0, padx=14, pady=4, cursor='hand2',
              command=deselect_all).pack(side=tk.LEFT, padx=4)

    tk.Label(toolbar, textvariable=selected_count_var,
             font=('Microsoft JhengHei', 10, 'bold'),
             bg='#21262d', fg='#56d364').pack(side=tk.RIGHT, padx=16)

    # ── Canvas 捲動區 ──
    outer = tk.Frame(win, bg='#0d1117')
    outer.pack(fill=tk.BOTH, expand=True, padx=10, pady=(6, 0))

    canvas = tk.Canvas(outer, bg='#0d1117', highlightthickness=0)
    vsb    = tk.Scrollbar(outer, orient=tk.VERTICAL, command=canvas.yview)
    canvas.configure(yscrollcommand=vsb.set)
    vsb.pack(side=tk.RIGHT, fill=tk.Y)
    canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    inner = tk.Frame(canvas, bg='#0d1117')
    cwin  = canvas.create_window((0, 0), window=inner, anchor='nw')
    canvas.bind('<Configure>', lambda e: canvas.itemconfig(cwin, width=e.width))
    inner.bind('<Configure>',  lambda e: canvas.configure(scrollregion=canvas.bbox('all')))
    canvas.bind('<Enter>', lambda e: canvas.bind_all('<MouseWheel>',
        lambda ev: canvas.yview_scroll(int(-1*(ev.delta/120)), 'units')))
    canvas.bind('<Leave>', lambda e: canvas.unbind_all('<MouseWheel>'))

    # ── 段落標題輔助 ──
    def section_label(text, fg='#e8c44a'):
        tk.Label(inner, text=text,
                 font=('Microsoft JhengHei', 10, 'bold'),
                 bg='#161b22', fg=fg,
                 anchor='w', padx=12, pady=5).pack(fill=tk.X, pady=(8, 2))

    # ══════════════════════════════════════════
    #  手動編輯器（讀取現有 Timestamp.txt）
    # ══════════════════════════════════════════
    def open_manual_editor(ts_path):
        """
        讀取現有 Timestamp.txt → 開啟斷點編輯器（純文字模式）。
        編輯完後用插值估算時間，寫回 Timestamp.txt。
        完成後標記 file_status[ts_path] = 'edited'。
        """
        try:
            with open(ts_path, 'r', encoding='utf-8') as f:
                raw_lines = f.readlines()
        except Exception as e:
            messagebox.showerror('讀取失敗', f'無法讀取文本：\n{e}')
            return

        # 解析成 seg 列表
        segs = []
        for line in raw_lines:
            p = parse_ts_line(line)
            if p:
                segs.append({'start': p[0], 'end': p[1], 'text': p[2]})
        if not segs:
            messagebox.showwarning('提示', '此文本沒有可解析的時間戳記行。')
            return

        # 純文字列表（給編輯器）
        initial_lines = [s['text'].strip() for s in segs if s['text'].strip()]

        # ── 開啟編輯視窗 ──
        edit_result = {'lines': None}
        ewin = tk.Toplevel(win)
        ewin.title(f"✏️  手動斷句編輯 — {os.path.basename(ts_path)}")
        ewin.geometry("820x680")
        ewin.resizable(True, True)
        ewin.grab_set()
        ewin.configure(bg='#0d1117')

        tk.Label(ewin,
                 text=f"✏️  手動斷句編輯",
                 font=('Microsoft JhengHei', 13, 'bold'),
                 bg='#0d1117', fg='white', pady=10).pack()
        tk.Label(ewin,
                 text=f"📄  {os.path.basename(ts_path)}",
                 font=('Microsoft JhengHei', 10),
                 bg='#0d1117', fg='#79c0ff').pack()
        tk.Label(ewin,
                 text="Enter = 切斷　│　行首 Backspace = 合併上一行　│　行尾 Delete = 合併下一行",
                 font=('Microsoft JhengHei', 9),
                 bg='#0d1117', fg='#6e7681', pady=4).pack()

        # 工具列
        etoolbar = tk.Frame(ewin, bg='#21262d', pady=3)
        etoolbar.pack(fill=tk.X)
        undo_stack_e = []
        line_count_var_e = tk.StringVar()

        etxt = scrolledtext.ScrolledText(
            ewin, wrap=tk.WORD,
            font=('Microsoft JhengHei', 11),
            bg='#1c2129', fg='#e6edf3',
            insertbackground='white',
            selectbackground='#2d4a6e',
            relief=tk.FLAT,
            padx=16, pady=12,
            spacing1=4, spacing3=4)
        etxt.pack(fill=tk.BOTH, expand=True, padx=8, pady=(4, 0))

        def _ecount():
            content = etxt.get('1.0', tk.END).rstrip('\n')
            n = len(content.split('\n')) if content.strip() else 0
            line_count_var_e.set(f'共 {n} 條斷句')

        def _esnap():
            undo_stack_e.append(etxt.get('1.0', tk.END))
            if len(undo_stack_e) > 20:
                undo_stack_e.pop(0)
            eundo_btn.config(state=tk.NORMAL)

        def do_eundo():
            if not undo_stack_e:
                return
            snap = undo_stack_e.pop()
            etxt.delete('1.0', tk.END)
            etxt.insert('1.0', snap.rstrip('\n'))
            if not undo_stack_e:
                eundo_btn.config(state=tk.DISABLED)
            _ecount()

        eundo_btn = tk.Button(etoolbar, text='⬅ 上一步',
                              font=('Microsoft JhengHei', 9, 'bold'),
                              bg='#2d333b', fg='#cdd9e5',
                              activebackground='#444c56', activeforeground='white',
                              bd=0, padx=12, pady=3, cursor='hand2',
                              state=tk.DISABLED, command=do_eundo)
        eundo_btn.pack(side=tk.LEFT, padx=(8, 4))

        tk.Label(etoolbar, textvariable=line_count_var_e,
                 font=('Microsoft JhengHei', 9),
                 bg='#21262d', fg='#8b949e').pack(side=tk.RIGHT, padx=12)

        # 填入初始內容
        etxt.insert('1.0', '\n'.join(initial_lines))
        _ecount()

        def on_eenter(event):
            _esnap()
            etxt.insert('insert', '\n')
            _ecount()
            return 'break'

        def on_ebackspace(event):
            idx = etxt.index('insert')
            col = int(idx.split('.')[1])
            row = int(idx.split('.')[0])
            if col == 0 and row > 1:
                _esnap()
                prev_end = f'{row-1}.end'
                etxt.delete(prev_end, f'{prev_end}+1c')
                _ecount()
                return 'break'

        def on_edelete(event):
            idx = etxt.index('insert')
            eol = etxt.index(f'{idx} lineend')
            if etxt.index('insert') == eol:
                _esnap()
                etxt.delete(eol, f'{eol}+1c')
                _ecount()
                return 'break'

        etxt.bind('<Return>',    on_eenter)
        etxt.bind('<BackSpace>', on_ebackspace)
        etxt.bind('<Delete>',    on_edelete)
        etxt.bind('<Control-z>', lambda e: (do_eundo(), 'break'))
        etxt.bind('<Control-Z>', lambda e: (do_eundo(), 'break'))
        etxt.bind('<KeyRelease>', lambda e: _ecount())

        # 底部按鈕
        ebtns = tk.Frame(ewin, bg='#1a252f', pady=10)
        ebtns.pack(fill=tk.X)

        def on_esave():
            raw = etxt.get('1.0', tk.END).rstrip('\n')
            edited_lines = [ln.strip() for ln in raw.split('\n') if ln.strip()]
            if not edited_lines:
                messagebox.showwarning('提示', '內容為空，請至少保留一條。')
                return
            edit_result['lines'] = edited_lines
            ewin.destroy()

        def on_ecancel():
            edit_result['lines'] = None
            ewin.destroy()

        tk.Button(ebtns, text='💾  完成編輯，套用插值時間戳記',
                  font=('Microsoft JhengHei', 11, 'bold'),
                  bg='#27ae60', fg='white',
                  activebackground='#2ecc71', activeforeground='white',
                  bd=0, padx=20, pady=7, cursor='hand2',
                  command=on_esave).pack(side=tk.LEFT, padx=20)
        tk.Button(ebtns, text='❌  取消',
                  font=('Microsoft JhengHei', 11),
                  bg='#7f8c8d', fg='white',
                  activebackground='#95a5a6', activeforeground='white',
                  bd=0, padx=16, pady=7, cursor='hand2',
                  command=on_ecancel).pack(side=tk.LEFT, padx=4)

        ewin.protocol('WM_DELETE_WINDOW', on_ecancel)
        etxt.focus_set()
        ewin.wait_window()

        if not edit_result['lines']:
            return   # 使用者取消，不做任何事

        # ── 用插值估算時間，產生新的時間戳記 ──
        edited_lines = edit_result['lines']
        all_words_flat = []
        for s in segs:
            words = s['text'].split()
            n = len(words)
            if n == 0:
                continue
            dur = (s['end'] - s['start']) / n
            for wi, w in enumerate(words):
                all_words_flat.append({
                    'word':  w,
                    'start': s['start'] + wi * dur,
                    'end':   s['start'] + (wi + 1) * dur,
                })

        # assign_timestamps 方式：按詞序列找對應時間
        ptr = 0
        N   = len(all_words_flat)
        new_segs_out = []
        for line_text in edited_lines:
            words_in_line = line_text.split()
            if not words_in_line:
                continue
            matched = []
            for wt in words_in_line:
                wt_clean = wt.lower().strip('.,!?;:\'"')
                best_offset = None
                for offset in range(min(8, N - ptr)):
                    cand = all_words_flat[ptr + offset]['word'].lower().strip('.,!?;:\'"')
                    if cand == wt_clean:
                        best_offset = offset
                        break
                if best_offset is not None:
                    matched.append(all_words_flat[ptr + best_offset])
                    ptr += best_offset + 1
                else:
                    prev_end = matched[-1]['end'] if matched else \
                               (all_words_flat[ptr-1]['end'] if ptr > 0 else 0.0)
                    matched.append({'word': wt, 'start': prev_end, 'end': prev_end + 0.25})
            if matched:
                new_segs_out.append({
                    'text':  line_text,
                    'start': matched[0]['start'],
                    'end':   matched[-1]['end'],
                })

        # ── 備份 + 寫回 ──
        backup_file(ts_path)
        ts_lines_out = []
        for seg in new_segs_out:
            s_ts = format_timestamp(seg['start'])
            e_ts = format_timestamp(seg['end'])
            ts_lines_out.append(f"[{s_ts} --> {e_ts}] {seg['text'].strip()}")
        with open(ts_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(ts_lines_out))

        # 同步純文字版本（如果存在）
        plain_path = ts_path.replace(' Timestamp.txt', '.txt')
        if os.path.exists(plain_path):
            backup_file(plain_path)
            with open(plain_path, 'w', encoding='utf-8') as f:
                f.write('\n'.join(seg['text'].strip() for seg in new_segs_out))

        # 標記已編輯
        file_status[ts_path] = 'edited'
        _refresh_row(ts_path)
        update_count()
        print(f"[模式5] 手動編輯完成：{os.path.basename(ts_path)}（{len(segs)} 條 → {len(new_segs_out)} 條）")

    # ══ 違規文本區（可勾選）══
    section_label(f'⚠️  違規文本（{len(need_update)} 個）— 勾選 = 自動轉錄　✏️ = 手動編輯斷句', fg='#e8c44a')

    for ts in need_update:
        name = os.path.basename(ts)
        has_v, violations = violations_map[ts]
        short_count = sum(1 for _, wc, reason, _ in violations if '太短' in reason)
        long_count  = sum(1 for _, wc, reason, _ in violations if '太長' in reason)

        var = tk.BooleanVar(value=True)
        check_vars[ts] = var

        row_bg = '#0d2a1a'
        row = tk.Frame(inner, bg=row_bg, bd=1, relief=tk.SOLID)
        row.pack(fill=tk.X, padx=8, pady=3)
        row_frames[ts] = row

        # ── 上列：勾選框 + 檔名 + 徽章 + 手動編輯按鈕 ──
        top_row = tk.Frame(row, bg=row_bg)
        top_row.pack(fill=tk.X, padx=8, pady=(6, 2))

        cb = tk.Checkbutton(top_row, variable=var,
                             bg=row_bg, activebackground=row_bg,
                             cursor='hand2',
                             command=lambda t=ts: (update_count(), _refresh_row(t)))
        cb.pack(side=tk.LEFT)

        tk.Label(top_row, text=name,
                 font=('Microsoft JhengHei', 10, 'bold'),
                 bg=row_bg, fg='#c9d1d9', anchor='w').pack(side=tk.LEFT, padx=4)

        # 違規徽章
        badge_f = tk.Frame(top_row, bg=row_bg)
        badge_f.pack(side=tk.LEFT, padx=6)
        if short_count:
            tk.Label(badge_f, text=f' 太短 ×{short_count} ',
                     font=('Microsoft JhengHei', 8, 'bold'),
                     bg='#3a2060', fg='#c792ea',
                     padx=4, pady=1).pack(side=tk.LEFT, padx=2)
        if long_count:
            tk.Label(badge_f, text=f' 太長 ×{long_count} ',
                     font=('Microsoft JhengHei', 8, 'bold'),
                     bg='#3a1010', fg='#ff6b6b',
                     padx=4, pady=1).pack(side=tk.LEFT, padx=2)

        # 狀態徽章（右側，動態更新）
        status_lbl = tk.Label(top_row, text=' ☑ 排程轉錄 ',
                               font=('Microsoft JhengHei', 8, 'bold'),
                               bg='#1a3a1a', fg='#56d364',
                               padx=4, pady=1)
        status_lbl.pack(side=tk.LEFT, padx=6)
        status_labels[ts] = status_lbl

        # 手動編輯按鈕（靠右）
        edit_btn = tk.Button(top_row,
                              text='  ✏️ 手動編輯  ',
                              font=('Microsoft JhengHei', 9, 'bold'),
                              bg='#1a3050', fg='#79c0ff',
                              activebackground='#2d5986', activeforeground='white',
                              bd=0, padx=10, pady=3, cursor='hand2',
                              command=lambda t=ts: open_manual_editor(t))
        edit_btn.pack(side=tk.RIGHT, padx=8)
        edit_btns[ts] = edit_btn

        # ── 違規詳情（最多 3 條）──
        detail_f = tk.Frame(row, bg=row_bg)
        detail_f.pack(fill=tk.X, padx=28, pady=(0, 6))
        for ln, wc, reason, preview in violations[:3]:
            tk.Label(detail_f,
                     text=f"第{ln}行 {reason}：「{preview}」",
                     font=('Microsoft JhengHei', 9),
                     bg=row_bg, fg='#6e7681',
                     anchor='w', wraplength=900, justify=tk.LEFT).pack(anchor='w')
        if len(violations) > 3:
            tk.Label(detail_f,
                     text=f"… 另有 {len(violations)-3} 條違規",
                     font=('Microsoft JhengHei', 9),
                     bg=row_bg, fg='#6e7681', anchor='w').pack(anchor='w')

    # ══ 無違規文本區（唯讀提示）══
    no_v_files = [ts for ts in all_ts_files if not violations_map[ts][0]]
    if no_v_files:
        section_label(f'✅  無違規文本（{len(no_v_files)} 個）— 將自動跳過', fg='#6e7681')
        for ts in no_v_files:
            name = os.path.basename(ts)
            row = tk.Frame(inner, bg='#0d1117')
            row.pack(fill=tk.X, padx=8, pady=2)
            tk.Label(row, text=f'  ✅  {name}',
                     font=('Microsoft JhengHei', 10),
                     bg='#0d1117', fg='#3a3a3a',
                     anchor='w').pack(fill=tk.X, padx=4)

    tk.Frame(inner, bg='#0d1117', height=12).pack()

    # ── 底部按鈕 ──
    btn_f = tk.Frame(win, bg='#1a252f', pady=10)
    btn_f.pack(fill=tk.X)

    def on_confirm():
        selected = [ts for ts, v in check_vars.items() if v.get()]
        # 收集已手動編輯且未勾選自動轉錄的，加入精準化隊列
        # 已編輯的不論有無勾選都記錄其最新斷句（從目前 ts 檔讀回）
        edited_set = {ts for ts, st in file_status.items() if st == 'edited'}
        result['selected'] = selected
        result['edited_set'] = edited_set
        win.destroy()

    def on_cancel():
        result['selected'] = None
        win.destroy()

    confirm_btn = tk.Button(btn_f,
                             text='  ▶ 開始處理  ',
                             font=('Microsoft JhengHei', 11, 'bold'),
                             bg='#27ae60', fg='white',
                             activebackground='#2ecc71', activeforeground='white',
                             bd=0, padx=20, pady=8, cursor='hand2',
                             command=on_confirm)
    confirm_btn.pack(side=tk.LEFT, padx=20)

    tk.Button(btn_f, text='  ❌ 取消  ',
              font=('Microsoft JhengHei', 11),
              bg='#7f8c8d', fg='white',
              activebackground='#95a5a6', activeforeground='white',
              bd=0, padx=16, pady=8, cursor='hand2',
              command=on_cancel).pack(side=tk.LEFT, padx=4)

    tk.Label(btn_f, textvariable=selected_count_var,
             font=('Microsoft JhengHei', 10),
             bg='#1a252f', fg='#56d364').pack(side=tk.RIGHT, padx=20)

    win.protocol('WM_DELETE_WINDOW', on_cancel)
    update_count()
    win.wait_window()

    return result['selected'], result.get('edited_set', set())


def mode5_show_summary(results, log_path):
    """
    顯示模式 5 執行完畢的摘要視窗。
    results = list of dict:
      { 'name', 'status', 'violations', 'mp3_found', 'updated' }
    """
    total     = len(results)
    updated   = sum(1 for r in results if r['status'] == 'updated')
    precise   = sum(1 for r in results if r['status'] == 'precise')
    manual    = sum(1 for r in results if r.get('precise') and r['status'] == 'updated')
    skipped   = sum(1 for r in results if r['status'] == 'no_violation')
    no_mp3    = sum(1 for r in results if r['status'] == 'no_mp3')
    errors    = sum(1 for r in results if r['status'] == 'error')

    win = tk.Toplevel()
    win.title("✅  模式 5 — 執行摘要")
    win.geometry("860x620")
    win.resizable(True, True)
    win.grab_set()
    win.configure(bg='#1a252f')

    # 標題
    tk.Label(win, text="✅  模式 5 執行完畢",
             font=('Microsoft JhengHei', 15, 'bold'),
             bg='#1a252f', fg='white', pady=14).pack()

    # 統計卡片
    stat_f = tk.Frame(win, bg='#1a252f')
    stat_f.pack(pady=(0, 12))
    for label, val, bg_c, fg_c in [
        ('📄 掃描文本',   total,   '#1e3a5f', '#79c0ff'),
        ('🔄 自動轉錄',  updated, '#1a3a1a', '#56d364'),
        ('✨ 精準化',    precise, '#0a2a3a', '#56c8ea'),
        ('✅ 無違規',    skipped, '#1a1a1a', '#8b949e'),
        ('🔍 找不到MP3', no_mp3,  '#3a2a10', '#f0a030'),
        ('❌ 錯誤',      errors,  '#3a1010', '#ff6b6b'),
    ]:
        card = tk.Frame(stat_f, bg=bg_c, bd=1, relief=tk.SOLID,
                        padx=16, pady=8)
        card.pack(side=tk.LEFT, padx=6)
        tk.Label(card, text=str(val),
                 font=('Consolas', 22, 'bold'),
                 bg=bg_c, fg=fg_c).pack()
        tk.Label(card, text=label,
                 font=('Microsoft JhengHei', 9),
                 bg=bg_c, fg=fg_c).pack()

    # 詳細列表
    tk.Label(win, text='  📋 詳細結果',
             font=('Microsoft JhengHei', 11, 'bold'),
             bg='#1a252f', fg='#e8c44a',
             anchor='w').pack(fill=tk.X, padx=16, pady=(4, 2))

    list_f  = tk.Frame(win, bg='#0d1117')
    list_f.pack(fill=tk.BOTH, expand=True, padx=16, pady=(0, 8))

    txt = tk.Text(list_f,
                  font=('Microsoft JhengHei', 10),
                  bg='#0d1117', fg='#c9d1d9',
                  relief=tk.FLAT, padx=12, pady=8,
                  wrap=tk.WORD, state=tk.NORMAL)
    vsb = tk.Scrollbar(list_f, orient=tk.VERTICAL, command=txt.yview)
    txt.configure(yscrollcommand=vsb.set)
    vsb.pack(side=tk.RIGHT, fill=tk.Y)
    txt.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

    txt.tag_config('updated', foreground='#56d364')
    txt.tag_config('precise', foreground='#56c8ea')
    txt.tag_config('skip',    foreground='#6e7681')
    txt.tag_config('nomp3',   foreground='#f0a030')
    txt.tag_config('error',   foreground='#ff6b6b')
    txt.tag_config('vdetail', foreground='#8b949e')

    for r in results:
        if r['status'] == 'no_violation':
            txt.insert(tk.END, f"  ✅ {r['name']}  — 無違規，跳過\n", 'skip')
        elif r['status'] == 'updated':
            vcount = len(r.get('violations', []))
            txt.insert(tk.END, f"  🔄 {r['name']}  — 發現 {vcount} 條違規，已重新轉錄並更新\n", 'updated')
            for (ln, wc, reason, preview) in r.get('violations', [])[:5]:
                txt.insert(tk.END, f"       第{ln}行 {reason}：「{preview}」\n", 'vdetail')
            if len(r.get('violations', [])) > 5:
                txt.insert(tk.END, f"       … 另有 {len(r['violations'])-5} 條違規\n", 'vdetail')
        elif r['status'] == 'precise':
            txt.insert(tk.END, f"  ✨ {r['name']}  — 已手動編輯 + 精準化詞級時間\n", 'precise')
        elif r['status'] == 'no_mp3':
            txt.insert(tk.END, f"  🔍 {r['name']}  — 找不到對應 MP3，略過\n", 'nomp3')
        elif r['status'] == 'error':
            txt.insert(tk.END, f"  ❌ {r['name']}  — 發生錯誤：{r.get('error','')}\n", 'error')

    txt.config(state=tk.DISABLED)

    # 紀錄檔路徑
    log_f = tk.Frame(win, bg='#243342', pady=6)
    log_f.pack(fill=tk.X, padx=16, pady=(0, 8))
    tk.Label(log_f, text=f'📝 紀錄檔已儲存：{log_path}',
             font=('Microsoft JhengHei', 9),
             bg='#243342', fg='#79c0ff',
             wraplength=800, justify=tk.LEFT).pack(padx=12, anchor='w')

    tk.Button(win, text='  關閉  ',
              font=('Microsoft JhengHei', 11, 'bold'),
              bg='#27ae60', fg='white',
              activebackground='#2ecc71', activeforeground='white',
              bd=0, padx=24, pady=8, cursor='hand2',
              command=win.destroy).pack(pady=(0, 14))

    win.wait_window()


def run_mode5(root_win, preset_model_key=None, preset_ts_paths=None, preset_min=None, preset_max=None):
    """模式 5 主流程：掃描文本 → 檢查違規 → 重新轉錄 → 更新 → 紀錄"""

    # ── 1. 違規規則（從主選單帶入）──
    min_words = preset_min if preset_min is not None else 6
    max_words = preset_max if preset_max is not None else 25
    print(f"[模式5] 違規規則：詞數 < {min_words} 或 > {max_words}")

    # ── 2. 來源（從主選單帶入）──
    ts_files = list(preset_ts_paths) if preset_ts_paths else []
    if not ts_files:
        messagebox.showwarning('提示', '未找到任何 Timestamp.txt 文本，請返回主選單重新選擇。')
        return
    print(f"[模式5] 共 {len(ts_files)} 個 Timestamp 文本。")

    # ── 3. 快速預掃：統計違規數量 ──
    violations_map = {}  # ts_path -> (has_v, details)
    for ts in ts_files:
        has_v, details = mode5_check_violations(ts, min_words, max_words)
        violations_map[ts] = (has_v, details)

    need_update = [ts for ts in ts_files if violations_map[ts][0]]
    print(f"[模式5] 違規文本：{len(need_update)} 個 / 無違規：{len(ts_files)-len(need_update)} 個")

    if not need_update:
        messagebox.showinfo('模式 5', f'掃描完畢！\n\n所有 {len(ts_files)} 個文本均符合斷句規則，無需更新。')
        return

    # ── 3b. 勾選視窗：讓使用者選哪幾份要轉錄 ──
    dialog_result = mode5_select_files_dialog(need_update, violations_map, ts_files, min_words, max_words)
    if dialog_result is None or dialog_result[0] is None:
        print("[模式5] 使用者取消。")
        return
    selected_to_update, edited_set = dialog_result
    # 精準化隊列：已手動編輯但未勾選自動轉錄的，獨立跑精準化
    # 已手動編輯且有勾選的，以自動轉錄為主（結果更好），不另外精準化
    precise_queue = edited_set - set(selected_to_update)  # 只手動編輯、沒勾選轉錄的
    if not selected_to_update and not precise_queue:
        messagebox.showinfo('模式 5', '未選取任何檔案，程式結束。')
        return
    need_update = selected_to_update
    print(f"[模式5] 自動轉錄：{len(need_update)} 個　精準化手動編輯：{len(precise_queue)} 個")

    # ── 4. 引擎與模型（主選單已選好，直接沿用）──
    key5 = preset_model_key if preset_model_key else "1"
    engine5, model_name5 = COMBO_MAP.get(key5, ("faster", "large-v3-turbo"))
    print(f"[模式5] 引擎：{'faster-whisper' if engine5=='faster' else '原版 Whisper'} | 模型：{model_name5}")

    # ── 5. 載入模型 ──
    print(f"[模式5] 載入模型...")
    model5, engine5, model_name5 = load_model_by_key(key5)

    # ── 6. 逐檔處理 ──
    WHISPER_SAMPLE_RATE = 16000
    results = []
    log_lines = [
        f"模式 5 — 斷句違規修正紀錄",
        f"執行時間：{__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        f"規則：詞數 < {min_words} 或 > {max_words} 視為違規",
        f"引擎：{'faster-whisper' if engine5=='faster' else '原版 Whisper'} / 模型：{model_name5}",
        f"掃描文本數：{len(ts_files)}　自動轉錄：{len(need_update)} 個　精準化手動編輯：{len(precise_queue)} 個",
        "=" * 70,
        "",
    ]

    for i, ts_path in enumerate(ts_files):
        name = os.path.basename(ts_path)
        has_v, violations = violations_map[ts_path]
        print(f"\n[模式5] ({i+1}/{len(ts_files)}) {name}")

        if not has_v:
            print(f"  ✅ 無違規，跳過")
            results.append({'name': name, 'status': 'no_violation',
                             'violations': [], 'mp3_found': False, 'updated': False})
            log_lines.append(f"[跳過] {name}  — 無違規")
            continue

        # 找對應 MP3
        base_name = name.replace(' Timestamp.txt', '').replace('Timestamp.txt', '')
        folder    = os.path.dirname(ts_path)
        mp3_path  = None
        for ext in ['.mp3', '.wav', '.m4a']:
            candidate = os.path.join(folder, base_name + ext)
            if os.path.exists(candidate):
                mp3_path = candidate
                break

        if not mp3_path:
            print(f"  🔍 找不到對應 MP3：{base_name}.[mp3/wav/m4a]")
            results.append({'name': name, 'status': 'no_mp3',
                             'violations': violations, 'mp3_found': False, 'updated': False})
            log_lines.append(f"[找不到MP3] {name}")
            log_lines.append(f"           找不到：{base_name}.[mp3/wav/m4a]")
            continue

        print(f"  📢 發現 {len(violations)} 條違規，對應 MP3：{os.path.basename(mp3_path)}")
        for ln, wc, reason, preview in violations[:3]:
            print(f"     第{ln}行 {reason}：「{preview}」")

        # 重新轉錄
        try:
            if engine5 == "whisper":
                import whisper as whisper_lib5
                audio5   = whisper_lib5.load_audio(mp3_path)
                duration5 = audio5.shape[0] / WHISPER_SAMPLE_RATE
                if duration5 < 10:
                    raise ValueError(f"音訊長度 {duration5:.1f}s 小於 10 秒")
                print(f"  🎙 轉錄中（{duration5:.1f}s）...")
                result5 = model5.transcribe(
                    audio5, language="en", verbose=False,
                    word_timestamps=True, beam_size=5, best_of=5,
                    temperature=0.0, condition_on_previous_text=True,
                    compression_ratio_threshold=2.4, no_speech_threshold=0.6,
                )
                segments5 = result5["segments"]
            else:
                try:
                    import soundfile as sf
                    info5 = sf.info(mp3_path)
                    duration5 = info5.duration
                except Exception:
                    duration5 = 99
                if duration5 < 10:
                    raise ValueError(f"音訊長度 {duration5:.1f}s 小於 10 秒")
                print(f"  🎙 轉錄中（{duration5:.1f}s）...")
                segs_gen5, _ = model5.transcribe(
                    mp3_path, language="en", word_timestamps=True,
                    beam_size=5, best_of=5, temperature=0.0,
                    condition_on_previous_text=True,
                    compression_ratio_threshold=2.4, no_speech_threshold=0.6,
                    vad_filter=True,
                )
                segments5 = list(segs_gen5)

            # 重新斷句
            new_segs5 = smart_sentence_split(
                segments5,
                max_gap=0.6, max_duration=5.0,
                max_words=max_words, min_words=min_words
            )

            # 產生新的 Timestamp 內容
            new_ts_lines5 = []
            for seg in new_segs5:
                s5 = format_timestamp(seg['start'])
                e5 = format_timestamp(seg['end'])
                new_ts_lines5.append(f"[{s5} --> {e5}] {seg['text'].strip()}")
            new_ts_content5 = '\n'.join(new_ts_lines5)

            # 備份舊文本後覆蓋
            bk5 = backup_file(ts_path)
            with open(ts_path, 'w', encoding='utf-8') as f5:
                f5.write(new_ts_content5)

            # 同步更新純文字版本（如果存在）
            plain_path5 = ts_path.replace(' Timestamp.txt', '.txt')
            plain_updated5 = False
            if os.path.exists(plain_path5):
                plain_bk5 = backup_file(plain_path5)
                plain_lines5 = [seg['text'].strip() for seg in new_segs5]
                with open(plain_path5, 'w', encoding='utf-8') as f5:
                    f5.write('\n'.join(plain_lines5))
                plain_updated5 = True

            seg_count_old = len([l for l in open(bk5, encoding='utf-8').readlines() if parse_ts_line(l)])
            seg_count_new = len(new_segs5)

            print(f"  ✏️ 已更新：{name}（{seg_count_old} 條 → {seg_count_new} 條）")
            if bk5:
                print(f"     備份：{os.path.basename(bk5)}")
            if plain_updated5:
                print(f"     純文字同步更新：{os.path.basename(plain_path5)}")

            results.append({'name': name, 'status': 'updated',
                             'violations': violations, 'mp3_found': True, 'updated': True})

            log_lines.append(f"[更新] {name}")
            log_lines.append(f"       MP3：{os.path.basename(mp3_path)}")
            log_lines.append(f"       段落數：{seg_count_old} 條 → {seg_count_new} 條")
            log_lines.append(f"       備份：{os.path.basename(bk5) if bk5 else '無'}")
            if plain_updated5:
                log_lines.append(f"       純文字同步更新：{os.path.basename(plain_path5)}")
            log_lines.append(f"       違規詳情（共 {len(violations)} 條）：")
            for ln, wc, reason, preview in violations:
                log_lines.append(f"         第{ln}行 {reason}：「{preview}」")

        except Exception as ex5:
            import traceback
            err_msg = str(ex5)
            print(f"  ❌ 錯誤：{err_msg}")
            traceback.print_exc()
            results.append({'name': name, 'status': 'error',
                             'violations': violations, 'mp3_found': bool(mp3_path),
                             'updated': False, 'error': err_msg})
            log_lines.append(f"[錯誤] {name}：{err_msg}")

        log_lines.append("")

    # ── 6b. 精準化隊列：已手動編輯、未勾選自動轉錄的檔案 ──
    # 流程：讀取目前 Timestamp.txt（已含手動斷句）→ Whisper 取詞級時間 → assign_timestamps → 覆蓋
    for ts_path in precise_queue:
        name = os.path.basename(ts_path)
        print(f"\n[模式5] [精準化] {name}")

        # 讀取手動編輯後的斷句（目前檔案內容）
        try:
            with open(ts_path, 'r', encoding='utf-8') as f_r:
                raw_lines_p = f_r.readlines()
            edited_lines_p = []
            for line in raw_lines_p:
                p = parse_ts_line(line)
                if p:
                    edited_lines_p.append(p[2].strip())
            if not edited_lines_p:
                raise ValueError("無法從手動編輯文本解析斷句")
        except Exception as ep:
            print(f"  ❌ 讀取手動斷句失敗：{ep}")
            results.append({'name': name, 'status': 'error',
                             'violations': violations_map.get(ts_path, (False,[]))[1],
                             'mp3_found': False, 'updated': False, 'error': str(ep),
                             'precise': True})
            log_lines.append(f"[精準化失敗] {name}：{ep}")
            log_lines.append("")
            continue

        # 找 MP3
        base_name_p = name.replace(' Timestamp.txt', '').replace('Timestamp.txt', '')
        folder_p    = os.path.dirname(ts_path)
        mp3_path_p  = None
        for ext in ['.mp3', '.wav', '.m4a']:
            candidate = os.path.join(folder_p, base_name_p + ext)
            if os.path.exists(candidate):
                mp3_path_p = candidate
                break

        if not mp3_path_p:
            print(f"  🔍 精準化找不到 MP3：{base_name_p}")
            results.append({'name': name, 'status': 'no_mp3',
                             'violations': [], 'mp3_found': False, 'updated': False,
                             'precise': True})
            log_lines.append(f"[精準化找不到MP3] {name}")
            log_lines.append("")
            continue

        try:
            # Whisper 轉錄取詞級時間
            if engine5 == "whisper":
                import whisper as whisper_lib5
                audio_p   = whisper_lib5.load_audio(mp3_path_p)
                duration_p = audio_p.shape[0] / WHISPER_SAMPLE_RATE
                if duration_p < 10:
                    raise ValueError(f"音訊長度 {duration_p:.1f}s 小於 10 秒")
                print(f"  🎙 精準化轉錄中（{duration_p:.1f}s，保留手動斷句）...")
                result_p = model5.transcribe(
                    audio_p, language="en", verbose=False,
                    word_timestamps=True, beam_size=5, best_of=5,
                    temperature=0.0, condition_on_previous_text=True,
                    compression_ratio_threshold=2.4, no_speech_threshold=0.6,
                )
                segments_p = result_p["segments"]
            else:
                try:
                    import soundfile as sf
                    info_p = sf.info(mp3_path_p)
                    duration_p = info_p.duration
                except Exception:
                    duration_p = 99
                if duration_p < 10:
                    raise ValueError(f"音訊長度 {duration_p:.1f}s 小於 10 秒")
                print(f"  🎙 精準化轉錄中（{duration_p:.1f}s，保留手動斷句）...")
                segs_gen_p, _ = model5.transcribe(
                    mp3_path_p, language="en", word_timestamps=True,
                    beam_size=5, best_of=5, temperature=0.0,
                    condition_on_previous_text=True,
                    compression_ratio_threshold=2.4, no_speech_threshold=0.6,
                    vad_filter=True,
                )
                segments_p = list(segs_gen_p)

            # 建立詞索引
            word_idx_p = build_word_index(segments_p)

            # 用手動斷句 + 詞索引 → 精準時間
            precise_segs = assign_timestamps(edited_lines_p, word_idx_p)

            # 產生新 Timestamp 內容
            precise_ts_lines = []
            for seg in precise_segs:
                s_p = format_timestamp(seg['start'])
                e_p = format_timestamp(seg['end'])
                precise_ts_lines.append(f"[{s_p} --> {e_p}] {seg['text'].strip()}")
            precise_ts_content = '\n'.join(precise_ts_lines)

            # 備份插值版（上一次手動編輯後的版本）→ 寫入精準版
            bk_p = backup_file(ts_path)
            with open(ts_path, 'w', encoding='utf-8') as fw_p:
                fw_p.write(precise_ts_content)

            # 同步純文字版本
            plain_p = ts_path.replace(' Timestamp.txt', '.txt')
            if os.path.exists(plain_p):
                backup_file(plain_p)
                with open(plain_p, 'w', encoding='utf-8') as fw_p2:
                    fw_p2.write('\n'.join(seg['text'].strip() for seg in precise_segs))

            print(f"  ✨ 精準化完成：{name}（{len(edited_lines_p)} 條，詞級時間）")

            results.append({'name': name, 'status': 'precise',
                             'violations': violations_map.get(ts_path,(False,[]))[1],
                             'mp3_found': True, 'updated': True, 'precise': True})

            log_lines.append(f"[精準化] {name}")
            log_lines.append(f"        MP3：{os.path.basename(mp3_path_p)}")
            log_lines.append(f"        保留手動斷句 {len(edited_lines_p)} 條，套用詞級時間")
            log_lines.append(f"        備份（插值版）：{os.path.basename(bk_p) if bk_p else '無'}")
            log_lines.append("")

        except Exception as ep2:
            import traceback
            print(f"  ❌ 精準化失敗：{ep2}")
            traceback.print_exc()
            results.append({'name': name, 'status': 'error',
                             'violations': [], 'mp3_found': True,
                             'updated': False, 'error': str(ep2), 'precise': True})
            log_lines.append(f"[精準化錯誤] {name}：{ep2}")
            log_lines.append("")

    # ── 7. 寫紀錄檔 ──
    # 紀錄檔存在第一個文本所在的資料夾
    log_folder  = os.path.dirname(ts_files[0])
    log_ts      = __import__('datetime').datetime.now().strftime('%Y%m%d_%H%M%S')
    log_path    = os.path.join(log_folder, f'mode5_log_{log_ts}.txt')
    try:
        with open(log_path, 'w', encoding='utf-8') as lf:
            lf.write('\n'.join(log_lines))
        print(f"\n[模式5] 紀錄檔：{log_path}")
    except Exception as le:
        log_path = f"（紀錄檔儲存失敗：{le}）"

    # ── 8. 摘要視窗 ──
    mode5_show_summary(results, log_path)
    print("[模式5] 完成。")


# ─── 主程式 ───────────────────────────────────────────

COMBO_MAP = {
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

MODEL_ROWS = [
    # (key, engine_label, name, stars, speed, size, recommended)
    ("1",  "faster",  "large-v3-turbo", 5, 4, "~1.6GB", True),
    ("2",  "faster",  "large-v3",       5, 3, "~3.0GB", False),
    ("3",  "faster",  "large-v2",       4, 3, "~3.0GB", False),
    ("4",  "faster",  "medium",         3, 4, "~1.5GB", False),
    ("5",  "faster",  "small",          2, 5, "~0.5GB", False),
    ("6",  "faster",  "base",           1, 5, "~0.1GB", False),
    ("7",  "whisper", "large-v3-turbo", 5, 2, "~1.6GB", False),
    ("8",  "whisper", "large-v3",       5, 1, "~3.0GB", False),
    ("9",  "whisper", "large-v2",       4, 1, "~3.0GB", False),
    ("10", "whisper", "medium",         3, 2, "~1.5GB", False),
    ("11", "whisper", "small",          2, 3, "~0.5GB", False),
    ("12", "whisper", "base",           1, 4, "~0.1GB", False),
]


def load_model_by_key(key):
    """載入模型，回傳 (model, engine, model_name)"""
    engine, model_name = COMBO_MAP.get(key, ("faster", "large-v3-turbo"))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"使用裝置: {device}  引擎: {'faster-whisper' if engine=='faster' else '原版Whisper'}  模型: {model_name}")
    if engine == "faster":
        try:
            from faster_whisper import WhisperModel
            compute_type = "float16" if device == "cuda" else "int8"
            model = WhisperModel(model_name, device=device, compute_type=compute_type)
            print(f"faster-whisper 載入完成（{compute_type}）")
        except ImportError:
            messagebox.showerror("缺少套件",
                "找不到 faster-whisper！\n請先執行：pip install faster-whisper\n\n改用原版 Whisper 繼續。")
            engine = "whisper"
            import whisper as _wlib
            model = _wlib.load_model(model_name, device=device)
    else:
        import whisper as _wlib
        model = _wlib.load_model(model_name, device=device)
        print("原版 Whisper 載入完成")
    return model, engine, model_name


# ══════════════════════════════════════════════════════
#  主選單視窗（一個畫面搞定所有設定）
# ══════════════════════════════════════════════════════
def show_main_launcher():
    """
    主選單視窗，回傳 config dict 或 None（取消）。
    config keys:
      mode         : '1'~'5'
      file_paths   : list[str]   (模式1~4)
      save_plain   : bool        (模式1~4)
      save_ts      : bool        (模式1~4)
      model_key    : str  '1'~'12'
    """
    cfg = {'done': False, 'cfg': None}

    win = tk.Toplevel()
    win.title("🎙  mp3toword-Smart  v25")
    win.geometry("1020x740")
    win.resizable(True, True)
    win.grab_set()
    win.configure(bg='#0d1117')

    # ── 頂部標題 ──
    tk.Label(win, text="🎙  mp3toword-Smart",
             font=('Microsoft JhengHei', 17, 'bold'),
             bg='#0d1117', fg='white', pady=14).pack()
    tk.Label(win, text="請先選擇模式，再依序完成右側設定",
             font=('Microsoft JhengHei', 10),
             bg='#0d1117', fg='#6e7681').pack(pady=(0, 8))

    # ── 主體：左欄模式 + 右欄設定 ──
    body = tk.Frame(win, bg='#0d1117')
    body.pack(fill=tk.BOTH, expand=True, padx=16, pady=(0, 8))
    body.columnconfigure(0, weight=0, minsize=310)
    body.columnconfigure(1, weight=1)
    body.rowconfigure(0, weight=1)

    # ════════════════════
    #  左欄：模式選擇
    # ════════════════════
    left = tk.Frame(body, bg='#161b22', bd=1, relief=tk.SOLID)
    left.grid(row=0, column=0, sticky='nsew', padx=(0, 8))

    tk.Label(left, text="  選擇模式",
             font=('Microsoft JhengHei', 11, 'bold'),
             bg='#21262d', fg='#e8c44a',
             anchor='w', pady=8).pack(fill=tk.X)

    MODE_INFO = [
        ("1", "一般轉錄",
         "跳過已有文本，只處理\n全新的 MP3。",
         "適合：第一次批量轉錄", '#1f3a5f', '#79c0ff'),
        ("2", "重新轉錄＋手動比對",
         "重新轉錄，逐檔開啟視\n覺化比對視窗手動審閱。",
         "適合：確認轉錄有無改善", '#2a1f5f', '#b39ddb'),
        ("3", "重新轉錄＋全自動覆蓋",
         "重新轉錄，舊文本自動\n備份後直接覆蓋。",
         "適合：確定要更新全部", '#1f3a2a', '#56d364'),
        ("4", "轉錄＋斷句編輯",
         "轉錄後進入純文字編輯\n器，自訂精準斷句位置。",
         "適合：手動掌控斷句", '#3a2a10', '#f0a030'),
        ("5", "★ 違規檢查＋修正",
         "掃描現有文本，修正斷\n句違規，輸出紀錄檔。",
         "適合：批量修正舊文本", '#3a1a10', '#ff8c57'),
    ]

    selected_mode = tk.StringVar(value='1')
    mode_btns = {}

    def _mode_bg(m, selected):
        info = next(x for x in MODE_INFO if x[0] == m)
        return info[4] if selected else '#161b22'

    def _mode_fg(m, selected):
        info = next(x for x in MODE_INFO if x[0] == m)
        return info[5] if selected else '#8b949e'

    def select_mode(m):
        selected_mode.set(m)
        for mm, btn_data in mode_btns.items():
            is_sel = (mm == m)
            bg = _mode_bg(mm, is_sel)
            fg = _mode_fg(mm, is_sel)
            btn_data['frame'].configure(bg=bg)
            btn_data['num'].configure(bg=bg, fg=fg)
            btn_data['title'].configure(bg=bg, fg='white' if is_sel else '#6e7681')
            btn_data['desc'].configure(bg=bg, fg=fg)
            btn_data['hint'].configure(bg=bg, fg=fg)
        refresh_right()

    for m, title, desc, hint, bg_sel, fg_sel in MODE_INFO:
        is_sel = (m == '1')
        bg = bg_sel if is_sel else '#161b22'
        fg = fg_sel if is_sel else '#8b949e'

        f = tk.Frame(left, bg=bg, cursor='hand2', pady=8, padx=10,
                     bd=1, relief=tk.SOLID)
        f.pack(fill=tk.X, padx=6, pady=4)

        num_lbl   = tk.Label(f, text=f"模式 {m}", bg=bg, fg=fg,
                              font=('Microsoft JhengHei', 8, 'bold'))
        num_lbl.pack(anchor='w')
        title_lbl = tk.Label(f, text=title, bg=bg,
                              fg='white' if is_sel else '#6e7681',
                              font=('Microsoft JhengHei', 11, 'bold'), anchor='w')
        title_lbl.pack(anchor='w')
        desc_lbl  = tk.Label(f, text=desc, bg=bg, fg=fg,
                              font=('Microsoft JhengHei', 9),
                              anchor='w', justify=tk.LEFT)
        desc_lbl.pack(anchor='w', pady=(2, 0))
        hint_lbl  = tk.Label(f, text=hint, bg=bg, fg=fg,
                              font=('Microsoft JhengHei', 8, 'italic'), anchor='w')
        hint_lbl.pack(anchor='w')

        mode_btns[m] = {'frame': f, 'num': num_lbl,
                        'title': title_lbl, 'desc': desc_lbl, 'hint': hint_lbl}

        for widget in (f, num_lbl, title_lbl, desc_lbl, hint_lbl):
            widget.bind('<Button-1>', lambda e, mm=m: select_mode(mm))

    # ════════════════════
    #  右欄：動態設定區
    # ════════════════════
    right = tk.Frame(body, bg='#0d1117')
    right.grid(row=0, column=1, sticky='nsew')

    right_content = {'frame': None}

    # ── 共用變數 ──
    src_var      = tk.StringVar(value='files')   # 'files' | 'folder'
    file_paths_v = {'paths': []}
    save_plain_v = tk.BooleanVar(value=True)
    save_ts_v    = tk.BooleanVar(value=True)
    model_key_v  = tk.StringVar(value='1')
    src_label_v  = tk.StringVar(value='尚未選擇')
    # 模式5專用
    m5_ts_paths_v  = {'paths': []}   # 選取的 Timestamp.txt 列表
    m5_src_label_v = tk.StringVar(value='尚未選擇')
    m5_min_v       = tk.StringVar(value='6')
    m5_max_v       = tk.StringVar(value='25')

    def pick_files():
        paths = list(askopenfilenames(
            title="選擇音訊檔案",
            filetypes=[("音訊檔案", "*.mp3 *.wav *.m4a")]
        ))
        if paths:
            file_paths_v['paths'] = paths
            src_label_v.set(f"已選 {len(paths)} 個檔案")

    def pick_folder():
        folder = askdirectory(title="選擇包含音訊檔案的資料夾")
        if folder:
            paths = scan_folder_for_mp3(folder)
            file_paths_v['paths'] = paths
            src_label_v.set(f"資料夾：{os.path.basename(folder)}（{len(paths)} 個）")

    def pick_m5_files():
        chosen = list(askopenfilenames(
            title='選擇 Timestamp 文本檔案',
            filetypes=[('Timestamp 文本', '*Timestamp.txt'), ('所有文字檔', '*.txt')]
        ))
        paths = [f for f in chosen if f.endswith('Timestamp.txt')]
        if paths:
            m5_ts_paths_v['paths'] = paths
            m5_src_label_v.set(f"已選 {len(paths)} 個文本")

    def pick_m5_folder():
        folder = askdirectory(title='選擇包含文本的資料夾')
        if folder:
            paths = [os.path.join(folder, fn)
                     for fn in sorted(os.listdir(folder))
                     if fn.endswith('Timestamp.txt')]
            m5_ts_paths_v['paths'] = paths
            m5_src_label_v.set(f"資料夾：{os.path.basename(folder)}（{len(paths)} 個文本）")

    def refresh_right():
        """根據目前模式重繪右欄。"""
        if right_content['frame']:
            right_content['frame'].destroy()

        f = tk.Frame(right, bg='#0d1117')
        f.pack(fill=tk.BOTH, expand=True)
        right_content['frame'] = f

        m = selected_mode.get()

        # ── Section helper ──
        def section(parent, title):
            hdr = tk.Frame(parent, bg='#21262d', pady=5)
            hdr.pack(fill=tk.X, pady=(12, 4))
            tk.Label(hdr, text=f"  {title}",
                     font=('Microsoft JhengHei', 10, 'bold'),
                     bg='#21262d', fg='#e8c44a', anchor='w').pack(anchor='w', padx=4)
            return hdr

        # ── 模式 1~4：音訊來源 + 儲存格式 + 引擎模型 ──
        if m in ('1', '2', '3', '4'):

            # 音訊來源
            section(f, "① 音訊來源")
            src_f = tk.Frame(f, bg='#0d1117')
            src_f.pack(fill=tk.X, padx=12)

            def _make_src_btn(parent, text, cmd, icon):
                b = tk.Button(parent, text=f"  {icon}  {text}  ",
                              font=('Microsoft JhengHei', 10, 'bold'),
                              bg='#1f3a5f', fg='#79c0ff',
                              activebackground='#2d5986', activeforeground='white',
                              bd=0, padx=12, pady=6, cursor='hand2', command=cmd)
                b.pack(side=tk.LEFT, padx=(0, 8))

            _make_src_btn(src_f, "選擇多個檔案", pick_files, "🎵")
            _make_src_btn(src_f, "選擇資料夾",   pick_folder, "📁")

            tk.Label(src_f, textvariable=src_label_v,
                     font=('Microsoft JhengHei', 9),
                     bg='#0d1117', fg='#56d364').pack(side=tk.LEFT, padx=8)

            # 儲存格式
            section(f, "② 儲存格式")
            fmt_f = tk.Frame(f, bg='#0d1117')
            fmt_f.pack(fill=tk.X, padx=12)
            for text, var, hint in [
                ("純文字  (.txt)",         save_plain_v, "每行一條斷句，無時間"),
                ("時間戳記  (Timestamp.txt)", save_ts_v,    "含精準起止時間"),
            ]:
                row = tk.Frame(fmt_f, bg='#0d1117')
                row.pack(anchor='w', pady=3)
                tk.Checkbutton(row, variable=var,
                               bg='#0d1117', activebackground='#0d1117',
                               fg='white', selectcolor='#1f3a5f',
                               font=('Microsoft JhengHei', 10, 'bold'),
                               text=text, cursor='hand2').pack(side=tk.LEFT)
                tk.Label(row, text=f"  —  {hint}",
                         bg='#0d1117', fg='#6e7681',
                         font=('Microsoft JhengHei', 9)).pack(side=tk.LEFT)

        # ── 引擎 & 模型（模式1~4都需要）──
        if m in ('1', '2', '3', '4'):
            section(f, "③ 引擎 & 模型")
            _build_model_picker(f, model_key_v)

        # ── 模式 5：違規規則 + 來源選擇 + 引擎模型（全在主選單完成）──
        if m == '5':
            # ① 違規規則設定
            section(f, "① 違規規則設定")
            rule_f = tk.Frame(f, bg='#0d1117')
            rule_f.pack(fill=tk.X, padx=12, pady=4)
            for label, var5, hint5 in [
                ("最少詞數（少於此值 → 違規）", m5_min_v, "預設 6"),
                ("最多詞數（超過此值 → 違規）", m5_max_v, "預設 25"),
            ]:
                row5 = tk.Frame(rule_f, bg='#0d1117')
                row5.pack(fill=tk.X, pady=4)
                tk.Label(row5, text=label,
                         font=('Microsoft JhengHei', 10, 'bold'),
                         bg='#0d1117', fg='#e8c44a', anchor='w').pack(side=tk.LEFT)
                tk.Label(row5, text=f"  {hint5}",
                         font=('Microsoft JhengHei', 9),
                         bg='#0d1117', fg='#6e7681').pack(side=tk.LEFT)
                tk.Entry(row5, textvariable=var5,
                         font=('Consolas', 11),
                         bg='#161b22', fg='white', insertbackground='white',
                         relief=tk.FLAT, width=6, justify=tk.CENTER).pack(side=tk.LEFT, padx=8)

            # ② 文本來源
            section(f, "② 文本來源（Timestamp.txt）")
            src5_f = tk.Frame(f, bg='#0d1117')
            src5_f.pack(fill=tk.X, padx=12)

            def _make_src5_btn(parent, text, cmd, icon):
                b = tk.Button(parent, text=f"  {icon}  {text}  ",
                              font=('Microsoft JhengHei', 10, 'bold'),
                              bg='#3a1a10', fg='#ff8c57',
                              activebackground='#5a2a10', activeforeground='white',
                              bd=0, padx=12, pady=6, cursor='hand2', command=cmd)
                b.pack(side=tk.LEFT, padx=(0, 8))

            _make_src5_btn(src5_f, "選擇多個文本", pick_m5_files,  "📄")
            _make_src5_btn(src5_f, "選擇資料夾",   pick_m5_folder, "📁")

            tk.Label(src5_f, textvariable=m5_src_label_v,
                     font=('Microsoft JhengHei', 9),
                     bg='#0d1117', fg='#56d364').pack(side=tk.LEFT, padx=8)

            # ③ 引擎 & 模型
            section(f, "③ 引擎 & 模型")
            _build_model_picker(f, model_key_v)
            tk.Label(f,
                     text="  ℹ️  引擎在發現違規需要轉錄時才載入",
                     font=('Microsoft JhengHei', 9),
                     bg='#0d1117', fg='#6e7681').pack(anchor='w', padx=16, pady=(2, 0))

    def _build_model_picker(parent, var):
        """渲染引擎/模型選擇器（點選格子）。"""
        outer = tk.Frame(parent, bg='#0d1117')
        outer.pack(fill=tk.X, padx=12, pady=4)

        # 分兩群
        for group_label, keys in [
            ("⚡ faster-whisper（推薦，速度快 4~8 倍）", ["1","2","3","4","5","6"]),
            ("🔬 原版 Whisper（OpenAI 官方）",           ["7","8","9","10","11","12"]),
        ]:
            grp_hdr = tk.Frame(outer, bg='#161b22')
            grp_hdr.pack(fill=tk.X, pady=(6, 2))
            tk.Label(grp_hdr, text=f"  {group_label}",
                     font=('Microsoft JhengHei', 9, 'bold'),
                     bg='#161b22', fg='#79c0ff', pady=3).pack(anchor='w', padx=4)

            grid = tk.Frame(outer, bg='#0d1117')
            grid.pack(fill=tk.X)

            for col, k in enumerate(keys):
                row_data = next(r for r in MODEL_ROWS if r[0] == k)
                _, _, name, stars, speed, size, rec = row_data

                def _make_cell(parent, k=k, name=name, stars=stars, speed=speed, size=size, rec=rec):
                    is_sel = (var.get() == k)
                    bg = '#1f3a5f' if is_sel else '#161b22'
                    fg = '#79c0ff' if is_sel else '#6e7681'

                    cell = tk.Frame(parent, bg=bg, bd=1, relief=tk.SOLID,
                                    cursor='hand2', padx=6, pady=5)
                    cell.grid(row=0, column=col, padx=3, pady=2, sticky='ew')
                    parent.columnconfigure(col, weight=1)

                    name_lbl = tk.Label(cell, text=name,
                                        font=('Consolas', 8, 'bold'),
                                        bg=bg, fg='white' if is_sel else '#c9d1d9')
                    name_lbl.pack()
                    star_lbl = tk.Label(cell, text='★'*stars + '☆'*(5-stars),
                                        font=('Consolas', 7),
                                        bg=bg, fg='#f0c040' if is_sel else '#444')
                    star_lbl.pack()
                    spd_lbl  = tk.Label(cell, text='⚡'*speed,
                                        font=('Consolas', 7),
                                        bg=bg, fg='#56d364' if is_sel else '#444')
                    spd_lbl.pack()
                    size_lbl = tk.Label(cell, text=size,
                                        font=('Consolas', 7),
                                        bg=bg, fg=fg)
                    size_lbl.pack()
                    if rec:
                        tk.Label(cell, text='推薦', bg='#1a3a10', fg='#56d364',
                                 font=('Microsoft JhengHei', 7, 'bold'),
                                 padx=3).pack()

                    def _click(e, k=k):
                        var.set(k)
                        refresh_right()

                    for w in (cell, name_lbl, star_lbl, spd_lbl, size_lbl):
                        w.bind('<Button-1>', _click)

                _make_cell(grid, k=k, name=name, stars=stars,
                           speed=speed, size=size, rec=rec)

    # 初始渲染
    refresh_right()

    # ── 底部按鈕 ──
    btm = tk.Frame(win, bg='#161b22', pady=10)
    btm.pack(fill=tk.X)

    err_var = tk.StringVar(value='')
    tk.Label(btm, textvariable=err_var,
             font=('Microsoft JhengHei', 9),
             bg='#161b22', fg='#ff6b6b').pack(side=tk.LEFT, padx=16)

    def on_start():
        m = selected_mode.get()
        err_var.set('')
        # 驗證
        if m in ('1','2','3','4'):
            if not file_paths_v['paths']:
                err_var.set('❌ 請先選擇音訊來源（檔案或資料夾）')
                return
            if not save_plain_v.get() and not save_ts_v.get():
                err_var.set('❌ 請至少勾選一種儲存格式')
                return
        if m == '5':
            if not m5_ts_paths_v['paths']:
                err_var.set('❌ 請先選擇要掃描的 Timestamp 文本來源')
                return
            try:
                mn = int(m5_min_v.get().strip())
                mx = int(m5_max_v.get().strip())
                if mn < 1 or mx < 1 or mn >= mx:
                    raise ValueError()
            except ValueError:
                err_var.set('❌ 違規規則數值有誤（請輸入正整數，且最少 < 最多）')
                return
        cfg['cfg'] = {
            'mode':        m,
            'file_paths':  file_paths_v['paths'],
            'save_plain':  save_plain_v.get(),
            'save_ts':     save_ts_v.get(),
            'model_key':   model_key_v.get(),
            # 模式5
            'm5_ts_paths': m5_ts_paths_v['paths'],
            'm5_min':      int(m5_min_v.get()) if m == '5' else 6,
            'm5_max':      int(m5_max_v.get()) if m == '5' else 25,
        }
        cfg['done'] = True
        win.destroy()

    def on_quit():
        win.destroy()

    tk.Button(btm, text='  ▶  開始  ',
              font=('Microsoft JhengHei', 12, 'bold'),
              bg='#27ae60', fg='white',
              activebackground='#2ecc71', activeforeground='white',
              bd=0, padx=24, pady=8, cursor='hand2',
              command=on_start).pack(side=tk.RIGHT, padx=16)

    tk.Button(btm, text='  ✕  離開  ',
              font=('Microsoft JhengHei', 11),
              bg='#3a3a3a', fg='#cdd9e5',
              activebackground='#555', activeforeground='white',
              bd=0, padx=16, pady=8, cursor='hand2',
              command=on_quit).pack(side=tk.RIGHT, padx=4)

    win.protocol('WM_DELETE_WINDOW', on_quit)
    win.wait_window()

    return cfg['cfg'] if cfg['done'] else None


# ══════════════════════════════════════════════════════
#  主程式進入點
# ══════════════════════════════════════════════════════
root = Tk()
root.withdraw()

cfg = show_main_launcher()
if not cfg:
    print("使用者取消。程式結束。")
    exit()

mode_choice    = cfg['mode']
file_paths     = cfg['file_paths']
save_plain     = cfg['save_plain']
save_timestamp = cfg['save_ts']
model_key      = cfg['model_key']

# ── 模式 5：交給 run_mode5 處理 ──
if mode_choice == '5':
    run_mode5(root,
              preset_model_key=cfg['model_key'],
              preset_ts_paths=cfg['m5_ts_paths'],
              preset_min=cfg['m5_min'],
              preset_max=cfg['m5_max'])
    exit()

# ── 模式 1~4 ──
recheck_mode   = mode_choice in ('2', '3')
auto_mode      = mode_choice == '3'
edit_only_mode = mode_choice == '4'

# 篩選需要處理的檔案
files_to_process, files_done = [], []
for fp in file_paths:
    base = os.path.join(os.path.dirname(fp), os.path.splitext(os.path.basename(fp))[0].strip())
    checks = []
    if save_plain:     checks.append(base + ".txt")
    if save_timestamp: checks.append(base + " Timestamp.txt")
    if checks and all(os.path.exists(c) for c in checks):
        if recheck_mode or edit_only_mode:
            files_to_process.append(fp)
        else:
            files_done.append(os.path.basename(fp))
    else:
        files_to_process.append(fp)

recheck_count = sum(
    1 for fp in files_to_process
    if any(os.path.exists(
        os.path.join(os.path.dirname(fp),
                     os.path.splitext(os.path.basename(fp))[0].strip()) + ext
    ) for ext in ([".txt"] if save_plain else []) +
                  ([" Timestamp.txt"] if save_timestamp else []))
) if (recheck_mode or edit_only_mode) else 0

print(f"\n總計: {len(file_paths)} 個 | 已完成: {len(files_done)} 個 | 需處理: {len(files_to_process)} 個"
      + (f" (其中 {recheck_count} 個已有舊文檔，將重新轉錄並覆蓋)"
         if (recheck_mode or edit_only_mode) and recheck_count else ""))

if not files_to_process:
    messagebox.showinfo("完成", "所有檔案都已有對應的文本檔！")
    exit()

if not messagebox.askyesno("確認",
        f"將處理 {len(files_to_process)} 個檔案"
        + (f"（其中 {len(files_done)} 個已跳過）" if files_done else "")
        + "，是否開始？"):
    print("使用者取消。程式結束。")
    exit()

# 載入模型
model, engine, model_name = load_model_by_key(model_key)

# 斷句邏輯說明
def show_split_logic_info():
    info_win = tk.Toplevel()
    info_win.title("📖 智慧斷句邏輯說明（v7）— mp3toword-Smart v25")
    info_win.geometry("700x620")
    info_win.resizable(True, True)
    info_win.grab_set()
    info_win.configure(bg='#1a252f')
    tk.Label(info_win, text="📖  智慧斷句邏輯說明",
             font=('Microsoft JhengHei', 14, 'bold'),
             bg='#1a252f', fg='white', pady=12).pack()
    text_area = scrolledtext.ScrolledText(
        info_win, wrap=tk.WORD, width=82, height=20,
        font=('Microsoft JhengHei', 10),
        bg='#0d1117', fg='#c9d1d9',
        insertbackground='white', relief=tk.FLAT, padx=12, pady=8)
    text_area.pack(fill=tk.BOTH, expand=True, padx=12, pady=(0, 6))
    logic_text = """
【規則 A｜句尾標點強制斷句】
  句號 . 、驚嘆號 ! 、問號 ? → 無條件立即斷開，不受任何其他規則保護。

【規則 B｜語意安全斷點（spaCy 詞性分析）】
  在逗號、分號後準備斷句時，程式會分析「下一個詞」的詞性：
    ✅ 可以斷：並列連接詞（and / but / or）
    ✅ 可以斷：新主語開頭（大寫名詞 / 代名詞 / 專有名詞）
    ✅ 可以斷：副詞開頭（however / then / suddenly）
    ❌ 不斷：從屬連接詞（that / which / because / when ...）
    ❌ 不斷：介詞（of / in / with / to / from ...）
    ❌ 不斷：冠詞（the / a）→ 避免切斷名詞片語

【規則 C｜時間間隔斷句】
  相鄰兩詞之間靜音間隔 > 0.6 秒 → 判斷為自然停頓，斷開新的一條。

【待斷模式】詞數 ≥ 15 或時長 ≥ 5 秒 → 積極找斷點
【緊急模式】詞數 ≥ 25 → 語意保護全解除，強制斷開
【殘句合併】小寫介詞開頭 → 併入前一條
【短句整合 Pass】詞數 < 6 的短句往上/下合併

【目前參數】  min_words=6  max_words=15  max_duration=5.0s  max_gap=0.6s
"""
    text_area.insert(tk.END, logic_text.strip())
    text_area.config(state=tk.DISABLED)
    mode_labels = {
        '1': '一般轉錄（跳過已有文檔）',
        '2': '重新轉錄＋手動比對',
        '3': '重新轉錄＋全自動覆蓋',
        '4': '轉錄＋純文字斷句編輯',
    }
    tk.Label(info_win,
             text=f"  目前模式：{mode_labels.get(mode_choice, mode_choice)}",
             font=('Microsoft JhengHei', 10, 'bold'),
             bg='#1a252f', fg='#f0c040', pady=4).pack(anchor='w', padx=12)
    tk.Button(info_win, text='  了解，開始處理  ',
              font=('Microsoft JhengHei', 11, 'bold'),
              bg='#27ae60', fg='white', padx=20, pady=6,
              command=info_win.destroy).pack(pady=(4, 12))
    info_win.wait_window()

show_split_logic_info()

# 處理檔案
stats = {'success': 0, 'skip_exist': 0, 'skip_short': 0, 'error': 0}
for i, fp in enumerate(files_to_process):
    print(f"\n{'='*50}")
    print(f"處理 {i+1}/{len(files_to_process)}: {os.path.basename(fp)}")
    print('='*50)
    result = process_audio_file(fp, model, engine, save_plain, save_timestamp,
                                recheck=recheck_mode, auto_mode=auto_mode,
                                edit_only=edit_only_mode)
    stats[result] += 1

print(f"\n{'='*50}")
print(f"完成！成功:{stats['success']} 跳過(已存在):{stats['skip_exist']} "
      f"跳過(太短):{stats['skip_short']} 錯誤:{stats['error']}")
print('='*50)
