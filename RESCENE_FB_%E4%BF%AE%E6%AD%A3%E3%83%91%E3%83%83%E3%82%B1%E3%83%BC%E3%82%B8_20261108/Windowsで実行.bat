@echo off
chcp 65001 >nul
set "SITE=%~1"
if "%SITE%"=="" (
 echo RESCENE-FB-JP のフォルダをこのウィンドウにドラッグして Enter を押してください。
 set /p "SITE=フォルダ: "
)
py -3 "%~dp0apply_rescene_site_update.py" "%SITE%" --check
if errorlevel 1 (
  echo 確認に失敗しました。対象フォルダを確認してください。
  pause
  exit /b 1
)
py -3 "%~dp0apply_rescene_site_update.py" "%SITE%"
if errorlevel 1 (
  echo 更新に失敗しました。
) else (
  echo 更新が完了しました。Gitでコミット、プッシュしてください。
)
pause
