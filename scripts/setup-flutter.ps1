@echo off
REM First-time Flutter setup for BBA Quiz mobile app
cd /d "%~dp0..\mobile"

where flutter >nul 2>&1
if errorlevel 1 (
  echo Flutter not found. Install from https://docs.flutter.dev/get-started/install
  exit /b 1
)

if not exist "android" (
  echo Creating Flutter platform folders...
  flutter create . --project-name bba_quiz --org com.bbadublin --platforms=android,ios,web
)

flutter pub get
echo.
echo Done. Next steps:
echo   1. Deploy Apps Script and copy the Web App URL
echo   2. Edit mobile\lib\config\app_config.dart OR use --dart-define=QUIZ_URL=...
echo   3. flutter run -d chrome --dart-define=QUIZ_URL=YOUR_URL
echo.
echo See docs\FLUTTER.md for full instructions.
