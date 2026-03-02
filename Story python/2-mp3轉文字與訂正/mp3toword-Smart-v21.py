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
    # Tab 3：斷點編輯器
    # ════════════════════════════════════════════════════════════
    tab_edit = tk.Frame(nb, bg='#0d1117')
    nb.add(tab_edit, text='  ✂ 斷點編輯  ')

    # ── seg 結構 ──
    # {
    #   'start', 'end', 'text',
    #   'origins': [{'start','end','text'}, ...]  ← 合併歷史，len>1 可恢復
    #   'split_from': seg_id | None               ← 由哪條拆分出來（顯示藍綠色）
    #   'id': int
    # }
    _seg_id_counter = [0]
    def new_id():
        _seg_id_counter[0] += 1
        return _seg_id_counter[0]

    def make_seg(start, end, text, origins=None, split_from=None):
        o = origins if origins is not None else [{'start': start, 'end': end, 'text': text}]
        return {'start': start, 'end': end, 'text': text,
                'origins': o, 'split_from': split_from, 'id': new_id()}

    if new_segs:
        edited_segs = [make_seg(s, e, t) for s, e, t in new_segs]
    elif old_segs:
        edited_segs = [make_seg(s, e, t) for s, e, t in old_segs]
    else:
        edited_segs = []

    edit_state = {
        'segs':          edited_segs,
        'drag_seg':      None,   # 拖曳中的 seg index
        'drag_word':     None,   # 拖曳中的 word index（從此詞開始帶走後面所有詞）
        'drag_ghost':    None,   # 浮動 ghost label
        'drag_drop_idx': None,   # 目前預覽的插入位置（在第幾張卡片之後）
        'drop_indicator':None,   # 當前的橘色插入線 widget
        'card_widgets':  [],     # [(card_frame, seg_idx), ...] 供拖曳定位用
        'focus_seg_id':  None,   # 操作後要捲回的 seg id
    }

    # ── 說明列 ──
    info_fr = tk.Frame(tab_edit, bg='#161b22', pady=6)
    info_fr.pack(fill=tk.X)
    tk.Label(info_fr,
             text='✂ 斷點編輯器：完成後按底部「使用自訂版本」儲存',
             font=('Microsoft JhengHei', 10), bg='#161b22', fg='#c9d1d9', padx=12).pack(anchor='w')
    tk.Label(info_fr,
             text='💡  點擊詞語 → 在該詞後切斷   ｜   拖曳詞語 → 該詞+後半整句被帶走，拖到目標位置放開插入   ｜   🔗 合併兩條   ｜   ↩ 恢復原始',
             font=('Microsoft JhengHei', 9), bg='#161b22', fg='#8b949e', padx=12).pack(anchor='w')

    # ── Canvas + Scrollbar ──
    edit_outer = tk.Frame(tab_edit, bg='#0d1117')
    edit_outer.pack(fill=tk.BOTH, expand=True)
    edit_canvas = tk.Canvas(edit_outer, bg='#0d1117', highlightthickness=0)
    edit_vsb = tk.Scrollbar(edit_outer, orient=tk.VERTICAL, command=edit_canvas.yview)
    edit_canvas.configure(yscrollcommand=edit_vsb.set)
    edit_vsb.pack(side=tk.RIGHT, fill=tk.Y)
    edit_canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
    edit_inner = tk.Frame(edit_canvas, bg='#0d1117')
    edit_cwin = edit_canvas.create_window((0, 0), window=edit_inner, anchor='nw')
    edit_canvas.bind('<Configure>', lambda e: edit_canvas.itemconfig(edit_cwin, width=e.width))
    edit_inner.bind('<Configure>', lambda e: edit_canvas.configure(scrollregion=edit_canvas.bbox('all')))
    # 滾輪只在 edit_canvas 上方才作用
    edit_canvas.bind('<Enter>', lambda e: edit_canvas.bind_all('<MouseWheel>',
        lambda ev: edit_canvas.yview_scroll(int(-1*(ev.delta/120)), 'units')))
    edit_canvas.bind('<Leave>', lambda e: edit_canvas.unbind_all('<MouseWheel>'))

    def fmt_time(sec):
        m_ = int(sec // 60); s_ = sec % 60
        return f'{m_:02d}:{s_:05.2f}'

    # ── 顏色定義 ──
    COLOR = {
        'normal': {'card': '#161b22', 'txt_bg': '#1c2129', 'txt_fg': '#e6edf3',
                   'badge_bg': None,      'badge_fg': None,      'badge': ''},
        'merged': {'card': '#1e1a2e', 'txt_bg': '#1e1a2e', 'txt_fg': '#d4b8f0',
                   'badge_bg': '#3a2060', 'badge_fg': '#c792ea', 'badge': '⊕ 已合併'},
        'split':  {'card': '#0a1e30', 'txt_bg': '#0a1e30', 'txt_fg': '#7dd8f0',
                   'badge_bg': '#0a3a50', 'badge_fg': '#56c8ea', 'badge': '✂ 已拆分'},
    }

    def seg_kind(seg):
        if len(seg.get('origins', [])) > 1: return 'merged'
        if seg.get('split_from') is not None: return 'split'
        return 'normal'

    # ─────────────────────────────────────────────
    # 捲動到指定 seg
    # ─────────────────────────────────────────────
    def scroll_to_seg_id(seg_id):
        """在 rebuild 後，把畫面捲到包含 seg_id 的卡片。"""
        if seg_id is None:
            return
        def _do():
            for card_w, s_idx in edit_state['card_widgets']:
                segs = edit_state['segs']
                if s_idx < len(segs) and segs[s_idx]['id'] == seg_id:
                    try:
                        edit_canvas.update_idletasks()
                        card_y = card_w.winfo_y()
                        canvas_h = edit_canvas.winfo_height()
                        total_h  = edit_inner.winfo_height()
                        if total_h > 0:
                            frac = max(0.0, min(1.0, (card_y - 40) / total_h))
                            edit_canvas.yview_moveto(frac)
                    except Exception:
                        pass
                    break
        edit_canvas.after(80, _do)

    # ─────────────────────────────────────────────
    # 拖曳邏輯
    # ─────────────────────────────────────────────
    def _clear_drop_indicator():
        ind = edit_state.get('drop_indicator')
        if ind:
            try: ind.destroy()
            except: pass
        edit_state['drop_indicator'] = None
        edit_state['drag_drop_idx']  = None

    def _get_drop_position(wy_root):
        """根據滑鼠 y（螢幕座標），判斷要插入在第幾張卡片之後（回傳 0..N）。
        0 = 插到最前面；N = 插到最後面。
        """
        best_idx = 0
        for card_w, s_idx in edit_state['card_widgets']:
            try:
                cy = card_w.winfo_rooty() + card_w.winfo_height() // 2
                if wy_root > cy:
                    best_idx = s_idx + 1
            except Exception:
                pass
        return best_idx

    def _show_drop_indicator(drop_idx):
        """在 drop_idx 位置（第 drop_idx 張卡片之後）畫橘色插入線。"""
        _clear_drop_indicator()
        cards = edit_state['card_widgets']
        if not cards:
            return
        edit_state['drag_drop_idx'] = drop_idx

        # 找參考 widget
        if drop_idx == 0:
            ref_w = cards[0][0]
            anchor_y = ref_w.winfo_y() - 4
        elif drop_idx >= len(cards):
            ref_w = cards[-1][0]
            anchor_y = ref_w.winfo_y() + ref_w.winfo_height() + 2
        else:
            ref_w = cards[drop_idx][0]
            anchor_y = ref_w.winfo_y() - 4

        ind = tk.Frame(edit_inner, bg='#ff8c00', height=3)
        ind.place(x=10, y=anchor_y, relwidth=1.0, width=-20, height=3)
        edit_state['drop_indicator'] = ind

    def on_drag_start(event, seg_idx, word_idx):
        """
        開始拖曳 word_idx 這個詞：
        ghost 顯示「該詞 + 後面所有詞」（整個後半句）。
        """
        edit_state['drag_seg']  = seg_idx
        edit_state['drag_word'] = word_idx
        segs  = edit_state['segs']
        words = segs[seg_idx]['text'].split()
        tail_text = ' '.join(words[word_idx:])   # 從這個詞起整段後半

        ghost = tk.Label(win,
                         text=f'  {tail_text}  ',
                         bg='#f0a000', fg='#1a1a1a',
                         font=('Microsoft JhengHei', 10, 'bold'),
                         padx=8, pady=4,
                         relief=tk.RAISED, bd=2,
                         wraplength=600, justify=tk.LEFT)
        ghost.place(x=event.x_root - win.winfo_rootx() + 12,
                    y=event.y_root - win.winfo_rooty() - 10)
        edit_state['drag_ghost'] = ghost

    def on_drag_motion(event):
        ghost = edit_state.get('drag_ghost')
        if not ghost:
            return
        ghost.place(x=event.x_root - win.winfo_rootx() + 12,
                    y=event.y_root - win.winfo_rooty() - 10)
        drop_idx = _get_drop_position(event.y_root)
        if drop_idx != edit_state.get('drag_drop_idx'):
            _show_drop_indicator(drop_idx)

    def on_drag_release(event):
        ghost = edit_state.get('drag_ghost')
        if not ghost:
            return
        try: ghost.destroy()
        except: pass
        edit_state['drag_ghost'] = None
        _clear_drop_indicator()

        seg_idx  = edit_state.get('drag_seg')
        word_idx = edit_state.get('drag_word')
        drop_idx = _get_drop_position(event.y_root)

        edit_state['drag_seg']  = None
        edit_state['drag_word'] = None

        if seg_idx is None or word_idx is None:
            return

        do_drag_split_and_insert(seg_idx, word_idx, drop_idx)

    # ─────────────────────────────────────────────
    # 資料操作
    # ─────────────────────────────────────────────
    def do_drag_split_and_insert(seg_idx, word_idx, drop_idx):
        """
        把 seg[seg_idx] 在 word_idx 處切開：
          前半留在原位，後半（tail）插入到 drop_idx 位置。
        若 drop_idx == seg_idx+1（就是原來位置的下一格）等同於普通 split。
        若 word_idx == 0 表示整條被拖走，不切割只移動。
        """
        segs  = edit_state['segs']
        seg   = segs[seg_idx]
        words = seg['text'].split()
        parent_id = seg['id']

        if word_idx == 0:
            # 整條移動
            tail_seg = make_seg(seg['start'], seg['end'], seg['text'],
                                split_from=parent_id)
            new_segs = [s for i, s in enumerate(segs) if i != seg_idx]
            # 計算調整後的 drop_idx
            adj = drop_idx if drop_idx <= seg_idx else drop_idx - 1
            adj = max(0, min(adj, len(new_segs)))
            new_segs = new_segs[:adj] + [tail_seg] + new_segs[adj:]
        else:
            text_head = ' '.join(words[:word_idx])
            text_tail = ' '.join(words[word_idx:])
            ratio     = word_idx / len(words)
            mid       = seg['start'] + (seg['end'] - seg['start']) * ratio

            head_seg = make_seg(seg['start'], mid,       text_head, split_from=parent_id)
            tail_seg = make_seg(mid,          seg['end'], text_tail, split_from=parent_id)

            # 先把原本的 seg 換成 head
            new_segs = segs[:seg_idx] + [head_seg] + segs[seg_idx + 1:]
            # 再把 tail 插到 drop_idx（已調整）
            adj = drop_idx if drop_idx <= seg_idx else drop_idx
            adj = max(0, min(adj, len(new_segs)))
            new_segs = new_segs[:adj] + [tail_seg] + new_segs[adj:]

        edit_state['segs']        = new_segs
        edit_state['focus_seg_id'] = tail_seg['id']
        rebuild_edit_ui()
        scroll_to_seg_id(tail_seg['id'])

    def do_split(seg_idx, word_idx):
        """點擊切斷：在 word_idx 後切，兩條留在原位。"""
        segs  = edit_state['segs']
        seg   = segs[seg_idx]
        words = seg['text'].split()
        if word_idx < 0 or word_idx >= len(words) - 1:
            return
        text_a = ' '.join(words[:word_idx + 1])
        text_b = ' '.join(words[word_idx + 1:])
        ratio  = (word_idx + 1) / len(words)
        mid    = seg['start'] + (seg['end'] - seg['start']) * ratio
        pid    = seg['id']
        seg_a  = make_seg(seg['start'], mid,        text_a, split_from=pid)
        seg_b  = make_seg(mid,          seg['end'],  text_b, split_from=pid)
        edit_state['segs'] = segs[:seg_idx] + [seg_a, seg_b] + segs[seg_idx + 1:]
        edit_state['focus_seg_id'] = seg_b['id']
        rebuild_edit_ui()
        scroll_to_seg_id(seg_b['id'])

    def do_merge(idx):
        segs = edit_state['segs']
        if idx + 1 >= len(segs):
            return
        a, b = segs[idx], segs[idx + 1]
        merged_origins = a.get('origins', [{'start':a['start'],'end':a['end'],'text':a['text']}]) + \
                         b.get('origins', [{'start':b['start'],'end':b['end'],'text':b['text']}])
        merged = make_seg(a['start'], b['end'],
                          a['text'].rstrip() + ' ' + b['text'].lstrip(),
                          origins=merged_origins)
        edit_state['segs'] = segs[:idx] + [merged] + segs[idx + 2:]
        edit_state['focus_seg_id'] = merged['id']
        rebuild_edit_ui()
        scroll_to_seg_id(merged['id'])

    def do_restore(seg_idx):
        segs    = edit_state['segs']
        seg     = segs[seg_idx]
        origins = seg.get('origins', [])
        if len(origins) <= 1:
            return
        restored = [make_seg(o['start'], o['end'], o['text']) for o in origins]
        edit_state['segs'] = segs[:seg_idx] + restored + segs[seg_idx + 1:]
        edit_state['focus_seg_id'] = restored[0]['id']
        rebuild_edit_ui()
        scroll_to_seg_id(restored[0]['id'])

    # ─────────────────────────────────────────────
    # UI 渲染
    # ─────────────────────────────────────────────
    def rebuild_edit_ui():
        for w in edit_inner.winfo_children():
            w.destroy()
        edit_state['card_widgets'] = []

        segs = edit_state['segs']

        for idx, seg in enumerate(segs):
            kind    = seg_kind(seg)
            C       = COLOR[kind]
            card_bg = C['card']
            txt_bg  = C['txt_bg']
            txt_fg  = C['txt_fg']

            card = tk.Frame(edit_inner, bg=card_bg, bd=1, relief=tk.SOLID, padx=8, pady=6)
            card.pack(fill=tk.X, padx=10, pady=(6, 0))
            edit_state['card_widgets'].append((card, idx))

            # ── 標頭：時間戳記 + 徽章 ──
            hdr = tk.Frame(card, bg=card_bg)
            hdr.pack(fill=tk.X)
            tk.Label(hdr,
                     text=f"  [{fmt_time(seg['start'])} → {fmt_time(seg['end'])}]",
                     bg=card_bg, fg='#58a6ff',
                     font=('Consolas', 9), anchor='w').pack(side=tk.LEFT)
            if C['badge']:
                origins = seg.get('origins', [])
                n_lbl   = f' {len(origins)} 條' if kind == 'merged' else ''
                tk.Label(hdr,
                         text=f" {C['badge']}{n_lbl} ",
                         bg=C['badge_bg'], fg=C['badge_fg'],
                         font=('Microsoft JhengHei', 8, 'bold'),
                         padx=4, pady=1).pack(side=tk.LEFT, padx=6)

            # ── 詞語列 ──
            txt_frame = tk.Frame(card, bg=txt_bg, padx=6, pady=6)
            txt_frame.pack(fill=tk.X, pady=(4, 0))

            words = seg['text'].split()
            for wi, word in enumerate(words):
                is_last = (wi == len(words) - 1)

                w_lbl = tk.Label(txt_frame,
                                 text=word + ' ',
                                 bg=txt_bg, fg=txt_fg,
                                 font=('Microsoft JhengHei', 11),
                                 cursor='fleur' if not is_last else 'arrow',
                                 padx=2, pady=2)
                w_lbl.pack(side=tk.LEFT)

                if not is_last:
                    hover_bg = '#223322'
                    # 懸停：橘色提示「這個詞後面可以切」
                    def _enter(e, lbl=w_lbl, orig_bg=txt_bg):
                        lbl.config(bg='#3a2800', fg='#ffb340')
                    def _leave(e, lbl=w_lbl, orig_bg=txt_bg, orig_fg=txt_fg):
                        lbl.config(bg=orig_bg, fg=orig_fg)
                    w_lbl.bind('<Enter>', _enter)
                    w_lbl.bind('<Leave>', _leave)

                    # 點擊 = 直接切斷（在此詞之後）
                    w_lbl.bind('<Button-1>',
                               lambda e, si=idx, wi_=wi: do_split(si, wi_))

                    # 拖曳開始（移動超過 3px 才算拖曳，避免誤觸）
                    drag_origin = [None, None]

                    def _motion_start(e, si=idx, wi_=wi, dorg=drag_origin):
                        if dorg[0] is None:
                            dorg[0] = e.x_root
                            dorg[1] = e.y_root
                        elif (abs(e.x_root - dorg[0]) > 3 or abs(e.y_root - dorg[1]) > 3):
                            if edit_state.get('drag_ghost') is None:
                                on_drag_start(e, si, wi_)
                            else:
                                on_drag_motion(e)
                        else:
                            on_drag_motion(e)

                    w_lbl.bind('<B1-Motion>', _motion_start)

            # ── 底部操作列 ──
            act = tk.Frame(card, bg=card_bg)
            act.pack(fill=tk.X, pady=(3, 0))
            if len(words) > 1:
                tk.Label(act,
                         text='↑ 點擊詞語切斷  ｜  拖曳詞語帶走後半句',
                         bg=card_bg, fg='#484f58',
                         font=('Microsoft JhengHei', 8)).pack(side=tk.LEFT)

            # 恢復按鈕（合併過才顯示）
            if kind == 'merged':
                origins = seg.get('origins', [])
                preview = '　/　'.join(
                    f'「{o["text"][:26]}{"…" if len(o["text"])>26 else ""}」'
                    for o in origins[:3])
                if len(origins) > 3:
                    preview += f'　…共 {len(origins)} 條'
                rst_fr = tk.Frame(card, bg='#2a1e40', padx=6, pady=4)
                rst_fr.pack(fill=tk.X, pady=(4, 0))
                tk.Label(rst_fr, text=f'原始：{preview}',
                         bg='#2a1e40', fg='#9e7ac7',
                         font=('Microsoft JhengHei', 8),
                         wraplength=900, justify=tk.LEFT).pack(side=tk.LEFT, fill=tk.X, expand=True)
                tk.Button(rst_fr, text='↩ 恢復原始斷點',
                          font=('Microsoft JhengHei', 9, 'bold'),
                          bg='#5a3a80', fg='#e0c9ff',
                          activebackground='#7a4aaa', activeforeground='white',
                          bd=0, padx=10, pady=3, cursor='hand2',
                          command=lambda si=idx: do_restore(si)).pack(side=tk.RIGHT, padx=4)

            # ── 卡片間合併按鈕 ──
            if idx < len(segs) - 1:
                mr = tk.Frame(edit_inner, bg='#0d1117', pady=1)
                mr.pack(fill=tk.X, padx=10)
                tk.Frame(mr, bg='#30363d', height=1).pack(side=tk.LEFT, fill=tk.X, expand=True, pady=7)
                tk.Button(mr, text='🔗 合併這兩條',
                          font=('Microsoft JhengHei', 9),
                          bg='#1f3a5f', fg='#79c0ff',
                          activebackground='#2d5986', activeforeground='white',
                          bd=0, padx=10, pady=3, cursor='hand2',
                          command=lambda mi=idx: do_merge(mi)).pack(side=tk.LEFT, padx=8)
                tk.Frame(mr, bg='#30363d', height=1).pack(side=tk.LEFT, fill=tk.X, expand=True, pady=7)

        # 段落總數
        cf = tk.Frame(edit_inner, bg='#161b22', pady=4)
        cf.pack(fill=tk.X, padx=10, pady=(8, 4))
        tk.Label(cf, text=f'  📊 目前共 {len(segs)} 條段落',
                 bg='#161b22', fg='#8b949e',
                 font=('Microsoft JhengHei', 9)).pack(anchor='w')

    # 全域放開事件（拖曳結束）
    win.bind('<ButtonRelease-1>', lambda e: on_drag_release(e))

    # 初始渲染
    rebuild_edit_ui()

    # ── 預設顯示智慧比對 ──
    nb.select(0)

    # ── 按鈕區 ──
    btn = tk.Frame(win, bg='#f0f0f0', pady=10)
    btn.pack(fill=tk.X)

    def choose(val, custom_segs=None):
        result['choice'] = val
        if custom_segs is not None:
            result['custom_segs'] = custom_segs
        win.destroy()

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
              command=lambda: choose('custom', edit_state['segs'])).pack(side=tk.LEFT, padx=5)
    tk.Button(btn, text='⏭ 略過此檔',
              font=('Microsoft JhengHei',10),
              bg='#7f8c8d', fg='white', padx=15, pady=6,
              command=lambda: choose('skip')).pack(side=tk.RIGHT, padx=20)

    win.protocol("WM_DELETE_WINDOW", lambda: choose('skip'))
    win.wait_window()
    return result['choice'], result.get('custom_segs')

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
    """將 path 備份為 path（原檔）.ext，若備份已存在則加編號。"""
    if not os.path.exists(path):
        return None
    base, ext = os.path.splitext(path)
    backup_path = base + "（原檔）" + ext
    if os.path.exists(backup_path):
        n = 2
        while os.path.exists(f"{base}（原檔{n}）{ext}"):
            n += 1
        backup_path = f"{base}（原檔{n}）{ext}"
    import shutil
    shutil.copy2(path, backup_path)
    return backup_path


def process_audio_file(file_path, model, engine, save_plain, save_timestamp,
                       recheck=False, auto_mode=False):
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

                if auto_mode and os.path.exists(txt_path):
                    # 全自動：備份舊檔後直接覆蓋
                    bk = backup_file(txt_path)
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write(new_content)
                    print(f"  [自動覆蓋] 純文字已備份至 {os.path.basename(bk)}，新版已寫入")
                elif recheck and os.path.exists(txt_path):
                    with open(txt_path, "r", encoding="utf-8") as f:
                        old_content = f.read()
                    if old_content.strip() == new_content.strip():
                        print(f"  [相同] 純文字內容一致，無需更新: {os.path.basename(txt_path)}")
                    else:
                        print(f"  [差異] 純文字有差異，開啟比對視窗...")
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
                    if old_ts_content.strip() == new_ts_content.strip():
                        print(f"  [相同] 時間戳記內容一致，無需更新: {os.path.basename(ts_path)}")
                    else:
                        print(f"  [差異] 時間戳記有差異，開啟比對視窗...")
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

# 步驟 2.5：是否啟用重新轉錄並比對差異 / 全自動模式
recheck_mode = False
auto_mode    = False

mode_choice = simpledialog.askstring(
    "重新轉錄模式",
    "選擇處理模式（輸入數字）：\n\n"
    "  1  一般模式（已有文檔的檔案直接跳過）\n"
    "  2  重新轉錄比對模式（手動決定覆蓋/保留）\n"
    "  3  全自動模式（自動覆蓋，舊檔備份為「原檔」）\n",
    initialvalue="1"
)
mode_choice = (mode_choice or "1").strip()
if mode_choice == "2":
    recheck_mode = True
elif mode_choice == "3":
    recheck_mode = True
    auto_mode    = True

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

# 步驟 5.5：顯示斷句邏輯說明
def show_split_logic_info():
    info_win = tk.Toplevel()
    info_win.title("📖 智慧斷句邏輯說明（v7）")
    info_win.geometry("700x540")
    info_win.resizable(False, False)
    info_win.grab_set()
    info_win.configure(bg='#1a252f')

    tk.Label(info_win, text="📖  智慧斷句邏輯說明",
             font=('Microsoft JhengHei', 14, 'bold'),
             bg='#1a252f', fg='white', pady=12).pack()

    text_area = scrolledtext.ScrolledText(
        info_win, wrap=tk.WORD, width=82, height=24,
        font=('Microsoft JhengHei', 10),
        bg='#0d1117', fg='#c9d1d9',
        insertbackground='white', relief=tk.FLAT, padx=12, pady=8)
    text_area.pack(fill=tk.BOTH, expand=True, padx=12, pady=(0, 6))

    logic_text = """
【規則 A｜句尾標點強制斷句】
  句號 . 、驚嘆號 ! 、問號 ? → 無條件立即斷開，不受任何其他規則保護。
  這保證每個完整句子都獨立成一條，是最高優先規則。

【規則 B｜語意安全斷點（spaCy 詞性分析）】
  在逗號、分號後準備斷句時，程式會分析「下一個詞」的詞性：
    ✅ 可以斷：並列連接詞（and / but / or）
    ✅ 可以斷：新主語開頭（大寫名詞 / 代名詞 / 專有名詞）
    ✅ 可以斷：副詞開頭（however / then / suddenly）
    ❌ 不斷：從屬連接詞（that / which / because / when ...）
    ❌ 不斷：介詞（of / in / with / to / from ...）
    ❌ 不斷：冠詞（the / a）→ 避免切斷名詞片語
  若未安裝 spaCy，自動降級為純字串規則（大寫=可斷，小寫連接詞=不斷）。

【規則 C｜時間間隔斷句】
  相鄰兩詞之間靜音間隔 > 0.6 秒 → 判斷為自然停頓，斷開新的一條。
  例外：若前一個詞是連接詞（and/but/if/because 等）且字數 < 6，
  保護這個短片段不被間隔切開，避免「But」「And then」單獨成行。

【待斷模式（字數/時長觸發）】
  當一條句子累積詞數 ≥ 15，或時長 ≥ 5 秒，進入「待斷模式」：
  → 此後遇到任何逗號（且語意安全）或停頓，立即斷開
  緊急模式：詞數 ≥ 25 → 語意保護完全解除，強制斷開

【殘句合併】
  斷句完成後，若某條句子以「小寫介詞」開頭（of/in/with...）
  → 視為上一句的延伸，自動往前合併。

【短句整合 Pass（v7 新增）⭐】
  全部斷句完成後，對「詞數 < 6」的短句進行二次整合：
    ① 優先往下合併（若下一句詞數 ≤ 30）
    ② 若下一句太長，嘗試往上合併（若上一句詞數 ≤ 30）
    ③ 上下句都超過 30 詞 → 保留短句不動，避免句子過長
  這確保每條輸出至少有 6 個詞，提高閱讀舒適度。

【目前參數設定】
  最小詞數（min_words）：6
  最大詞數（max_words）：15
  最大時長（max_duration）：5.0 秒
  最大停頓間隔（max_gap）：0.6 秒
"""
    text_area.insert(tk.END, logic_text.strip())
    text_area.config(state=tk.DISABLED)

    mode_lbl = "全自動模式（自動備份+覆蓋）" if auto_mode else \
               "重新轉錄比對模式（手動確認）" if recheck_mode else \
               "一般模式（跳過已有文檔）"
    tk.Label(info_win,
             text=f"  目前模式：{mode_lbl}",
             font=('Microsoft JhengHei', 10, 'bold'),
             bg='#1a252f', fg='#f0c040', pady=4).pack(anchor='w', padx=12)

    tk.Button(info_win, text='  了解，開始處理  ',
              font=('Microsoft JhengHei', 11, 'bold'),
              bg='#27ae60', fg='white', padx=20, pady=6,
              command=info_win.destroy).pack(pady=(4, 12))
    info_win.wait_window()

show_split_logic_info()

# 步驟 6：處理檔案
stats = {'success': 0, 'skip_exist': 0, 'skip_short': 0, 'error': 0}
for i, fp in enumerate(files_to_process):
    print(f"\n{'='*50}")
    print(f"處理 {i+1}/{len(files_to_process)}: {os.path.basename(fp)}")
    print('='*50)
    result = process_audio_file(fp, model, engine, save_plain, save_timestamp,
                                recheck=recheck_mode, auto_mode=auto_mode)
    stats[result] += 1

print(f"\n{'='*50}")
print(f"完成！成功:{stats['success']} 跳過(已存在):{stats['skip_exist']} 跳過(太短):{stats['skip_short']} 錯誤:{stats['error']}")
print('='*50)
