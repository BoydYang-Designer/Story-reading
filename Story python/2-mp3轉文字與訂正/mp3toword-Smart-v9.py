import os
import re
import torch
from tkinter import Tk, messagebox, simpledialog
from tkinter.filedialog import askopenfilenames, askdirectory

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


def smart_sentence_split(segments, max_gap=0.6, max_duration=6.0, max_words=18, min_words=3):
    """
    智能斷句 v2：
    - 不在連接詞（that/and/but/or/which/who/when/where/because/so）後斷句
    - 殘句（詞數不足 min_words）合併到前一句
    - 支援原版 Whisper 和 faster-whisper 格式
    """
    sentence_endings = {'.', '!', '?', '。', '！', '？'}
    pause_punctuations = {',', ';', ':', '，', '；', '：'}
    # 不在這些連接詞後面斷句
    joining_words = {
        'that', 'and', 'but', 'or', 'nor', 'so', 'yet',
        'which', 'who', 'whom', 'whose', 'when', 'where',
        'because', 'although', 'though', 'while', 'as',
        'if', 'unless', 'until', 'since', 'after', 'before',
    }

    new_segments = []
    current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0, 'last_word_clean': ''}

    def flush(current_sentence, new_segments):
        """輸出當前句子，若詞數不足則合併到上一句"""
        text = current_sentence['text'].strip()
        if not text:
            return
        word_count = len(text.split())
        if word_count < min_words and new_segments:
            # 殘句合併到上一句
            prev = new_segments[-1]
            new_segments[-1] = {
                'start': prev['start'],
                'end': current_sentence['end'],
                'text': prev['text'].rstrip() + ' ' + text
            }
        else:
            new_segments.append({
                'start': current_sentence['start'],
                'end': current_sentence['end'],
                'text': text
            })

    for segment in segments:
        # 取得 words（相容兩種格式）
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
            sub_sentences = []
            temp = ""
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

            # 1. 時間間隔過大 → 強制斷句（但不在連接詞後斷）
            if current_sentence['text'] and (word_start - current_sentence['end']) > max_gap:
                if current_sentence['last_word_clean'] not in joining_words:
                    flush(current_sentence, new_segments)
                    current_sentence = {'start': word_start, 'end': word_end, 'text': word, 'word_count': 1, 'last_word_clean': word_clean}
                    continue

            # 2. 句子總時長過長 → 遇標點斷句（但不在連接詞後斷）
            if (word_end - current_sentence['start']) > max_duration:
                if word[-1] in sentence_endings | pause_punctuations:
                    if current_sentence['last_word_clean'] not in joining_words:
                        current_sentence['end'] = word_end
                        current_sentence['text'] += ' ' + word
                        current_sentence['last_word_clean'] = word_clean
                        flush(current_sentence, new_segments)
                        current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0, 'last_word_clean': ''}
                        continue
                else:
                    if current_sentence['last_word_clean'] not in joining_words:
                        flush(current_sentence, new_segments)
                        current_sentence = {'start': word_start, 'end': word_end, 'text': word, 'word_count': 1, 'last_word_clean': word_clean}
                        continue

            # 3. 詞數過多 → 遇標點斷句（但不在連接詞後斷）
            if current_sentence['word_count'] >= max_words:
                if word[-1] in sentence_endings | pause_punctuations:
                    if current_sentence['last_word_clean'] not in joining_words:
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

            # 遇句尾標點 → 斷句（但不在連接詞後斷）
            if word[-1] in sentence_endings:
                if current_sentence['last_word_clean'] not in joining_words:
                    flush(current_sentence, new_segments)
                    current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0, 'last_word_clean': ''}

    # 處理最後剩餘句子
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


def process_audio_file(file_path, model, engine, save_plain, save_timestamp):
    WHISPER_SAMPLE_RATE = 16000
    try:
        directory = os.path.dirname(file_path)
        clean_filename = os.path.splitext(os.path.basename(file_path))[0].strip()
        base_path = os.path.join(directory, clean_filename)

        # 跳過已存在的檔案
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
                lines = [s['text'].strip() for s in smart_segments if s['text'].strip()]
                with open(txt_path, "w", encoding="utf-8") as f:
                    f.write('\n'.join(lines))
                print(f"  [成功] 純文字: {os.path.basename(txt_path)}")
            except Exception as e:
                print(f"  [失敗] 純文字儲存失敗: {e}")

        # 儲存時間戳記
        if save_timestamp:
            ts_path = base_path + " Timestamp.txt"
            try:
                with open(ts_path, "w", encoding="utf-8") as f:
                    for seg in smart_segments:
                        s = format_timestamp(seg['start'])
                        e = format_timestamp(seg['end'])
                        f.write(f"[{s} --> {e}] {seg['text'].strip()}\n")
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

# 步驟 3：篩選需要處理的檔案
files_to_process, files_done = [], []
for fp in file_paths:
    base = os.path.join(os.path.dirname(fp), os.path.splitext(os.path.basename(fp))[0].strip())
    checks = []
    if save_plain: checks.append(base + ".txt")
    if save_timestamp: checks.append(base + " Timestamp.txt")
    if checks and all(os.path.exists(c) for c in checks):
        files_done.append(os.path.basename(fp))
    else:
        files_to_process.append(fp)

print(f"\n總計: {len(file_paths)} 個 | 已完成: {len(files_done)} 個 | 需處理: {len(files_to_process)} 個")

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
    result = process_audio_file(fp, model, engine, save_plain, save_timestamp)
    stats[result] += 1

print(f"\n{'='*50}")
print(f"完成！成功:{stats['success']} 跳過(已存在):{stats['skip_exist']} 跳過(太短):{stats['skip_short']} 錯誤:{stats['error']}")
print('='*50)
