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
    return filename if filename else "tiktok_video"

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
                # 優先使用 HD 影片
                video_url = data['data'].get('hdplay') or data['data'].get('play')
                title = data['data'].get('title', 'tiktok_video')
                
                if video_url:
                    return {
                        'video_url': video_url,
                        'title': title
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
            text = response.text
            # 尋找無浮水印影片連結
            video_patterns = [
                r'href="(https?://[^"]*download[^"]*)"',
                r'"(https?://[^"]*\.mp4[^"]*)"',
                r'data-url="(https?://[^"]*)"'
            ]
            
            for pattern in video_patterns:
                video_match = re.search(pattern, text)
                if video_match:
                    return {
                        'video_url': video_match.group(1),
                        'title': 'TikTok Video'
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
            # 尋找無浮水印影片連結
            video_patterns = [
                r'<a[^>]*href="([^"]*)"[^>]*>No Watermark<',
                r'href="(https?://[^"]*nowatermark[^"]*)"',
                r'<a[^>]*download[^>]*href="([^"]*)"'
            ]
            
            for pattern in video_patterns:
                video_match = re.search(pattern, text, re.IGNORECASE)
                if video_match:
                    video_url = video_match.group(1)
                    # 解碼 HTML 實體
                    video_url = video_url.replace('&amp;', '&')
                    return {
                        'video_url': video_url,
                        'title': 'TikTok Video'
                    }
    except Exception as e:
        print(f"  API 3 失敗: {e}")
    
    return None

def download_with_api4(url):
    """
    使用 API 方法 4: TikDD
    """
    try:
        api_url = "https://tikdd.cc/wp-json/aio-dl/video-data/"
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Content-Type": "application/json"
        }
        
        payload = {
            "url": url
        }
        
        response = requests.post(api_url, json=payload, headers=headers, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('medias'):
                for media in data['medias']:
                    if media.get('url'):
                        return {
                            'video_url': media['url'],
                            'title': data.get('title', 'TikTok Video')
                        }
    except Exception as e:
        print(f"  API 4 失敗: {e}")
    
    return None

def download_tiktok_video(url, save_path):
    """
    使用多個 API 下載 TikTok 影片（自動切換）
    """
    print(f"正在獲取影片資訊...")
    
    # 嘗試多個 API
    apis = [
        ("TikWM API", download_with_api1),
        ("SnapTik API", download_with_api2),
        ("SSSTik API", download_with_api3),
        ("TikDD API", download_with_api4)
    ]
    
    video_info = None
    
    for api_name, api_func in apis:
        print(f"  嘗試使用 {api_name}...")
        try:
            video_info = api_func(url)
            if video_info and video_info.get('video_url'):
                print(f"  ✓ {api_name} 成功！")
                break
        except Exception as e:
            print(f"  ✗ {api_name} 失敗")
            continue
    
    if not video_info or not video_info.get('video_url'):
        print("  ✗ 所有 API 都無法獲取影片")
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
        video_url = video_info['video_url']
        title = video_info.get('title', 'tiktok_video')
        
        # 清理檔名
        title = clean_filename(title)
        filename = title[:100]  # 限制檔名長度
        
        # 下載影片
        print(f"正在下載影片: {filename}")
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.tiktok.com/"
        }
        
        video_response = requests.get(video_url, headers=headers, stream=True, timeout=60)
        
        if video_response.status_code != 200:
            print(f"影片下載失敗，狀態碼: {video_response.status_code}")
            return False
        
        # 儲存影片
        file_path = os.path.join(save_path, f"{filename}.mp4")
        
        # 如果檔案已存在，添加數字後綴
        counter = 1
        while os.path.exists(file_path):
            file_path = os.path.join(save_path, f"{filename}_{counter}.mp4")
            counter += 1
        
        total_size = int(video_response.headers.get('content-length', 0))
        downloaded_size = 0
        
        with open(file_path, 'wb') as f:
            for chunk in video_response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    downloaded_size += len(chunk)
                    if total_size > 0:
                        progress = (downloaded_size / total_size) * 100
                        print(f"\r下載進度: {progress:.1f}%", end='')
        
        print(f"\n✓ 影片已儲存: {os.path.basename(file_path)}")
        
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
    print("TikTok 影片下載器 v2.0")
    print("支援多個 API，自動切換")
    print("=" * 60)
    
    # 初始化 Tkinter
    root = Tk()
    root.withdraw()
    
    # 選擇儲存資料夾
    save_path = askdirectory(title="選擇影片儲存位置")
    
    if not save_path:
        print("未選擇儲存位置，程式結束。")
        return
    
    print(f"\n影片將儲存到: {save_path}\n")
    
    # 詢問是否要下載多個影片
    batch_mode = messagebox.askyesno(
        "批次下載",
        "您要下載多個影片嗎？\n\n"
        "● Yes: 可以連續輸入多個連結\n"
        "● No: 只下載一個影片"
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
            
            if download_tiktok_video(url, save_path):
                success_count += 1
            else:
                fail_count += 1
            
            print("-" * 60)
            time.sleep(1)  # 避免請求過於頻繁
    else:
        print("\n--- 單一影片下載 ---")
        url = simpledialog.askstring(
            "輸入 TikTok 連結",
            "請貼上 TikTok 影片連結:"
        )
        
        if url and url.strip():
            url = url.strip()
            print(f"\n處理連結: {url}")
            
            if download_tiktok_video(url, save_path):
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
            f"成功下載 {success_count} 個影片！\n"
            f"失敗 {fail_count} 個\n\n"
            f"儲存位置: {save_path}"
        )
    else:
        messagebox.showwarning(
            "下載失敗",
            "沒有成功下載任何影片。\n\n"
            "可能原因：\n"
            "• 連結無效或影片已刪除\n"
            "• 私人帳號的影片\n"
            "• API 服務暫時無法使用\n\n"
            "建議稍後再試。"
        )

if __name__ == "__main__":
    main()
