# BBA Dublin Bible Quiz

Standalone Bible quiz application for [Believers Brethren Assembly Dublin](https://www.bbadublin.com/).

**This is a separate project** from Open Chat Studio. BBA Dublin uses **only** this quiz app — Google Sheets, Apps Script, and an optional Flutter client.

**Target URL:** `https://www.quiz.bbadublin.com/`

## What this project includes

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Backend** | Google Apps Script (`gas/`) | Auth, daily quiz, scoring, leaderboards |
| **Database** | Google Sheets | Questions, users, submissions, schedule |
| **Web UI** | HTML in Apps Script | Login, quiz, scoreboard, badges |
| **Mobile / Web app** | Flutter (`mobile/`) | Optional app embedding the same quiz URL |

**Not included:** AI chat, Ollama, or any Open Chat Studio features.

## Features

- **User authentication** — Register/login with email + password, or email + OTP
- **Daily quiz** — One quiz per day based on a Bible chapter; question count varies by chapter (minimum 5)
- **Midnight reset** — New quiz each morning (Europe/Dublin timezone)
- **Immutable answers** — Once submitted, answers cannot be changed
- **Scoreboards** — All-time, monthly, and weekly leaderboards
- **Badges** — Earned from streaks, scores, and perfect quizzes
- **Flutter app** — Android, iOS, and Web ([FLUTTER.md](docs/FLUTTER.md))

## Project structure

```
bba-quiz/
├── gas/                    # Google Apps Script (copy into your Sheet)
├── mobile/                 # Flutter app (optional)
├── docs/
│   ├── SETUP.md            # Deploy to quiz.bbadublin.com
│   ├── FLUTTER.md          # Build the Flutter app
│   └── SHEET-TEMPLATE.md   # Sheet column reference
└── scripts/
    └── setup-flutter.ps1
```

## Quick start

1. Create a Google Sheet named **"BBA Dublin Bible Quiz"**
2. **Extensions → Apps Script** — copy all files from `gas/`
3. Run **`setupSheets()`** once
4. **Deploy → Web app** (Execute as: Me, Access: Anyone)
5. Point **`quiz.bbadublin.com`** to the deployed URL — see [SETUP.md](docs/SETUP.md)
6. (Optional) Flutter app — see [FLUTTER.md](docs/FLUTTER.md)

## Google Sheet tabs

| Tab | Purpose |
|-----|---------|
| `Users` | Accounts, sessions, stats |
| `OTP` | Temporary login codes |
| `DailySchedule` | Date → book/chapter → quiz ID |
| `Questions` | Quiz questions (min. 5 per day) |
| `Submissions` | Locked answers (one per user per day) |
| `Settings` | Optional configuration |

## Adding daily quizzes

1. Add a row to **DailySchedule**: `date | book | chapter | quiz_id`
2. Add questions to **Questions** for that `quiz_id` (minimum 5; more for longer chapters)
3. **BBA Quiz → Validate upcoming quizzes** in the spreadsheet menu

## License

Built for BBA Dublin. Internal use.
