import os
import re
import requests
from tkinter import Tk, messagebox, simpledialog
from tkinter.filedialog import askdirectory
import json
import time

# ===========================
# TikTok 下載相關函數
# ===========================

def extract_video_id(url):
    """從 TikTok URL 中提取影片 ID"""
    patterns = [
        r'tiktok\.com/@[\w\.-]+/video/(\d+)',
        r'tiktok\.com/v/(\d+)',
        r'vm\.tiktok\.com/(\w+)',
        r'vt\.tiktok\.com/(\w+)',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    
    return None

def clean_filename(filename):
    """清理檔名中的非法字元"""
    filename = re.sub(r'[<>:"/\\|?*]', '', filename)
    filename = ' '.join(filename.split())
    if len(filename) > 100:
        filename = filename[:100]
    return filename if filename else "audio"

def download_with_api1(url):
    """使用 API 方法 1: TikWM"""
    try:
        api_url = "https://www.tikwm.com/api/"
        payload = {"url": url, "hd": 1}
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Content-Type": "application/x-www-form-urlencoded"
        }
        
        response = requests.post(api_url, data=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('code') == 0 and 'data' in data:
                audio_url = data['data'].get('music')
                title = data['data'].get('title', 'tiktok_audio')
                music_info = data['data'].get('music_info', {})
                author = music_info.get('author', 'Unknown')
                music_title = music_info.get('title', title)
                
                return {
                    'audio_url': audio_url,
                    'title': music_title,
                    'author': author
                }
    except Exception as e:
        pass
    
    return None

def download_with_api2(url):
    """使用 API 方法 2: SnapTik"""
    try:
        clean_url = url.split('?')[0] if '?' in url else url
        api_url = "https://snaptik.app/abc2.php"
        payload = {"url": clean_url, "lang": "en"}
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://snaptik.app",
            "Referer": "https://snaptik.app/"
        }
        
        response = requests.post(api_url, data=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            text = response.text
            audio_pattern = r'"?(https?://[^"]*\.mp3[^"]*)"?'
            audio_match = re.search(audio_pattern, text)
            
            if audio_match:
                return {
                    'audio_url': audio_match.group(1),
                    'title': 'TikTok Audio',
                    'author': 'Unknown'
                }
    except Exception as e:
        pass
    
    return None

def download_with_api3(url):
    """使用 API 方法 3: SSSTik"""
    try:
        api_url = "https://ssstik.io/abc"
        video_id = extract_video_id(url)
        if not video_id:
            return None
        
        payload = {"id": url, "locale": "en", "tt": "temp_token"}
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://ssstik.io",
            "Referer": "https://ssstik.io/"
        }
        
        response = requests.post(api_url, data=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            text = response.text
            audio_pattern = r'href="(https?://[^"]*music[^"]*)"'
            audio_match = re.search(audio_pattern, text)
            
            if audio_match:
                return {
                    'audio_url': audio_match.group(1),
                    'title': 'TikTok Audio',
                    'author': 'Unknown'
                }
    except Exception as e:
        pass
    
    return None

def get_tiktok_info(url):
    """獲取 TikTok 音檔資訊"""
    apis = [download_with_api1, download_with_api2, download_with_api3]
    
    for api_func in apis:
        try:
            audio_info = api_func(url)
            if audio_info and audio_info.get('audio_url'):
                title = audio_info.get('title', 'tiktok_audio')
                author = audio_info.get('author', 'Unknown')
                
                title = clean_filename(title)
                author = clean_filename(author)
                
                if author and author != 'Unknown':
                    default_filename = f"{author} - {title}"
                else:
                    default_filename = title
                
                return default_filename[:100], audio_info
        except:
            continue
    
    return None, None

def download_tiktok_audio(audio_info, save_path, filename):
    """下載 TikTok 音檔"""
    try:
        audio_url = audio_info['audio_url']
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.tiktok.com/"
        }
        
        audio_response = requests.get(audio_url, headers=headers, stream=True, timeout=60)
        
        if audio_response.status_code != 200:
            return False
        
        file_path = os.path.join(save_path, f"{filename}.mp3")
        
        # 如果檔案已存在,自動添加數字後綴
        if os.path.exists(file_path):
            counter = 1
            original_filename = filename
            while os.path.exists(file_path):
                filename = f"{original_filename}_{counter}"
                file_path = os.path.join(save_path, f"{filename}.mp3")
                counter += 1
        
        total_size = int(audio_response.headers.get('content-length', 0))
        downloaded_size = 0
        
        with open(file_path, 'wb') as f:
            for chunk in audio_response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded_size += len(chunk)
                    if total_size > 0:
                        progress = (downloaded_size / total_size) * 100
                        print(f"\r  下載進度: {progress:.1f}%", end='')
        
        print(f"\n  ✓ 已儲存: {os.path.basename(file_path)}")
        return True
        
    except Exception as e:
        print(f"\n  ✗ 下載失敗: {e}")
        return False

# ===========================
# YouTube 下載相關函數
# ===========================

def get_youtube_info(url):
    """獲取 YouTube 影片資訊"""
    try:
        # 嘗試使用 yt-dlp
        import yt_dlp
        
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            title = info.get('title', 'youtube_audio')
            uploader = info.get('uploader', 'Unknown')
            
            title = clean_filename(title)
            uploader = clean_filename(uploader)
            
            if uploader and uploader != 'Unknown':
                default_filename = f"{uploader} - {title}"
            else:
                default_filename = title
            
            return default_filename[:100], info
    
    except ImportError:
        print("  ✗ 需要安裝 yt-dlp: pip install yt-dlp")
        return None, None
    except Exception as e:
        print(f"  ✗ 獲取 YouTube 資訊失敗: {e}")
        return None, None

def download_youtube_audio(url, save_path, filename):
    """下載 YouTube 音檔"""
    try:
        import yt_dlp
        
        file_path = os.path.join(save_path, f"{filename}.mp3")
        
        # 如果檔案已存在,自動添加數字後綴
        if os.path.exists(file_path):
            counter = 1
            original_filename = filename
            while os.path.exists(file_path):
                filename = f"{original_filename}_{counter}"
                file_path = os.path.join(save_path, f"{filename}.mp3")
                counter += 1
        
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': file_path[:-4],  # 移除 .mp3
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'quiet': False,
            'no_warnings': True,
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        
        print(f"  ✓ 已儲存: {os.path.basename(file_path)}")
        return True
        
    except ImportError:
        print("  ✗ 需要安裝 yt-dlp: pip install yt-dlp")
        print("  ✗ 需要安裝 ffmpeg")
        return False
    except Exception as e:
        print(f"\n  ✗ 下載失敗: {e}")
        return False

# ===========================
# 通用函數
# ===========================

def detect_url_type(url):
    """判斷 URL 類型"""
    if 'tiktok' in url.lower():
        return 'tiktok'
    elif 'youtube' in url.lower() or 'youtu.be' in url.lower():
        return 'youtube'
    else:
        return 'unknown'

def get_media_info(url):
    """獲取媒體資訊 (自動判斷類型)"""
    url_type = detect_url_type(url)
    
    if url_type == 'tiktok':
        return get_tiktok_info(url), 'tiktok'
    elif url_type == 'youtube':
        return get_youtube_info(url), 'youtube'
    else:
        return (None, None), 'unknown'

def download_media(url_type, url_or_info, save_path, filename):
    """下載媒體檔案"""
    if url_type == 'tiktok':
        return download_tiktok_audio(url_or_info, save_path, filename)
    elif url_type == 'youtube':
        return download_youtube_audio(url_or_info, save_path, filename)
    else:
        return False

# ===========================
# 主程式
# ===========================

def main():
    print("=" * 60)
    print("TikTok + YouTube 音檔下載器 v1.0")
    print("支援 TikTok 和 YouTube")
    print("=" * 60)
    
    # 初始化 Tkinter
    root = Tk()
    root.withdraw()
    
    # 選擇儲存資料夾
    save_path = askdirectory(title="選擇音檔儲存位置")
    
    if not save_path:
        print("未選擇儲存位置，程式結束。")
        return
    
    print(f"\n音檔將儲存到: {save_path}\n")
    
    # 詢問是否要下載多個音檔
    batch_mode = messagebox.askyesno(
        "批次下載",
        "您要下載多個音檔嗎？\n\n"
        "● Yes: 可連續輸入多個連結\n"
        "● No: 只下載一個音檔"
    )
    
    success_count = 0
    fail_count = 0
    
    if batch_mode:
        print("\n--- 批次下載模式 ---")
        print("請輸入連結（每次輸入一個）")
        print("輸入空白或按取消結束\n")
        
        while True:
            # 步驟 1: 輸入連結
            url = simpledialog.askstring(
                "輸入連結",
                "請貼上 TikTok 或 YouTube 連結:\n（按取消或留空結束）"
            )
            
            if not url or not url.strip():
                break
            
            url = url.strip()
            
            # 判斷類型
            url_type = detect_url_type(url)
            
            if url_type == 'unknown':
                print(f"\n✗ 不支援的連結類型: {url}")
                messagebox.showwarning("錯誤", "不支援的連結類型\n請使用 TikTok 或 YouTube 連結")
                continue
            
            print(f"\n處理連結: {url}")
            print(f"類型: {url_type.upper()}")
            
            # 步驟 2: 獲取預設檔名
            print("正在獲取檔案資訊...")
            (default_filename, media_info), _ = get_media_info(url)
            
            if not default_filename:
                print("✗ 無法獲取檔案資訊")
                messagebox.showerror("錯誤", "無法獲取檔案資訊\n請檢查連結是否正確")
                fail_count += 1
                continue
            
            print(f"預設檔名: {default_filename}")
            
            # 步驟 3: 詢問檔名
            custom_filename = simpledialog.askstring(
                "編輯檔名",
                f"類型: {url_type.upper()}\n"
                f"預設檔名: {default_filename}.mp3\n\n"
                f"請輸入檔名 (不含副檔名):\n"
                f"(直接按確認使用預設檔名)",
                initialvalue=default_filename
            )
            
            if not custom_filename or not custom_filename.strip():
                filename = default_filename
                print("使用預設檔名")
            else:
                filename = clean_filename(custom_filename.strip())
                print(f"使用自訂檔名: {filename}")
            
            # 步驟 4: 開始下載
            print(f"\n開始下載: {filename}.mp3")
            
            if url_type == 'tiktok':
                success = download_tiktok_audio(media_info, save_path, filename)
            elif url_type == 'youtube':
                success = download_youtube_audio(url, save_path, filename)
            else:
                success = False
            
            if success:
                success_count += 1
            else:
                fail_count += 1
            
            print("-" * 60)
            time.sleep(0.5)
    
    else:
        # 單一下載模式
        print("\n--- 單一音檔下載 ---")
        url = simpledialog.askstring(
            "輸入連結",
            "請貼上 TikTok 或 YouTube 連結:"
        )
        
        if not url or not url.strip():
            print("未輸入連結，程式結束。")
            return
        
        url = url.strip()
        url_type = detect_url_type(url)
        
        if url_type == 'unknown':
            print(f"\n✗ 不支援的連結類型")
            messagebox.showerror("錯誤", "不支援的連結類型\n請使用 TikTok 或 YouTube 連結")
            return
        
        print(f"\n處理連結: {url}")
        print(f"類型: {url_type.upper()}")
        
        # 獲取預設檔名
        print("正在獲取檔案資訊...")
        (default_filename, media_info), _ = get_media_info(url)
        
        if not default_filename:
            print("無法獲取檔案資訊。")
            messagebox.showerror("錯誤", "無法獲取檔案資訊")
            return
        
        print(f"預設檔名: {default_filename}")
        
        # 詢問檔名
        custom_filename = simpledialog.askstring(
            "編輯檔名",
            f"類型: {url_type.upper()}\n"
            f"預設檔名: {default_filename}.mp3\n\n"
            f"請輸入檔名 (不含副檔名):",
            initialvalue=default_filename
        )
        
        if not custom_filename or not custom_filename.strip():
            filename = default_filename
        else:
            filename = clean_filename(custom_filename.strip())
        
        print(f"\n開始下載: {filename}")
        
        if url_type == 'tiktok':
            success = download_tiktok_audio(media_info, save_path, filename)
        elif url_type == 'youtube':
            success = download_youtube_audio(url, save_path, filename)
        else:
            success = False
        
        if success:
            success_count += 1
            messagebox.showinfo("完成", f"下載成功！\n\n儲存位置: {save_path}")
        else:
            fail_count += 1
            messagebox.showerror("失敗", "下載失敗")
    
    # 批次模式的結果統計
    if batch_mode:
        print("\n" + "=" * 60)
        print("下載完成！")
        print(f"成功: {success_count} 個")
        print(f"失敗: {fail_count} 個")
        print("=" * 60)
        
        if success_count > 0:
            messagebox.showinfo(
                "下載完成",
                f"成功下載 {success_count} 個音檔！\n"
                f"失敗 {fail_count} 個\n\n"
                f"儲存位置: {save_path}"
            )
        else:
            messagebox.showwarning("下載失敗", "沒有成功下載任何音檔")

if __name__ == "__main__":
    main()
