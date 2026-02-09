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

def get_default_filename_from_url(url):
    """
    從 URL 獲取預設檔名（不下載，僅獲取資訊）
    """
    print(f"  正在獲取檔案資訊...")
    
    # 嘗試多個 API
    apis = [
        download_with_api1,
        download_with_api2,
        download_with_api3
    ]
    
    for api_func in apis:
        try:
            audio_info = api_func(url)
            if audio_info and audio_info.get('audio_url'):
                title = audio_info.get('title', 'tiktok_audio')
                author = audio_info.get('author', 'Unknown')
                
                # 清理檔名
                title = clean_filename(title)
                author = clean_filename(author)
                
                # 組合預設檔名
                if author and author != 'Unknown':
                    default_filename = f"{author} - {title}"
                else:
                    default_filename = title
                
                return default_filename[:100]
        except:
            continue
    
    return "tiktok_audio"

def download_tiktok_audio(url, save_path, custom_filename=None):
    """
    使用多個 API 下載 TikTok 音檔(自動切換)
    custom_filename: 如果提供,則直接使用此檔名,不再詢問
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
        return False, None
    
    try:
        audio_url = audio_info['audio_url']
        title = audio_info.get('title', 'tiktok_audio')
        author = audio_info.get('author', 'Unknown')
        
        # 清理檔名
        title = clean_filename(title)
        author = clean_filename(author)
        
        # 組合預設檔名
        if author and author != 'Unknown':
            default_filename = f"{author} - {title}"
        else:
            default_filename = title
        
        default_filename = default_filename[:100]  # 限制檔名長度
        
        # 如果沒有提供自訂檔名,則使用互動方式
        if custom_filename is None:
            print(f"\n預設檔名: {default_filename}")
            
            # 初始化 Tkinter (如果還沒初始化)
            root = Tk()
            root.withdraw()
            
            # 詢問是否使用預設檔名
            use_default = messagebox.askyesno(
                "確認檔名",
                f"預設檔名:\n{default_filename}.mp3\n\n"
                f"是否使用此檔名?\n\n"
                f"● Yes: 使用預設檔名\n"
                f"● No: 自訂檔名"
            )
            
            if use_default:
                filename = default_filename
                print(f"  使用預設檔名: {filename}")
            else:
                # 讓使用者輸入自訂檔名
                custom_filename_input = simpledialog.askstring(
                    "自訂檔名",
                    f"請輸入檔名 (不含副檔名):\n\n預設: {default_filename}",
                    initialvalue=default_filename
                )
                
                if custom_filename_input and custom_filename_input.strip():
                    filename = clean_filename(custom_filename_input.strip())
                    print(f"  使用自訂檔名: {filename}")
                else:
                    print("  未輸入檔名，使用預設檔名")
                    filename = default_filename
        else:
            # 使用提供的自訂檔名
            filename = clean_filename(custom_filename)
            print(f"  使用指定檔名: {filename}")
        
        # 下載音檔
        print(f"正在下載音檔: {filename}")
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.tiktok.com/"
        }
        
        audio_response = requests.get(audio_url, headers=headers, stream=True, timeout=60)
        
        if audio_response.status_code != 200:
            print(f"音檔下載失敗，狀態碼: {audio_response.status_code}")
            return False, None
        
        # 儲存音檔
        file_path = os.path.join(save_path, f"{filename}.mp3")
        
        # 如果檔案已存在,自動添加數字後綴
        if os.path.exists(file_path):
            counter = 1
            original_filename = filename
            while os.path.exists(file_path):
                filename = f"{original_filename}_{counter}"
                file_path = os.path.join(save_path, f"{filename}.mp3")
                counter += 1
            print(f"  檔案已存在，重新命名為: {filename}.mp3")
        
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
        
        return True, default_filename
        
    except requests.exceptions.Timeout:
        print("請求超時，請檢查網路連接")
        return False, None
    except requests.exceptions.RequestException as e:
        print(f"網路請求錯誤: {e}")
        return False, None
    except Exception as e:
        print(f"下載失敗: {e}")
        import traceback
        traceback.print_exc()
        return False, None

def main():
    """
    主程式
    """
    print("=" * 60)
    print("TikTok 音檔下載器 v3.0")
    print("支援多個 API，自動切換")
    print("可自訂檔名")
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
        "● Yes: 可一次貼上多個連結並統一編輯檔名\n"
        "● No: 只下載一個音檔"
    )
    
    success_count = 0
    fail_count = 0
    
    if batch_mode:
        print("\n--- 批次下載模式 ---")
        
        # 步驟 1: 一次輸入所有連結
        urls_input = simpledialog.askstring(
            "輸入多個 TikTok 連結",
            "請貼上所有 TikTok 影片連結\n"
            "（每行一個連結，或用空格/逗號分隔）\n\n"
            "範例:\n"
            "https://www.tiktok.com/@user/video/123\n"
            "https://www.tiktok.com/@user/video/456\n"
            "https://www.tiktok.com/@user/video/789"
        )
        
        if not urls_input or not urls_input.strip():
            print("未輸入任何連結，程式結束。")
            return
        
        # 解析連結（支援多種分隔方式）
        urls = []
        # 先按換行分割
        for line in urls_input.split('\n'):
            line = line.strip()
            if line:
                # 再按逗號或空格分割
                if ',' in line:
                    urls.extend([u.strip() for u in line.split(',') if u.strip()])
                elif ' ' in line and 'tiktok.com' in line:
                    # 如果有空格且包含 tiktok.com，按空格分割
                    urls.extend([u.strip() for u in line.split() if 'tiktok.com' in u or 'vm.tiktok' in u or 'vt.tiktok' in u])
                else:
                    urls.append(line)
        
        # 去重並過濾無效連結
        urls = list(dict.fromkeys(urls))  # 去重但保持順序
        urls = [u for u in urls if 'tiktok' in u.lower()]
        
        if not urls:
            print("沒有找到有效的 TikTok 連結。")
            messagebox.showwarning("錯誤", "沒有找到有效的 TikTok 連結")
            return
        
        print(f"\n找到 {len(urls)} 個連結:")
        for i, url in enumerate(urls, 1):
            print(f"  {i}. {url}")
        
        # 步驟 2: 獲取所有預設檔名
        print("\n正在獲取所有檔案的預設檔名...")
        url_filename_map = {}
        
        for i, url in enumerate(urls, 1):
            print(f"\n[{i}/{len(urls)}] 處理連結: {url[:50]}...")
            default_filename = get_default_filename_from_url(url)
            url_filename_map[url] = default_filename
            print(f"  預設檔名: {default_filename}")
            time.sleep(0.5)  # 避免請求過於頻繁
        
        # 步驟 3: 顯示所有檔名供使用者編輯
        print("\n" + "=" * 60)
        print("檔名列表（可編輯）")
        print("=" * 60)
        
        filename_list_text = ""
        for i, (url, filename) in enumerate(url_filename_map.items(), 1):
            filename_list_text += f"{i}. {filename}\n"
        
        # 讓使用者編輯所有檔名
        edited_filenames = simpledialog.askstring(
            "編輯檔名",
            f"找到 {len(urls)} 個音檔，請確認或修改檔名\n"
            f"（每行一個檔名，不含副檔名 .mp3）\n"
            f"保持原有順序，不要刪除或新增行數\n\n"
            f"預設檔名:\n",
            initialvalue=filename_list_text.strip()
        )
        
        if not edited_filenames:
            print("使用者取消操作。")
            return
        
        # 解析編輯後的檔名
        edited_lines = [line.strip() for line in edited_filenames.split('\n') if line.strip()]
        
        # 移除行號（如果使用者保留了）
        final_filenames = []
        for line in edited_lines:
            # 移除開頭的數字和點
            line = re.sub(r'^\d+\.\s*', '', line)
            final_filenames.append(line)
        
        if len(final_filenames) != len(urls):
            print(f"警告: 檔名數量 ({len(final_filenames)}) 與連結數量 ({len(urls)}) 不符")
            use_default = messagebox.askyesno(
                "檔名數量不符",
                f"檔名數量 ({len(final_filenames)}) 與連結數量 ({len(urls)}) 不符\n\n"
                f"是否使用預設檔名?\n\n"
                f"● Yes: 使用預設檔名\n"
                f"● No: 取消下載"
            )
            
            if not use_default:
                print("使用者取消操作。")
                return
            
            # 使用預設檔名
            final_filenames = list(url_filename_map.values())
        
        # 步驟 4: 顯示最終的下載清單
        print("\n" + "=" * 60)
        print("最終下載清單")
        print("=" * 60)
        for i, (url, filename) in enumerate(zip(urls, final_filenames), 1):
            print(f"{i}. {filename}.mp3")
        
        confirm = messagebox.askyesno(
            "確認下載",
            f"即將下載 {len(urls)} 個音檔\n\n"
            f"儲存位置: {save_path}\n\n"
            f"是否開始下載?"
        )
        
        if not confirm:
            print("使用者取消下載。")
            return
        
        # 步驟 5: 開始下載
        print("\n" + "=" * 60)
        print("開始下載...")
        print("=" * 60)
        
        for i, (url, filename) in enumerate(zip(urls, final_filenames), 1):
            print(f"\n[{i}/{len(urls)}] 下載: {filename}")
            print(f"連結: {url}")
            
            success, _ = download_tiktok_audio(url, save_path, filename)
            
            if success:
                success_count += 1
            else:
                fail_count += 1
            
            print("-" * 60)
            
            # 避免請求過於頻繁
            if i < len(urls):
                time.sleep(1)
    
    else:
        print("\n--- 單一音檔下載 ---")
        url = simpledialog.askstring(
            "輸入 TikTok 連結",
            "請貼上 TikTok 影片連結:"
        )
        
        if url and url.strip():
            url = url.strip()
            print(f"\n處理連結: {url}")
            
            success, _ = download_tiktok_audio(url, save_path)
            
            if success:
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
