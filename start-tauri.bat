@echo off
title SignalTeams Desktop Launcher
cd /d "%~dp0"
if exist "%~dp0SignalTeams.exe" (
    start "" "%~dp0SignalTeams.exe"
) else if exist "%~dp0frontend\src-tauri\target\release\signalteams.exe" (
    start "" "%~dp0frontend\src-tauri\target\release\signalteams.exe"
) else (
    echo Building SignalTeams Tauri desktop app...
    cd /d "%~dp0frontend\src-tauri"
    cargo build --release
    start "" "%~dp0frontend\src-tauri\target\release\signalteams.exe"
)
