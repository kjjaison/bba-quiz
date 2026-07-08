# Deployment Guide — quiz.bbadublin.com

This guide walks through deploying the Bible Quiz app from Google Sheets/Apps Script to your custom subdomain.

## Prerequisites

- Google account with access to the BBA Dublin domain DNS
- Permission to create Google Sheets and Apps Script projects
- (Optional) Cloudflare or similar for custom domain routing

---

## Step 1: Create the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it **"BBA Dublin Bible Quiz"**
3. Keep this sheet private (only admins need edit access)

---

## Step 2: Install Apps Script

1. In the spreadsheet, go to **Extensions → Apps Script**
2. Delete the default `Code.gs` file (if present)
3. Create these **7 script files** — click **+** next to Files, choose **Script**, then paste from `gas/`:

   | Apps Script file | Copy from |
   |------------------|-----------|
   | `Config.gs` | `gas/Config.gs` |
   | `Auth.gs` | `gas/Auth.gs` |
   | `Quiz.gs` | `gas/Quiz.gs` |
   | `Leaderboard.gs` | `gas/Leaderboard.gs` |
   | `Main.gs` | `gas/Main.gs` |
   | `ApiClient.gs` | `gas/ApiClient.gs` |
   | **`Setup.gs`** | **`gas/Setup.gs`** ← setup function lives here |

4. Create an HTML file:
   - Click **+** → **HTML**
   - When asked for the name, type **`index`** and press Enter
   - It will appear in the sidebar as **`index.html`** — **that is correct**
   - Paste the full contents of `gas/index.html`
   - **Do not** rename it or create a second file
5. Press **Ctrl+S** (or **Cmd+S**) to **save all files**

---

## Step 3: Run initial setup

The function dropdown only shows functions from the **file you currently have open**. Use one of these methods:

### Method A — From the Google Sheet (easiest)

1. Go back to your **Google Sheet** tab (not Apps Script)
2. **Refresh the page** (F5)
3. In the menu bar, click **BBA Quiz → Run initial setup**
4. Click **Allow** when asked to authorize
5. You should see **"Setup complete!"** — new tabs appear at the bottom of the sheet

### Method B — From the Apps Script editor

1. In the **left sidebar**, click **`Setup.gs`** (not `Code.gs` or `index`)
2. At the **top toolbar**, click the function dropdown — it should show **`setupSheets`**
3. Click **Run** (▶ play button)
4. First time: click **Review permissions** → choose your Google account → **Allow**
5. Check the spreadsheet for new tabs: `Users`, `DailySchedule`, `Questions`, etc.

### If you still don't see `setupSheets`

| Problem | Fix |
|---------|-----|
| Dropdown shows `doGet` or `myFunction` only | You have the wrong file open — click **`Setup.gs`** in the left sidebar |
| No `Setup.gs` in the sidebar | Create it: **+ → Script**, name it `Setup.gs`, paste from `gas/Setup.gs` |
| Only default `Code.gs` exists | You need all 7 `.gs` files — see Step 2 |
| Red error markers in the editor | Fix syntax errors first; save with Ctrl+S |
| No **BBA Quiz** menu in the sheet | Save all scripts, refresh the spreadsheet |

---

## Step 4: Configure Production Settings

In `Config.gs`, change the salt to a unique random string:

```javascript
SALT: 'your-unique-random-string-here',
```

This secures password hashing. Do not share this value.

---

## Step 5: Deploy as Web App

1. In Apps Script, click **Deploy → New deployment**
2. Click the gear icon → select **Web app**
3. Settings:
   - **Description:** BBA Dublin Bible Quiz
   - **Execute as:** Me (`your-email@gmail.com`)
   - **Who has access:** **Anyone** ← required for public quiz
4. Click **Deploy**
5. Copy the **Web app URL** — it **must** end with **`/exec`**

   ✅ Correct:
   ```
   https://script.google.com/macros/s/AKfycbx.../exec
   ```

   ❌ Wrong (causes "page not found" for visitors):
   ```
   https://script.google.com/macros/s/AKfycbx.../dev
   https://script.google.com/home/projects/...
   https://docs.google.com/spreadsheets/...
   ```

6. Open the `/exec` URL in a **new incognito/private window** to test
7. You should see the BBA Dublin Bible Quiz login page

### After any code change

You must redeploy or visitors keep seeing old/broken pages:

1. **Deploy → Manage deployments**
2. Click the **pencil (Edit)** icon
3. **Version → New version**
4. Click **Deploy**
5. The URL stays the same — no DNS change needed

### Checklist if you see "Page not found"

| Check | Fix |
|-------|-----|
| URL ends with `/dev` | Use the `/exec` URL from **Deploy → Manage deployments** |
| URL is the spreadsheet link | Use the **Web app** URL, not the Google Sheet URL |
| HTML file missing | Create HTML file named **`index`** (shows as `index.html` in sidebar — that's OK) |
| Never redeployed after adding `index` | Deploy → Manage deployments → Edit → New version → Deploy |
| Access is "Only myself" | Change to **Anyone** and redeploy |
| DNS for quiz.bbadublin.com | Point to the full `/exec` URL, not just bbadublin.com |
| First visit asks to authorize | Normal for owner on `/dev`; use `/exec` with **Anyone** access |

---

## Step 6: Point quiz.bbadublin.com to the App

You have three options:

### Option A: DNS Redirect (Simplest)

If your DNS provider supports URL forwarding:

1. Create a CNAME or redirect record:
   - **Host:** `quiz` (or `www.quiz`)
   - **Target:** Your Apps Script Web App URL
2. Enable HTTPS redirect if available

### Option B: Cloudflare Worker (Recommended for custom domain)

1. Add `bbadublin.com` to Cloudflare
2. Create a Worker that proxies to the Apps Script URL:

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec';
    return Response.redirect(target + url.search, 302);
  }
};
```

3. Add a route: `quiz.bbadublin.com/*` → your Worker

### Option C: Google Sites Embed

1. Create a new Google Site at `quiz.bbadublin.com` (if using Google Workspace custom domains)
2. Embed the Apps Script web app URL in a full-width embed block
3. Map the custom domain in Google Sites settings

### Option D: Flutter Web app

Build and host the Flutter app (`bba-quiz/mobile`) — it embeds the same Apps Script URL in an iframe. See [FLUTTER.md](FLUTTER.md).

---

## Step 7: Test the Deployment

1. Open your deployed URL (or `quiz.bbadublin.com`)
2. **Register** a test account
3. Verify today's quiz loads (sample data from `setupSheets`)
4. Submit answers and confirm they lock
5. Check the **Scoreboard** and **Profile** tabs
6. Test **OTP login**: request a code and verify the email arrives

---

## Step 8: Add Real Quiz Content

### Daily Schedule

In the **DailySchedule** sheet, add one row per day:

| date | book | chapter | quiz_id |
|------|------|---------|---------|
| 2026-07-07 | John | Chapter 3 | quiz-001 |
| 2026-07-08 | Psalm | 23 | quiz-002 |

Dates must be `YYYY-MM-DD`. The app uses **Europe/Dublin** timezone for the daily reset.

### Questions

In the **Questions** sheet:

| quiz_id | question_num | question | book_reference | option_a | option_b | option_c | option_d | correct_answer |
|---------|--------------|----------|----------------|----------|----------|----------|----------|----------------|
| quiz-001 | 1 | Who came to Jesus at night? | Chapter 3 | Nicodemus | Peter | Judas | Thomas | option_a |

- `book_reference` is the chapter shown in the app (e.g. `Chapter 3`, `23`)
- `correct_answer` is `option_a`–`option_d` or `A`–`D`
- **Minimum 5 questions per day** — longer chapters can have more (6, 8, 10, etc.)
- Points: 10 per correct answer

### Validate before going live

In the spreadsheet, use **BBA Quiz → Validate upcoming quizzes** to see which scheduled days are ready and which need more questions.

---

## Ongoing Maintenance

### Adding next week's quizzes

Add rows to `DailySchedule` and corresponding questions in `Questions`. Plan at least 2 weeks ahead.

### Monitoring submissions

View the **Submissions** sheet to see who completed each day's quiz. The `locked` column is always `TRUE` after submit.

### User management

The **Users** sheet stores accounts. To disable a user, delete their row (they will need to re-register).

### Redeploying after code changes

1. Edit scripts in Apps Script
2. **Deploy → Manage deployments → Edit (pencil) → New version → Deploy**
3. The URL stays the same; no DNS changes needed

---

## Troubleshooting

### Setup / `setupSheets` errors

| Error message | Solution |
|---------------|----------|
| **`CONFIG is not defined`** | Add `Config.gs` — copy from `gas/Config.gs` and save |
| **`getSpreadsheet_ is not defined`** | Add `Config.gs` (contains helper functions) |
| **`No spreadsheet linked to this script`** | Do **not** create script at script.google.com. Open your **Google Sheet** → **Extensions → Apps Script** |
| **`Cannot call SpreadsheetApp.getUi()`** / **`Ui` object not available** | Setup may still have worked. Check sheet tabs. Better: run from **BBA Quiz → Run initial setup** in the sheet menu |
| **`Authorization required`** | Click **Review permissions** → choose Google account → **Allow** |
| **`ReferenceError: X is not defined`** | Missing a `.gs` file — you need all 7 script files (see Step 2) |
| **Execution shows green check but no tabs** | Wrong spreadsheet — script must be opened from **Extensions → Apps Script** on your quiz sheet |
| **Red error in editor** | Click the error, fix the file, press Ctrl+S, run again |

After a successful run you should see tabs: `Users`, `OTP`, `DailySchedule`, `Questions`, `Submissions`, `Settings`.

### Runtime errors

| Issue | Solution |
|-------|----------|
| OTP emails not sending | Re-authorize script; check Gmail sending limits (100/day for free accounts) |
| "No quiz scheduled for today" | Add a row in DailySchedule with today's date |
| "needs at least 5 questions" | Add more rows in Questions for that quiz_id |
| Session expired | User must log in again (sessions last 72 hours) |
| Answers can be resubmitted | Check Submissions sheet — `locked` must be TRUE |
| Wrong timezone / quiz not resetting | Verify `TIMEZONE: 'Europe/Dublin'` in Config.gs |

---

## Security Notes

- Passwords are SHA-256 hashed with a salt (not stored in plain text)
- OTP codes expire after 10 minutes
- Sessions expire after 72 hours
- Submissions are locked immediately on submit
- Keep the spreadsheet private; only the web app URL is public
