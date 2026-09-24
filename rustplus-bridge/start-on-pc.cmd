@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-on-pc.ps1" %*
exit /b %errorlevel%
