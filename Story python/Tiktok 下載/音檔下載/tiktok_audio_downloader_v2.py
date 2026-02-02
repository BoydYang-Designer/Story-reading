import os
import re
import requests
from tkinter import Tk, messagebox, simpledialog
from tkinter.filedialog import askdirectory
import json
import time

def extract_video_id(url):
    """
    從 TikTok URL 中提取影片 ID
    支援多種 TikTok URL 格式
    """
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
    """
    清理檔名中的非法字元
    """
    # 移除或替換非法字元
    filename = re.sub(r'[<>:"/\\|?*]', '', filename)
    # 移除多餘空格
    filename = ' '.join(filename.split())
    # 限制長度
    if len(filename) > 100:
        filename = filename[:100]
    return filename if filename else "tiktok_audio"

def download_with_api1(url):
    """
    使用 API 方法 1: TikWM
    """
    try:
        api_url = "https://www.tikwm.com/api/"
        
        payload = {
            "url": url,
            "hd": 1
        }
        
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
        print(f"  API 1 失敗: {e}")
    
    return None

def download_with_api2(url):
    """
    使用 API 方法 2: SnapTik
    """
    try:
        # 清理 URL
        clean_url = url.split('?')[0] if '?' in url else url
        
        api_url = "https://snaptik.app/abc2.php"
        
        payload = {
            "url": clean_url,
            "lang": "en"
        }
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://snaptik.app",
            "Referer": "https://snaptik.app/"
        }
        
        response = requests.post(api_url, data=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            # 嘗試解析回應
            text = response.text
            # 尋找音訊連結
            audio_pattern = r'"?(https?://[^"]*\.mp3[^"]*)"?'
            audio_match = re.search(audio_pattern, text)
            
            if audio_match:
                return {
                    'audio_url': audio_match.group(1),
                    'title': 'TikTok Audio',
                    'author': 'Unknown'
                }
    except Exception as e:
        print(f"  API 2 失敗: {e}")
    
    return None

def download_with_api3(url):
    """
    使用 API 方法 3: SSSTik
    """
    try:
        api_url = "https://ssstik.io/abc"
        
        # 提取影片 ID
        video_id = extract_video_id(url)
        if not video_id:
            return None
        
        payload = {
            "id": url,
            "locale": "en",
            "tt": "temp_token"
        }
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://ssstik.io",
            "Referer": "https://ssstik.io/"
        }
        
        response = requests.post(api_url, data=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            text = response.text
            # 尋找音樂連結
            audio_pattern = r'href="(https?://[^"]*music[^"]*)"'
            audio_match = re.search(audio_pattern, text)
            
            if audio_match:
                return {
                    'audio_url': audio_match.group(1),
                    'title': 'TikTok Audio',
                    'author': 'Unknown'
                }
    except Exception as e:
        print(f"  API 3 失敗: {e}")
    
    return None

def download_tiktok_audio(url, save_path):
    """
    使用多個 API 下載 TikTok 音檔（自動切換）
    """
    print(f"正在獲取音檔資訊...")
    
    # 嘗試多個 API
    apis = [
        ("TikWM API", download_with_api1),
        ("SnapTik API", download_with_api2),
        ("SSSTik API", download_with_api3)
    ]
    
    audio_info = None
    
    for api_name, api_func in apis:
        print(f"  嘗試使用 {api_name}...")
        try:
            audio_info = api_func(url)
            if audio_info and audio_info.get('audio_url'):
                print(f"  ✓ {api_name} 成功！")
                break
        except Exception as e:
            print(f"  ✗ {api_name} 失敗")
            continue
    
    if not audio_info or not audio_info.get('audio_url'):
        print("  ✗ 所有 API 都無法獲取音檔")
        print("\n可能的原因：")
        print("  1. 影片為私人帳號")
        print("  2. 影片已被刪除")
        print("  3. 連結格式不正確")
        print("  4. 所有 API 服務暫時無法使用")
        print("\n建議：")
        print("  - 確認連結是否正確")
        print("  - 稍後再試")
        print("  - 嘗試使用其他影片連結")
        return False
    
    try:
        audio_url = audio_info['audio_url']
        title = audio_info.get('title', 'tiktok_audio')
        author = audio_info.get('author', 'Unknown')
        
        # 清理檔名
        title = clean_filename(title)
        author = clean_filename(author)
        
        # 組合檔名
        if author and author != 'Unknown':
            filename = f"{author} - {title}"
        else:
            filename = title
        
        filename = filename[:100]  # 限制檔名長度
        
        # 下載音檔
        print(f"正在下載音檔: {filename}")
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.tiktok.com/"
        }
        
        audio_response = requests.get(audio_url, headers=headers, stream=True, timeout=60)
        
        if audio_response.status_code != 200:
            print(f"音檔下載失敗，狀態碼: {audio_response.status_code}")
            return False
        
        # 儲存音檔
        file_path = os.path.join(save_path, f"{filename}.mp3")
        
        # 如果檔案已存在，添加數字後綴
        counter = 1
        while os.path.exists(file_path):
            file_path = os.path.join(save_path, f"{filename}_{counter}.mp3")
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
                        print(f"\r下載進度: {progress:.1f}%", end='')
        
        print(f"\n✓ 音檔已儲存: {os.path.basename(file_path)}")
        
        # 顯示檔案大小
        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
        print(f"  檔案大小: {file_size_mb:.2f} MB")
        
        return True
        
    except requests.exceptions.Timeout:
        print("請求超時，請檢查網路連接")
        return False
    except requests.exceptions.RequestException as e:
        print(f"網路請求錯誤: {e}")
        return False
    except Exception as e:
        print(f"下載失敗: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """
    主程式
    """
    print("=" * 60)
    print("TikTok 音檔下載器 v2.0")
    print("支援多個 API，自動切換")
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
        "● Yes: 可以連續輸入多個連結\n"
        "● No: 只下載一個音檔"
    )
    
    success_count = 0
    fail_count = 0
    
    if batch_mode:
        print("\n--- 批次下載模式 ---")
        print("請輸入 TikTok 影片連結（每次輸入一個）")
        print("輸入空白或按取消結束\n")
        
        while True:
            url = simpledialog.askstring(
                "輸入 TikTok 連結",
                "請貼上 TikTok 影片連結:\n（按取消或留空結束）"
            )
            
            if not url or not url.strip():
                break
            
            url = url.strip()
            print(f"\n處理連結: {url}")
            
            if download_tiktok_audio(url, save_path):
                success_count += 1
            else:
                fail_count += 1
            
            print("-" * 60)
            time.sleep(1)  # 避免請求過於頻繁
    else:
        print("\n--- 單一音檔下載 ---")
        url = simpledialog.askstring(
            "輸入 TikTok 連結",
            "請貼上 TikTok 影片連結:"
        )
        
        if url and url.strip():
            url = url.strip()
            print(f"\n處理連結: {url}")
            
            if download_tiktok_audio(url, save_path):
                success_count += 1
            else:
                fail_count += 1
    
    # 顯示結果
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
        messagebox.showwarning(
            "下載失敗",
            "沒有成功下載任何音檔。\n\n"
            "可能原因：\n"
            "• 連結無效或影片已刪除\n"
            "• 私人帳號的影片\n"
            "• API 服務暫時無法使用\n\n"
            "建議稍後再試。"
        )

if __name__ == "__main__":
    main()
