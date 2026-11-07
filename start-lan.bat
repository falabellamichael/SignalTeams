@echo off
rem AgentHive LAN mode — friends join at http://<your-ip>:8075
cd /d %~dp0frontend
call npm run build
cd /d %~dp0backend
set AGENTHIVE_HOST=0.0.0.0
echo.
echo  ==== AgentHive LAN ====
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo   share this: http://%%a:8075
echo  (spaces in the IP are fine — tell them the 4 numbers)
echo.
.venv\Scripts\python.exe run.py
