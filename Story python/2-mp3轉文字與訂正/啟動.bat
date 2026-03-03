@echo off
chcp 65001 >nul
title mp3toword-Smart 啟動與環境配置

echo ===================================================
echo   mp3toword-Smart v23 - 智慧語音轉錄環境啟動器
echo ===================================================
echo.

echo [1/4] 正在檢查 Python 環境...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [錯誤] 找不到 Python！
    echo 請先到 https://www.python.org/ 下載並安裝 Python。
    echo 安裝時請務必勾選底部的「Add Python.exe to PATH」選項！
    pause
    exit /b
)

echo [2/4] 正在檢查並安裝必要的第三方套件...
echo (如果是第一次執行，這可能會花費數分鐘下載模型與套件，請耐心等候)
pip install torch torchvision torchaudio --quiet
pip install faster-whisper openai-whisper soundfile spacy --quiet

echo [3/4] 正在下載 spaCy 語言模型 (用於智慧斷句)...
python -m spacy download en_core_web_sm --quiet

echo [4/4] 環境準備就緒！正在啟動主程式...
echo ===================================================
python mp3toword-Smart-v23.py

echo.
echo ===================================================
echo 程式已結束執行。
pause