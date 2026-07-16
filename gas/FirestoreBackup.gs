/**
 * Firestore → Google Sheet standby backup.
 *
 * Runs every 15 minutes (install via menu). Mirrors runtime collections into the Sheet.
 * Does NOT touch Questions / QuestionsMalayalam / answer keys (those stay Sheet → Firestore, manual).
 */

var FIRESTORE_BACKUP_HANDLER = 'backupFirestoreToSheetScheduled_';

function installFirestoreBackupTrigger() {
  if (!hasDirectFirestoreCredentials_()) {
    showMessage_('Configure Firebase first (Authorize Firebase access). See docs/FIRESTORE-SPARK.md');
    return;
  }

  uninstallTriggersByHandler_(FIRESTORE_BACKUP_HANDLER);
  uninstallTriggersByHandler_('syncQuizToFirestoreScheduled_');

  ScriptApp.newTrigger(FIRESTORE_BACKUP_HANDLER)
    .timeBased()
    .everyMinutes(15)
    .create();

  showMessage_(
    'Installed 15-minute Firestore → Sheet backup.\n\n' +
    'Backs up: Users, Submissions, Sessions.\n' +
    'Questions / answers / schedule: Sheet → Firestore, manual only.\n\n' +
    'Old Sheet → Firestore auto-sync triggers were removed.'
  );
}

function uninstallFirestoreBackupTrigger() {
  var removed = uninstallTriggersByHandler_(FIRESTORE_BACKUP_HANDLER);
  removed += uninstallTriggersByHandler_('syncQuizToFirestoreScheduled_');
  showMessage_(
    removed
      ? 'Removed ' + removed + ' auto-sync / backup trigger(s).'
      : 'No Firestore auto-sync or backup triggers found.'
  );
}

function uninstallTriggersByHandler_(handlerName) {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  return removed;
}

function backupFirestoreToSheetScheduled_() {
  try {
    backupFirestoreToSheet_();
  } catch (err) {
    Logger.log('Firestore → Sheet backup failed: ' + (err.message || err));
  }
}

function backupFirestoreToSheetWithMessage() {
  try {
    var result = backupFirestoreToSheet_();
    showMessage_(
      'Firestore → Sheet backup complete.\n\n' +
      'Users: ' + result.users + '\n' +
      'Submissions: ' + result.submissions + '\n' +
      'Sessions: ' + result.sessions
    );
  } catch (err) {
    showMessage_('Backup failed:\n\n' + (err.message || err));
  }
}

function backupFirestoreToSheet_() {
  getFirebaseProjectId_();
  getFirestoreAccessToken_();

  return {
    users: backupFirestoreUsersToSheet_(),
    submissions: backupFirestoreSubmissionsToSheet_(),
    sessions: backupFirestoreSessionsToSheet_()
  };
}

function replaceSheetDataKeepingHeader_(sheetName, headers, rows) {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), headers.length);
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  invalidateSheetCache_(sheetName);
  return rows.length;
}

function backupFirestoreUsersToSheet_() {
  var docs = listFirestoreCollection_('users');
  var rows = [];
  for (var i = 0; i < docs.length; i++) {
    var u = decodeFirestoreDocument_(docs[i]);
    if (!u.email) continue;
    rows.push([
      u.email,
      u.passwordHash || '',
      u.displayName || '',
      '',
      '',
      '',
      Number(u.totalScore) || 0,
      Number(u.totalQuizzes) || 0,
      Number(u.perfectScores) || 0,
      Number(u.streak) || 0,
      u.mustChangePassword === true ? true : false
    ]);
  }
  rows.sort(function(a, b) {
    return String(a[0]).localeCompare(String(b[0]));
  });

  return replaceSheetDataKeepingHeader_(CONFIG.SHEETS.USERS, [
    'email', 'password_hash', 'display_name', 'created_at',
    'session_token', 'session_expires', 'total_score',
    'total_quizzes', 'perfect_scores', 'current_streak', 'must_change_password'
  ], rows);
}

function backupFirestoreSubmissionsToSheet_() {
  var docs = listFirestoreCollection_('submissions');
  var rows = [];
  for (var i = 0; i < docs.length; i++) {
    var s = decodeFirestoreDocument_(docs[i]);
    if (!s.email || !s.quizDate) continue;
    var submittedAt = s.submittedAt ? new Date(s.submittedAt) : '';
    rows.push([
      s.email,
      sheetDateFromYmd_(s.quizDate),
      s.answersJson || '{}',
      Number(s.score) || 0,
      Number(s.totalQuestions) || 0,
      submittedAt,
      s.locked !== false
    ]);
  }
  rows.sort(function(a, b) {
    var ae = String(a[0]);
    var be = String(b[0]);
    if (ae !== be) return ae.localeCompare(be);
    return String(a[1]).localeCompare(String(b[1]));
  });

  var count = replaceSheetDataKeepingHeader_(CONFIG.SHEETS.SUBMISSIONS, [
    'email', 'quiz_date', 'answers_json', 'score', 'total_questions',
    'submitted_at', 'locked'
  ], rows);
  invalidateSubmissionsSnapshot_();
  return count;
}

function backupFirestoreSessionsToSheet_() {
  var docs = listFirestoreCollection_('sessions');
  var rows = [];
  var now = new Date();
  for (var i = 0; i < docs.length; i++) {
    var s = decodeFirestoreDocument_(docs[i]);
    if (!s.sessionToken || !s.email) continue;
    var expires = s.expiresAt ? new Date(s.expiresAt) : null;
    if (expires && expires < now) continue;
    rows.push([
      s.email,
      s.sessionToken,
      expires || '',
      s.createdAt ? new Date(s.createdAt) : '',
      s.rememberMe === true
    ]);
  }

  return replaceSheetDataKeepingHeader_(CONFIG.SHEETS.SESSIONS, [
    'email', 'session_token', 'expires_at', 'created_at', 'remember_me'
  ], rows);
}
