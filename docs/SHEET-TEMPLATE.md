# Google Sheet Template Reference

Column definitions for each tab in the BBA Dublin Bible Quiz spreadsheet.

---

## Users

Stores registered accounts and cumulative statistics.

| Column | Header | Type | Description |
|--------|--------|------|-------------|
| A | email | Text | User's email (unique, lowercase) |
| B | password_hash | Text | SHA-256 hash (never edit manually) |
| C | display_name | Text | Name shown on leaderboard |
| D | created_at | DateTime | Registration timestamp |
| E | session_token | Text | Current login token |
| F | session_expires | DateTime | When session expires |
| G | total_score | Number | Lifetime points earned |
| H | total_quizzes | Number | Total quizzes completed |
| I | perfect_scores | Number | Quizzes with 100% |
| J | current_streak | Number | Consecutive days with submissions |

**Do not delete the header row.** Stats columns (G–J) are updated automatically.

---

## OTP

Temporary one-time login codes. Rows are deleted after use or expiry.

| Column | Header | Type | Description |
|--------|--------|------|-------------|
| A | email | Text | User requesting OTP |
| B | otp | Text | 6-digit code |
| C | expires_at | DateTime | Expiry (10 minutes after creation) |

Managed entirely by the script. No manual editing needed.

---

## DailySchedule

Maps each calendar date to a Bible chapter quiz.

| Column | Header | Type | Description |
|--------|--------|------|-------------|
| A | date | Date | Quiz date (`YYYY-MM-DD`) |
| B | book | Text | Bible book name (e.g. "John", "Psalm") |
| C | chapter | Text | Chapter reference (e.g. "Chapter 3", "23") |
| D | quiz_id | Text | Links to Questions sheet (e.g. "quiz-001") |

**Example rows:**

```
2026-07-07 | John    | Chapter 3  | quiz-001
2026-07-08 | Psalm   | 23         | quiz-002
2026-07-09 | Romans  | Chapter 8  | quiz-003
2026-07-10 | Genesis | Chapter 1  | quiz-004
```

The app looks up today's date (Europe/Dublin) and serves the matching quiz.

---

## Questions

Quiz questions linked by `quiz_id`. **Each chapter can have a different number of questions** — add as many rows as the chapter needs, with a **minimum of 5 per day**.

| Column | Header | Type | Description |
|--------|--------|------|-------------|
| A | quiz_id | Text | Must match DailySchedule.quiz_id |
| B | question_num | Number | Order (1, 2, 3...) — number sequentially |
| C | question | Text | Question text |
| D | book_reference | Text | Chapter reference (shown as **chapter** in the app) |
| E | option_a | Text | Answer choice A |
| F | option_b | Text | Answer choice B |
| G | option_c | Text | Answer choice C |
| H | option_d | Text | Answer choice D |
| I | correct_answer | Text | `option_a`, `option_b`, `option_c`, `option_d` (or `A`–`D`) |

**Examples by chapter length:**

| Chapter | quiz_id | Questions |
|---------|---------|-----------|
| Psalm 23 (short) | quiz-002 | 5 |
| John 3 (medium) | quiz-001 | 7 |
| Romans 8 (longer) | quiz-003 | 8 |

**Tips:**
- Longer or richer chapters can have more questions (6, 8, 10, etc.)
- Shorter chapters still need **at least 5** questions
- Use **BBA Quiz → Validate upcoming quizzes** in the spreadsheet menu to check before each week
- Reuse `quiz_id` values if you repeat the same chapter next year

---

## Submissions

One row per user per day. Created automatically on submit.

| Column | Header | Type | Description |
|--------|--------|------|-------------|
| A | email | Text | Submitter's email |
| B | quiz_date | Date | Date of the quiz |
| C | answers_json | Text | JSON map: `{"1":"A","2":"B",...}` |
| D | score | Number | Points earned (10 per correct) |
| E | total_questions | Number | Number of questions in quiz |
| F | submitted_at | DateTime | Submission timestamp |
| G | locked | Boolean | Always `TRUE` — prevents edits |

**Immutable:** Once a row exists for email + date, the user cannot submit again.

---

## Settings

Optional key-value configuration (for future use).

| Column | Header | Type | Description |
|--------|--------|------|-------------|
| A | key | Text | Setting name |
| B | value | Text | Setting value |

Example future settings: `quiz_reset_hour`, `points_per_question`, `maintenance_mode`.

---

## Sample Data (from setupSheets)

After running `setupSheets()`, you get:

- **DailySchedule:** Today + 2 future days with John 3, Psalm 23, Romans 8
- **Questions:** 7 questions for quiz-001, 5 for quiz-002, 8 for quiz-003
- Empty Users, OTP, Submissions tabs ready for production

Delete sample schedule rows and add your real content before going live.
