
@echo off
echo ===================================================
echo [경기북부 FS 인허가 대시보드] 로컬 서버 실행
echo ===================================================
echo.
echo 잠시 후 브라우저가 자동으로 실행됩니다.
echo 실행되지 않으면 브라우저 주소창에 http://localhost:8000 을 입력하세요.
echo.
echo 서버를 종료하려면 이 창을 닫거나 Ctrl+C를 누르세요.
echo.

start http://localhost:8000

node server.js
pause
