import os
import re
import torch
import difflib
import tkinter as tk
from tkinter import Tk, messagebox, simpledialog, scrolledtext, ttk
from tkinter.filedialog import askopenfilenames, askdirectory

def show_diff_dialog(filename, old_text, new_text):
    """
    顯示新舊文本的差異比對視窗，讓使用者選擇保留哪個版本。
    回傳值：'new' 表示使用新文本，'old' 表示保留舊文本，'skip' 表示略過。
    """
    result = {'choice': 'skip'}

    win = tk.Toplevel()
    win.title(f"差異比對 - {filename}")
    win.geometry("1100x700")
    win.resizable(True, True)
    win.grab_set()  # 強制焦點

    # ── 標題說明 ──
    header = tk.Frame(win, bg="#2c3e50", pady=8)
    header.pack(fill=tk.X)
    tk.Label(header, text=f"📄 {filename}　的轉錄差異比對",
             font=("Microsoft JhengHei", 13, "bold"), fg="white", bg="#2c3e50").pack()
    tk.Label(header, text="請確認要使用哪個版本",
             font=("Microsoft JhengHei", 10), fg="#bdc3c7", bg="#2c3e50").pack()

    # ── 統計資訊 ──
    old_lines = old_text.splitlines()
    new_lines = new_text.splitlines()
    diff = list(difflib.unified_diff(old_lines, new_lines, lineterm=''))
    added   = sum(1 for l in diff if l.startswith('+') and not l.startswith('+++'))
    removed = sum(1 for l in diff if l.startswith('-') and not l.startswith('---'))

    stats_frame = tk.Frame(win, bg="#ecf0f1", pady=4)
    stats_frame.pack(fill=tk.X, padx=10, pady=(5, 0))
    tk.Label(stats_frame,
             text=f"舊文本：{len(old_lines)} 行　新文本：{len(new_lines)} 行　新增：+{added} 行　刪除：-{removed} 行",
             font=("Microsoft JhengHei", 10), bg="#ecf0f1", fg="#555").pack()

    # ── 分頁顯示（Tab：並排比對 / 逐行差異） ──
    notebook = ttk.Notebook(win)
    notebook.pack(fill=tk.BOTH, expand=True, padx=10, pady=5)

    # ─ Tab 1：並排比對 ─
    tab1 = tk.Frame(notebook)
    notebook.add(tab1, text="  並排比對  ")

    paned = tk.PanedWindow(tab1, orient=tk.HORIZONTAL, sashwidth=6, bg="#95a5a6")
    paned.pack(fill=tk.BOTH, expand=True)

    def make_panel(parent, title, color):
        frame = tk.Frame(parent, bd=0)
        tk.Label(frame, text=title, font=("Microsoft JhengHei", 10, "bold"),
                 bg=color, fg="white", pady=4).pack(fill=tk.X)
        txt = scrolledtext.ScrolledText(frame, wrap=tk.WORD, font=("Consolas", 10),
                                        bg="#fdfefe", relief=tk.FLAT, bd=1)
        txt.pack(fill=tk.BOTH, expand=True)
        return frame, txt

    left_frame,  old_txt = make_panel(paned, "　舊文本（原有檔案）", "#c0392b")
    right_frame, new_txt = make_panel(paned, "　新文本（剛轉錄結果）", "#27ae60")
    paned.add(left_frame,  minsize=200)
    paned.add(right_frame, minsize=200)

    old_txt.insert(tk.END, old_text)
    new_txt.insert(tk.END, new_text)
    old_txt.config(state=tk.DISABLED)
    new_txt.config(state=tk.DISABLED)

    # ─ Tab 2：逐行 Diff ─
    tab2 = tk.Frame(notebook)
    notebook.add(tab2, text="  逐行差異  ")

    diff_txt = scrolledtext.ScrolledText(tab2, wrap=tk.WORD, font=("Consolas", 10),
                                          bg="#1e1e1e", fg="#d4d4d4", relief=tk.FLAT)
    diff_txt.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)
    diff_txt.tag_configure("add",    foreground="#6ec17a", background="#1e3a1e")
    diff_txt.tag_configure("remove", foreground="#f47678", background="#3a1e1e")
    diff_txt.tag_configure("header", foreground="#569cd6")
    diff_txt.tag_configure("same",   foreground="#808080")

    for line in difflib.unified_diff(old_lines, new_lines,
                                     fromfile="舊文本", tofile="新文本", lineterm=''):
        if line.startswith('+++') or line.startswith('---'):
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

    # ── 按鈕區 ──
    btn_frame = tk.Frame(win, bg="#f0f0f0", pady=10)
    btn_frame.pack(fill=tk.X)

    def choose(val):
        result['choice'] = val
        win.destroy()

    tk.Button(btn_frame, text="✅ 使用新文本（覆蓋舊檔）",
              font=("Microsoft JhengHei", 11, "bold"),
              bg="#27ae60", fg="white", padx=20, pady=6,
              command=lambda: choose('new')).pack(side=tk.LEFT, padx=20)

    tk.Button(btn_frame, text="🔒 保留舊文本（不覆蓋）",
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


def smart_sentence_split(segments, max_gap=0.6, max_duration=5.0, max_words=15, min_words=4):
    """
    智能斷句 v4：
    ─────────────────────────────────────────────────────────
    設計理念：「超過範圍後，耐心等待最近的自然斷點」
    - 詞數/時長超過軟上限後進入「待斷模式」，不硬切，
      等到下一個句尾標點（.!?）或逗號（,）才斷。
    - 斷點優先級：句尾標點 > 逗號/停頓 > 時間間隔 > 句尾（保護中）
    - 連接詞保護（and/but/when/...）只在詞數尚少時有效；
      進入待斷模式後連接詞保護自動失效，讓斷句更積極。
    - 句數計數：遇到第 1 個句尾後，下個句尾立刻斷（不受保護）。
    - 殘句合併：詞數 < min_words 或以接續介詞開頭 → 併入前一條。
    ─────────────────────────────────────────────────────────
    """
    SE  = {'.', '!', '?', '。', '！', '？'}   # 句尾標點
    PP  = {',', ';', ':', '，', '；', '：'}   # 停頓標點
    JW  = {                                    # 連接詞（待斷前保護）
        'that', 'and', 'but', 'or', 'nor', 'so', 'yet',
        'which', 'who', 'whom', 'whose', 'when', 'where',
        'because', 'although', 'though', 'while', 'as',
        'if', 'unless', 'until', 'since', 'after', 'before',
    }
    CS  = {                                    # 接續介詞（殘句合併用）
        'with', 'to', 'of', 'from', 'in', 'at', 'for', 'on',
        'about', 'into', 'by', 'than', 'through',
    }

    new_segments = []
    st = {'s': None, 'e': None, 't': '', 'wc': 0, 'lw': '', 'sc': 0, 'waiting': False}

    def do_flush():
        """輸出目前累積的句段，殘句則合併到前一條。"""
        txt = st['t'].strip()
        if not txt:
            return
        ws = txt.split()
        fw = ws[0].lower().rstrip('.,!?;:') if ws else ''
        is_fragment = len(ws) < min_words or fw in CS
        if is_fragment and new_segments:
            new_segments[-1]['text'] = new_segments[-1]['text'].rstrip() + ' ' + txt
            new_segments[-1]['end']  = st['e']
        else:
            new_segments.append({'start': st['s'], 'end': st['e'], 'text': txt})
        st['s'] = None; st['e'] = None; st['t'] = ''
        st['wc'] = 0;   st['lw'] = '';  st['sc'] = 0; st['waiting'] = False

    for segment in segments:
        words = None
        if hasattr(segment, 'words') and segment.words:
            words = [{'word': w.word, 'start': w.start, 'end': w.end} for w in segment.words]
        elif isinstance(segment, dict) and 'words' in segment and segment['words']:
            words = segment['words']

        # 無詞時間資訊 → 用標點切分後平均分配時間
        if not words:
            text      = (segment.text    if hasattr(segment, 'text')  else segment['text']).strip()
            seg_start = (segment.start   if hasattr(segment, 'start') else segment['start'])
            seg_end   = (segment.end     if hasattr(segment, 'end')   else segment['end'])
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
            for idx, sub in enumerate(subs):
                new_segments.append({
                    'start': seg_start + idx * tpp,
                    'end':   seg_start + (idx + 1) * tpp,
                    'text':  sub,
                })
            continue

        # ── 逐詞處理 ──
        for wi in words:
            w  = (wi.get('word', '') if isinstance(wi, dict) else wi.word).strip()
            if not w:
                continue
            ws = wi.get('start') if isinstance(wi, dict) else wi.start
            we = wi.get('end')   if isinstance(wi, dict) else wi.end
            if ws is None:
                ts = wi.get('timestamp', [None, None])
                ws, we = ts[0], ts[1]
            if ws is None:
                continue
            if we is None:
                we = ws

            wclean = w.lower().rstrip('.,!?;:')
            es = w[-1] in SE   # 句尾
            ep = w[-1] in PP   # 停頓

            if st['s'] is None:
                st['s'] = ws; st['e'] = we

            # 連接詞保護：僅在「尚未進入待斷模式 且 詞數較少」時有效
            jg = (st['lw'] in JW) and (not st['waiting']) and (st['wc'] < 6)

            # ── 觸發「待斷模式」條件 ──
            # 詞數超過軟上限，或時長超過軟上限 → 標記 waiting，等自然斷點
            if (st['wc'] >= max_words) or ((we - st['s']) > max_duration):
                st['waiting'] = True

            # ── 待斷模式：遇句尾、逗號、或時間停頓立刻斷（無連接詞保護）──
            if st['waiting'] and (es or ep or (st['t'] and (ws - st['e']) > max_gap * 0.7)):
                st['e'] = we; st['t'] += ' ' + w; st['lw'] = wclean
                if es: st['sc'] += 1
                do_flush(); continue

            # ── 時間間隔過大 → 斷句（jg 有效）──
            if st['t'] and (ws - st['e']) > max_gap and not jg:
                do_flush()
                st['s'] = ws; st['e'] = we; st['t'] = w; st['wc'] = 1; st['lw'] = wclean
                if es: st['sc'] = 1
                continue

            # ── 已完成 1 句 → 下個句尾立刻斷（無保護）──
            if st['sc'] >= 1 and es:
                st['e'] = we; st['t'] += ' ' + w; st['lw'] = wclean; st['sc'] += 1
                do_flush(); continue

            # ── 正常加詞 ──
            st['e'] = we; st['t'] += ' ' + w; st['wc'] += 1; st['lw'] = wclean
            if es:
                st['sc'] += 1
                if not jg:
                    do_flush()

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
