/**
 * Custom quizzes (multi book/chapter, date window, fixed question list).
 * Separate from daily quiz: own collection + submissions; does not affect streak/All Time.
 *
 * Settings:
 *   custom_quizzes_enabled     true|false  (show on main site when true; default false)
 *   custom_quiz_admin_emails   comma-separated emails allowed to manage quizzes
 */

function isCustomQuizzesEnabled_() {
  var fromSettings = String(getSetting_('custom_quizzes_enabled') || '').toLowerCase();
  if (fromSettings === 'true' || fromSettings === '1' || fromSettings === 'yes') {
    return true;
  }
  if (fromSettings === 'false' || fromSettings === '0' || fromSettings === 'no') {
    return false;
  }
  return CONFIG.CUSTOM_QUIZZES_ENABLED === true;
}

function getCustomQuizAdminEmails_() {
  var raw = String(getSetting_('custom_quiz_admin_emails') || '').trim();
  if (!raw) return [];
  return raw.split(/[,;\s]+/).map(function(e) {
    return String(e || '').toLowerCase().trim();
  }).filter(Boolean);
}

function isCustomQuizAdmin_(user) {
  var email = String((user && user.email) || '').toLowerCase().trim();
  if (!email) return false;
  var admins = getCustomQuizAdminEmails_();
  for (var i = 0; i < admins.length; i++) {
    if (admins[i] === email) return true;
  }
  return false;
}

function requireCustomQuizAdmin_(user) {
  if (!isCustomQuizAdmin_(user)) {
    throw new Error('Custom quiz admin access required. Add your email to Settings → custom_quiz_admin_emails.');
  }
}

function customQuizDocId_(id) {
  return String(id || '').trim().replace(/[^a-zA-Z0-9_\-]/g, '_').substring(0, 700);
}

function customSubmissionDocId_(email, customQuizId) {
  return firestoreEmailDocId_(email) + '_cq_' + customQuizDocId_(customQuizId);
}

function customShareUrl_(customQuizId) {
  var base = String(getQuizPublicUrl_() || '').replace(/\/+$/, '');
  return base + '/custom.html?q=' + encodeURIComponent(customQuizId);
}

function dublinNowYmdHm_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm');
}

function dublinNowIsoLike_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss");
}

/** Compare Dublin-local wall times as yyyy-MM-dd or yyyy-MM-ddTHH:mm. */
function normalizeWindowInstant_(value, endOfDay) {
  var s = String(value || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return s + (endOfDay ? 'T23:59:59' : 'T00:00:00');
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/.test(s)) {
    return s.replace(' ', 'T') + ':00';
  }
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) {
    return s.replace(' ', 'T').substring(0, 19);
  }
  return s;
}

function getCustomQuizWindowStatus_(quiz) {
  var now = dublinNowIsoLike_();
  var opens = normalizeWindowInstant_(quiz.opensAt, false);
  var closes = normalizeWindowInstant_(quiz.closesAt, true);
  if (quiz.status === 'draft') return 'draft';
  if (quiz.status === 'archived') return 'archived';
  if (opens && now < opens) return 'scheduled';
  if (closes && now > closes) return 'closed';
  if (quiz.status === 'published' || quiz.status === 'open') return 'open';
  return String(quiz.status || 'draft');
}

function encodeQuestionRefKey_(quizId, questionNum) {
  return String(quizId) + '#' + String(questionNum);
}

function decodeQuestionRefKey_(key) {
  var parts = String(key || '').split('#');
  if (parts.length < 2) return null;
  return { quizId: parts[0], questionNum: Number(parts[1]) || 0 };
}

function countQuestionsByQuizIdFromSheet_(language) {
  var lang = normalizeLanguage_(language);
  var sheetName = CONFIG.LANGUAGES[lang] && CONFIG.LANGUAGES[lang].sheet;
  if (!sheetName) return {};
  var sheet = getSheet_(sheetName);
  var col = getQuestionColumnMapForSheet_(sheet);
  var data = getSheetData_(sheetName);
  var counts = {};
  for (var i = 1; i < data.length; i++) {
    if (!String(data[i][col.TEXT] || '').trim()) continue;
    var quizId = String(data[i][col.QUIZ_ID] || '').trim();
    if (!quizId) continue;
    counts[quizId] = (counts[quizId] || 0) + 1;
  }
  return counts;
}

/** Per-quiz bilingual counts: only questions that exist in both EN and ML (by question number). */
function bilingualQuestionCountsByQuizId_() {
  var enIds = {};
  var mlIds = {};

  function collectIds_(language, dest) {
    var lang = normalizeLanguage_(language);
    var sheetName = CONFIG.LANGUAGES[lang] && CONFIG.LANGUAGES[lang].sheet;
    if (!sheetName) return;
    var sheet = getSheet_(sheetName);
    var col = getQuestionColumnMapForSheet_(sheet);
    var data = getSheetData_(sheetName);
    for (var i = 1; i < data.length; i++) {
      if (!String(data[i][col.TEXT] || '').trim()) continue;
      var quizId = String(data[i][col.QUIZ_ID] || '').trim();
      var qNum = String(data[i][col.NUM] || '').trim();
      if (!quizId || !qNum) continue;
      if (!dest[quizId]) dest[quizId] = {};
      dest[quizId][qNum] = true;
    }
  }

  collectIds_('en', enIds);
  collectIds_('ml', mlIds);

  var counts = {};
  var quizIds = Object.keys(enIds);
  for (var i = 0; i < quizIds.length; i++) {
    var qid = quizIds[i];
    var enMap = enIds[qid] || {};
    var mlMap = mlIds[qid] || {};
    var n = 0;
    var nums = Object.keys(enMap);
    for (var j = 0; j < nums.length; j++) {
      if (mlMap[nums[j]]) n++;
    }
    if (n > 0) counts[qid] = n;
  }
  return counts;
}

function listChapterCatalog_(language) {
  // language kept for API compatibility; catalog is always bilingual (EN ∩ ML).
  var byQuiz = {};

  var schedule = getSheetData_(CONFIG.SHEETS.SCHEDULE);
  for (var i = 1; i < schedule.length; i++) {
    var quizId = String(schedule[i][3] || schedule[i][2] || '').trim();
    if (!quizId) continue;
    var book = String(schedule[i][1] || '').trim();
    var chapter = String(schedule[i][2] || '').trim();
    byQuiz[quizId] = {
      quizId: quizId,
      book: book,
      chapter: chapter,
      label: buildQuizTitle_(book, chapter, '')
    };
  }

  if (useFirestoreForQuiz_()) {
    try {
      var docs = listFirestoreCollection_('schedule');
      for (var d = 0; d < docs.length; d++) {
        var s = decodeFirestoreDocument_(docs[d]);
        var qid = String(s.quizId || '').trim();
        if (!qid) continue;
        byQuiz[qid] = {
          quizId: qid,
          book: String(s.book || ''),
          chapter: String(s.chapter || ''),
          label: String(s.title || buildQuizTitle_(s.book, s.chapter, ''))
        };
      }
    } catch (err) {
      Logger.log('Custom catalog schedule FS failed: ' + (err.message || err));
    }
  }

  var counts = bilingualQuestionCountsByQuizId_();

  if (useFirestoreForQuiz_()) {
    try {
      var quizDocs = listFirestoreCollection_('quizzes');
      for (var q = 0; q < quizDocs.length; q++) {
        var meta = decodeFirestoreDocument_(quizDocs[q]);
        var metaId = String(meta.quizId || '').trim();
        if (!metaId) continue;
        if (!byQuiz[metaId] && (meta.book || meta.chapter || meta.title)) {
          byQuiz[metaId] = {
            quizId: metaId,
            book: String(meta.book || ''),
            chapter: String(meta.chapter || ''),
            label: String(meta.title || buildQuizTitle_(meta.book, meta.chapter, meta.bookReference || ''))
          };
        }
      }
    } catch (err2) {
      Logger.log('Custom catalog quizzes FS failed: ' + (err2.message || err2));
    }
  }

  var catalog = [];
  var ids = Object.keys(byQuiz);
  for (var k = 0; k < ids.length; k++) {
    var entry = byQuiz[ids[k]];
    entry.questionCount = Number(counts[entry.quizId]) || 0;
    entry.languages = ['en', 'ml'];
    entry.language = 'both';
    if (entry.questionCount > 0) {
      catalog.push(entry);
    }
  }

  catalog.sort(function(a, b) {
    var bookCmp = String(a.book).localeCompare(String(b.book));
    if (bookCmp !== 0) return bookCmp;
    return compareQuizIds_(a.quizId, b.quizId);
  });
  return catalog;
}

/**
 * Pool of questions available in BOTH English and Malayalam (same quizId + question number).
 */
function buildQuestionPool_(scopes, language) {
  var pool = [];
  var seen = {};

  for (var i = 0; i < scopes.length; i++) {
    var scope = scopes[i] || {};
    var quizId = String(scope.quizId || '').trim();
    if (!quizId) continue;
    var enQuestions = loadQuestionsForQuiz_(quizId, 'en', false);
    var mlMap = {};
    var mlQuestions = loadQuestionsForQuiz_(quizId, 'ml', false);
    for (var m = 0; m < mlQuestions.length; m++) {
      mlMap[String(mlQuestions[m].id)] = true;
    }
    for (var q = 0; q < enQuestions.length; q++) {
      var qNum = enQuestions[q].id;
      if (!mlMap[String(qNum)]) continue;
      var key = encodeQuestionRefKey_(quizId, qNum);
      if (seen[key]) continue;
      seen[key] = true;
      pool.push({
        quizId: quizId,
        questionNum: Number(qNum),
        chapter: String(enQuestions[q].chapter || scope.label || scope.chapter || ''),
        book: String(scope.book || ''),
        key: key
      });
    }
  }
  return pool;
}

function shufflePickQuestionRefs_(pool, count) {
  var arr = pool.slice();
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, count).map(function(item, idx) {
    return {
      displayId: idx + 1,
      quizId: item.quizId,
      questionNum: item.questionNum,
      chapter: item.chapter,
      book: item.book,
      key: item.key
    };
  });
}

function loadCustomQuizQuestions_(refs, language, includeAnswers) {
  var lang = normalizeLanguage_(language);
  var cacheByQuiz = {};
  var out = [];

  for (var i = 0; i < refs.length; i++) {
    var ref = refs[i];
    var quizId = String(ref.quizId || '');
    if (!cacheByQuiz[quizId]) {
      cacheByQuiz[quizId] = {};
      var loaded = loadQuestionsForQuiz_(quizId, lang, !!includeAnswers);
      for (var q = 0; q < loaded.length; q++) {
        cacheByQuiz[quizId][String(loaded[q].id)] = loaded[q];
      }
    }
    var src = cacheByQuiz[quizId][String(ref.questionNum)];
    if (!src) {
      throw new Error('Missing question ' + ref.questionNum + ' for ' + quizId);
    }
    var displayId = Number(ref.displayId) || (i + 1);
    var row = {
      id: displayId,
      question: src.question,
      chapter: src.chapter || ref.chapter || '',
      options: src.options,
      quizId: quizId,
      sourceQuestionNum: Number(ref.questionNum)
    };
    if (includeAnswers) {
      row.correctAnswer = normalizeCorrectAnswer_(src.correctAnswer || '');
    }
    out.push(row);
  }
  return out;
}

function newCustomQuizId_() {
  var stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyyMMdd-HHmmss');
  var rand = Utilities.getUuid().replace(/-/g, '').substring(0, 6);
  return 'cq_' + stamp + '_' + rand;
}

function sanitizeScopes_(scopes) {
  if (typeof scopes === 'string') {
    try {
      scopes = JSON.parse(scopes);
    } catch (e) {
      scopes = [];
    }
  }
  if (!scopes || !scopes.length) {
    throw new Error('Select at least one book/chapter.');
  }
  var out = [];
  for (var i = 0; i < scopes.length; i++) {
    var s = scopes[i] || {};
    var quizId = String(s.quizId || '').trim();
    if (!quizId) continue;
    out.push({
      quizId: quizId,
      book: String(s.book || '').trim(),
      chapter: String(s.chapter || '').trim(),
      label: String(s.label || buildQuizTitle_(s.book, s.chapter, '')).trim()
    });
  }
  if (!out.length) {
    throw new Error('Select at least one book/chapter.');
  }
  return out;
}

function publicCustomQuizSummary_(doc) {
  var windowStatus = getCustomQuizWindowStatus_(doc);
  return {
    id: doc.id,
    title: doc.title,
    scopes: doc.scopes || [],
    questionCount: Number(doc.questionCount) || (doc.questionRefs ? doc.questionRefs.length : 0),
    opensAt: doc.opensAt,
    closesAt: doc.closesAt,
    status: doc.status,
    windowStatus: windowStatus,
    language: 'both',
    languages: ['en', 'ml'],
    shareUrl: customShareUrl_(doc.id),
    createdAt: doc.createdAt || '',
    publishedAt: doc.publishedAt || ''
  };
}

function writeCustomQuizDoc_(doc) {
  var id = customQuizDocId_(doc.id);
  firestoreCommitWrites_([buildFirestoreUpdateWrite_('customQuizzes', id, {
    id: id,
    title: String(doc.title || ''),
    scopes: doc.scopes || [],
    questionCount: Number(doc.questionCount) || 0,
    questionRefs: doc.questionRefs || [],
    opensAt: String(doc.opensAt || ''),
    closesAt: String(doc.closesAt || ''),
    status: String(doc.status || 'draft'),
    language: 'both',
    languages: ['en', 'ml'],
    createdBy: String(doc.createdBy || ''),
    createdAt: String(doc.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString(),
    publishedAt: String(doc.publishedAt || ''),
    resultsEmailSentAt: String(doc.resultsEmailSentAt || '')
  })]);
  return id;
}

function getCustomQuizDoc_(id) {
  id = customQuizDocId_(id);
  if (!id) return null;
  var doc = getFirestoreDocument_('customQuizzes', id);
  if (!doc || !doc.id) return null;
  return doc;
}

function listCustomQuizDocs_() {
  var docs = listFirestoreCollection_('customQuizzes');
  var out = [];
  for (var i = 0; i < docs.length; i++) {
    var d = decodeFirestoreDocument_(docs[i]);
    if (d && d.id) out.push(d);
  }
  out.sort(function(a, b) {
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  return out;
}

function getCustomSubmission_(email, customQuizId) {
  email = String(email || '').toLowerCase().trim();
  customQuizId = customQuizDocId_(customQuizId);
  if (!email || !customQuizId) return null;
  try {
    var doc = getFirestoreDocument_('customSubmissions', customSubmissionDocId_(email, customQuizId));
    if (!doc || !doc.email) return null;
    var answers = {};
    try {
      answers = JSON.parse(doc.answersJson || '{}');
    } catch (e) {
      answers = {};
    }
    return {
      email: email,
      customQuizId: customQuizId,
      score: Number(doc.score) || 0,
      totalQuestions: Number(doc.totalQuestions) || 0,
      answers: answers,
      submittedAt: doc.submittedAt || '',
      locked: doc.locked !== false
    };
  } catch (err) {
    Logger.log('Custom submission read failed: ' + (err.message || err));
    return null;
  }
}

function createCustomQuizDraft_(user, payload) {
  requireCustomQuizAdmin_(user);
  payload = payload || {};
  var scopes = sanitizeScopes_(payload.scopes);
  var questionCount = Number(payload.questionCount) || 0;
  if (questionCount < 1) {
    throw new Error('Question count must be at least 1.');
  }
  var opensAt = String(payload.opensAt || '').trim();
  var closesAt = String(payload.closesAt || '').trim();
  if (!opensAt || !closesAt) {
    throw new Error('Open and close dates are required.');
  }
  if (normalizeWindowInstant_(closesAt, true) < normalizeWindowInstant_(opensAt, false)) {
    throw new Error('Close date must be on or after the open date.');
  }

  var previewLang = normalizeLanguage_(payload.previewLanguage || payload.language || 'en');
  var pool = buildQuestionPool_(scopes);
  if (pool.length < questionCount) {
    throw new Error(
      'Only ' + pool.length +
      ' bilingual questions (EN+ML) across the selected chapters. Reduce the count or sync both language sheets.'
    );
  }

  var refs = shufflePickQuestionRefs_(pool, questionCount);
  var id = newCustomQuizId_();
  var title = String(payload.title || '').trim();
  if (!title) {
    title = scopes.map(function(s) { return s.label || s.quizId; }).slice(0, 3).join(', ');
    if (scopes.length > 3) title += ' +' + (scopes.length - 3);
  }

  var doc = {
    id: id,
    title: title,
    scopes: scopes,
    questionCount: questionCount,
    questionRefs: refs,
    opensAt: opensAt,
    closesAt: closesAt,
    status: 'draft',
    language: 'both',
    languages: ['en', 'ml'],
    createdBy: String(user.email || '').toLowerCase(),
    createdAt: new Date().toISOString(),
    publishedAt: ''
  };
  writeCustomQuizDoc_(doc);

  var preview = loadCustomQuizQuestions_(refs, previewLang, true);
  return {
    quiz: publicCustomQuizSummary_(doc),
    questions: preview,
    admin: true,
    previewLanguage: previewLang
  };
}

function shuffleCustomQuizQuestions_(user, customQuizId, language) {
  requireCustomQuizAdmin_(user);
  var doc = getCustomQuizDoc_(customQuizId);
  if (!doc) throw new Error('Custom quiz not found.');
  if (doc.status !== 'draft') {
    throw new Error('Only draft quizzes can be reshuffled. Create a new quiz or keep the current list.');
  }

  var pool = buildQuestionPool_(doc.scopes || []);
  var count = Number(doc.questionCount) || 0;
  if (pool.length < count) {
    throw new Error('Not enough bilingual questions left in the selected chapters.');
  }
  doc.questionRefs = shufflePickQuestionRefs_(pool, count);
  doc.language = 'both';
  doc.languages = ['en', 'ml'];
  writeCustomQuizDoc_(doc);
  var previewLang = normalizeLanguage_(language || 'en');
  return {
    quiz: publicCustomQuizSummary_(doc),
    questions: loadCustomQuizQuestions_(doc.questionRefs, previewLang, true),
    admin: true,
    previewLanguage: previewLang
  };
}

function publishCustomQuiz_(user, customQuizId) {
  requireCustomQuizAdmin_(user);
  var doc = getCustomQuizDoc_(customQuizId);
  if (!doc) throw new Error('Custom quiz not found.');
  if (!doc.questionRefs || !doc.questionRefs.length) {
    throw new Error('Add and verify questions before publishing.');
  }
  doc.status = 'published';
  doc.publishedAt = new Date().toISOString();
  writeCustomQuizDoc_(doc);
  return {
    quiz: publicCustomQuizSummary_(doc),
    shareUrl: customShareUrl_(doc.id)
  };
}

function listCustomQuizzesForUser_(user) {
  var admin = isCustomQuizAdmin_(user);
  var docs = listCustomQuizDocs_();
  var out = [];
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i];
    var windowStatus = getCustomQuizWindowStatus_(d);
    if (admin) {
      out.push(publicCustomQuizSummary_(d));
      continue;
    }
    if (!isCustomQuizzesEnabled_()) continue;
    if (d.status !== 'published' && d.status !== 'open') continue;
    if (windowStatus === 'draft' || windowStatus === 'archived') continue;
    out.push(publicCustomQuizSummary_(d));
  }
  return { quizzes: out, admin: admin, enabled: isCustomQuizzesEnabled_() };
}

function getCustomQuizForUser_(user, customQuizId, language) {
  var doc = getCustomQuizDoc_(customQuizId);
  if (!doc) throw new Error('Custom quiz not found.');

  var admin = isCustomQuizAdmin_(user);
  var windowStatus = getCustomQuizWindowStatus_(doc);
  if (!admin) {
    if (doc.status !== 'published' && doc.status !== 'open') {
      throw new Error('This custom quiz is not available yet.');
    }
  }

  var submission = getCustomSubmission_(user.email, doc.id);
  var completed = !!(submission && submission.locked);
  var canTake = windowStatus === 'open' && !completed;
  var includeAnswers = completed || (admin && windowStatus !== 'open');

  // Non-admins cannot peek answers before submitting
  if (!admin && !completed) {
    includeAnswers = false;
  }

  var lang = normalizeLanguage_(language || 'en');
  var questions = loadCustomQuizQuestions_(doc.questionRefs || [], lang, includeAnswers);

  var payload = {
    id: doc.id,
    title: doc.title,
    scopes: doc.scopes || [],
    opensAt: doc.opensAt,
    closesAt: doc.closesAt,
    status: doc.status,
    windowStatus: windowStatus,
    language: lang,
    languages: ['en', 'ml'],
    questionCount: questions.length,
    shareUrl: customShareUrl_(doc.id),
    submitted: completed,
    canTake: canTake,
    questions: questions
  };

  if (completed && submission) {
    payload.score = submission.score;
    payload.totalQuestions = submission.totalQuestions;
    payload.answers = submission.answers;
    payload.submittedAt = submission.submittedAt;
    if (includeAnswers) {
      var correctAnswers = {};
      for (var i = 0; i < questions.length; i++) {
        correctAnswers[String(questions[i].id)] = questions[i].correctAnswer;
      }
      payload.correctAnswers = correctAnswers;
    }
  }

  if (admin) {
    payload.admin = true;
  }

  return payload;
}

function submitCustomQuiz_(user, customQuizId, answers, language) {
  var doc = getCustomQuizDoc_(customQuizId);
  if (!doc) throw new Error('Custom quiz not found.');
  if (doc.status !== 'published' && doc.status !== 'open') {
    throw new Error('This custom quiz is not open for submissions.');
  }

  var windowStatus = getCustomQuizWindowStatus_(doc);
  if (windowStatus === 'scheduled') {
    throw new Error('This custom quiz has not opened yet.');
  }
  if (windowStatus === 'closed') {
    throw new Error('This custom quiz is closed.');
  }

  var existing = getCustomSubmission_(user.email, doc.id);
  if (existing && existing.locked) {
    throw new Error('You already submitted this quiz. Only one attempt is allowed.');
  }

  if (typeof answers === 'string') {
    try {
      answers = JSON.parse(answers);
    } catch (e) {
      answers = {};
    }
  }
  answers = answers || {};

  var lang = normalizeLanguage_(language || 'en');
  var questions = loadCustomQuizQuestions_(doc.questionRefs || [], lang, true);
  var totalQuestions = questions.length;
  var score = 0;
  var answeredCount = 0;
  var answerMap = {};
  var correctAnswers = {};

  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    var qid = String(q.id);
    var given = normalizeCorrectAnswer_(answers[qid] || answers[q.id] || '');
    answerMap[qid] = given;
    correctAnswers[qid] = normalizeCorrectAnswer_(q.correctAnswer || '');
    if (given) answeredCount++;
    if (given && correctAnswers[qid] && given === correctAnswers[qid]) {
      score++;
    }
  }

  if (answeredCount < totalQuestions) {
    throw new Error('Please answer all ' + totalQuestions + ' questions before submitting.');
  }

  var totalPoints = score * (CONFIG.POINTS_PER_CORRECT || 1);
  var submittedAt = new Date();
  var email = String(user.email || '').toLowerCase().trim();

  firestoreCommitWrites_([buildFirestoreUpdateWrite_(
    'customSubmissions',
    customSubmissionDocId_(email, doc.id),
    {
      email: email,
      customQuizId: doc.id,
      answersJson: JSON.stringify(answerMap),
      score: totalPoints,
      totalQuestions: totalQuestions,
      submittedAt: submittedAt.toISOString(),
      locked: true,
      updatedAt: submittedAt.toISOString()
    }
  )]);

  return {
    score: totalPoints,
    correct: score,
    totalQuestions: totalQuestions,
    percentage: totalQuestions ? Math.round((score / totalQuestions) * 100) : 0,
    isPerfect: score === totalQuestions && totalQuestions > 0,
    answers: answerMap,
    correctAnswers: correctAnswers,
    questions: questions,
    submittedAt: submittedAt.toISOString()
  };
}

function buildCustomQuizLeaderboard_(customQuizId) {
  customQuizId = customQuizDocId_(customQuizId);
  var subDocs = listFirestoreCollection_('customSubmissions');
  var scores = {};
  for (var i = 0; i < subDocs.length; i++) {
    var s = decodeFirestoreDocument_(subDocs[i]);
    if (String(s.customQuizId || '') !== String(customQuizId)) continue;
    if (s.locked === false) continue;
    var email = String(s.email || '').toLowerCase().trim();
    if (!email) continue;
    scores[email] = {
      email: email,
      score: Number(s.score) || 0,
      totalQuestions: Number(s.totalQuestions) || 0
    };
  }

  var names = {};
  try {
    var users = listFirestoreCollection_('users');
    for (var u = 0; u < users.length; u++) {
      var userDoc = decodeFirestoreDocument_(users[u]);
      if (userDoc.email) {
        names[String(userDoc.email).toLowerCase()] = userDoc.displayName || userDoc.email;
      }
    }
  } catch (err) {
    Logger.log('Custom leaderboard names failed: ' + (err.message || err));
  }

  var leaderboard = [];
  for (var key in scores) {
    if (!scores.hasOwnProperty(key)) continue;
    leaderboard.push({
      email: key,
      displayName: names[key] || key,
      score: scores[key].score,
      totalQuestions: scores[key].totalQuestions,
      quizzes: 1
    });
  }
  leaderboard.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.displayName).localeCompare(String(b.displayName));
  });
  return assignLeaderboardRanks_(leaderboard);
}

/** Emails of users who locked a submission for this custom quiz. */
function listCustomQuizParticipantEmails_(customQuizId) {
  customQuizId = customQuizDocId_(customQuizId);
  var subDocs = listFirestoreCollection_('customSubmissions');
  var emails = [];
  var seen = {};
  for (var i = 0; i < subDocs.length; i++) {
    var s = decodeFirestoreDocument_(subDocs[i]);
    if (String(s.customQuizId || '') !== String(customQuizId)) continue;
    if (s.locked === false) continue;
    var email = String(s.email || '').toLowerCase().trim();
    if (!email || seen[email]) continue;
    seen[email] = true;
    emails.push(email);
  }
  emails.sort();
  return emails;
}

/**
 * Recipients for custom-quiz results: participants only (never all registered users).
 * In email_broadcast_mode=test, only the test recipient — and only if they participated
 * (unless forceTestRecipient is true for menu testing).
 */
function listCustomQuizResultRecipients_(customQuizId, options) {
  options = options || {};
  var participants = listCustomQuizParticipantEmails_(customQuizId);
  if (options.forceTestRecipient) {
    return [getEmailTestRecipient_()];
  }
  if (getEmailBroadcastMode_() === 'test') {
    var testEmail = getEmailTestRecipient_();
    for (var i = 0; i < participants.length; i++) {
      if (participants[i] === testEmail) return [testEmail];
    }
    return [];
  }
  return participants;
}

function getCustomQuizResults_(user, customQuizId) {
  var doc = getCustomQuizDoc_(customQuizId);
  if (!doc) throw new Error('Custom quiz not found.');

  var admin = isCustomQuizAdmin_(user);
  var windowStatus = getCustomQuizWindowStatus_(doc);
  var mine = getCustomSubmission_(user.email, doc.id);

  if (!admin && windowStatus !== 'closed' && !(mine && mine.locked)) {
    throw new Error('Results are available after you submit, or when the quiz closes.');
  }

  var leaderboard = [];
  if (admin || windowStatus === 'closed') {
    leaderboard = buildCustomQuizLeaderboard_(doc.id);
  }

  return {
    quiz: publicCustomQuizSummary_(doc),
    mine: mine ? {
      score: mine.score,
      totalQuestions: mine.totalQuestions,
      submittedAt: mine.submittedAt
    } : null,
    leaderboard: leaderboard,
    windowStatus: windowStatus,
    admin: admin
  };
}

/** Closed published quizzes that have not had results email sent yet. */
function listCustomQuizzesDueForResultsEmail_() {
  var docs = listCustomQuizDocs_();
  var due = [];
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i];
    if (d.status !== 'published' && d.status !== 'open') continue;
    if (d.resultsEmailSentAt) continue;
    if (getCustomQuizWindowStatus_(d) !== 'closed') continue;
    due.push(d);
  }
  return due;
}

function markCustomQuizResultsEmailSent_(doc) {
  doc.resultsEmailSentAt = new Date().toISOString();
  writeCustomQuizDoc_(doc);
}
