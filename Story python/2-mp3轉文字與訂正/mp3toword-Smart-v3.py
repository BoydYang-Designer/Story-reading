import whisper
import os
import torch
from tkinter import Tk, messagebox
from tkinter.filedialog import askopenfilenames, askdirectory
import re

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


def smart_sentence_split(segments, max_gap=0.6, max_duration=5.0, max_words=15):
    """
    智能斷句：根據標點、時間間隔、時長和字數進行分段。
    修正：確保 word_end 為 None 時不造成時間錯誤。
    """
    sentence_endings = {'.', '!', '?', '。', '！', '？'}
    pause_punctuations = {',', ';', ':', '，', '；', '：'}

    new_segments = []
    current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0}

    for segment in segments:
        if 'words' in segment and segment['words']:
            words = segment['words']
        else:
            # 無詞級時間戳記：按標點分割並均分時間
            text = segment['text'].strip()
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

            duration = segment['end'] - segment['start']
            time_per = duration / max(len(sub_sentences), 1)
            for idx, sub_text in enumerate(sub_sentences):
                new_segments.append({
                    'start': segment['start'] + idx * time_per,
                    'end': segment['start'] + (idx + 1) * time_per,
                    'text': sub_text
                })
            continue

        for word_info in words:
            word = word_info.get('word', '').strip()
            if not word:
                continue

            # 修正：安全取得 word_start / word_end
            word_start = word_info.get('start')
            word_end = word_info.get('end')
            if word_start is None:
                ts = word_info.get('timestamp', [None, None])
                word_start = ts[0]
                word_end = ts[1]
            if word_start is None:
                continue
            # 若 word_end 缺失，用 word_start 代替（避免 None 參與計算）
            if word_end is None:
                word_end = word_start

            # 初始化句子起始
            if current_sentence['start'] is None:
                current_sentence['start'] = word_start
                current_sentence['end'] = word_end

            # 1. 時間間隔過大 → 強制斷句
            if current_sentence['text'] and (word_start - current_sentence['end']) > max_gap:
                new_segments.append({
                    'start': current_sentence['start'],
                    'end': current_sentence['end'],
                    'text': current_sentence['text'].strip()
                })
                current_sentence = {'start': word_start, 'end': word_end, 'text': word, 'word_count': 1}
                continue

            # 2. 句子總時長過長 → 遇標點斷句，否則強制斷
            if (word_end - current_sentence['start']) > max_duration:
                if word[-1] in sentence_endings | pause_punctuations:
                    current_sentence['end'] = word_end
                    current_sentence['text'] += ' ' + word
                    new_segments.append({
                        'start': current_sentence['start'],
                        'end': current_sentence['end'],
                        'text': current_sentence['text'].strip()
                    })
                    current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0}
                    continue
                else:
                    new_segments.append({
                        'start': current_sentence['start'],
                        'end': current_sentence['end'],
                        'text': current_sentence['text'].strip()
                    })
                    current_sentence = {'start': word_start, 'end': word_end, 'text': word, 'word_count': 1}
                    continue

            # 3. 詞數過多 → 遇標點斷句
            if current_sentence['word_count'] >= max_words:
                if word[-1] in sentence_endings | pause_punctuations:
                    current_sentence['end'] = word_end
                    current_sentence['text'] += ' ' + word
                    new_segments.append({
                        'start': current_sentence['start'],
                        'end': current_sentence['end'],
                        'text': current_sentence['text'].strip()
                    })
                    current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0}
                    continue

            # 正常加入詞
            current_sentence['end'] = word_end
            current_sentence['text'] += ' ' + word
            current_sentence['word_count'] += 1

            # 遇句尾標點 → 斷句
            if word[-1] in sentence_endings:
                new_segments.append({
                    'start': current_sentence['start'],
                    'end': current_sentence['end'],
                    'text': current_sentence['text'].strip()
                })
                current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0}

    # 處理最後剩餘句子
    if current_sentence['text'].strip():
        new_segments.append({
            'start': current_sentence['start'],
            'end': current_sentence['end'],
            'text': current_sentence['text'].strip()
        })

    return new_segments


def scan_folder_for_mp3(folder_path):
    audio_extensions = ['.mp3', '.wav', '.m4a']
    files = []
    for f in os.listdir(folder_path):
        fp = os.path.join(folder_path, f)
        if os.path.isfile(fp) and os.path.splitext(f)[1].lower() in audio_extensions:
            files.append(fp)
    return sorted(files)


def process_audio_file(file_path, model, save_plain, save_timestamp):
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

        # 檢查長度
        audio = whisper.load_audio(file_path)
        duration = audio.shape[0] / WHISPER_SAMPLE_RATE
        if duration < 10:
            print(f"  [跳過] 檔案長度 ({duration:.2f} 秒) 小於 10 秒。")
            return 'skip_short'

        print(f"檔案長度: {duration:.2f} 秒。開始轉錄...")

        result = model.transcribe(
            audio,
            language="en",
            verbose=False,
            word_timestamps=True
        )
        print("轉錄完成。")

        smart_segments = smart_sentence_split(
            result["segments"],
            max_gap=0.6,
            max_duration=5.0,
            max_words=15
        )

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
        return 'error'


# --- 主程式 ---
root = Tk()
root.withdraw()

# 選擇檔案或資料夾
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

# 儲存格式
save_plain = messagebox.askyesno("儲存選項", "儲存「純文字」版本？\n(例: MyAudio.txt)")
save_timestamp = messagebox.askyesno("儲存選項", "儲存「時間戳記」版本？\n(例: MyAudio Timestamp.txt)")

if not save_plain and not save_timestamp:
    print("未選擇儲存格式。程式結束。")
    exit()

# 篩選需要處理的檔案
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

# 載入模型
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"\n使用裝置: {device}")

model_name = "small"
print(f"載入 '{model_name}' 模型（精準版）...")
model = whisper.load_model(model_name, device=device)
print("模型載入完成。\n")

# 處理檔案
stats = {'success': 0, 'skip_exist': 0, 'skip_short': 0, 'error': 0}
for i, fp in enumerate(files_to_process):
    print(f"\n{'='*50}")
    print(f"處理 {i+1}/{len(files_to_process)}: {os.path.basename(fp)}")
    print('='*50)
    result = process_audio_file(fp, model, save_plain, save_timestamp)
    stats[result] += 1

print(f"\n{'='*50}")
print(f"完成！成功:{stats['success']} 跳過(已存在):{stats['skip_exist']} 跳過(太短):{stats['skip_short']} 錯誤:{stats['error']}")
print('='*50)
