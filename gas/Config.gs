/**
 * BBA Dublin Bible Quiz - Configuration
 * Copy all .gs files into a Google Apps Script project bound to your quiz spreadsheet.
 */

var CONFIG = {
  // Sheet names
  SHEETS: {
    USERS: 'Users',
    OTP: 'OTP',
    SCHEDULE: 'DailySchedule',
    QUESTIONS: 'Questions',
    QUESTIONS_MALAYALAM: 'QuestionsMalayalam',
    SUBMISSIONS: 'Submissions',
    SESSIONS: 'Sessions',
    BADGES: 'Badges',
    SETTINGS: 'Settings'
  },

  // Dublin timezone for daily quiz reset (midnight local time)
  TIMEZONE: 'Europe/Dublin',

  // OTP validity in minutes
  OTP_EXPIRY_MINUTES: 10,

  // Session token validity in hours (30 days)
  SESSION_HOURS: 720,

  // Longer session when user chooses "Remember me on this device" (1 year)
  SESSION_REMEMBER_HOURS: 8760,

  // Extend session expiry on each authenticated API call
  SESSION_EXTEND_ON_USE: true,

  // Max active sessions per user (web + mobile can coexist)
  MAX_SESSIONS_PER_USER: 10,

  // Each daily quiz must have at least this many questions (chapters may have more)
  MIN_QUESTIONS_PER_QUIZ: 5,

  // First date when rebuilding DailySchedule from the Questions sheet
  SCHEDULE_START_DATE: '2026-07-08',

  // Bump on each release — keep in sync with mobile/lib/config/app_config.dart appVersion
  APP_VERSION: '2026-07-16.5',

  // Quiz question languages (sheet per language, same quiz_id across sheets)
  DEFAULT_LANGUAGE: 'en',
  LANGUAGES: {
    en: { label: 'English', sheet: 'Questions' },
    ml: { label: 'Malayalam', sheet: 'QuestionsMalayalam' }
  },

  // Password salt prefix (change this to a random string in production)
  SALT: 'bba-quiz-2026',

  // Quiz email: send from deployer (bba@), replies go to quizmaster@
  QUIZ_FROM_EMAIL: 'bba@bbadublin.com',
  QUIZ_REPLY_EMAIL: 'quizmaster@bbadublin.com',
  QUIZ_EMAIL_NAME: 'BBA Dublin Bible Quiz',

  // Hybrid Firestore sync (Spark: Apps Script direct; Blaze: optional Cloud Function URL)
  FIREBASE_PROJECT_ID: 'bbadublin-quiz',
  // user = your Google account OAuth (use when org blocks service account keys)
  // service_account = FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY in Script properties
  FIRESTORE_AUTH_MODE: 'user',
  FIRESTORE_SYNC_URL: '',
  SYNC_SECRET: '',

  // Quiz content: firestore (primary), sheet (standby), auto (firestore when configured)
  QUIZ_DATA_SOURCE: 'firestore',

  // Scoring
  POINTS_PER_CORRECT: 1,

  // Testing: allow picking quiz date in UI. Override via Settings → test_date_picker | true/false
  TEST_DATE_PICKER: false,

  // Badge definitions (earned automatically based on stats)
  BADGE_RULES: [
    { id: 'first_quiz', name: 'First Steps', icon: '🌱', description: 'Complete your first quiz', check: function(s) { return s.totalQuizzes >= 1; } },
    { id: 'quizzes_5', name: 'Five Loaves', icon: '🥖', description: 'Complete 5 quizzes', check: function(s) { return s.totalQuizzes >= 5; } },
    { id: 'quizzes_10', name: 'Daily Bread', icon: '🍞', description: 'Complete 10 quizzes', check: function(s) { return s.totalQuizzes >= 10; } },
    { id: 'quizzes_25', name: 'Good Soil', icon: '🌿', description: 'Complete 25 quizzes', check: function(s) { return s.totalQuizzes >= 25; } },
    { id: 'quizzes_50', name: 'Dedicated Disciple', icon: '✝️', description: 'Complete 50 quizzes', check: function(s) { return s.totalQuizzes >= 50; } },
    { id: 'quizzes_100', name: 'Elder in the Word', icon: '📕', description: 'Complete 100 quizzes', check: function(s) { return s.totalQuizzes >= 100; } },
    { id: 'streak_3', name: 'On a Roll', icon: '⚡', description: '3-day quiz streak', check: function(s) { return s.streak >= 3; } },
    { id: 'streak_7', name: 'Week Warrior', icon: '🔥', description: '7-day quiz streak', check: function(s) { return s.streak >= 7; } },
    { id: 'streak_14', name: 'Fortnight Faithful', icon: '🗓️', description: '14-day quiz streak', check: function(s) { return s.streak >= 14; } },
    { id: 'streak_30', name: 'Faithful Scholar', icon: '📖', description: '30-day quiz streak', check: function(s) { return s.streak >= 30; } },
    { id: 'streak_60', name: 'Steadfast Servant', icon: '💎', description: '60-day quiz streak', check: function(s) { return s.streak >= 60; } },
    { id: 'perfect', name: 'Perfect Score', icon: '⭐', description: 'Score 100% on a quiz', check: function(s) { return s.perfectScores >= 1; } },
    { id: 'perfect_3', name: 'Hat Trick', icon: '🎯', description: '3 perfect scores', check: function(s) { return s.perfectScores >= 3; } },
    { id: 'perfect_5', name: 'Scripture Master', icon: '👑', description: '5 perfect scores', check: function(s) { return s.perfectScores >= 5; } },
    { id: 'perfect_10', name: 'Flawless Ten', icon: '💫', description: '10 perfect scores', check: function(s) { return s.perfectScores >= 10; } },
    { id: 'score_10', name: 'Point Pioneer', icon: '🌾', description: 'Earn 10 total points', check: function(s) { return s.totalScore >= 10; } },
    { id: 'score_50', name: 'Rising Star', icon: '🌟', description: 'Earn 50 total points', check: function(s) { return s.totalScore >= 50; } },
    { id: 'score_100', name: 'Hundredfold', icon: '📈', description: 'Earn 100 total points', check: function(s) { return s.totalScore >= 100; } },
    { id: 'score_200', name: 'Bible Champion', icon: '🏆', description: 'Earn 200 total points', check: function(s) { return s.totalScore >= 200; } },
    { id: 'score_500', name: 'Pillar of Truth', icon: '🛡️', description: 'Earn 500 total points', check: function(s) { return s.totalScore >= 500; } },
    { id: 'rank_10', name: 'Top Ten', icon: '🥇', description: 'Reach top 10 on the scoreboard', check: function(s) { return s.rank > 0 && s.rank <= 10; } },
    { id: 'rank_3', name: 'Podium Finish', icon: '🏅', description: 'Reach top 3 on the scoreboard', check: function(s) { return s.rank > 0 && s.rank <= 3; } },
    { id: 'rank_1', name: 'Quiz Champion', icon: '👑', description: 'Reach #1 on the scoreboard', check: function(s) { return s.rank === 1; } }
  ]
};

function getSpreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error(
      'No spreadsheet linked to this script. ' +
      'Open your Google Sheet → Extensions → Apps Script (do not use script.google.com standalone). ' +
      'The script must be bound to the BBA Dublin Bible Quiz spreadsheet.'
    );
  }
  return ss;
}

function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) {
    throw new Error('Sheet not found: ' + name + '. Run setupSheets() first.');
  }
  return sheet;
}

var SHEET_CACHE_TTL_SEC = 90;
var SUBMISSION_SNAPSHOT_CACHE_SEC = 45;
var SUBMISSION_LOOKUP_CACHE_SEC = 60;
var SCHEDULE_CACHE_TTL_SEC = 300;
var SESSION_USER_CACHE_SEC = 300;
var QUIZ_SOURCE_CACHE_SEC = 600;
var SHEET_ANSWERS_CACHE_SEC = 300;

/** Cached sheet read — avoids repeated getDataRange() calls within a request or across warm instances. */
function getSheetData_(name) {
  var cache = CacheService.getScriptCache();
  var key = 'sh:' + name;
  var cached = cache.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  var data = getSheet_(name).getDataRange().getValues();
  try {
    var json = JSON.stringify(data);
    if (json.length < 95000) {
      cache.put(key, json, SHEET_CACHE_TTL_SEC);
    }
  } catch (e) {
    // Skip cache if sheet is too large or not serializable
  }
  return data;
}

function invalidateSheetCache_(name) {
  var cache = CacheService.getScriptCache();
  cache.remove('sh:' + name);
  if (name === CONFIG.SHEETS.SUBMISSIONS) {
    cache.remove('subsnap:v1');
  }
}

/** Show alert in Sheet UI, or log to Execution log when run from editor. */
function showMessage_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message);
    Logger.log('(Popup not available from editor — setup may still have succeeded. Check your sheet tabs.)');
  }
}

function todayDate_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

/** Date object for writing quiz_date cells (avoids locale string mismatches). */
function todaySheetDate_() {
  var parts = todayDate_().split('-');
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
}

/** Normalize sheet date cells to yyyy-MM-dd for reliable comparisons. */
function normalizeSheetDate_(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (value instanceof Date) {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  if (typeof value === 'number' && isFinite(value) && value > 0) {
    // Google Sheets serial date (days since 1899-12-30)
    var base = new Date(1899, 11, 30);
    var serialDate = new Date(base.getTime() + Math.round(value * 86400 * 1000));
    return Utilities.formatDate(serialDate, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  var str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }

  var dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    var day = Number(dmy[1]);
    var month = Number(dmy[2]);
    var year = Number(dmy[3]);
    if (day > 12) {
      return Utilities.formatDate(new Date(year, month - 1, day), CONFIG.TIMEZONE, 'yyyy-MM-dd');
    }
    if (month > 12) {
      return Utilities.formatDate(new Date(year, day - 1, month), CONFIG.TIMEZONE, 'yyyy-MM-dd');
    }
    return Utilities.formatDate(new Date(year, month - 1, day), CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }

  try {
    var parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
      return Utilities.formatDate(parsed, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    }
  } catch (e) {}

  return str.substring(0, 10);
}

function isSheetTruthy_(value) {
  return value === true || value === 1 || value === '1' ||
    String(value).toUpperCase() === 'TRUE';
}

/** When true, clients may pass quizDate to load/submit quizzes for other days (testing only). */
function isTestDatePickerEnabled_() {
  var fromSettings = String(getSetting_('test_date_picker') || '').toLowerCase();
  if (fromSettings === 'true' || fromSettings === '1' || fromSettings === 'yes') {
    return true;
  }
  if (fromSettings === 'false' || fromSettings === '0' || fromSettings === 'no') {
    return false;
  }
  return CONFIG.TEST_DATE_PICKER === true;
}

function resolveQuizDate_(requestedDate) {
  var today = todayDate_();
  if (!isTestDatePickerEnabled_()) {
    return today;
  }
  var normalized = normalizeSheetDate_(requestedDate);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return today;
  }
  return normalized;
}

function sheetDateFromYmd_(ymd) {
  var parts = String(ymd || '').substring(0, 10).split('-');
  if (parts.length !== 3) {
    return todaySheetDate_();
  }
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
}

function getAppPublicConfig_() {
  return {
    version: CONFIG.APP_VERSION,
    testDatePicker: isTestDatePickerEnabled_()
  };
}

function jsonResponse_(data, status) {
  status = status || 200;
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function errorResponse_(message, status) {
  return jsonResponse_({ success: false, error: message }, status || 400);
}

function successResponse_(data) {
  var result = { success: true };
  for (var key in data) {
    if (data.hasOwnProperty(key)) {
      result[key] = data[key];
    }
  }
  return jsonResponse_(result);
}
