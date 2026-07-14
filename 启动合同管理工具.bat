@echo off
chcp 65001 >nul
echo 正在启动合同管理工具...
echo.
cd /d "%~dp0"
node src/server.js
pause
