/**
 * Quiz content sync: Google Sheet → Firestore (MANUAL ONLY).
 *
 * Syncs: questions, answerKeys, schedule, quizzes.
 * Does NOT auto-run. Runtime data (users/submissions/sessions) uses FirestoreRuntime.gs
 * + FirestoreBackup.gs (Firestore → Sheet every 15 minutes).
 *
 * Spark plan (default): direct REST sync from Apps Script (see FirestoreRest.gs).
 * Blaze plan (optional): set firestore_sync_url in Settings to use Cloud Function instead.
 */

var FIRESTORE_SYNC_STATE_KEY = 'firestore_sync_state';
var FIRESTORE_SYNC_TIME_BUFFER_MS = 90000;

function getSetting_(key) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'set:' + String(key || '');
  var cached = cache.get(cacheKey);
  if (cached !== null && cached !== undefined) {
    return cached === '__empty__' ? '' : cached;
  }

  var sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEETS.SETTINGS);
  var value = '';
  if (sheet) {
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === key) {
        value = String(data[i][1] || '').trim();
        break;
      }
    }
  }

  try {
    cache.put(cacheKey, value === '' ? '__empty__' : value, 300);
  } catch (e) {}
  return value;
}

var FIRESTORE_LANGUAGE_SHEETS = {
  Questions: 'en',
  QuestionsMalayalam: 'ml'
};

var FIRESTORE_SYNC_SHEET_NAMES = ['Questions', 'QuestionsMalayalam'];

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
  return normalizeSheetDate_(value);
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

function loadFirestoreSyncState_() {
  var raw = PropertiesService.getScriptProperties().getProperty(FIRESTORE_SYNC_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveFirestoreSyncState_(state) {
  PropertiesService.getScriptProperties().setProperty(
    FIRESTORE_SYNC_STATE_KEY,
    JSON.stringify(state)
  );
}

function clearFirestoreSyncState_() {
  PropertiesService.getScriptProperties().deleteProperty(FIRESTORE_SYNC_STATE_KEY);
}

function hasPendingFirestoreSyncState_() {
  var state = loadFirestoreSyncState_();
  return !!(state && state.phase && state.phase !== 'done');
}

function firestoreSyncHasTimeRemaining_() {
  try {
    var remaining = ScriptApp.getRemainingTime();
    return remaining <= 0 || remaining > FIRESTORE_SYNC_TIME_BUFFER_MS;
  } catch (e) {
    return true;
  }
}

function createInitialFirestoreSyncState_() {
  return {
    syncBatchId: 'sync_' + Date.now(),
    syncedAt: new Date().toISOString(),
    phase: 'questions',
    sheetIndex: 0,
    rowIndex: 1,
    scheduleRowIndex: 1,
    pruneCollectionIndex: 0,
    quizMap: {},
    scheduleDays: 0,
    written: 0,
    removed: {
      questions: 0,
      answerKeys: 0,
      schedule: 0,
      quizzes: 0
    }
  };
}

function trackQuizMapEntry_(state, parsed) {
  if (!state.quizMap[parsed.quizId]) {
    state.quizMap[parsed.quizId] = {
      bookReference: parsed.bookReference,
      questionCount: {},
      syncBatchId: state.syncBatchId
    };
  }
  state.quizMap[parsed.quizId].questionCount[parsed.language] =
    (state.quizMap[parsed.quizId].questionCount[parsed.language] || 0) + 1;
  if (!state.quizMap[parsed.quizId].bookReference && parsed.bookReference) {
    state.quizMap[parsed.quizId].bookReference = parsed.bookReference;
  }
}

function flushFirestoreWriteBatch_(batch, state) {
  if (!batch.length) return;
  firestoreCommitWrites_(batch);
  state.written += batch.length;
  batch.length = 0;
}

function runFirestoreQuestionsPhase_(state) {
  var batch = [];
  var syncedAt = new Date(state.syncedAt);

  while (state.sheetIndex < FIRESTORE_SYNC_SHEET_NAMES.length) {
    var sheetName = FIRESTORE_SYNC_SHEET_NAMES[state.sheetIndex];
    var language = FIRESTORE_LANGUAGE_SHEETS[sheetName];
    var sheet = getSpreadsheet_().getSheetByName(sheetName);
    if (!sheet) {
      state.sheetIndex++;
      state.rowIndex = 1;
      continue;
    }

    var data = sheet.getDataRange().getValues();
    var col = getQuestionColumnMapForSheet_(sheet);

    while (state.rowIndex < data.length) {
      var parsed = rowToFirestoreQuestion_(data[state.rowIndex], language, state.syncBatchId, syncedAt, col);
      state.rowIndex++;

      if (!parsed) continue;

      batch.push(parsed.questionWrite);
      if (parsed.answerKeyWrite) batch.push(parsed.answerKeyWrite);
      trackQuizMapEntry_(state, parsed);

      if (batch.length >= FIRESTORE_BATCH_WRITE_SIZE) {
        flushFirestoreWriteBatch_(batch, state);
      }

      if (!firestoreSyncHasTimeRemaining_()) {
        flushFirestoreWriteBatch_(batch, state);
        saveFirestoreSyncState_(state);
        return false;
      }
    }

    state.sheetIndex++;
    state.rowIndex = 1;
  }

  flushFirestoreWriteBatch_(batch, state);
  state.phase = 'schedule';
  state.scheduleRowIndex = 1;
  saveFirestoreSyncState_(state);
  return true;
}

function runFirestoreSchedulePhase_(state) {
  var batch = [];
  var syncedAt = new Date(state.syncedAt);
  var scheduleSheet = getSheet_(CONFIG.SHEETS.SCHEDULE);
  var scheduleData = scheduleSheet.getDataRange().getValues();

  while (state.scheduleRowIndex < scheduleData.length) {
    var row = scheduleData[state.scheduleRowIndex];
    state.scheduleRowIndex++;

    var date = formatSheetDateForFirestore_(row[0]);
    var book = String(row[1] || '').trim();
    var chapter = String(row[2] || '').trim();
    var scheduleQuizId = String(row[3] || '').trim();
    if (!date || !scheduleQuizId) continue;

    state.scheduleDays++;
    var title = buildQuizTitle_(book, chapter, '');
    var quizMeta = state.quizMap[scheduleQuizId];
    if (quizMeta && quizMeta.bookReference) {
      title = buildQuizTitle_(book, chapter, quizMeta.bookReference);
    }

    batch.push(buildFirestoreUpdateWrite_('schedule', date, {
      date: date,
      quizId: scheduleQuizId,
      book: book,
      chapter: chapter,
      title: title,
      syncBatchId: state.syncBatchId,
      syncedAt: syncedAt
    }));

    if (batch.length >= FIRESTORE_BATCH_WRITE_SIZE) {
      flushFirestoreWriteBatch_(batch, state);
    }

    if (!firestoreSyncHasTimeRemaining_()) {
      flushFirestoreWriteBatch_(batch, state);
      saveFirestoreSyncState_(state);
      return false;
    }
  }

  flushFirestoreWriteBatch_(batch, state);
  state.phase = 'quizzes';
  saveFirestoreSyncState_(state);
  return true;
}

function runFirestoreQuizzesPhase_(state) {
  var batch = [];
  var syncedAt = new Date(state.syncedAt);
  var quizIds = Object.keys(state.quizMap);
  var index = state.quizIndex || 0;

  while (index < quizIds.length) {
    var quizId = quizIds[index];
    var entry = state.quizMap[quizId];
    var parsed = parseBookReference_(entry.bookReference || '');

    batch.push(buildFirestoreUpdateWrite_('quizzes', quizId, {
      quizId: quizId,
      bookReference: entry.bookReference || '',
      book: parsed.book,
      chapter: parsed.chapter,
      title: buildQuizTitle_(parsed.book, parsed.chapter, entry.bookReference || ''),
      questionCount: entry.questionCount,
      syncBatchId: state.syncBatchId,
      syncedAt: syncedAt
    }));

    index++;
    state.quizIndex = index;

    if (batch.length >= FIRESTORE_BATCH_WRITE_SIZE) {
      flushFirestoreWriteBatch_(batch, state);
    }

    if (!firestoreSyncHasTimeRemaining_()) {
      flushFirestoreWriteBatch_(batch, state);
      saveFirestoreSyncState_(state);
      return false;
    }
  }

  flushFirestoreWriteBatch_(batch, state);
  state.phase = 'meta';
  delete state.quizIndex;
  saveFirestoreSyncState_(state);
  return true;
}

function runFirestoreMetaPhase_(state) {
  var syncedAt = new Date(state.syncedAt);
  var questionsEn = 0;
  var questionsMl = 0;

  Object.keys(state.quizMap).forEach(function(quizId) {
    questionsEn += state.quizMap[quizId].questionCount.en || 0;
    questionsMl += state.quizMap[quizId].questionCount.ml || 0;
  });

  firestoreCommitWrites_([buildFirestoreUpdateWrite_('syncMeta', 'latest', {
    syncBatchId: state.syncBatchId,
    syncedAt: syncedAt,
    source: 'google-sheet-apps-script',
    questionsEn: questionsEn,
    questionsMl: questionsMl,
    scheduleDays: state.scheduleDays,
    quizCount: Object.keys(state.quizMap).length
  })]);

  state.written += 1;

  if (shouldPruneStaleFirestore_()) {
    state.phase = 'prune';
    state.pruneCollectionIndex = 0;
  } else {
    state.phase = 'done';
  }

  saveFirestoreSyncState_(state);
  return true;
}

function runFirestorePrunePhase_(state) {
  var collections = ['questions', 'answerKeys', 'schedule', 'quizzes'];

  while (state.pruneCollectionIndex < collections.length) {
    var collectionId = collections[state.pruneCollectionIndex];
    var removed = deleteStaleFirestoreDocsChunk_(collectionId, state.syncBatchId, 300);
    state.removed[collectionId] = (state.removed[collectionId] || 0) + removed;

    if (removed > 0 && !firestoreSyncHasTimeRemaining_()) {
      saveFirestoreSyncState_(state);
      return false;
    }

    if (removed === 0) {
      state.pruneCollectionIndex++;
    } else if (!firestoreSyncHasTimeRemaining_()) {
      saveFirestoreSyncState_(state);
      return false;
    }
  }

  state.phase = 'done';
  saveFirestoreSyncState_(state);
  return true;
}

function buildFirestoreSyncResult_(state, incomplete) {
  var questionsEn = 0;
  var questionsMl = 0;
  Object.keys(state.quizMap || {}).forEach(function(quizId) {
    questionsEn += state.quizMap[quizId].questionCount.en || 0;
    questionsMl += state.quizMap[quizId].questionCount.ml || 0;
  });

  return {
    syncBatchId: state.syncBatchId,
    written: state.written,
    removed: state.removed,
    quizCount: Object.keys(state.quizMap || {}).length,
    scheduleDays: state.scheduleDays || 0,
    mode: 'apps-script-direct',
    phase: state.phase,
    incomplete: incomplete === true,
    message: incomplete
      ? 'Sync paused at phase "' + state.phase + '". Run "Continue Firestore sync" to finish.'
      : ''
  };
}

function syncQuizToFirestoreDirect_() {
  var state = loadFirestoreSyncState_();
  if (!state || state.phase === 'done') {
    state = createInitialFirestoreSyncState_();
    saveFirestoreSyncState_(state);
  }

  while (state.phase !== 'done') {
    var completed = true;

    if (state.phase === 'questions') {
      completed = runFirestoreQuestionsPhase_(state);
    } else if (state.phase === 'schedule') {
      completed = runFirestoreSchedulePhase_(state);
    } else if (state.phase === 'quizzes') {
      completed = runFirestoreQuizzesPhase_(state);
    } else if (state.phase === 'meta') {
      completed = runFirestoreMetaPhase_(state);
    } else if (state.phase === 'prune') {
      completed = runFirestorePrunePhase_(state);
    } else {
      state.phase = 'done';
      saveFirestoreSyncState_(state);
    }

    state = loadFirestoreSyncState_();
    if (!completed || !state || state.phase === 'done') {
      break;
    }

    if (!firestoreSyncHasTimeRemaining_()) {
      break;
    }
  }

  state = loadFirestoreSyncState_() || state;
  var incomplete = state.phase !== 'done';

  if (!incomplete) {
    clearFirestoreSyncState_();
  }

  return buildFirestoreSyncResult_(state, incomplete);
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
    if (result.incomplete) {
      showMessage_(
        'Questions sync paused (time limit).\n\n' +
        'Phase: ' + result.phase + '\n' +
        'Written so far: ' + result.written + '\n\n' +
        'Run BBA Quiz → Continue Firestore sync to finish.'
      );
      return;
    }

    showMessage_(
      'Questions synced to Firestore (manual).\n\n' +
      'Mode: ' + (result.mode || 'cloud-function') + '\n' +
      'Quizzes: ' + result.quizCount + '\n' +
      'Schedule days: ' + result.scheduleDays + '\n' +
      'Documents written: ' + result.written + '\n' +
      (shouldPruneStaleFirestore_()
        ? 'Stale docs removed: ' + JSON.stringify(result.removed) + '\n\n'
        : 'Stale cleanup: skipped (enable Settings → firestore_sync_prune_stale | true)\n\n') +
      'Users / submissions are NOT pushed here.\n' +
      'Use "Migrate runtime data to Firestore" once, then 15-min backup Sheet standby.'
    );
  } catch (err) {
    showMessage_('Firestore sync failed:\n\n' + (err.message || err));
  }
}

function continueFirestoreSyncWithMessage() {
  if (!hasPendingFirestoreSyncState_()) {
    showMessage_('No paused sync found. Use "Sync questions to Firestore (manual)" to start.');
    return;
  }
  syncQuizToFirestoreWithMessage();
}

function resetFirestoreSyncStateWithMessage() {
  clearFirestoreSyncState_();
  showMessage_('Paused Firestore sync state cleared. You can start a fresh questions sync.');
}

/** @deprecated Replaced by installFirestoreBackupTrigger — removes old Sheet→FS auto sync. */
function installFirestoreSyncTrigger() {
  uninstallTriggersByHandler_('syncQuizToFirestoreScheduled_');
  showMessage_(
    'Sheet → Firestore auto-sync is disabled.\n\n' +
    'Questions sync is manual only.\n' +
    'Use: BBA Quiz → Install 15-min Firestore → Sheet backup\n' +
    'for Users / Submissions / Sessions standby.'
  );
}

function syncQuizToFirestoreScheduled_() {
  Logger.log('Sheet → Firestore auto-sync disabled. Questions must be synced manually.');
}
