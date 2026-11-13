@echo off
title SignalHive Desktop Launcher
cd /d "%~dp0"
if exist "%~dp0SignalHive.exe" (
    start "" "%~dp0SignalHive.exe"
) else if exist "%~dp0frontend\src-tauri\target\release\signalteams.exe" (
    start "" "%~dp0frontend\src-tauri\target\release\signalteams.exe"
) else (
    echo Building SignalHive Tauri desktop app...
    cd /d "%~dp0frontend\src-tauri"
    cargo build --release
    start "" "%~dp0frontend\src-tauri\target\release\signalteams.exe"
)
