/**
 * Daily welcome + scoreboard emails (MailApp).
 *
 * Settings:
 *   email_broadcast_mode   test | all   (default test — one recipient only)
 *   email_test_recipient   kjjaison@gmail.com
 *   quiz_public_url        https://bbadublin-quiz.web.app/
 *   daily_welcome_hour     6   (Europe/Dublin)
 *   daily_scoreboard_hour  23
 *   weekly_scoreboard_hour 23  (Saturday)
 *   monthly_scoreboard_hour 23 (last day of month; daily trigger checks date)
 */

var QUIZ_EMAIL_HANDLERS = [
  'sendDailyWelcomeEmailScheduled_',
  'sendDailyScoreboardEmailScheduled_',
  'sendWeeklyScoreboardEmailScheduled_',
  'sendMonthlyScoreboardEmailScheduled_',
  'sendCustomQuizResultsEmailScheduled_'
];

function getEmailBroadcastMode_() {
  var mode = String(getSetting_('email_broadcast_mode') || 'test').toLowerCase();
  return mode === 'all' ? 'all' : 'test';
}

function getEmailTestRecipient_() {
  return String(getSetting_('email_test_recipient') || 'kjjaison@gmail.com').trim().toLowerCase();
}

function getQuizPublicUrl_() {
  var fromSettings = String(getSetting_('quiz_public_url') || '').trim();
  if (fromSettings) return fromSettings;
  try {
    var url = ScriptApp.getService().getUrl();
    if (url) return url;
  } catch (e) {}
  return 'https://bbadublin-quiz.web.app/';
}

function getEmailHourSetting_(key, fallback) {
  var raw = getSetting_(key);
  if (raw === '' || raw == null) return fallback;
  var hour = parseInt(raw, 10);
  if (isNaN(hour) || hour < 0 || hour > 23) return fallback;
  return hour;
}

/** True when today is the last calendar day of the month in the given timezone. */
function isLastDayOfMonthInTimezone_(timezone) {
  var now = new Date();
  var year = parseInt(Utilities.formatDate(now, timezone, 'yyyy'), 10);
  var month = parseInt(Utilities.formatDate(now, timezone, 'MM'), 10);
  var day = parseInt(Utilities.formatDate(now, timezone, 'dd'), 10);
  var lastDay = new Date(year, month, 0).getDate();
  return day === lastDay;
}

function listEmailBroadcastRecipients_() {
  if (getEmailBroadcastMode_() === 'test') {
    return [getEmailTestRecipient_()];
  }

  var emails = [];
  var seen = {};

  if (useFirestoreForRuntime_()) {
    try {
      var docs = listFirestoreCollection_('users');
      for (var i = 0; i < docs.length; i++) {
        var u = decodeFirestoreDocument_(docs[i]);
        var email = String(u.email || '').toLowerCase().trim();
        if (email && !seen[email]) {
          seen[email] = true;
          emails.push(email);
        }
      }
    } catch (err) {
      Logger.log('Firestore user list for email failed: ' + (err.message || err));
    }
  }

  if (!emails.length) {
    var users = getSheetData_(CONFIG.SHEETS.USERS);
    for (var j = 1; j < users.length; j++) {
      var sheetEmail = String(users[j][0] || '').toLowerCase().trim();
      if (sheetEmail && !seen[sheetEmail]) {
        seen[sheetEmail] = true;
        emails.push(sheetEmail);
      }
    }
  }

  emails.sort();
  return emails;
}

function formatEmailDate_(dateStr) {
  dateStr = normalizeSheetDate_(dateStr || todayDate_());
  try {
    var parts = dateStr.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
    return Utilities.formatDate(d, CONFIG.TIMEZONE, 'EEEE d MMMM yyyy');
  } catch (e) {
    return dateStr;
  }
}

function formatScheduleLabel_(schedule) {
  if (!schedule) return 'Today\'s chapter';
  if (schedule.title) return schedule.title;
  if (schedule.book && schedule.chapter) {
    return schedule.book + ' ' + schedule.chapter;
  }
  if (schedule.book) return schedule.book;
  if (schedule.chapter) return schedule.chapter;
  if (schedule.quizId) return schedule.quizId;
  return 'Today\'s chapter';
}

function buildQuizEmailShell_(title, bodyHtml) {
  var quizUrl = getQuizPublicUrl_();
  return '<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#1a1a1a;line-height:1.5;">' +
    '<div style="background:#1e3a5f;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">' +
    '<h1 style="margin:0;font-size:22px;font-weight:normal;">BBA Dublin Bible Quiz</h1>' +
    '<p style="margin:8px 0 0;opacity:0.9;font-size:14px;">' + escapeHtml_(title) + '</p>' +
    '</div>' +
    '<div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;">' +
    bodyHtml +
    '<p style="margin:24px 0 0;text-align:center;">' +
    '<a href="' + escapeHtml_(quizUrl) + '" style="display:inline-block;background:#1e3a5f;color:#fff;' +
    'text-decoration:none;padding:12px 24px;border-radius:6px;font-size:16px;">Open today\'s quiz</a>' +
    '</p>' +
    '</div>' +
    '<p style="text-align:center;font-size:12px;color:#6b7280;margin:16px 0;">' +
    'Questions? Reply to this email or contact ' + escapeHtml_(getQuizReplyEmail_()) +
    '</p></div>';
}

function buildScoreboardTableHtml_(leaderboard, highlightName) {
  if (!leaderboard || !leaderboard.length) {
    return '<p style="color:#6b7280;">No scores yet — be the first to complete the quiz!</p>';
  }

  var rows = '';
  for (var i = 0; i < leaderboard.length; i++) {
    var entry = leaderboard[i];
    var isHighlight = highlightName && entry.displayName === highlightName;
    var bg = isHighlight ? 'background:#fef3c7;' : (i % 2 === 0 ? 'background:#f9fafb;' : '');
    rows += '<tr style="' + bg + '">' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;width:48px;">#' + entry.rank + '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">' + escapeHtml_(entry.displayName) + '</td>' +
      '<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:bold;">' +
      entry.score + '</td>' +
      '</tr>';
  }

  return '<table style="width:100%;border-collapse:collapse;font-size:15px;">' +
    '<thead><tr style="background:#f3f4f6;">' +
    '<th style="padding:10px 12px;text-align:left;">Rank</th>' +
    '<th style="padding:10px 12px;text-align:left;">Name</th>' +
    '<th style="padding:10px 12px;text-align:right;">Points</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function escapeHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getDisplayNameForEmail_(email) {
  email = String(email || '').toLowerCase().trim();
  var user = getFirestoreUserByEmail_(email);
  if (user && user.displayName) return user.displayName;

  var users = getSheetData_(CONFIG.SHEETS.USERS);
  for (var i = 1; i < users.length; i++) {
    if (String(users[i][0] || '').toLowerCase() === email) {
      return String(users[i][2] || email);
    }
  }
  return email;
}

function buildDailyWelcomeEmail_(dateStr) {
  dateStr = normalizeSheetDate_(dateStr || todayDate_());
  var schedule = getScheduleForDate_(dateStr);
  var chapterLabel = formatScheduleLabel_(schedule);
  var formattedDate = formatEmailDate_(dateStr);

  var body =
    '<p style="font-size:17px;margin:0 0 16px;">Good morning! 🌅</p>' +
    '<p>Welcome to today\'s Bible quiz.</p>' +
    '<div style="background:#f0f9ff;border-left:4px solid #1e3a5f;padding:16px;margin:20px 0;">' +
    '<p style="margin:0 0 4px;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Today — ' +
    escapeHtml_(formattedDate) + '</p>' +
    '<p style="margin:0;font-size:20px;font-weight:bold;color:#1e3a5f;">' + escapeHtml_(chapterLabel) + '</p>' +
    '</div>' +
    '<p>Read the chapter, then take the quiz when you\'re ready. You can submit once per day.</p>' +
    '<p style="margin-top:20px;color:#6b7280;font-size:14px;">May God bless your time in His Word today.</p>';

  return {
    subject: 'Today\'s quiz — ' + chapterLabel + ' (' + formattedDate + ')',
    htmlBody: buildQuizEmailShell_('Daily welcome', body)
  };
}

function buildScoreboardEmail_(period, dateStr) {
  dateStr = normalizeSheetDate_(dateStr || todayDate_());
  var leaderboard;
  var title;
  var subject;

  if (period === 'daily') {
    leaderboard = getLeaderboardForDate_(dateStr);
    var schedule = getScheduleForDate_(dateStr);
    var chapterLabel = formatScheduleLabel_(schedule);
    title = 'Daily scoreboard — ' + formatEmailDate_(dateStr);
    subject = 'Daily scoreboard — ' + chapterLabel + ' (' + formatEmailDate_(dateStr) + ')';
  } else if (period === 'weekly') {
    leaderboard = getLeaderboard_('weekly');
    title = 'Weekly scoreboard';
    subject = 'Weekly scoreboard — last 7 days';
  } else if (period === 'monthly') {
    leaderboard = getLeaderboard_('monthly');
    var monthLabel = getLeaderboardPeriodLabel_('monthly');
    title = 'Monthly scoreboard — ' + monthLabel;
    subject = 'Monthly scoreboard — ' + monthLabel;
  } else {
    throw new Error('Unknown scoreboard period: ' + period);
  }

  var body =
    '<p>Here are the top scores' +
    (period === 'daily' ? ' for today\'s quiz' : '') + ':</p>' +
    buildScoreboardTableHtml_(leaderboard);

  return {
    subject: subject,
    htmlBody: buildQuizEmailShell_(title, body),
    leaderboard: leaderboard
  };
}

function buildPersonalizedScoreboardEmail_(period, recipientEmail, dateStr) {
  var base = buildScoreboardEmail_(period, dateStr);
  var displayName = getDisplayNameForEmail_(recipientEmail);
  var personalRank = null;

  for (var i = 0; i < (base.leaderboard || []).length; i++) {
    if (base.leaderboard[i].displayName === displayName) {
      personalRank = base.leaderboard[i];
      break;
    }
  }

  var title;
  if (period === 'daily') {
    title = 'Daily scoreboard — ' + formatEmailDate_(dateStr || todayDate_());
  } else if (period === 'weekly') {
    title = 'Weekly scoreboard';
  } else {
    title = 'Monthly scoreboard — ' + getLeaderboardPeriodLabel_('monthly');
  }

  var personal = '';
  if (personalRank) {
    personal = '<p style="background:#ecfdf5;border-radius:6px;padding:12px 16px;">' +
      'Your rank: <strong>#' + personalRank.rank + '</strong> with <strong>' + personalRank.score +
      '</strong> point' + (personalRank.score === 1 ? '' : 's') + '.</p>';
  }

  var body =
    '<p style="font-size:17px;">Hi ' + escapeHtml_(displayName) + ',</p>' +
    personal +
    '<p>Here are the top scores' +
    (period === 'daily' ? ' for today\'s quiz' : '') + ':</p>' +
    buildScoreboardTableHtml_(base.leaderboard, displayName);

  return {
    subject: base.subject,
    htmlBody: buildQuizEmailShell_(title, body)
  };
}

function sendEmailBroadcast_(buildEmailFn, options) {
  options = options || {};
  var recipients = options.recipients;
  if (!recipients || !recipients.length) {
    recipients = listEmailBroadcastRecipients_();
  }
  if (!recipients.length) {
    throw new Error(
      options.emptyMessage ||
      'No email recipients found. Set email_test_recipient in Settings.'
    );
  }

  var quotaBefore = -1;
  try {
    quotaBefore = MailApp.getRemainingDailyQuota();
  } catch (e) {}

  if (quotaBefore === 0) {
    throw new Error(
      'MailApp daily quota is 0. Wait until tomorrow or send from a Google Workspace account with higher quota.'
    );
  }

  var sent = 0;
  var errors = [];
  var personalize = options.personalize === true;
  // Visible To = account that owns the script (reliable). Recipients always go in BCC.
  var visibleTo = getScriptRunnerEmail_() || getQuizReplyEmail_() || getQuizFromEmail_();
  if (!visibleTo) {
    throw new Error(
      'Could not detect the script email account.\n' +
      'Open the Google Sheet while signed in as the account that should send quiz emails, then try again.'
    );
  }

  // Same body for everyone → one (or few) messages with BCC batches.
  if (!personalize) {
    var content = buildEmailFn();
    var batchSize = 40;
    for (var b = 0; b < recipients.length; b += batchSize) {
      var batch = recipients.slice(b, b + batchSize);
      try {
        sendQuizEmail_({
          to: visibleTo,
          bcc: batch.join(','),
          subject: content.subject,
          htmlBody: content.htmlBody
        });
        sent += batch.length;
        if (b + batchSize < recipients.length) {
          Utilities.sleep(500);
        }
      } catch (err) {
        errors.push('batch ' + (b / batchSize + 1) + ': ' + (err.message || err));
        Logger.log('Email BCC batch failed: ' + (err.message || err));
      }
    }
  } else {
    // Personalized scoreboard: one message per person, recipient in BCC.
    for (var i = 0; i < recipients.length; i++) {
      var email = recipients[i];
      try {
        var personal = buildEmailFn(email);
        sendQuizEmail_({
          to: visibleTo,
          bcc: email,
          subject: personal.subject,
          htmlBody: personal.htmlBody
        });
        sent++;
        if (recipients.length > 1) {
          Utilities.sleep(250);
        }
      } catch (err) {
        errors.push(email + ': ' + (err.message || err));
        Logger.log('Email failed for ' + email + ': ' + (err.message || err));
      }
    }
  }

  var quotaAfter = -1;
  try {
    quotaAfter = MailApp.getRemainingDailyQuota();
  } catch (e2) {}

  if (sent === 0) {
    throw new Error(
      'No emails were sent.\n\n' +
      (errors.length ? errors.join('\n') : 'Unknown error') +
      '\n\nFrom (script): ' + visibleTo +
      '\nBCC: ' + recipients.join(', ') +
      '\nQuota remaining: ' + quotaAfter
    );
  }

  return {
    sent: sent,
    total: recipients.length,
    errors: errors,
    visibleTo: visibleTo,
    bcc: recipients.slice(),
    quotaBefore: quotaBefore,
    quotaAfter: quotaAfter
  };
}

function sendDailyWelcomeEmails_(dateStr) {
  return sendEmailBroadcast_(function() {
    return buildDailyWelcomeEmail_(dateStr);
  });
}

function sendDailyScoreboardEmails_(dateStr) {
  return sendEmailBroadcast_(function(recipientEmail) {
    return buildPersonalizedScoreboardEmail_('daily', recipientEmail, dateStr);
  }, { personalize: true });
}

function sendWeeklyScoreboardEmails_() {
  return sendEmailBroadcast_(function(recipientEmail) {
    return buildPersonalizedScoreboardEmail_('weekly', recipientEmail);
  }, { personalize: true });
}

function sendMonthlyScoreboardEmails_() {
  return sendEmailBroadcast_(function(recipientEmail) {
    return buildPersonalizedScoreboardEmail_('monthly', recipientEmail);
  }, { personalize: true });
}

function buildCustomQuizResultsEmail_(customQuizId, recipientEmail) {
  var doc = getCustomQuizDoc_(customQuizId);
  if (!doc) throw new Error('Custom quiz not found: ' + customQuizId);

  var leaderboard = buildCustomQuizLeaderboard_(doc.id);
  var displayName = getDisplayNameForEmail_(recipientEmail);
  var personalRank = null;
  for (var i = 0; i < leaderboard.length; i++) {
    if (String(leaderboard[i].email || '').toLowerCase() === String(recipientEmail || '').toLowerCase() ||
        leaderboard[i].displayName === displayName) {
      personalRank = leaderboard[i];
      break;
    }
  }

  var scopes = (doc.scopes || []).map(function(s) {
    return s.label || s.quizId;
  }).join(', ');
  var shareUrl = customShareUrl_(doc.id);
  var title = 'Custom quiz results — ' + (doc.title || doc.id);
  var personal = '';
  if (personalRank) {
    personal = '<p style="background:#ecfdf5;border-radius:6px;padding:12px 16px;">' +
      'Your result: <strong>#' + personalRank.rank + '</strong> with <strong>' + personalRank.score +
      '</strong> / ' + (personalRank.totalQuestions || doc.questionCount || '?') +
      ' point' + (personalRank.score === 1 ? '' : 's') + '.</p>';
  }

  var body =
    '<p style="font-size:17px;">Hi ' + escapeHtml_(displayName) + ',</p>' +
    personal +
    '<p>Final results for <strong>' + escapeHtml_(doc.title || doc.id) + '</strong>.</p>' +
    '<p style="color:#6b7280;font-size:14px;">Chapters: ' + escapeHtml_(scopes || '—') + '<br>' +
    'Window: ' + escapeHtml_(doc.opensAt || '') + ' → ' + escapeHtml_(doc.closesAt || '') + '</p>' +
    '<p>Here are the scores among participants:</p>' +
    buildScoreboardTableHtml_(leaderboard, displayName) +
    '<p style="margin-top:16px;font-size:14px;"><a href="' + escapeHtml_(shareUrl) + '">View this quiz online</a></p>';

  return {
    subject: title,
    htmlBody: buildQuizEmailShell_(title, body)
  };
}

/**
 * Email final results to people who submitted this custom quiz only
 * (never the full user list).
 */
function sendCustomQuizResultsEmails_(customQuizId, options) {
  options = options || {};
  var doc = getCustomQuizDoc_(customQuizId);
  if (!doc) throw new Error('Custom quiz not found: ' + customQuizId);

  var participants = listCustomQuizParticipantEmails_(doc.id);
  var recipients = listCustomQuizResultRecipients_(doc.id, {
    forceTestRecipient: options.forceTestRecipient === true
  });

  if (!recipients.length) {
    throw new Error(
      'No custom-quiz result recipients.\n' +
      'Participants who submitted: ' + (participants.length || 0) + '\n' +
      (getEmailBroadcastMode_() === 'test'
        ? 'Test mode is on — the test recipient must have participated (or use the menu test send).'
        : 'Nobody has submitted this quiz yet.')
    );
  }

  var result = sendEmailBroadcast_(function(recipientEmail) {
    return buildCustomQuizResultsEmail_(doc.id, recipientEmail);
  }, {
    personalize: true,
    recipients: recipients,
    emptyMessage: 'No participants to email for this custom quiz.'
  });

  if (!options.skipMarkSent) {
    markCustomQuizResultsEmailSent_(doc);
  }

  result.participants = participants.length;
  result.customQuizId = doc.id;
  result.title = doc.title;
  return result;
}

/** Find closed custom quizzes and email participants (once each). */
function sendDueCustomQuizResultsEmails_() {
  var due = listCustomQuizzesDueForResultsEmail_();
  var summaries = [];
  var totalSent = 0;

  for (var i = 0; i < due.length; i++) {
    var quiz = due[i];
    try {
      var result = sendCustomQuizResultsEmails_(quiz.id);
      totalSent += result.sent || 0;
      summaries.push(quiz.id + ': sent ' + result.sent + '/' + result.total);
    } catch (err) {
      summaries.push(quiz.id + ': ' + (err.message || err));
      Logger.log('Custom quiz results email failed for ' + quiz.id + ': ' + (err.message || err));
    }
  }

  return {
    due: due.length,
    sent: totalSent,
    summaries: summaries
  };
}

// --- Scheduled handlers (time-based triggers) ---

function sendDailyWelcomeEmailScheduled_() {
  try {
    var result = sendDailyWelcomeEmails_();
    Logger.log('Daily welcome email: sent ' + result.sent + '/' + result.total);
  } catch (err) {
    Logger.log('Daily welcome email failed: ' + (err.message || err));
  }
}

function sendDailyScoreboardEmailScheduled_() {
  try {
    var result = sendDailyScoreboardEmails_();
    Logger.log('Daily scoreboard email: sent ' + result.sent + '/' + result.total);
  } catch (err) {
    Logger.log('Daily scoreboard email failed: ' + (err.message || err));
  }
}

function sendWeeklyScoreboardEmailScheduled_() {
  try {
    var result = sendWeeklyScoreboardEmails_();
    Logger.log('Weekly scoreboard email: sent ' + result.sent + '/' + result.total);
  } catch (err) {
    Logger.log('Weekly scoreboard email failed: ' + (err.message || err));
  }
}

function sendMonthlyScoreboardEmailScheduled_() {
  if (!isLastDayOfMonthInTimezone_(CONFIG.TIMEZONE)) {
    Logger.log('Monthly scoreboard skipped — not last day of month in ' + CONFIG.TIMEZONE);
    return;
  }
  try {
    var result = sendMonthlyScoreboardEmails_();
    Logger.log('Monthly scoreboard email: sent ' + result.sent + '/' + result.total);
  } catch (err) {
    Logger.log('Monthly scoreboard email failed: ' + (err.message || err));
  }
}

function sendCustomQuizResultsEmailScheduled_() {
  try {
    var result = sendDueCustomQuizResultsEmails_();
    Logger.log(
      'Custom quiz results email: due=' + result.due +
      ' sent=' + result.sent +
      ' details=' + (result.summaries || []).join(' | ')
    );
  } catch (err) {
    Logger.log('Custom quiz results email failed: ' + (err.message || err));
  }
}

// --- Menu actions ---

function installQuizEmailTriggers() {
  for (var i = 0; i < QUIZ_EMAIL_HANDLERS.length; i++) {
    uninstallTriggersByHandler_(QUIZ_EMAIL_HANDLERS[i]);
  }

  // Settings sheet edits are cached — clear so Install sees the latest hours.
  try {
    var cache = CacheService.getScriptCache();
    cache.remove('set:daily_welcome_hour');
    cache.remove('set:daily_scoreboard_hour');
    cache.remove('set:weekly_scoreboard_hour');
    cache.remove('set:monthly_scoreboard_hour');
    cache.remove('set:email_broadcast_mode');
    cache.remove('set:email_test_recipient');
  } catch (e) {}

  var welcomeHour = getEmailHourSetting_('daily_welcome_hour', 6);
  var dailyBoardHour = getEmailHourSetting_('daily_scoreboard_hour', 23);
  var weeklyHour = getEmailHourSetting_('weekly_scoreboard_hour', 23);
  var monthlyHour = getEmailHourSetting_('monthly_scoreboard_hour', 23);

  ScriptApp.newTrigger('sendDailyWelcomeEmailScheduled_')
    .timeBased()
    .everyDays(1)
    .atHour(welcomeHour)
    .create();

  ScriptApp.newTrigger('sendDailyScoreboardEmailScheduled_')
    .timeBased()
    .everyDays(1)
    .atHour(dailyBoardHour)
    .create();

  ScriptApp.newTrigger('sendWeeklyScoreboardEmailScheduled_')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(weeklyHour)
    .create();

  // Runs daily at 23:00; handler sends only on the last day of the month (Dublin).
  ScriptApp.newTrigger('sendMonthlyScoreboardEmailScheduled_')
    .timeBased()
    .everyDays(1)
    .atHour(monthlyHour)
    .create();

  // Custom quizzes: email participants after close (checks every hour).
  ScriptApp.newTrigger('sendCustomQuizResultsEmailScheduled_')
    .timeBased()
    .everyHours(1)
    .create();

  var mode = getEmailBroadcastMode_();
  showMessage_(
    'Quiz email triggers installed (' + CONFIG.TIMEZONE + ').\n\n' +
    'Daily welcome: ' + welcomeHour + ':00\n' +
    'Daily scoreboard: ' + dailyBoardHour + ':00\n' +
    'Weekly scoreboard: Saturday ' + weeklyHour + ':00\n' +
    'Monthly scoreboard: last day of month ' + monthlyHour + ':00\n' +
    'Custom quiz results: every hour (participants only)\n\n' +
    'Broadcast mode: ' + mode +
    (mode === 'test' ? ' → ' + getEmailTestRecipient_() : ' → all registered users (daily emails)') +
    '\nCustom quizzes always email participants only.' +
    '\n\nRun test sends from the menu before enabling "all".'
  );
}

function removeQuizEmailTriggers() {
  var removed = 0;
  for (var i = 0; i < QUIZ_EMAIL_HANDLERS.length; i++) {
    removed += uninstallTriggersByHandler_(QUIZ_EMAIL_HANDLERS[i]);
  }
  showMessage_(
    removed
      ? 'Removed ' + removed + ' quiz email trigger(s).'
      : 'No quiz email triggers found.'
  );
}

function enableEmailBroadcastToAll() {
  var ui = SpreadsheetApp.getUi();
  var confirm = ui.alert(
    'Send emails to ALL users?',
    'This will email every registered user for scheduled sends.\n\n' +
    'Make sure you have tested with test mode first.\n\n' +
    'Settings: email_broadcast_mode | all',
    ui.ButtonSet.YES_NO
  );
  if (confirm !== ui.Button.YES) {
    showMessage_('Cancelled — still in test mode.');
    return;
  }
  setSetting_('email_broadcast_mode', 'all');
  showMessage_(
    'Broadcast mode set to ALL users.\n\n' +
    'Scheduled emails will go to every registered email.\n' +
    'To revert: Settings → email_broadcast_mode | test'
  );
}

function testDailyWelcomeEmail() {
  runQuizEmailTest_('Daily welcome', function() {
    return sendDailyWelcomeEmails_();
  });
}

function testDailyScoreboardEmail() {
  runQuizEmailTest_('Daily scoreboard', function() {
    return sendDailyScoreboardEmails_();
  });
}

function testWeeklyScoreboardEmail() {
  runQuizEmailTest_('Weekly scoreboard', function() {
    return sendWeeklyScoreboardEmails_();
  });
}

function testMonthlyScoreboardEmail() {
  runQuizEmailTest_('Monthly scoreboard', function() {
    return sendMonthlyScoreboardEmails_();
  });
}

function testCustomQuizResultsEmail() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'Test custom quiz results email',
    'Enter the custom quiz id (from the share link, e.g. cq_20260904-…).\n\n' +
    'Sends only to email_test_recipient (for testing).\n' +
    'Does not mark the quiz as “results emailed”.',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) {
    showMessage_('Cancelled.');
    return;
  }
  var quizId = String(response.getResponseText() || '').trim();
  if (!quizId) {
    showMessage_('No quiz id entered.');
    return;
  }

  try {
    setSetting_('email_broadcast_mode', 'test');
    var result = sendCustomQuizResultsEmails_(quizId, {
      forceTestRecipient: true,
      skipMarkSent: true
    });
    showMessage_(
      'Custom quiz results test email dispatched.\n\n' +
      formatEmailTestResult_('Custom quiz', result) + '\n' +
      'Quiz: ' + (result.title || quizId) + '\n' +
      'Participants who submitted: ' + (result.participants || 0) + '\n' +
      'BCC: ' + (result.bcc ? result.bcc.join(', ') : getEmailTestRecipient_()) + '\n\n' +
      'Production sends go only to people who submitted that quiz.'
    );
  } catch (err) {
    showMessage_('Custom quiz results test failed:\n\n' + (err.message || err));
  }
}

function sendDueCustomQuizResultsEmailsNow() {
  try {
    var result = sendDueCustomQuizResultsEmails_();
    showMessage_(
      'Custom quiz results email run complete.\n\n' +
      'Closed quizzes due: ' + result.due + '\n' +
      'Messages sent: ' + result.sent + '\n\n' +
      (result.summaries && result.summaries.length
        ? result.summaries.join('\n')
        : 'Nothing to send.') +
      '\n\nRecipients are always participants only (not all users).'
    );
  } catch (err) {
    showMessage_('Send failed:\n\n' + (err.message || err));
  }
}

function testAllQuizEmails() {
  var results = [];
  try {
    results.push(formatEmailTestResult_('Welcome', sendDailyWelcomeEmails_()));
    Utilities.sleep(500);
    results.push(formatEmailTestResult_('Daily scoreboard', sendDailyScoreboardEmails_()));
    Utilities.sleep(500);
    results.push(formatEmailTestResult_('Weekly scoreboard', sendWeeklyScoreboardEmails_()));
    Utilities.sleep(500);
    results.push(formatEmailTestResult_('Monthly scoreboard', sendMonthlyScoreboardEmails_()));
    showMessage_(
      'All test emails sent.\n\n' + results.join('\n') + '\n\n' +
      'Recipient: ' + getEmailTestRecipient_() + '\n' +
      'Mode: ' + getEmailBroadcastMode_()
    );
  } catch (err) {
    showMessage_('Test emails failed:\n\n' + (err.message || err));
  }
}

function runQuizEmailTest_(label, sendFn) {
  try {
    setSetting_('email_broadcast_mode', 'test');
    setSetting_('email_test_recipient', 'kjjaison@gmail.com');

    var result = sendFn();
    showMessage_(
      label + ' test email dispatched.\n\n' +
      formatEmailTestResult_(label, result) + '\n\n' +
      'Visible To (script account): ' + (result.visibleTo || '(unknown)') + '\n' +
      'BCC: ' + (result.bcc ? result.bcc.join(', ') : getEmailTestRecipient_()) + '\n' +
      'Mail quota left: ' + (result.quotaAfter >= 0 ? result.quotaAfter : '?') + '\n\n' +
      'Check Inbox and Spam for kjjaison@gmail.com.\n' +
      'Also check Sent mail of the script account.'
    );
  } catch (err) {
    showMessage_(label + ' test failed:\n\n' + (err.message || err));
  }
}

function formatEmailTestResult_(label, result) {
  var line = label + ': ' + result.sent + '/' + result.total + ' sent';
  if (result.errors && result.errors.length) {
    line += '\nErrors:\n' + result.errors.join('\n');
  }
  return line;
}
