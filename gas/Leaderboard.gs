/**
 * Leaderboards (all-time, monthly, weekly) and badges.
 * Prefers Firestore so scores appear right after submit (Sheet is standby only).
 */

function getLeaderboard_(period) {
  period = period || 'all';

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

  var leaderboard;
  if (period === 'all') {
    leaderboard = buildAllTimeLeaderboardFromUsers_();
  } else {
    leaderboard = buildPeriodLeaderboardFromSubmissions_(period);
  }

  try {
    cache.put(cacheKey, JSON.stringify(leaderboard), 30);
  } catch (e) {}

  return leaderboard;
}

function buildAllTimeLeaderboardFromUsers_() {
  var docs = listFirestoreCollection_('users');
  var leaderboard = [];

  for (var i = 0; i < docs.length; i++) {
    var u = decodeFirestoreDocument_(docs[i]);
    if (!u.email) continue;
    leaderboard.push({
      displayName: u.displayName || u.email,
      score: Number(u.totalScore) || 0,
      quizzes: Number(u.totalQuizzes) || 0
    });
  }

  leaderboard.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return b.quizzes - a.quizzes;
  });

  return assignLeaderboardRanks_(leaderboard.slice(0, 50));
}

function buildPeriodLeaderboardFromSubmissions_(period) {
  var now = new Date();
  var startDate = null;
  if (period === 'weekly') {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === 'monthly') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

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
    if (!quizDate) continue;
    var subDate = new Date(quizDate + 'T12:00:00');
    if (startDate && subDate < startDate) continue;

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

  var now = new Date();
  var startDate = null;

  if (period === 'weekly') {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (period === 'monthly') {
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  var scores = {};

  for (var i = 1; i < data.length; i++) {
    var email = (data[i][0] || '').toLowerCase();
    var rowDate = data[i][1];
    var subDate = rowDate instanceof Date ? rowDate : new Date(String(rowDate));

    if (startDate && subDate < startDate) {
      continue;
    }

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
  cache.remove('lb:fs:daily');
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

function getUserProfile_(user) {
  var allTime = getLeaderboard_('all');
  var rank = 0;
  for (var j = 0; j < allTime.length; j++) {
    if (allTime[j].displayName === user.displayName) {
      rank = allTime[j].rank;
      break;
    }
  }

  var stats = {
    totalScore: user.totalScore,
    totalQuizzes: user.totalQuizzes,
    perfectScores: user.perfectScores,
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
