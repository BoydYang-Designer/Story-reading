"""
fetch_audio.py
==============
互動式單字發音 MP3 下載工具

支援來源：
  - story.json   （從 '內文' 欄位抽取單字）
  - Timestamp.txt（從句子中抽取單字）

發音來源（三層降級）：
  1. FreeDictionary API（真人錄音，優先美式）
  2. Wiktionary        （真人錄音，ogg 轉 mp3）
  3. 記錄到 download_log.txt（找不到時）

安裝需求：
  pip install requests pydub
  brew install ffmpeg   # macOS（ogg 轉 mp3 需要）
  # Windows: https://ffmpeg.org/download.html
  # Ubuntu:  sudo apt install ffmpeg
"""

import re
import json
import time
import hashlib
import tempfile
import requests
from pathlib import Path
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import tkinter as tk
from tkinter import filedialog


# ── CONFIG ────────────────────────────────────────────────────────────────────

CONCURRENCY = 3      # 並發下載數
DELAY       = 0.3    # 每次請求間隔（秒）
LOG_FILE    = "download_log.txt"


# ── 文字清理：抽取英文單字 ───────────────────────────────────────────────────

def extract_words(text: str) -> list[str]:
    raw = re.findall(r"[a-zA-Z]+(?:[-'][a-zA-Z]+)*", text)
    seen, words = set(), []
    for w in raw:
        w = w.lower().strip("-'")
        if len(w) >= 2 and w not in seen:
            seen.add(w)
            words.append(w)
    return words


# ── 解析來源檔案 ─────────────────────────────────────────────────────────────

def parse_json(filepath: Path) -> list[str]:
    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)
    items    = data.get("New Words", []) if isinstance(data, dict) else data
    all_text = " ".join(str(item.get("内文", "") or item.get("內文", ""))
                        for item in items if isinstance(item, dict))
    words    = extract_words(all_text)
    print(f"  [{filepath.name}] 抽取到 {len(words)} 個不重複單字")
    return words


def parse_timestamp_txt(filepath: Path) -> list[str]:
    pattern   = re.compile(r"\[.*?-->\s*.*?\]\s*(.*)")
    all_parts = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            m = pattern.match(line.strip())
            if m:
                all_parts.append(m.group(1))
    words = extract_words(" ".join(all_parts))
    print(f"  [{filepath.name}] 抽取到 {len(words)} 個不重複單字")
    return words


def load_words_from_files(filepaths: list[Path]) -> list[str]:
    all_words = set()
    for fp in filepaths:
        suffix = fp.suffix.lower()
        if suffix == ".json":
            all_words.update(parse_json(fp))
        elif suffix == ".txt":
            all_words.update(parse_timestamp_txt(fp))
        else:
            print(f"  ⚠️  不支援的格式：{fp.name}（只支援 .json / .txt）")
    return sorted(all_words)


# ── 發音來源 1：FreeDictionary ───────────────────────────────────────────────

def get_freedict_mp3(word: str) -> bytes | None:
    try:
        res = requests.get(
            f"https://api.dictionaryapi.dev/api/v2/entries/en/{requests.utils.quote(word)}",
            timeout=8
        )
        if res.status_code != 200:
            return None
        data = res.json()
        if not isinstance(data, list) or not data:
            return None
        phonetics  = [p for entry in data for p in entry.get("phonetics", [])]
        audio_urls = [p["audio"] for p in phonetics if p.get("audio")]
        chosen     = next((u for u in audio_urls if "-us" in u), None) \
                     or (audio_urls[0] if audio_urls else None)
        if not chosen:
            return None
        mp3 = requests.get(chosen, timeout=10)
        return mp3.content if mp3.status_code == 200 else None
    except Exception:
        return None


# ── 發音來源 2：Wiktionary ───────────────────────────────────────────────────

def get_wiktionary_mp3(word: str) -> bytes | None:
    for filename in [f"En-us-{word}.ogg", f"En-{word}.ogg"]:
        md5 = hashlib.md5(filename.replace(" ", "_").encode()).hexdigest()
        url = (
            f"https://upload.wikimedia.org/wikipedia/commons/"
            f"{md5[0]}/{md5[0:2]}/{requests.utils.quote(filename)}"
        )
        try:
            res = requests.get(url, timeout=10)
            if res.status_code != 200:
                continue
            try:
                from pydub import AudioSegment
                with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as t:
                    t.write(res.content)
                    ogg = t.name
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as t:
                    mp3 = t.name
                AudioSegment.from_ogg(ogg).export(mp3, format="mp3")
                data = Path(mp3).read_bytes()
                Path(ogg).unlink(missing_ok=True)
                Path(mp3).unlink(missing_ok=True)
                return data
            except Exception:
                return None
        except Exception:
            continue
    return None


# ── 核心：下載單一單字 ───────────────────────────────────────────────────────

def download_word(word: str, output_dir: Path) -> tuple[str, str]:
    """
    回傳 (word, status)
    status: 'skipped' | 'freedict' | 'wiktionary' | 'failed'
    """
    if (output_dir / f"{word}.mp3").exists():
        return word, "skipped"

    time.sleep(DELAY)

    mp3 = get_freedict_mp3(word)
    if mp3:
        (output_dir / f"{word}.mp3").write_bytes(mp3)
        print(f"  ✅ [FreeDictionary] {word}.mp3")
        return word, "freedict"

    mp3 = get_wiktionary_mp3(word)
    if mp3:
        (output_dir / f"{word}.mp3").write_bytes(mp3)
        print(f"  ✅ [Wiktionary]     {word}.mp3")
        return word, "wiktionary"

    print(f"  ❌ [Not Found]      {word}")
    return word, "failed"


# ── 互動 UI ──────────────────────────────────────────────────────────────────

def pick_files() -> list[Path]:
    root = tk.Tk()
    root.withdraw()
    paths = filedialog.askopenfilenames(
        title="選擇來源檔案（可多選 .json / .txt）",
        filetypes=[("支援的檔案", "*.json *.txt"), ("所有檔案", "*.*")]
    )
    root.destroy()
    return [Path(p) for p in paths]


def pick_output_dir() -> Path | None:
    root = tk.Tk()
    root.withdraw()
    folder = filedialog.askdirectory(title="選擇 MP3 儲存資料夾")
    root.destroy()
    return Path(folder) if folder else None


# ── 寫入 log ─────────────────────────────────────────────────────────────────

def write_log(
    output_dir: Path,
    source_files: list[Path],
    results: dict[str, list[str]],
    skipped_count: int,
) -> Path:
    log_path  = output_dir / LOG_FILE
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ok_fd     = sorted(results.get("freedict",   []))
    ok_wk     = sorted(results.get("wiktionary", []))
    failed    = sorted(results.get("failed",     []))
    total_ok  = len(ok_fd) + len(ok_wk)

    lines = [
        "=" * 55,
        "  MP3 下載紀錄",
        f"  執行時間：{timestamp}",
        "=" * 55,
        "",
        "【來源檔案】",
        *[f"  {fp.name}" for fp in source_files],
        "",
        "【摘要】",
        f"  ✅ 成功下載：{total_ok} 個",
        f"     FreeDictionary：{len(ok_fd)} 個",
        f"     Wiktionary：    {len(ok_wk)} 個",
        f"  ⏭️  已有跳過：    {skipped_count} 個",
        f"  ❌ 找不到：      {len(failed)} 個",
        "",
    ]

    if ok_fd:
        lines += [
            "─" * 55,
            f"【成功 — FreeDictionary】（{len(ok_fd)} 個）",
            *[f"  {w}.mp3" for w in ok_fd],
            "",
        ]

    if ok_wk:
        lines += [
            "─" * 55,
            f"【成功 — Wiktionary】（{len(ok_wk)} 個）",
            *[f"  {w}.mp3" for w in ok_wk],
            "",
        ]

    if failed:
        lines += [
            "─" * 55,
            f"【找不到】（{len(failed)} 個）",
            *[f"  {w}" for w in failed],
            "",
        ]

    lines.append("=" * 55)
    log_path.write_text("\n".join(lines), encoding="utf-8")
    return log_path


# ── 主程式 ───────────────────────────────────────────────────────────────────

def main():
    print("=" * 55)
    print("  英文單字 MP3 下載工具")
    print("=" * 55)

    # 1. 選取來源檔案
    print("\n📂 請選擇來源檔案（.json 或 .txt，可多選）...")
    source_files = pick_files()
    if not source_files:
        print("❌ 未選擇任何檔案，結束。")
        return
    print(f"  已選取 {len(source_files)} 個檔案：")
    for fp in source_files:
        print(f"    - {fp.name}")

    # 2. 解析單字
    print("\n📖 解析檔案中...")
    all_words = load_words_from_files(source_files)
    print(f"\n  合計 {len(all_words)} 個不重複單字")

    # 3. 選取輸出資料夾
    print("\n📁 請選擇 MP3 儲存資料夾...")
    output_dir = pick_output_dir()
    if not output_dir:
        print("❌ 未選擇資料夾，結束。")
        return
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"  儲存位置：{output_dir}")

    # 4. 計算待下載
    to_download   = [w for w in all_words if not (output_dir / f"{w}.mp3").exists()]
    skipped_count = len(all_words) - len(to_download)
    print(f"\n  已有 MP3（跳過）：{skipped_count} 個")
    print(f"  待下載：          {len(to_download)} 個")

    if not to_download:
        print("\n✨ 全部單字已有 MP3，無需下載。")
        log_path = write_log(output_dir, source_files, {}, skipped_count)
        print(f"📝 紀錄已存至：{log_path}")
        input("\n按 Enter 結束...")
        return

    # 5. 確認開始
    ans = input(f"\n▶  開始下載 {len(to_download)} 個單字的 MP3？(y/n) ").strip().lower()
    if ans != "y":
        print("取消。")
        return

    # 6. 下載
    print(f"\n🚀 開始下載...\n")
    results: dict[str, list[str]] = {"freedict": [], "wiktionary": [], "failed": []}

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as executor:
        futures = {executor.submit(download_word, w, output_dir): w for w in to_download}
        for i, future in enumerate(as_completed(futures), 1):
            word, status = future.result()
            if status != "skipped":
                results[status].append(word)
            if i % 50 == 0:
                ok = len(results["freedict"]) + len(results["wiktionary"])
                print(f"\n  📊 進度 {i}/{len(to_download)}  ✅ {ok}  ❌ {len(results['failed'])}\n")

    # 7. 寫入 log
    log_path = write_log(output_dir, source_files, results, skipped_count)

    # 8. 畫面顯示完整清單（停留等待）
    ok_fd    = sorted(results["freedict"])
    ok_wk    = sorted(results["wiktionary"])
    failed   = sorted(results["failed"])
    total_ok = len(ok_fd) + len(ok_wk)

    print(f"\n{'=' * 55}")
    print(f"  下載完成")
    print(f"{'=' * 55}")
    print(f"  ✅ 成功：{total_ok} 個")
    print(f"     FreeDictionary：{len(ok_fd)} 個")
    print(f"     Wiktionary：    {len(ok_wk)} 個")
    print(f"  ⏭️  跳過：{skipped_count} 個")
    print(f"  ❌ 找不到：{len(failed)} 個")

    if ok_fd:
        print(f"\n── 成功（FreeDictionary）{'─' * 30}")
        for w in ok_fd:
            print(f"   {w}.mp3")

    if ok_wk:
        print(f"\n── 成功（Wiktionary）{'─' * 34}")
        for w in ok_wk:
            print(f"   {w}.mp3")

    if failed:
        print(f"\n── 找不到 {'─' * 45}")
        for w in failed:
            print(f"   {w}")

    print(f"\n{'=' * 55}")
    print(f"📝 紀錄已存至：{log_path}")
    print(f"📁 MP3 位置：  {output_dir.resolve()}")
    print(f"{'=' * 55}")
    input("\n按 Enter 結束...")


if __name__ == "__main__":
    main()
