@echo off
rem AgentHive dev stack: backend :8075 + vite :5175
start "agenthive-backend" /min cmd /c "cd /d %~dp0backend && .venv\Scripts\python.exe run.py"
start "agenthive-frontend" /min cmd /c "cd /d %~dp0frontend && npm run dev"
echo AgentHive starting - http://localhost:5175
