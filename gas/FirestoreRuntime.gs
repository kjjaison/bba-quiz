/**
 * Runtime data in Firestore (users, submissions, sessions).
 * Reads prefer Firestore; Google Sheet is standby via dual-write + FirestoreBackup.gs.
 */

function firestoreEmailDocId_(email) {
  return String(email || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
}

function firestoreSubmissionDocId_(email, date) {
  return firestoreEmailDocId_(email) + '_' + normalizeSheetDate_(date);
}

function firestoreSessionDocId_(token) {
  return Utilities.base64EncodeWebSafe(String(token || '')).replace(/=+$/, '').substring(0, 700);
}

function useFirestoreForRuntime_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('rt_src_mode');
  if (cached === '1') return true;
  if (cached === '0') return false;

  var ok = false;
  try {
    getFirebaseProjectId_();
    if (getFirestoreAuthMode_() === 'service_account') {
      getFirebaseCredentials_();
    }
    ok = true;
  } catch (e) {
    ok = false;
  }

  cache.put('rt_src_mode', ok ? '1' : '0', QUIZ_SOURCE_CACHE_SEC || 600);
  return ok;
}

function getFirestoreUserByEmail_(email) {
  if (!useFirestoreForRuntime_()) return null;
  email = String(email || '').toLowerCase().trim();
  if (!email) return null;
  try {
    var doc = getFirestoreDocument_('users', firestoreEmailDocId_(email));
    if (!doc || !doc.email) return null;
    return {
      email: String(doc.email).toLowerCase(),
      displayName: String(doc.displayName || ''),
      totalScore: Number(doc.totalScore) || 0,
      totalQuizzes: Number(doc.totalQuizzes) || 0,
      perfectScores: Number(doc.perfectScores) || 0,
      streak: Number(doc.streak) || 0,
      mustChangePassword: doc.mustChangePassword === true,
      passwordHash: String(doc.passwordHash || ''),
      source: 'firestore'
    };
  } catch (err) {
    Logger.log('Firestore user read failed: ' + (err.message || err));
    return null;
  }
}

function getFirestoreSessionByToken_(token) {
  if (!useFirestoreForRuntime_()) return null;
  token = String(token || '').trim();
  if (!token) return null;
  try {
    var doc = getFirestoreDocument_('sessions', firestoreSessionDocId_(token));
    if (!doc || !doc.sessionToken) return null;
    return {
      email: String(doc.email || '').toLowerCase(),
      token: String(doc.sessionToken),
      expiresAt: doc.expiresAt ? new Date(doc.expiresAt) : null,
      createdAt: doc.createdAt ? new Date(doc.createdAt) : null,
      rememberMe: doc.rememberMe === true,
      source: 'firestore'
    };
  } catch (err) {
    Logger.log('Firestore session read failed: ' + (err.message || err));
    return null;
  }
}

function getFirestoreSubmissionByEmailDate_(email, date) {
  if (!useFirestoreForRuntime_()) return null;
  email = String(email || '').toLowerCase().trim();
  var quizDate = normalizeSheetDate_(date);
  if (!email || !quizDate) return null;
  try {
    var doc = getFirestoreDocument_('submissions', firestoreSubmissionDocId_(email, quizDate));
    if (!doc || !doc.email) return null;
    var answers = {};
    try {
      answers = JSON.parse(doc.answersJson || '{}');
    } catch (e) {
      answers = {};
    }
    return {
      row: null,
      score: Number(doc.score) || 0,
      totalQuestions: Number(doc.totalQuestions) || 0,
      answers: answers,
      submittedAt: doc.submittedAt || '',
      locked: doc.locked !== false,
      source: 'firestore'
    };
  } catch (err) {
    Logger.log('Firestore submission read failed: ' + (err.message || err));
    return null;
  }
}

function listFirestoreSubmissionDatesForEmail_(email) {
  if (!useFirestoreForRuntime_()) return null;
  email = String(email || '').toLowerCase().trim();
  if (!email) return [];
  try {
    var docs = runFirestoreQuery_({
      from: [{ collectionId: 'submissions' }],
      where: firestoreStringFilter_('email', email)
    });
    var dates = [];
    for (var i = 0; i < docs.length; i++) {
      if (docs[i].quizDate) dates.push(normalizeSheetDate_(docs[i].quizDate));
    }
    return dates;
  } catch (err) {
    Logger.log('Firestore submission list failed: ' + (err.message || err));
    return null;
  }
}

function writeFirestoreUserProfile_(profile) {
  if (!profile || !profile.email) return;
  try {
    var email = String(profile.email).toLowerCase().trim();
    firestoreCommitWrites_([buildFirestoreUpdateWrite_('users', firestoreEmailDocId_(email), {
      email: email,
      displayName: String(profile.displayName || ''),
      totalScore: Number(profile.totalScore) || 0,
      totalQuizzes: Number(profile.totalQuizzes) || 0,
      perfectScores: Number(profile.perfectScores) || 0,
      streak: Number(profile.streak) || 0,
      mustChangePassword: profile.mustChangePassword === true,
      passwordHash: String(profile.passwordHash || ''),
      updatedAt: new Date().toISOString()
    })]);
  } catch (err) {
    Logger.log('Firestore user write failed: ' + (err.message || err));
  }
}

function writeFirestoreSubmission_(submission) {
  if (!submission || !submission.email || !submission.quizDate) return;
  try {
    var email = String(submission.email).toLowerCase().trim();
    var quizDate = normalizeSheetDate_(submission.quizDate);
    firestoreCommitWrites_([buildFirestoreUpdateWrite_(
      'submissions',
      firestoreSubmissionDocId_(email, quizDate),
      {
        email: email,
        quizDate: quizDate,
        answersJson: typeof submission.answersJson === 'string'
          ? submission.answersJson
          : JSON.stringify(submission.answers || {}),
        score: Number(submission.score) || 0,
        totalQuestions: Number(submission.totalQuestions) || 0,
        submittedAt: submission.submittedAt
          ? (submission.submittedAt instanceof Date
            ? submission.submittedAt.toISOString()
            : String(submission.submittedAt))
          : new Date().toISOString(),
        locked: submission.locked !== false,
        updatedAt: new Date().toISOString()
      }
    )]);
  } catch (err) {
    Logger.log('Firestore submission write failed: ' + (err.message || err));
  }
}

function writeFirestoreSession_(session) {
  if (!session || !session.token) return;
  try {
    firestoreCommitWrites_([buildFirestoreUpdateWrite_(
      'sessions',
      firestoreSessionDocId_(session.token),
      {
        email: String(session.email || '').toLowerCase().trim(),
        sessionToken: String(session.token),
        expiresAt: session.expiresAt instanceof Date
          ? session.expiresAt.toISOString()
          : String(session.expiresAt || ''),
        createdAt: session.createdAt instanceof Date
          ? session.createdAt.toISOString()
          : String(session.createdAt || new Date().toISOString()),
        rememberMe: session.rememberMe === true,
        updatedAt: new Date().toISOString()
      }
    )]);
  } catch (err) {
    Logger.log('Firestore session write failed: ' + (err.message || err));
  }
}

function deleteFirestoreSession_(token) {
  if (!token || !useFirestoreForRuntime_()) return;
  try {
    firestoreCommitWrites_([{
      delete: firestoreDocumentPath_('sessions', firestoreSessionDocId_(token))
    }]);
  } catch (err) {
    Logger.log('Firestore session delete failed: ' + (err.message || err));
  }
}

/**
 * Rebuild users.totalScore / totalQuizzes / perfectScores / streak from submissions.
 * Use when stats are out of date (e.g. submits wrote submissions but not users).
 */
function recalculateUserStatsFromSubmissions() {
  try {
    var result = recalculateUserStatsFromSubmissions_();
    showMessage_(
      'User stats recalculated from Firestore submissions.\n\n' +
      'Users updated: ' + result.usersUpdated + '\n' +
      'Submissions scanned: ' + result.submissionsScanned + '\n\n' +
      'Fields set: totalScore, totalQuizzes, perfectScores, streak\n' +
      'Scoreboard cache cleared. Refresh the app Scoreboard tab.'
    );
  } catch (err) {
    showMessage_('Recalculate failed:\n\n' + (err.message || err));
  }
}

function recalculateUserStatsFromSubmissions_() {
  getFirebaseProjectId_();
  getFirestoreAccessToken_();

  var pointsPerCorrect = CONFIG.POINTS_PER_CORRECT || 1;
  var subDocs = listFirestoreCollection_('submissions');
  var byEmail = {};

  for (var i = 0; i < subDocs.length; i++) {
    var s = decodeFirestoreDocument_(subDocs[i]);
    if (!s.email || s.locked === false) continue;

    var email = String(s.email).toLowerCase().trim();
    var quizDate = normalizeSheetDate_(s.quizDate);
    var score = Number(s.score) || 0;
    var totalQuestions = Number(s.totalQuestions) || 0;
    if (!email || !quizDate) continue;

    if (!byEmail[email]) {
      byEmail[email] = {
        totalScore: 0,
        totalQuizzes: 0,
        perfectScores: 0,
        dates: []
      };
    }

    byEmail[email].totalScore += score;
    byEmail[email].totalQuizzes += 1;
    if (totalQuestions > 0 && score === totalQuestions * pointsPerCorrect) {
      byEmail[email].perfectScores += 1;
    }
    byEmail[email].dates.push(quizDate);
  }

  var userDocs = listFirestoreCollection_('users');
  var existing = {};
  for (var u = 0; u < userDocs.length; u++) {
    var user = decodeFirestoreDocument_(userDocs[u]);
    if (user.email) {
      existing[String(user.email).toLowerCase()] = user;
    }
  }

  var today = todayDate_();
  var writes = [];
  var usersUpdated = 0;
  var emails = Object.keys(byEmail);

  for (var e = 0; e < emails.length; e++) {
    var em = emails[e];
    var agg = byEmail[em];
    var prev = existing[em] || {};
    var streak = calculateStreakFromDates_(em, today, agg.dates);

    writes.push(buildFirestoreUpdateWrite_('users', firestoreEmailDocId_(em), {
      email: em,
      displayName: String(prev.displayName || em),
      totalScore: agg.totalScore,
      totalQuizzes: agg.totalQuizzes,
      perfectScores: agg.perfectScores,
      streak: streak,
      mustChangePassword: prev.mustChangePassword === true,
      passwordHash: String(prev.passwordHash || ''),
      updatedAt: new Date().toISOString()
    }));
    usersUpdated++;

    if (writes.length >= FIRESTORE_BATCH_WRITE_SIZE) {
      firestoreCommitWrites_(writes);
      writes = [];
    }
  }

  for (var existingEmail in existing) {
    if (!existing.hasOwnProperty(existingEmail) || byEmail[existingEmail]) continue;
    var bare = existing[existingEmail];
    writes.push(buildFirestoreUpdateWrite_('users', firestoreEmailDocId_(existingEmail), {
      email: existingEmail,
      displayName: String(bare.displayName || existingEmail),
      totalScore: 0,
      totalQuizzes: 0,
      perfectScores: 0,
      streak: 0,
      mustChangePassword: bare.mustChangePassword === true,
      passwordHash: String(bare.passwordHash || ''),
      updatedAt: new Date().toISOString()
    }));
    usersUpdated++;
    if (writes.length >= FIRESTORE_BATCH_WRITE_SIZE) {
      firestoreCommitWrites_(writes);
      writes = [];
    }
  }

  if (writes.length) {
    firestoreCommitWrites_(writes);
  }

  invalidateLeaderboardCache_();

  return {
    usersUpdated: usersUpdated,
    submissionsScanned: subDocs.length
  };
}

/**
 * One-time (or on-demand) migrate Users / Submissions / Sessions from Sheet → Firestore.
 * After this, runtime reads prefer Firestore; Sheet is kept as standby via backup.
 */
function migrateRuntimeDataToFirestore() {
  try {
    var result = migrateRuntimeDataToFirestore_();
    showMessage_(
      'Runtime data migrated to Firestore.\n\n' +
      'Users: ' + result.users + '\n' +
      'Submissions: ' + result.submissions + '\n' +
      'Sessions: ' + result.sessions + '\n\n' +
      'Login / submit now read Firestore first.\n' +
      'Next: install "15-min Firestore → Sheet backup" for standby.'
    );
  } catch (err) {
    showMessage_('Runtime migration failed:\n\n' + (err.message || err));
  }
}

function migrateRuntimeDataToFirestore_() {
  getFirebaseProjectId_();
  getFirestoreAccessToken_();

  var usersWritten = 0;
  var users = getSheetData_(CONFIG.SHEETS.USERS);
  var userBatch = [];
  for (var i = 1; i < users.length; i++) {
    var email = String(users[i][0] || '').toLowerCase().trim();
    if (!email) continue;
    userBatch.push(buildFirestoreUpdateWrite_('users', firestoreEmailDocId_(email), {
      email: email,
      displayName: String(users[i][2] || ''),
      totalScore: Number(users[i][6]) || 0,
      totalQuizzes: Number(users[i][7]) || 0,
      perfectScores: Number(users[i][8]) || 0,
      streak: Number(users[i][9]) || 0,
      mustChangePassword: userMustChangePassword_(users[i]),
      passwordHash: String(users[i][1] || ''),
      updatedAt: new Date().toISOString()
    }));
    usersWritten++;
    if (userBatch.length >= FIRESTORE_BATCH_WRITE_SIZE) {
      firestoreCommitWrites_(userBatch);
      userBatch = [];
    }
  }
  if (userBatch.length) firestoreCommitWrites_(userBatch);

  var submissionsWritten = 0;
  var sheet = getSheet_(CONFIG.SHEETS.SUBMISSIONS);
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var numCols = Math.max(sheet.getLastColumn(), 7);
    var data = sheet.getRange(1, 1, lastRow, numCols).getValues();
    var display = sheet.getRange(1, 1, lastRow, numCols).getDisplayValues();
    var subBatch = [];
    for (var s = 1; s < data.length; s++) {
      var subEmail = String(data[s][0] || '').toLowerCase().trim();
      var quizDate = normalizeSheetDate_(data[s][1]) || normalizeSheetDate_(display[s][1]);
      if (!subEmail || !quizDate) continue;
      var submittedAt = data[s][5];
      subBatch.push(buildFirestoreUpdateWrite_(
        'submissions',
        firestoreSubmissionDocId_(subEmail, quizDate),
        {
          email: subEmail,
          quizDate: quizDate,
          answersJson: String(data[s][2] || '{}'),
          score: Number(data[s][3]) || 0,
          totalQuestions: Number(data[s][4]) || 0,
          submittedAt: submittedAt instanceof Date ? submittedAt.toISOString() : String(submittedAt || ''),
          locked: isSheetTruthy_(data[s][6]),
          updatedAt: new Date().toISOString()
        }
      ));
      submissionsWritten++;
      if (subBatch.length >= FIRESTORE_BATCH_WRITE_SIZE) {
        firestoreCommitWrites_(subBatch);
        subBatch = [];
      }
    }
    if (subBatch.length) firestoreCommitWrites_(subBatch);
  }

  var sessionsWritten = 0;
  var sessionsSheet = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.SESSIONS);
  if (sessionsSheet && sessionsSheet.getLastRow() >= 2) {
    var sessData = sessionsSheet.getDataRange().getValues();
    var sessBatch = [];
    for (var t = 1; t < sessData.length; t++) {
      var token = String(sessData[t][1] || '');
      if (!token) continue;
      var expires = sessData[t][2];
      var created = sessData[t][3];
      sessBatch.push(buildFirestoreUpdateWrite_(
        'sessions',
        firestoreSessionDocId_(token),
        {
          email: String(sessData[t][0] || '').toLowerCase().trim(),
          sessionToken: token,
          expiresAt: expires instanceof Date ? expires.toISOString() : String(expires || ''),
          createdAt: created instanceof Date ? created.toISOString() : String(created || ''),
          rememberMe: isSheetTruthy_(sessData[t][4]),
          updatedAt: new Date().toISOString()
        }
      ));
      sessionsWritten++;
      if (sessBatch.length >= FIRESTORE_BATCH_WRITE_SIZE) {
        firestoreCommitWrites_(sessBatch);
        sessBatch = [];
      }
    }
    if (sessBatch.length) firestoreCommitWrites_(sessBatch);
  }

  return {
    users: usersWritten,
    submissions: submissionsWritten,
    sessions: sessionsWritten
  };
}
