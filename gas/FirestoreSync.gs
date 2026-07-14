/**
 * Hybrid sync: Google Sheet → Firestore.
 *
 * Spark plan (default): direct REST sync from Apps Script (see FirestoreRest.gs).
 * Blaze plan (optional): set firestore_sync_url in Settings to use Cloud Function instead.
 */

function getSetting_(key) {
  var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.SETTINGS);
  if (!sheet) return '';

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === key) {
      return String(data[i][1] || '').trim();
    }
  }
  return '';
}

var FIRESTORE_LANGUAGE_SHEETS = {
  Questions: 'en',
  QuestionsMalayalam: 'ml'
};

function hasDirectFirestoreCredentials_() {
  try {
    getFirebaseProjectId_();
    if (getFirestoreAuthMode_() === 'service_account') {
      getFirebaseCredentials_();
    }
    return true;
  } catch (e) {
    return false;
  }
}

function hasCloudFunctionSync_() {
  return !!getFirestoreSyncUrl_();
}

function getFirestoreSyncUrl_() {
  return getSetting_('firestore_sync_url') || (CONFIG.FIRESTORE_SYNC_URL || '');
}

function getSyncSecret_() {
  return getSetting_('sync_secret') || (CONFIG.SYNC_SECRET || '');
}

function questionDocId_(language, quizId, questionNum) {
  return language + '_' + quizId + '_' + questionNum;
}

function formatSheetDateForFirestore_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  }
  return String(value || '').substring(0, 10);
}

function rowToFirestoreQuestion_(row, language, syncBatchId, syncedAt, col) {
  col = col || QCOL;
  var quizId = String(row[col.QUIZ_ID] || '').trim();
  var questionText = String(row[col.TEXT] || '').trim();
  if (!quizId || !questionText) return null;

  var questionNum = Number(row[col.NUM]);
  var bookReference = col.CHAPTER >= 0 ? String(row[col.CHAPTER] || '').trim() : '';
  var correctAnswer = normalizeCorrectAnswer_(row[col.CORRECT]);
  var docId = questionDocId_(language, quizId, questionNum);
  var options = normalizeQuestionOptions_({
    A: row[col.OPTION_A],
    B: row[col.OPTION_B],
    C: row[col.OPTION_C],
    D: row[col.OPTION_D]
  });

  return {
    questionWrite: buildFirestoreUpdateWrite_('questions', docId, {
      quizId: quizId,
      language: language,
      questionNum: questionNum,
      question: questionText,
      bookReference: bookReference,
      options: options,
      syncBatchId: syncBatchId,
      syncedAt: syncedAt
    }),
    answerKeyWrite: correctAnswer
      ? buildFirestoreUpdateWrite_('answerKeys', docId, {
          quizId: quizId,
          language: language,
          questionNum: questionNum,
          correctAnswer: correctAnswer,
          syncBatchId: syncBatchId,
          syncedAt: syncedAt
        })
      : null,
    quizId: quizId,
    bookReference: bookReference,
    language: language
  };
}

function syncQuizToFirestoreViaCloudFunction_() {
  var url = getFirestoreSyncUrl_();
  var secret = getSyncSecret_();

  if (!url) {
    throw new Error('Missing firestore_sync_url in Settings sheet.');
  }
  if (!secret) {
    throw new Error('Missing sync_secret in Settings sheet.');
  }

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Sync-Secret': secret },
    payload: JSON.stringify({ source: 'apps-script' }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Cloud sync failed (' + code + '): ' + body);
  }

  var data = JSON.parse(body);
  if (!data.success) {
    throw new Error(data.error || 'Cloud sync failed');
  }
  return data.result;
}

function syncQuizToFirestoreDirect_() {
  var syncBatchId = 'sync_' + Date.now();
  var syncedAt = new Date();
  var writes = [];
  var quizMap = {};

  Object.keys(FIRESTORE_LANGUAGE_SHEETS).forEach(function(sheetName) {
    var language = FIRESTORE_LANGUAGE_SHEETS[sheetName];
    var sheet = getSpreadsheet_().getSheetByName(sheetName);
    if (!sheet) return;

    var data = sheet.getDataRange().getValues();
    var col = getQuestionColumnMapForSheet_(sheet);
    for (var i = 1; i < data.length; i++) {
      var parsed = rowToFirestoreQuestion_(data[i], language, syncBatchId, syncedAt, col);
      if (!parsed) continue;

      writes.push(parsed.questionWrite);
      if (parsed.answerKeyWrite) {
        writes.push(parsed.answerKeyWrite);
      }

      if (!quizMap[parsed.quizId]) {
        quizMap[parsed.quizId] = {
          bookReference: parsed.bookReference,
          questionCount: {},
          syncBatchId: syncBatchId
        };
      }
      quizMap[parsed.quizId].questionCount[language] =
        (quizMap[parsed.quizId].questionCount[language] || 0) + 1;
      if (!quizMap[parsed.quizId].bookReference && parsed.bookReference) {
        quizMap[parsed.quizId].bookReference = parsed.bookReference;
      }
    }
  });

  var scheduleSheet = getSheet_(CONFIG.SHEETS.SCHEDULE);
  var scheduleData = scheduleSheet.getDataRange().getValues();
  var scheduleDays = 0;

  for (var s = 1; s < scheduleData.length; s++) {
    var date = formatSheetDateForFirestore_(scheduleData[s][0]);
    var book = String(scheduleData[s][1] || '').trim();
    var chapter = String(scheduleData[s][2] || '').trim();
    var scheduleQuizId = String(scheduleData[s][3] || '').trim();
    if (!date || !scheduleQuizId) continue;

    scheduleDays++;
    var title = buildQuizTitle_(book, chapter, '');
    var quizMeta = quizMap[scheduleQuizId];
    if (quizMeta && quizMeta.bookReference) {
      title = buildQuizTitle_(book, chapter, quizMeta.bookReference);
    }

    writes.push(buildFirestoreUpdateWrite_('schedule', date, {
      date: date,
      quizId: scheduleQuizId,
      book: book,
      chapter: chapter,
      title: title,
      syncBatchId: syncBatchId,
      syncedAt: syncedAt
    }));
  }

  Object.keys(quizMap).forEach(function(quizId) {
    var entry = quizMap[quizId];
    var parsed = parseBookReference_(entry.bookReference || '');
    writes.push(buildFirestoreUpdateWrite_('quizzes', quizId, {
      quizId: quizId,
      bookReference: entry.bookReference || '',
      book: parsed.book,
      chapter: parsed.chapter,
      title: buildQuizTitle_(parsed.book, parsed.chapter, entry.bookReference || ''),
      questionCount: entry.questionCount,
      syncBatchId: syncBatchId,
      syncedAt: syncedAt
    }));
  });

  var questionsEn = 0;
  var questionsMl = 0;
  Object.keys(quizMap).forEach(function(quizId) {
    questionsEn += quizMap[quizId].questionCount.en || 0;
    questionsMl += quizMap[quizId].questionCount.ml || 0;
  });

  writes.push(buildFirestoreUpdateWrite_('syncMeta', 'latest', {
    syncBatchId: syncBatchId,
    syncedAt: syncedAt,
    source: 'google-sheet-apps-script',
    questionsEn: questionsEn,
    questionsMl: questionsMl,
    scheduleDays: scheduleDays,
    quizCount: Object.keys(quizMap).length
  }));

  firestoreCommitWrites_(writes);

  var removed = {
    questions: deleteStaleFirestoreDocs_('questions', syncBatchId),
    answerKeys: deleteStaleFirestoreDocs_('answerKeys', syncBatchId),
    schedule: deleteStaleFirestoreDocs_('schedule', syncBatchId),
    quizzes: deleteStaleFirestoreDocs_('quizzes', syncBatchId)
  };

  return {
    syncBatchId: syncBatchId,
    written: writes.length,
    removed: removed,
    quizCount: Object.keys(quizMap).length,
    scheduleDays: scheduleDays,
    mode: 'apps-script-direct'
  };
}

function syncQuizToFirestore() {
  if (hasDirectFirestoreCredentials_()) {
    return syncQuizToFirestoreDirect_();
  }
  if (hasCloudFunctionSync_()) {
    return syncQuizToFirestoreViaCloudFunction_();
  }
  throw new Error(
    'Firestore sync is not configured.\n\n' +
    'Spark plan (org blocks service account keys):\n' +
    '1. Settings: firebase_project_id | bbadublin-quiz\n' +
    '2. Settings: firestore_auth_mode | user\n' +
    '3. Add your Google account as Editor on Firebase project\n' +
    '4. Copy appsscript.json oauthScopes, then run Authorize Firebase access\n\n' +
    'See docs/FIRESTORE-SPARK.md'
  );
}

function syncQuizToFirestoreWithMessage() {
  try {
    var result = syncQuizToFirestore();
    showMessage_(
      'Firestore sync complete!\n\n' +
      'Mode: ' + (result.mode || 'cloud-function') + '\n' +
      'Quizzes: ' + result.quizCount + '\n' +
      'Schedule days: ' + result.scheduleDays + '\n' +
      'Documents written: ' + result.written + '\n\n' +
      'View: Firebase Console → Firestore → questions / schedule'
    );
  } catch (err) {
    showMessage_('Firestore sync failed:\n\n' + (err.message || err));
  }
}

function installFirestoreSyncTrigger() {
  if (!hasDirectFirestoreCredentials_() && !hasCloudFunctionSync_()) {
    showMessage_('Configure Firebase credentials first. See docs/FIRESTORE-SPARK.md');
    return;
  }

  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncQuizToFirestoreScheduled_') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('syncQuizToFirestoreScheduled_')
    .timeBased()
    .everyMinutes(15)
    .create();

  showMessage_('Installed 15-minute Firestore sync trigger (Apps Script, Spark-compatible).');
}

function syncQuizToFirestoreScheduled_() {
  try {
    syncQuizToFirestore();
  } catch (err) {
    Logger.log('Scheduled Firestore sync failed: ' + (err.message || err));
  }
}
