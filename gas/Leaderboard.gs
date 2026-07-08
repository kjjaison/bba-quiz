/**
 * Leaderboards (all-time, monthly, weekly) and badges
 */

function getLeaderboard_(period) {
  period = period || 'all';
  var sheet = getSheet_(CONFIG.SHEETS.SUBMISSIONS);
  var data = sheet.getDataRange().getValues();
  var usersSheet = getSheet_(CONFIG.SHEETS.USERS);
  var users = usersSheet.getDataRange().getValues();

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

  leaderboard.sort(function(a, b) { return b.score - a.score; });

  // Return top 50
  return leaderboard.slice(0, 50).map(function(entry, index) {
    entry.rank = index + 1;
    return entry;
  });
}

function getUserProfile_(user) {
  var stats = {
    totalScore: user.totalScore,
    totalQuizzes: user.totalQuizzes,
    perfectScores: user.perfectScores,
    streak: user.streak
  };

  var badges = [];
  for (var i = 0; i < CONFIG.BADGE_RULES.length; i++) {
    var rule = CONFIG.BADGE_RULES[i];
    if (rule.check(stats)) {
      badges.push({
        id: rule.id,
        name: rule.name,
        icon: rule.icon,
        description: rule.description
      });
    }
  }

  // Rank in all-time leaderboard
  var allTime = getLeaderboard_('all');
  var rank = 0;
  for (var j = 0; j < allTime.length; j++) {
    if (allTime[j].displayName === user.displayName) {
      rank = allTime[j].rank;
      break;
    }
  }

  return {
    displayName: user.displayName,
    email: user.email,
    stats: stats,
    badges: badges,
    rank: rank
  };
}
