"""
fetch_audio_yahoo.py  ← v3（Selenium 版）
==========================================
從 Yahoo 奇摩字典抓取英文單字發音 MP3
使用 Selenium 模擬真實 Chrome 瀏覽器，解決 JS 動態渲染問題

安裝需求：
  pip install selenium requests beautifulsoup4 lxml

  ※ Selenium 4.6+ 內建 ChromeDriver 自動管理，不需要手動下載 chromedriver
  ※ 需要已安裝 Google Chrome 瀏覽器

支援來源檔案：
  - story.json     （從 '內文' / '内文' 欄位抽取單字）
  - Timestamp.txt  （從時間戳記句子抽取單字）

等級資料：
  oxford_5000.csv  （需與本程式放在同一資料夾）
  格式：word,level  （level 為 A1 / A2 / B1 / B2 / C1）
"""

import re
import csv
import json
import time
import requests
from pathlib import Path
from datetime import datetime
from bs4 import BeautifulSoup
import tkinter as tk
from tkinter import filedialog, ttk, messagebox

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException


# ── CONFIG ────────────────────────────────────────────────────────────────────

DELAY        = 1.2
PAGE_TIMEOUT = 12
LOG_FILE     = "download_log.txt"
OXFORD_CSV   = Path(__file__).parent / "oxford_5000.csv"
YAHOO_URL    = "https://tw.dictionary.yahoo.com/dictionary?p={word}"
CEFR_LEVELS  = ["A1", "A2", "B1", "B2", "C1", "未知"]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://tw.dictionary.yahoo.com/",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}


# ── Selenium 瀏覽器建立 ───────────────────────────────────────────────────────

def create_driver() -> webdriver.Chrome:
    """建立無頭 Chrome，並啟用 performance log 攔截 MP3 網路請求"""
    options = Options()
    options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--mute-audio")
    options.add_argument(f"user-agent={HEADERS['User-Agent']}")
    options.add_argument("--lang=zh-TW")
    # 啟用 Network log，用來攔截 .mp3 請求
    options.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(PAGE_TIMEOUT + 5)
    return driver


# ── Oxford 5000 載入 ──────────────────────────────────────────────────────────

def load_oxford_csv(csv_path: Path) -> dict[str, str]:
    if not csv_path.exists():
        print(f"  ⚠️  找不到 {csv_path.name}，所有單字將列為「未知」等級")
        return {}
    table = {}
    with open(csv_path, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            word  = row.get("word", "").strip().lower()
            level = row.get("cefr", row.get("level", "")).strip().upper()
            if word and level:
                table[word] = level
    print(f"  📚 Oxford 5000 載入 {len(table)} 筆")
    return table


def classify_words(words: list[str], oxford: dict[str, str]) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {lv: [] for lv in CEFR_LEVELS}
    for w in words:
        lv = oxford.get(w, "未知")
        if lv not in groups:
            lv = "未知"
        groups[lv].append(w)
    return groups


# ── 文字清理 ─────────────────────────────────────────────────────────────────

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
    all_text = " ".join(
        str(item.get("内文", "") or item.get("內文", ""))
        for item in items if isinstance(item, dict)
    )
    words = extract_words(all_text)
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
    all_words: set[str] = set()
    for fp in filepaths:
        suffix = fp.suffix.lower()
        if suffix == ".json":
            all_words.update(parse_json(fp))
        elif suffix == ".txt":
            all_words.update(parse_timestamp_txt(fp))
        else:
            print(f"  ⚠️  不支援的格式：{fp.name}（只支援 .json / .txt）")
    return sorted(all_words)


# ── Yahoo 奇摩字典：Selenium 抓 MP3 URL ─────────────────────────────────────

def get_yahoo_mp3_url(driver: webdriver.Chrome, word: str) -> str | None:
    """
    三種方式依序嘗試：
      1. Performance Log：攔截瀏覽器實際發出的 .mp3 網路請求（最準確）
      2. DOM 解析：從渲染後 HTML 找 <audio> 或 data-* 屬性
      3. 正規表示式：掃描整頁 HTML
    """
    url = YAHOO_URL.format(word=requests.utils.quote(word))
    try:
        driver.get(url)
        try:
            WebDriverWait(driver, PAGE_TIMEOUT).until(
                EC.presence_of_element_located(
                    (By.CSS_SELECTOR, "div.dictionaryWordCard, div#web, section")
                )
            )
        except TimeoutException:
            pass
        time.sleep(0.6)

        # 方法 1：Performance Log
        try:
            logs = driver.get_log("performance")
            for entry in logs:
                msg = json.loads(entry["message"]).get("message", {})
                if msg.get("method") == "Network.requestWillBeSent":
                    req_url = msg.get("params", {}).get("request", {}).get("url", "")
                    if ".mp3" in req_url:
                        return req_url
        except Exception:
            pass

        # 方法 2：DOM 解析
        soup = BeautifulSoup(driver.page_source, "lxml")
        for audio_tag in soup.find_all("audio"):
            src = audio_tag.get("src", "")
            if src and ".mp3" in src:
                return src if src.startswith("http") else "https:" + src
            for source in audio_tag.find_all("source"):
                s = source.get("src", "")
                if s and ".mp3" in s:
                    return s if s.startswith("http") else "https:" + s
        for tag in soup.find_all(True):
            for attr in ("data-src", "data-url", "data-audio", "data-mp3"):
                val = tag.get(attr, "")
                if val and ".mp3" in val:
                    return val if val.startswith("http") else "https:" + val

        # 方法 3：正規表示式掃全頁
        mp3_urls = re.findall(r'https?://[^\s"\'<>]+\.mp3[^\s"\'<>]*', driver.page_source)
        for u in mp3_urls:
            if word.lower() in u.lower():
                return u
        if mp3_urls:
            return mp3_urls[0]

        return None

    except WebDriverException as e:
        print(f"  ⚠️  [{word}] 瀏覽器錯誤：{e}")
        return None


def download_mp3_bytes(mp3_url: str) -> bytes | None:
    try:
        res = requests.get(mp3_url, headers=HEADERS, timeout=12)
        return res.content if res.status_code == 200 else None
    except Exception:
        return None


# ── 核心：下載單一單字 ───────────────────────────────────────────────────────

def download_word(word: str, output_dir: Path, driver: webdriver.Chrome) -> tuple[str, str]:
    out_file = output_dir / f"{word}.mp3"
    if out_file.exists():
        return word, "skipped"

    time.sleep(DELAY)

    mp3_url = get_yahoo_mp3_url(driver, word)
    if not mp3_url:
        print(f"  ❌ [找不到 URL]   {word}")
        return word, "no_url"

    mp3_data = download_mp3_bytes(mp3_url)
    if mp3_data and len(mp3_data) > 1000:
        out_file.write_bytes(mp3_data)
        print(f"  ✅ [Yahoo]        {word}.mp3")
        return word, "success"
    else:
        print(f"  ❌ [下載失敗]     {word}")
        return word, "dl_fail"


# ── tkinter GUI ───────────────────────────────────────────────────────────────

def pick_files() -> list[Path]:
    root = tk.Tk(); root.withdraw()
    paths = filedialog.askopenfilenames(
        title="選擇來源檔案（可多選 .json / .txt）",
        filetypes=[("支援的檔案", "*.json *.txt"), ("所有檔案", "*.*")],
    )
    root.destroy()
    return [Path(p) for p in paths]


def pick_output_dir() -> Path | None:
    root = tk.Tk(); root.withdraw()
    folder = filedialog.askdirectory(title="選擇 MP3 儲存資料夾")
    root.destroy()
    return Path(folder) if folder else None


def ask_levels(groups: dict[str, list[str]]) -> list[str] | None:
    selected_levels: list[str] | None = None
    root = tk.Tk()
    root.title("選擇要下載的等級")
    root.resizable(False, False)

    tk.Label(root, text="選擇要下載的 CEFR 等級",
             font=("Arial", 13, "bold"), pady=10).pack()
    tk.Label(root, text="（勾選後點「確認下載」開始）",
             font=("Arial", 10), fg="gray").pack()
    ttk.Separator(root, orient="horizontal").pack(fill="x", padx=20, pady=5)

    frame = tk.Frame(root, padx=30, pady=5)
    frame.pack()
    vars_: dict[str, tk.BooleanVar] = {}
    total_var = tk.StringVar()

    def update_total(*_):
        n = sum(len(groups.get(lv, [])) for lv, v in vars_.items() if v.get())
        total_var.set(f"合計將下載：{n} 個")

    colors = {"A1": "#2e7d32", "A2": "#388e3c", "B1": "#1565c0",
              "B2": "#6a1b9a", "C1": "#b71c1c", "未知": "#757575"}

    for lv in CEFR_LEVELS:
        count = len(groups.get(lv, []))
        bv = tk.BooleanVar(value=False)
        bv.trace_add("write", update_total)
        vars_[lv] = bv
        row = tk.Frame(frame); row.pack(anchor="w", pady=3)
        cb = tk.Checkbutton(row, variable=bv, font=("Arial", 11)); cb.pack(side="left")
        tk.Label(row, text=lv, font=("Arial", 11, "bold"),
                 fg=colors.get(lv, "black"), width=4, anchor="w").pack(side="left")
        tk.Label(row, text=f"（{count} 個）",
                 font=("Arial", 11), fg="#555555").pack(side="left")
        if count == 0:
            cb.config(state="disabled")

    ttk.Separator(root, orient="horizontal").pack(fill="x", padx=20, pady=8)
    update_total()
    tk.Label(root, textvariable=total_var,
             font=("Arial", 11, "bold"), fg="#1565c0").pack()
    btn_frame = tk.Frame(root, pady=12); btn_frame.pack()

    def on_confirm():
        nonlocal selected_levels
        chosen = [lv for lv, v in vars_.items() if v.get()]
        if not chosen:
            messagebox.showwarning("未勾選", "請至少勾選一個等級！", parent=root)
            return
        selected_levels = chosen
        root.destroy()

    tk.Button(btn_frame, text="確認下載", command=on_confirm,
              bg="#1565c0", fg="white", font=("Arial", 11, "bold"),
              width=12, relief="flat", cursor="hand2").pack(side="left", padx=8)
    tk.Button(btn_frame, text="取消", command=root.destroy,
              font=("Arial", 11), width=8, relief="flat",
              cursor="hand2").pack(side="left", padx=8)

    root.mainloop()
    return selected_levels


# ── Log ──────────────────────────────────────────────────────────────────────

def write_log(output_dir, source_files, chosen_levels,
              results, skipped_count, groups) -> Path:
    log_path  = output_dir / LOG_FILE
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    ok      = sorted(results.get("success", []))
    no_url  = sorted(results.get("no_url",  []))
    dl_fail = sorted(results.get("dl_fail", []))
    lines = [
        "=" * 55,
        "  Yahoo 奇摩字典 MP3 下載紀錄（Selenium 版）",
        f"  執行時間：{timestamp}",
        "=" * 55, "",
        "【來源檔案】", *[f"  {fp.name}" for fp in source_files], "",
        "【勾選等級】", f"  {' / '.join(chosen_levels)}", "",
        "【各等級單字數】",
        *[f"  {lv}：{len(groups.get(lv, []))} 個" for lv in CEFR_LEVELS], "",
        "【摘要】",
        f"  ✅ 成功下載：  {len(ok)} 個",
        f"  ⏭️  已有跳過：  {skipped_count} 個",
        f"  ❌ 找不到 URL：{len(no_url)} 個",
        f"  ❌ 下載失敗：  {len(dl_fail)} 個", "",
    ]
    if ok:
        lines += ["─" * 55, f"【成功】（{len(ok)} 個）", *[f"  {w}.mp3" for w in ok], ""]
    if no_url:
        lines += ["─" * 55, f"【找不到 URL】（{len(no_url)} 個）", *[f"  {w}" for w in no_url], ""]
    if dl_fail:
        lines += ["─" * 55, f"【下載失敗】（{len(dl_fail)} 個）", *[f"  {w}" for w in dl_fail], ""]
    lines.append("=" * 55)
    log_path.write_text("\n".join(lines), encoding="utf-8")
    return log_path


# ── 主程式 ───────────────────────────────────────────────────────────────────

def main():
    print("=" * 55)
    print("  Yahoo 奇摩字典  英文單字 MP3 下載工具  v3")
    print("  （Selenium Chrome 版 — 支援 JS 動態渲染）")
    print("=" * 55)

    print("\n📚 載入 Oxford 5000 等級清單...")
    oxford = load_oxford_csv(OXFORD_CSV)

    print("\n📂 請選擇來源檔案（.json 或 .txt，可多選）...")
    source_files = pick_files()
    if not source_files:
        print("❌ 未選擇任何檔案，結束。"); return
    for fp in source_files:
        print(f"    - {fp.name}")

    print("\n📖 解析檔案中...")
    all_words = load_words_from_files(source_files)
    print(f"\n  合計 {len(all_words)} 個不重複單字")

    print("\n📁 請選擇 MP3 儲存資料夾...")
    output_dir = pick_output_dir()
    if not output_dir:
        print("❌ 未選擇資料夾，結束。"); return
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"  儲存位置：{output_dir}")

    missing       = [w for w in all_words if not (output_dir / f"{w}.mp3").exists()]
    skipped_count = len(all_words) - len(missing)
    print(f"\n  已有 MP3（跳過）：{skipped_count} 個")
    print(f"  缺少（待處理）：  {len(missing)} 個")

    if not missing:
        print("\n✨ 全部單字已有 MP3，無需下載。")
        input("\n按 Enter 結束..."); return

    print("\n🔍 依 CEFR 等級分類中...")
    groups = classify_words(missing, oxford)
    for lv in CEFR_LEVELS:
        print(f"  {lv}：{len(groups[lv])} 個")

    print("\n🪟 請在彈出視窗中勾選要下載的等級...")
    chosen_levels = ask_levels(groups)
    if not chosen_levels:
        print("取消。"); return

    to_download = sorted({w for lv in chosen_levels for w in groups.get(lv, [])})
    print(f"\n  已勾選等級：{' / '.join(chosen_levels)}")
    print(f"  合計下載：  {len(to_download)} 個單字")

    print("\n🌐 啟動 Chrome 瀏覽器（headless）...")
    try:
        driver = create_driver()
    except WebDriverException as e:
        print(f"\n❌ 無法啟動 Chrome：{e}")
        print("   請確認已安裝 Google Chrome，並執行：pip install --upgrade selenium")
        input("\n按 Enter 結束..."); return

    print(f"\n🚀 開始下載（來源：Yahoo 奇摩字典）...\n")
    results: dict[str, list[str]] = {"success": [], "no_url": [], "dl_fail": []}

    try:
        for i, word in enumerate(to_download, 1):
            w, status = download_word(word, output_dir, driver)
            if status != "skipped":
                results.setdefault(status, []).append(w)
            if i % 20 == 0:
                ok   = len(results.get("success", []))
                fail = len(results.get("no_url", [])) + len(results.get("dl_fail", []))
                print(f"\n  📊 進度 {i}/{len(to_download)}  ✅ {ok}  ❌ {fail}\n")
    finally:
        driver.quit()
        print("\n  🌐 Chrome 已關閉")

    log_path = write_log(output_dir, source_files, chosen_levels,
                         results, skipped_count, groups)

    ok      = sorted(results.get("success", []))
    no_url  = sorted(results.get("no_url",  []))
    dl_fail = sorted(results.get("dl_fail", []))

    print(f"\n{'=' * 55}\n  下載完成\n{'=' * 55}")
    print(f"  ✅ 成功：     {len(ok)} 個")
    print(f"  ⏭️  跳過：     {skipped_count} 個")
    print(f"  ❌ 找不到：   {len(no_url)} 個")
    print(f"  ❌ 下載失敗： {len(dl_fail)} 個")
    if ok:
        print(f"\n── 成功下載 {'─'*43}")
        for w in ok: print(f"   {w}.mp3")
    if no_url:
        print(f"\n── 找不到 URL {'─'*41}")
        for w in no_url: print(f"   {w}")
    if dl_fail:
        print(f"\n── 下載失敗 {'─'*43}")
        for w in dl_fail: print(f"   {w}")

    print(f"\n{'=' * 55}")
    print(f"📝 紀錄已存至：{log_path}")
    print(f"📁 MP3 位置：  {output_dir.resolve()}")
    print(f"{'=' * 55}")
    input("\n按 Enter 結束...")


if __name__ == "__main__":
    main()
