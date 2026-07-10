# Flutter App — BBA Dublin Bible Quiz

A Flutter wrapper app that loads the **same Google Apps Script web app** used by `quiz.bbadublin.com`. One Google Sheet backend, multiple clients.

```
Google Sheet + Apps Script (same backend)
        │
        ├── quiz.bbadublin.com (browser)
        ├── Apps Script URL directly
        └── Flutter app (Android / iOS / Web)
              └── embeds the same URL in WebView / iframe
```

## Why this approach?

- **One source of truth** — Quiz content, users, scores, and leaderboards stay in the Google Sheet
- **No duplicate logic** — The Flutter app shows the same web UI; updates to Apps Script apply everywhere
- **Fast to ship** — No need to rebuild auth, quiz, and leaderboard in Dart

## Prerequisites

- [Flutter SDK](https://docs.flutter.dev/get-started/install) 3.2+
- Deployed Apps Script Web App URL (see [SETUP.md](SETUP.md))

## First-time setup

From the repo root:

```powershell
cd bba-quiz\mobile
flutter create . --project-name bba_quiz --org com.bbadublin --platforms=android,ios,web
flutter pub get
```

If platform folders already exist, skip `flutter create` and run only `flutter pub get`.

## Configure the quiz URL

After deploying Apps Script, set your Web App URL using **one** of these:

### Option A: `app_config.dart` (simple)

Edit `lib/config/app_config.dart`:

```dart
static const String defaultUrl =
    'https://script.google.com/macros/s/AKfycb.../exec';
```

### Option B: Build-time flag (recommended for CI)

```powershell
flutter run -d chrome --dart-define=QUIZ_URL=https://script.google.com/macros/s/YOUR_ID/exec
```

```powershell
flutter build web --dart-define=QUIZ_URL=https://script.google.com/macros/s/YOUR_ID/exec
```

## Run the app

```powershell
# Web (Chrome) — embeds quiz in iframe
flutter run -d chrome --dart-define=QUIZ_URL=https://script.google.com/macros/s/YOUR_ID/exec

# Android emulator / device
flutter run -d android --dart-define=QUIZ_URL=https://script.google.com/macros/s/YOUR_ID/exec

# iOS (Mac only)
flutter run -d ios --dart-define=QUIZ_URL=https://script.google.com/macros/s/YOUR_ID/exec
```

## Build for production

### Flutter Web (host at quiz.bbadublin.com or a subdomain)

```powershell
flutter build web --dart-define=QUIZ_URL=https://script.google.com/macros/s/YOUR_ID/exec
```

Upload `build/web/` to your host (Firebase Hosting, Cloudflare Pages, Netlify, etc.).

### Android APK

```powershell
flutter build apk --dart-define=QUIZ_URL=https://script.google.com/macros/s/YOUR_ID/exec
```

Output: `build/app/outputs/flutter-apk/app-release.apk`

### iOS

```powershell
flutter build ios --dart-define=QUIZ_URL=https://script.google.com/macros/s/YOUR_ID/exec
```

Open `ios/Runner.xcworkspace` in Xcode to archive and upload to App Store.

## Platform behavior

| Platform | How it works |
|----------|----------------|
| **Android / iOS** | `webview_flutter` loads the Apps Script URL full-screen |
| **Flutter Web** | Full-page `iframe` embeds the same URL |
| **Open in browser** | App bar button opens the quiz URL externally |

## Android internet permission

After `flutter create`, confirm `android/app/src/main/AndroidManifest.xml` includes:

```xml
<uses-permission android:name="android.permission.INTERNET"/>
```

Flutter adds this by default.

## Hosting options for Flutter Web

You can use either:

1. **Apps Script URL only** — Point `quiz.bbadublin.com` directly to the script (simplest)
2. **Flutter Web build** — Host `build/web/` at `quiz.bbadublin.com`; it embeds the Apps Script URL inside the Flutter shell (custom app bar, PWA manifest)

Both use the **same Google Sheet** — only the shell differs.

## Future: native Flutter UI

The Apps Script backend also exposes a JSON API (`doPost` with `action` fields). You can later replace the WebView with native Dart screens calling that API. The current WebView approach is the fastest path to a working app.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Blank WebView on Android | Ensure `INTERNET` permission; use HTTPS URL |
| "Set your Apps Script URL" message | Update `defaultUrl` or pass `--dart-define=QUIZ_URL=...` |
| Language selector not showing | Redeploy Apps Script `index`; rebuild app (`appVersion` in `app_config.dart` must match `Config.gs`); WebView clears cache on launch |
| Old UI in mobile WebView | Bump `appVersion` in `app_config.dart` and rebuild APK |
| iframe blank on web | Apps Script must be deployed with **Anyone** access |
| OTP email not sent | Same as web — authorize Gmail in Apps Script |
