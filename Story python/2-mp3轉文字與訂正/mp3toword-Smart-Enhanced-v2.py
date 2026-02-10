import whisper
import os
import torch
from tkinter import Tk, messagebox, simpledialog
from tkinter.filedialog import askopenfilenames, askdirectory
import re

def format_timestamp(seconds: float) -> str:
    """
    將秒數(浮點數)轉換為 H:MM:SS.mmm 格式的字串。
    """
    assert seconds >= 0, "non-negative timestamp expected"
    milliseconds = round(seconds * 1000.0)

    hours = milliseconds // 3_600_000
    milliseconds %= 3_600_000
    minutes = milliseconds // 60_000
    milliseconds %= 60_000
    seconds_int = milliseconds // 1_000
    milliseconds_rem = milliseconds % 1_000

    return f"{hours:02}:{minutes:02}:{seconds_int:02}.{milliseconds_rem:03}"

def format_plain_text_with_paragraphs(text, sentences_per_paragraph=3, max_words_per_paragraph=50):
    """
    將純文字智能分段,提升可讀性
    
    參數:
    - text: 原始文字
    - sentences_per_paragraph: 每段包含的句子數(預設3句)
    - max_words_per_paragraph: 每段最大詞數(預設50個詞)
    
    返回:
    - 分段後的文字
    """
    # 定義句子結束標點和次要分割點
    sentence_endings = r'([.!?。!?]+)'
    minor_breaks = r'([,;:])'
    
    # 首先嘗試按句號分割
    sentences = re.split(sentence_endings, text)
    
    # 重新組合句子和標點
    combined_sentences = []
    i = 0
    while i < len(sentences):
        if i + 1 < len(sentences) and re.match(sentence_endings, sentences[i + 1]):
            # 合併句子和其標點
            combined_sentences.append(sentences[i] + sentences[i + 1])
            i += 2
        elif sentences[i].strip():
            # 單獨的句子(沒有配對標點)
            combined_sentences.append(sentences[i])
            i += 1
        else:
            i += 1
    
    # 如果沒有明顯的句子分割(只有一個長句),則按詞數和標點分段
    if len(combined_sentences) <= 1:
        text = text.strip()
        words = text.split()
        paragraphs = []
        current_paragraph = []
        word_count = 0
        
        for word in words:
            current_paragraph.append(word)
            word_count += 1
            
            # 檢查是否達到詞數限制且遇到合適的分割點
            if word_count >= max_words_per_paragraph:
                # 尋找最近的標點符號作為分割點
                if any(punct in word for punct in ['.', '!', '?', ',', ';']):
                    paragraphs.append(' '.join(current_paragraph))
                    current_paragraph = []
                    word_count = 0
            # 或者達到更大的詞數強制分段
            elif word_count >= max_words_per_paragraph * 1.5:
                paragraphs.append(' '.join(current_paragraph))
                current_paragraph = []
                word_count = 0
        
        # 添加最後一段
        if current_paragraph:
            paragraphs.append(' '.join(current_paragraph))
        
        return '\n\n'.join(paragraphs)
    
    # 如果有明顯的句子分割,按照每段句子數分段
    paragraphs = []
    for i in range(0, len(combined_sentences), sentences_per_paragraph):
        paragraph_sentences = combined_sentences[i:i + sentences_per_paragraph]
        paragraph = ' '.join(s.strip() for s in paragraph_sentences if s.strip())
        if paragraph:
            paragraphs.append(paragraph)
    
    # 用雙換行符號連接段落
    return '\n\n'.join(paragraphs)

def smart_sentence_split(segments, max_gap=0.6, max_duration=5.0, max_words=15):
    """
    智能斷句:根據標點符號、時間間隔、時長和字數進行更精準的分段
    
    參數:
    - segments: Whisper 返回的原始分段(帶詞級時間戳記)
    - max_gap: 兩個詞之間的最大間隔(秒),超過此值視為新句子 (降低至0.6秒)
    - max_duration: 單句最大時長(秒),超過則強制分段 (降低至5秒)
    - max_words: 單句最大詞數,超過則在適當位置分段 (新增參數)
    
    返回:
    - 新的分段列表,每個元素包含 start, end, text
    """
    sentence_endings = {'.', '!', '?', '。', '!', '?'}
    pause_punctuations = {',', ';', ':', ',', ';', ':'}
    
    new_segments = []
    current_sentence = {
        'start': None,
        'end': None,
        'text': '',
        'word_count': 0
    }
    
    for segment in segments:
        # 如果有詞級時間戳記,使用詞級;否則使用段級
        if 'words' in segment and segment['words']:
            words = segment['words']
        else:
            # 沒有詞級時間戳記,使用段落級別
            # 嘗試按標點符號分割
            text = segment['text'].strip()
            sentences = re.split(r'([.!?,;:])', text)
            
            sub_sentences = []
            temp = ""
            for part in sentences:
                temp += part
                if part in ['.', '!', '?', ',', ';', ':']:
                    if temp.strip():
                        sub_sentences.append(temp.strip())
                        temp = ""
            if temp.strip():
                sub_sentences.append(temp.strip())
            
            # 為每個子句分配時間
            duration = segment['end'] - segment['start']
            time_per_sentence = duration / max(len(sub_sentences), 1)
            
            for idx, sub_text in enumerate(sub_sentences):
                start_time = segment['start'] + (idx * time_per_sentence)
                end_time = segment['start'] + ((idx + 1) * time_per_sentence)
                
                new_segments.append({
                    'start': start_time,
                    'end': end_time,
                    'text': sub_text
                })
            
            continue
        
        for i, word_info in enumerate(words):
            word = word_info.get('word', '').strip()
            word_start = word_info.get('start', word_info.get('timestamp', [None, None])[0])
            word_end = word_info.get('end', word_info.get('timestamp', [None, None])[1])
            
            if word_start is None:
                continue
            
            # 初始化當前句子的開始時間
            if current_sentence['start'] is None:
                current_sentence['start'] = word_start
            
            # 檢查是否需要因為時間間隔而分段
            if current_sentence['text'] and (word_start - current_sentence['end']) > max_gap:
                new_segments.append({
                    'start': current_sentence['start'],
                    'end': current_sentence['end'],
                    'text': current_sentence['text'].strip()
                })
                current_sentence = {
                    'start': word_start,
                    'end': word_end if word_end else word_start,
                    'text': word,
                    'word_count': 1
                }
                continue
            
            # 檢查是否需要因為時長而分段
            if current_sentence['end'] and (word_end - current_sentence['start']) > max_duration:
                # 如果當前詞有標點,在此分段
                if word and (word[-1] in sentence_endings.union(pause_punctuations)):
                    current_sentence['end'] = word_end if word_end else word_start
                    current_sentence['text'] += ' ' + word
                    new_segments.append({
                        'start': current_sentence['start'],
                        'end': current_sentence['end'],
                        'text': current_sentence['text'].strip()
                    })
                    current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0}
                    continue
                else:
                    # 沒有標點也強制分段
                    new_segments.append({
                        'start': current_sentence['start'],
                        'end': current_sentence['end'],
                        'text': current_sentence['text'].strip()
                    })
                    current_sentence = {
                        'start': word_start,
                        'end': word_end if word_end else word_start,
                        'text': word,
                        'word_count': 1
                    }
                    continue
            
            # 檢查是否需要因為詞數而分段
            if current_sentence['word_count'] >= max_words:
                # 尋找最近的標點符號
                if word and (word[-1] in sentence_endings.union(pause_punctuations)):
                    current_sentence['end'] = word_end if word_end else word_start
                    current_sentence['text'] += ' ' + word
                    new_segments.append({
                        'start': current_sentence['start'],
                        'end': current_sentence['end'],
                        'text': current_sentence['text'].strip()
                    })
                    current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0}
                    continue
            
            # 添加詞到當前句子
            current_sentence['end'] = word_end if word_end else word_start
            current_sentence['text'] += ' ' + word
            current_sentence['word_count'] += 1
            
            # 檢查句尾標點
            if word and word[-1] in sentence_endings:
                new_segments.append({
                    'start': current_sentence['start'],
                    'end': current_sentence['end'],
                    'text': current_sentence['text'].strip()
                })
                current_sentence = {'start': None, 'end': None, 'text': '', 'word_count': 0}
    
    # 處理最後一個未完成的句子
    if current_sentence['text'].strip():
        new_segments.append({
            'start': current_sentence['start'],
            'end': current_sentence['end'],
            'text': current_sentence['text'].strip()
        })
    
    return new_segments

def scan_folder_for_mp3(folder_path):
    """
    掃描資料夾中的所有 MP3 檔案
    
    參數:
    - folder_path: 資料夾路徑
    
    返回:
    - MP3 檔案路徑列表
    """
    mp3_files = []
    audio_extensions = ['.mp3', '.wav', '.m4a']
    
    for file in os.listdir(folder_path):
        file_path = os.path.join(folder_path, file)
        if os.path.isfile(file_path):
            _, ext = os.path.splitext(file)
            if ext.lower() in audio_extensions:
                mp3_files.append(file_path)
    
    return sorted(mp3_files)

def process_audio_file(file_path, model, save_plain, save_timestamp, device):
    """
    處理單個音訊檔案
    
    參數:
    - file_path: 音訊檔案路徑
    - model: Whisper 模型
    - save_plain: 是否儲存純文字
    - save_timestamp: 是否儲存時間戳記
    - device: 使用的裝置
    
    返回:
    - 處理結果: 'success', 'skip_exist', 'skip_short', 'error'
    """
    WHISPER_SAMPLE_RATE = 16000
    
    try:
        # 分離路徑與檔名
        directory = os.path.dirname(file_path)
        filename_with_ext = os.path.basename(file_path)
        filename_no_ext = os.path.splitext(filename_with_ext)[0]
        clean_filename = filename_no_ext.strip()
        base_path = os.path.join(directory, clean_filename)
        
        files_to_check = []
        if save_plain:
            files_to_check.append(base_path + ".txt")
        if save_timestamp:
            files_to_check.append(base_path + " Timestamp.txt")
        
        # 檢查是否已存在
        all_exist = False
        if files_to_check: 
            all_exist = all(os.path.exists(f) for f in files_to_check)

        if all_exist:
            print(f"  [跳過] 檔案已存在: {clean_filename}")
            return 'skip_exist'

        # 檢查長度
        audio = whisper.load_audio(file_path)
        duration = audio.shape[0] / WHISPER_SAMPLE_RATE 
        
        if duration < 10:
            print(f"  [跳過] 檔案長度 ({duration:.2f} 秒) 小於 10 秒。")
            return 'skip_short'
        
        print(f"檔案長度: {duration:.2f} 秒。開始轉錄...")

        # 轉錄 - 啟用詞級時間戳記以支援智能斷句
        result = model.transcribe(
            audio, 
            language="en", 
            verbose=False,
            word_timestamps=True
        )
        print("轉錄完成。")
        
        # 使用改進的智能斷句 - 更小的間隔和時長參數
        smart_segments = smart_sentence_split(
            result["segments"],
            max_gap=0.6,        # 降低至0.6秒
            max_duration=5.0,   # 降低至5秒
            max_words=15        # 最多15個詞
        )
        
        # 儲存純文字檔
        if save_plain:
            txt_path = base_path + ".txt"
            try:
                # 使用與時間戳記版本相同的分段,但不包含時間戳記
                plain_lines = []
                for segment in smart_segments:
                    text = segment['text'].strip()
                    if text:
                        plain_lines.append(text)
                
                # 用單換行符號連接各行
                formatted_text = '\n'.join(plain_lines)
                
                with open(txt_path, "w", encoding="utf-8") as f:
                    f.write(formatted_text)
                print(f"  [成功] 已儲存純文字檔(與時間戳記版本相同分段): {os.path.basename(txt_path)}")
            except Exception as e:
                print(f"  [失敗] 儲存純文字檔失敗: {e}")

        # 儲存時間戳記檔
        if save_timestamp:
            timestamp_txt_path = base_path + " Timestamp.txt"
            
            try:
                with open(timestamp_txt_path, "w", encoding="utf-8") as ts_file:
                    for segment in smart_segments:
                        start_time = format_timestamp(segment['start'])
                        end_time = format_timestamp(segment['end'])
                        text = segment['text'].strip()
                        ts_file.write(f"[{start_time} --> {end_time}] {text}\n")
                print(f"  [成功] 已儲存時間戳記檔: {os.path.basename(timestamp_txt_path)}")
            except Exception as e:
                print(f"  [失敗] 儲存時間戳記檔失敗: {e}")
        
        return 'success'

    except Exception as e:
        print(f"[錯誤] 處理檔案 {file_path} 時發生錯誤: {e}")
        return 'error'

# --- 主程式開始 ---
root = Tk()
root.withdraw()  # 隱藏主視窗

# --- 步驟 1: 選擇處理模式 ---
mode_choice = messagebox.askquestion(
    "選擇處理模式",
    "請選擇處理模式:\n\n"
    "● Yes: 選擇單個或多個 MP3 檔案\n"
    "● No: 選擇資料夾(自動掃描所有音訊檔)"
)

file_paths = []

if mode_choice == "yes":
    # 選擇單個或多個檔案
    file_paths = list(askopenfilenames(
        title="選擇一個或多個音訊檔案", 
        filetypes=[("MP3 files", "*.mp3"), ("All audio files", "*.mp3 *.wav *.m4a")]
    ))
else:
    # 選擇資料夾
    folder_path = askdirectory(title="選擇包含音訊檔案的資料夾")
    if folder_path:
        file_paths = scan_folder_for_mp3(folder_path)
        if file_paths:
            print(f"\n在資料夾中找到 {len(file_paths)} 個音訊檔案:")
            for fp in file_paths:
                print(f"  - {os.path.basename(fp)}")
        else:
            print("資料夾中沒有找到音訊檔案。")

if not file_paths:
    print("沒有選擇檔案或資料夾。程式結束...")
    exit()

print(f"\n共找到 {len(file_paths)} 個音訊檔案。")

# --- 步驟 2: 選擇儲存格式 ---
save_plain = messagebox.askyesno(
    "儲存選項", 
    "您是否要儲存「純文字」版本?\n(例如: MyAudio.txt)"
)

save_timestamp = messagebox.askyesno(
    "儲存選項", 
    "您是否要儲存「時間戳記」版本?\n(例如: MyAudio Timestamp.txt)"
)

if not save_plain and not save_timestamp:
    print("您沒有選擇任何儲存格式。程式即將結束...")
    exit()

# --- 步驟 2.5: 檢查哪些檔案需要處理 ---
print("\n正在檢查哪些檔案需要處理...")
files_to_process = []
files_already_done = []

for file_path in file_paths:
    directory = os.path.dirname(file_path)
    filename_with_ext = os.path.basename(file_path)
    filename_no_ext = os.path.splitext(filename_with_ext)[0]
    clean_filename = filename_no_ext.strip()
    base_path = os.path.join(directory, clean_filename)
    
    files_to_check = []
    if save_plain:
        files_to_check.append(base_path + ".txt")
    if save_timestamp:
        files_to_check.append(base_path + " Timestamp.txt")
    
    # 檢查是否已存在
    all_exist = False
    if files_to_check: 
        all_exist = all(os.path.exists(f) for f in files_to_check)
    
    if all_exist:
        files_already_done.append(filename_with_ext)
    else:
        files_to_process.append(file_path)

# 顯示檢查結果
print(f"\n{'='*60}")
print("檢查結果:")
print(f"{'='*60}")
print(f"總共找到音訊檔: {len(file_paths)} 個")
print(f"已有文本檔(跳過): {len(files_already_done)} 個")
print(f"需要轉檔: {len(files_to_process)} 個")
print(f"{'='*60}")

if files_already_done:
    print("\n已有文本檔的檔案:")
    for filename in files_already_done:
        print(f"  ✓ {filename}")

if files_to_process:
    print(f"\n需要轉檔的檔案 ({len(files_to_process)} 個):")
    for file_path in files_to_process:
        print(f"  → {os.path.basename(file_path)}")
    
    # 詢問是否開始處理
    start_processing = messagebox.askyesno(
        "開始轉檔確認",
        f"找到 {len(files_to_process)} 個需要轉檔的音訊檔。\n\n"
        f"已有文本: {len(files_already_done)} 個\n"
        f"需要處理: {len(files_to_process)} 個\n\n"
        "是否開始轉檔?"
    )
    
    if not start_processing:
        print("\n使用者取消操作。程式結束。")
        exit()
else:
    print("\n所有檔案都已有對應的文本檔,無需處理。")
    messagebox.showinfo("完成", "所有檔案都已有對應的文本檔!")
    exit()

# 更新待處理檔案列表
file_paths = files_to_process

# --- 步驟 3: 載入模型與裝置 ---
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"\nUsing device: {device}")

# 詢問使用哪個模型
model_choice = messagebox.askquestion(
    "模型選擇",
    "使用更精準的 'small' 模型?\n\n"
    "● Yes: 更精準但較慢 (推薦)\n"
    "● No: 使用 'base' 模型 (較快)"
)

model_name = "small" if model_choice == "yes" else "base"
print(f"正在載入 '{model_name}' 模型...")
model = whisper.load_model(model_name, device=device)
print("模型載入完成。\n")

# --- 步驟 4: 遍歷並處理所有檔案 ---
stats = {
    'success': 0,
    'skip_exist': 0,
    'skip_short': 0,
    'error': 0
}

for i, file_path in enumerate(file_paths):
    print(f"\n{'='*60}")
    print(f"正在處理檔案 {i + 1} / {len(file_paths)}")
    print(f"檔案名稱: {os.path.basename(file_path)}")
    print(f"{'='*60}")

    result = process_audio_file(file_path, model, save_plain, save_timestamp, device)
    stats[result] += 1

# --- 顯示處理統計 ---
print(f"\n{'='*60}")
print("所有檔案處理完畢!")
print(f"{'='*60}")
print(f"成功轉檔: {stats['success']} 個")
print(f"已存在跳過: {stats['skip_exist']} 個")
print(f"太短跳過: {stats['skip_short']} 個")
print(f"錯誤: {stats['error']} 個")
print(f"{'='*60}")
