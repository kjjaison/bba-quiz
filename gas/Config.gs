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

  // Bump this on each release to force clients to refresh cached app/session data
  APP_VERSION: '2026-07-08.4',

  // Password salt prefix (change this to a random string in production)
  SALT: 'bba-quiz-2026',

  // Badge definitions (earned automatically based on stats)
  BADGE_RULES: [
    { id: 'first_quiz', name: 'First Steps', icon: '🌱', description: 'Complete your first quiz', check: function(s) { return s.totalQuizzes >= 1; } },
    { id: 'streak_7', name: 'Week Warrior', icon: '🔥', description: '7-day quiz streak', check: function(s) { return s.streak >= 7; } },
    { id: 'streak_30', name: 'Faithful Scholar', icon: '📖', description: '30-day quiz streak', check: function(s) { return s.streak >= 30; } },
    { id: 'perfect', name: 'Perfect Score', icon: '⭐', description: 'Score 100% on a quiz', check: function(s) { return s.perfectScores >= 1; } },
    { id: 'perfect_5', name: 'Scripture Master', icon: '👑', description: '5 perfect scores', check: function(s) { return s.perfectScores >= 5; } },
    { id: 'score_500', name: 'Rising Star', icon: '🌟', description: 'Earn 500 total points', check: function(s) { return s.totalScore >= 500; } },
    { id: 'score_2000', name: 'Bible Champion', icon: '🏆', description: 'Earn 2000 total points', check: function(s) { return s.totalScore >= 2000; } },
    { id: 'quizzes_50', name: 'Dedicated Disciple', icon: '✝️', description: 'Complete 50 quizzes', check: function(s) { return s.totalQuizzes >= 50; } }
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
