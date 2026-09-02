/**
 * Leaderboards (daily = today, weekly = last 7 days, monthly = this calendar month, all-time).
 * Prefers Firestore so scores appear right after submit (Sheet is standby only).
 */

function getLeaderboard_(period) {
  period = String(period || 'all').toLowerCase();

  if (period === 'daily') {
    return getLeaderboardForDate_(todayDate_());
  }

  if (useFirestoreForRuntime_()) {
    try {
      return getLeaderboardFromFirestore_(period);
    } catch (err) {
      Logger.log('Firestore leaderboard failed, using sheet: ' + (err.message || err));
    }
  }

  return getLeaderboardFromSheet_(period);
}

/**
 * Inclusive yyyy-MM-dd window in CONFIG.TIMEZONE (Europe/Dublin).
 * daily   = today only (same as the daily email)
 * weekly  = last 7 calendar days including today
 * monthly = current calendar month
 * all     = no bounds
 */
function getLeaderboardPeriodRange_(period) {
  var today = todayDate_();
  period = String(period || 'all').toLowerCase();

  if (period === 'daily') {
    return { start: today, end: today };
  }
  if (period === 'weekly') {
    return { start: addDaysYmd_(today, -6), end: today };
  }
  if (period === 'monthly') {
    return { start: today.substring(0, 7) + '-01', end: today };
  }
  return { start: '', end: '' };
}

function getLeaderboardPeriodLabel_(period) {
  period = String(period || 'all').toLowerCase();
  var today = todayDate_();
  if (period === 'daily') {
    var parts = today.split('-');
    var day = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12, 0, 0);
    return Utilities.formatDate(day, CONFIG.TIMEZONE, 'EEEE, d MMMM yyyy');
  }
  if (period === 'weekly') {
    return 'Last 7 days';
  }
  if (period === 'monthly') {
    var mParts = today.split('-');
    var month = new Date(Number(mParts[0]), Number(mParts[1]) - 1, Number(mParts[2]), 12, 0, 0);
    return Utilities.formatDate(month, CONFIG.TIMEZONE, 'MMMM yyyy');
  }
  return 'All time';
}

function addDaysYmd_(ymd, days) {
  var parts = String(ymd || '').split('-');
  var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  d.setUTCDate(d.getUTCDate() + days);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function quizDateInRange_(quizDate, range) {
  var ymd = normalizeSheetDate_(quizDate);
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  range = range || {};
  if (range.start && ymd < range.start) return false;
  if (range.end && ymd > range.end) return false;
  return true;
}

/**
 * Competition ranking: equal scores share the same rank; next rank skips.
 * Example: scores 10,10,8 → ranks 1,1,3
 */
function assignLeaderboardRanks_(leaderboard) {
  var rank = 1;
  for (var i = 0; i < leaderboard.length; i++) {
    if (i > 0 && Number(leaderboard[i].score) !== Number(leaderboard[i - 1].score)) {
      rank = i + 1;
    }
    leaderboard[i].rank = rank;
  }
  return leaderboard;
}

function getLeaderboardFromFirestore_(period) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'lb:fs:' + period;
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  // All periods (including all-time) sum locked submissions.
  // users.totalScore can be 0 after migration/password writes even when quizzes exist.
  var leaderboard = buildPeriodLeaderboardFromSubmissions_(period);

  try {
    cache.put(cacheKey, JSON.stringify(leaderboard), 30);
  } catch (e) {}

  return leaderboard;
}

function buildPeriodLeaderboardFromSubmissions_(period) {
  var range = getLeaderboardPeriodRange_(period);
  var userDocs = listFirestoreCollection_('users');
  var displayNames = {};
  for (var u = 0; u < userDocs.length; u++) {
    var user = decodeFirestoreDocument_(userDocs[u]);
    if (user.email) {
      displayNames[String(user.email).toLowerCase()] = user.displayName || user.email;
    }
  }

  var subDocs = listFirestoreCollection_('submissions');
  var scores = {};

  for (var i = 0; i < subDocs.length; i++) {
    var s = decodeFirestoreDocument_(subDocs[i]);
    if (!s.email || s.locked === false) continue;
    if (!quizDateInRange_(s.quizDate, range)) continue;

    var email = String(s.email).toLowerCase();
    if (!scores[email]) {
      scores[email] = { email: email, score: 0, quizzes: 0 };
    }
    scores[email].score += Number(s.score) || 0;
    scores[email].quizzes += 1;
  }

  var leaderboard = [];
  for (var key in scores) {
    if (!scores.hasOwnProperty(key)) continue;
    leaderboard.push({
      displayName: displayNames[key] || key,
      score: scores[key].score,
      quizzes: scores[key].quizzes
    });
  }

  leaderboard.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return b.quizzes - a.quizzes;
  });

  return assignLeaderboardRanks_(leaderboard.slice(0, 50));
}

function getLeaderboardFromSheet_(period) {
  var data = getSheetData_(CONFIG.SHEETS.SUBMISSIONS);
  var users = getSheetData_(CONFIG.SHEETS.USERS);

  var displayNames = {};
  for (var u = 1; u < users.length; u++) {
    displayNames[(users[u][0] || '').toLowerCase()] = users[u][2] || users[u][0];
  }

  var range = getLeaderboardPeriodRange_(period);
  var scores = {};

  for (var i = 1; i < data.length; i++) {
    if (!quizDateInRange_(data[i][1], range)) {
      continue;
    }

    var email = (data[i][0] || '').toLowerCase();
    var points = Number(data[i][3]) || 0;
    if (!scores[email]) {
      scores[email] = { email: email, score: 0, quizzes: 0 };
    }
    scores[email].score += points;
    scores[email].quizzes += 1;
  }

  var leaderboard = [];
  for (var key in scores) {
    if (scores.hasOwnProperty(key)) {
      leaderboard.push({
        displayName: displayNames[key] || key,
        score: scores[key].score,
        quizzes: scores[key].quizzes
      });
    }
  }

  leaderboard.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return b.quizzes - a.quizzes;
  });

  return assignLeaderboardRanks_(leaderboard.slice(0, 50));
}

function invalidateLeaderboardCache_() {
  var cache = CacheService.getScriptCache();
  cache.remove('lb:fs:all');
  cache.remove('lb:fs:weekly');
  cache.remove('lb:fs:monthly');
  // Daily boards are cached as lb:fs:daily:YYYY-MM-DD (see getLeaderboardForDate_).
  cache.remove('lb:fs:daily');
  cache.remove('lb:fs:daily:' + todayDate_());
}

/** Leaderboard for one quiz day (submissions on that date only). */
function getLeaderboardForDate_(dateStr) {
  dateStr = normalizeSheetDate_(dateStr || todayDate_());
  if (!dateStr) return [];

  var cache = CacheService.getScriptCache();
  var cacheKey = 'lb:fs:daily:' + dateStr;
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  var leaderboard;
  if (useFirestoreForRuntime_()) {
    try {
      leaderboard = buildDailyLeaderboardFromSubmissions_(dateStr);
    } catch (err) {
      Logger.log('Firestore daily leaderboard failed, using sheet: ' + (err.message || err));
      leaderboard = buildDailyLeaderboardFromSheet_(dateStr);
    }
  } else {
    leaderboard = buildDailyLeaderboardFromSheet_(dateStr);
  }

  try {
    cache.put(cacheKey, JSON.stringify(leaderboard), 30);
  } catch (e2) {}

  return leaderboard;
}

function buildDailyLeaderboardFromSubmissions_(dateStr) {
  var userDocs = listFirestoreCollection_('users');
  var displayNames = {};
  for (var u = 0; u < userDocs.length; u++) {
    var user = decodeFirestoreDocument_(userDocs[u]);
    if (user.email) {
      displayNames[String(user.email).toLowerCase()] = user.displayName || user.email;
    }
  }

  var subDocs = listFirestoreCollection_('submissions');
  var scores = {};

  for (var i = 0; i < subDocs.length; i++) {
    var s = decodeFirestoreDocument_(subDocs[i]);
    if (!s.email || s.locked === false) continue;

    var quizDate = normalizeSheetDate_(s.quizDate);
    if (quizDate !== dateStr) continue;

    var email = String(s.email).toLowerCase();
    if (!scores[email]) {
      scores[email] = { email: email, score: 0, quizzes: 0 };
    }
    scores[email].score += Number(s.score) || 0;
    scores[email].quizzes += 1;
  }

  return sortLeaderboardEntries_(scores, displayNames);
}

function buildDailyLeaderboardFromSheet_(dateStr) {
  var data = getSheetData_(CONFIG.SHEETS.SUBMISSIONS);
  var users = getSheetData_(CONFIG.SHEETS.USERS);
  var displayNames = {};
  for (var u = 1; u < users.length; u++) {
    displayNames[(users[u][0] || '').toLowerCase()] = users[u][2] || users[u][0];
  }

  var scores = {};
  for (var i = 1; i < data.length; i++) {
    var rowDate = normalizeSheetDate_(data[i][1]);
    if (rowDate !== dateStr) continue;

    var email = (data[i][0] || '').toLowerCase();
    if (!scores[email]) {
      scores[email] = { email: email, score: 0, quizzes: 0 };
    }
    scores[email].score += Number(data[i][3]) || 0;
    scores[email].quizzes += 1;
  }

  return sortLeaderboardEntries_(scores, displayNames);
}

function sortLeaderboardEntries_(scores, displayNames) {
  var leaderboard = [];
  for (var key in scores) {
    if (!scores.hasOwnProperty(key)) continue;
    leaderboard.push({
      displayName: displayNames[key] || key,
      score: scores[key].score,
      quizzes: scores[key].quizzes
    });
  }

  leaderboard.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return b.quizzes - a.quizzes;
  });

  return assignLeaderboardRanks_(leaderboard.slice(0, 50));
}

function getUserQuizHistory_(user) {
  var email = String((user && user.email) || '').toLowerCase().trim();
  if (!email) return [];

  var rows = [];
  if (useFirestoreForRuntime_()) {
    try {
      rows = listUserSubmissionsFromFirestore_(email);
    } catch (err) {
      Logger.log('Firestore history failed, using sheet: ' + (err.message || err));
      rows = listUserSubmissionsFromSheet_(email);
    }
  } else {
    rows = listUserSubmissionsFromSheet_(email);
  }

  var labels = getScheduleLabelMap_();
  for (var i = 0; i < rows.length; i++) {
    rows[i].chapter = labels[rows[i].date] || '';
  }

  rows.sort(function(a, b) {
    if (a.date < b.date) return 1;
    if (a.date > b.date) return -1;
    return 0;
  });
  return rows;
}

function listUserSubmissionsFromFirestore_(email) {
  var docs = runFirestoreQuery_({
    from: [{ collectionId: 'submissions' }],
    where: firestoreStringFilter_('email', email)
  });
  var rows = [];
  for (var i = 0; i < docs.length; i++) {
    var s = docs[i];
    if (!s.email || s.locked === false) continue;
    var quizDate = normalizeSheetDate_(s.quizDate);
    if (!quizDate) continue;
    rows.push({
      date: quizDate,
      score: Number(s.score) || 0,
      totalQuestions: Number(s.totalQuestions) || 0
    });
  }
  return rows;
}

function listUserSubmissionsFromSheet_(email) {
  var data = getSheetData_(CONFIG.SHEETS.SUBMISSIONS);
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').toLowerCase() !== email) continue;
    var quizDate = normalizeSheetDate_(data[i][1]);
    if (!quizDate) continue;
    rows.push({
      date: quizDate,
      score: Number(data[i][3]) || 0,
      totalQuestions: Number(data[i][4]) || 0
    });
  }
  return rows;
}

function getScheduleLabelMap_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('sched_labels');
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  var map = {};
  try {
    if (useFirestoreForQuiz_()) {
      var docs = listFirestoreCollection_('schedule');
      for (var i = 0; i < docs.length; i++) {
        var s = decodeFirestoreDocument_(docs[i]);
        var dateStr = normalizeSheetDate_(s.date);
        if (!dateStr) continue;
        map[dateStr] = formatScheduleLabel_(s);
      }
    } else {
      var sheet = getSheetData_(CONFIG.SHEETS.SCHEDULE);
      for (var r = 1; r < sheet.length; r++) {
        var sheetDate = normalizeSheetDate_(sheet[r][0]);
        if (!sheetDate) continue;
        map[sheetDate] = formatScheduleLabel_({
          book: sheet[r][1],
          chapter: sheet[r][2],
          quizId: sheet[r][3]
        });
      }
    }
  } catch (err) {
    Logger.log('Schedule label map failed: ' + (err.message || err));
  }

  try {
    cache.put('sched_labels', JSON.stringify(map), 300);
  } catch (e2) {}
  return map;
}

function getUserProfile_(user) {
  var email = String((user && user.email) || '').toLowerCase().trim();
  var history = [];
  if (email) {
    if (useFirestoreForRuntime_()) {
      try {
        history = listUserSubmissionsFromFirestore_(email);
      } catch (err) {
        history = listUserSubmissionsFromSheet_(email);
      }
    } else {
      history = listUserSubmissionsFromSheet_(email);
    }
  }
  var totalScore = 0;
  var totalQuizzes = history.length;
  var perfectScores = 0;
  var pointsPerCorrect = CONFIG.POINTS_PER_CORRECT || 1;
  for (var h = 0; h < history.length; h++) {
    var row = history[h];
    totalScore += Number(row.score) || 0;
    if (row.totalQuestions > 0 && Number(row.score) === Number(row.totalQuestions) * pointsPerCorrect) {
      perfectScores += 1;
    }
  }
  if (totalQuizzes === 0) {
    totalScore = Number(user.totalScore) || 0;
    totalQuizzes = Number(user.totalQuizzes) || 0;
    perfectScores = Number(user.perfectScores) || 0;
  }

  var allTime = getLeaderboard_('all');
  var rank = 0;
  for (var j = 0; j < allTime.length; j++) {
    if (allTime[j].displayName === user.displayName) {
      rank = allTime[j].rank;
      break;
    }
  }

  var stats = {
    totalScore: totalScore,
    totalQuizzes: totalQuizzes,
    perfectScores: perfectScores,
    streak: user.streak,
    rank: rank
  };

  var badges = [];
  for (var i = 0; i < CONFIG.BADGE_RULES.length; i++) {
    var rule = CONFIG.BADGE_RULES[i];
    badges.push({
      id: rule.id,
      name: rule.name,
      icon: rule.icon,
      description: rule.description,
      earned: rule.check(stats)
    });
  }

  return {
    displayName: user.displayName,
    email: user.email,
    stats: stats,
    badges: badges,
    rank: rank,
    mustChangePassword: user.mustChangePassword === true
  };
}
