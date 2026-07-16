/**
 * Daily quiz logic, submission, and scoring
 * Each chapter quiz can have a different number of questions (minimum 5).
 *
 * Questions sheet columns:
 * quiz_id | question_num | question | book_reference | option_a | option_b | option_c | option_d | correct_answer
 */

var QCOL = {
  QUIZ_ID: 0,
  NUM: 1,
  TEXT: 2,
  CHAPTER: 3,
  OPTION_A: 4,
  OPTION_B: 5,
  OPTION_C: 6,
  OPTION_D: 7,
  CORRECT: 8
};

function normalizeLanguage_(language) {
  var lang = String(language || CONFIG.DEFAULT_LANGUAGE || 'en').toLowerCase();
  if (CONFIG.LANGUAGES && CONFIG.LANGUAGES[lang]) {
    return lang;
  }
  return CONFIG.DEFAULT_LANGUAGE || 'en';
}

function getQuestionsSheet_(language) {
  var lang = normalizeLanguage_(language);
  var sheetName = CONFIG.LANGUAGES[lang].sheet;
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet && lang !== 'en') {
    return getQuestionsSheet_('en');
  }
  if (!sheet) {
    throw new Error('Sheet not found: ' + sheetName + '. Run setupSheets() first.');
  }
  return sheet;
}

function normalizeCorrectAnswer_(value) {
  var s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'option_a' || s === 'a') return 'A';
  if (s === 'option_b' || s === 'b') return 'B';
  if (s === 'option_c' || s === 'c') return 'C';
  if (s === 'option_d' || s === 'd') return 'D';
  return String(value).trim().toUpperCase().charAt(0);
}

/** Detect column indices from header row (handles sheets with/without book_reference). */
function getQuestionColumnMapForSheet_(sheet) {
  if (!sheet || sheet.getLastRow() < 1) return QCOL;

  var header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 9)).getValues()[0];
  var norm = function(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, '_');
  };
  var idx = {};
  for (var i = 0; i < header.length; i++) {
    var h = norm(header[i]);
    if (h) idx[h] = i;
  }

  if (idx.option_a === undefined) return QCOL;

  var correctCol = idx.correct_answer;
  if (correctCol === undefined) correctCol = idx.correct;
  if (correctCol === undefined) correctCol = idx.option_a + 4;

  return {
    QUIZ_ID: idx.quiz_id !== undefined ? idx.quiz_id : 0,
    NUM: idx.question_num !== undefined ? idx.question_num : 1,
    TEXT: idx.question !== undefined ? idx.question : 2,
    CHAPTER: idx.book_reference !== undefined ? idx.book_reference : -1,
    OPTION_A: idx.option_a,
    OPTION_B: idx.option_b,
    OPTION_C: idx.option_c,
    OPTION_D: idx.option_d,
    CORRECT: correctCol
  };
}

/** Ensure options always use A/B/C/D keys (handles Firestore map variants). */
function normalizeQuestionOptions_(options) {
  var result = { A: '', B: '', C: '', D: '' };
  if (!options) return result;

  if (typeof options === 'string') {
    try { options = JSON.parse(options); } catch (e) { return result; }
  }

  if (Object.prototype.toString.call(options) === '[object Array]') {
    result.A = String(options[0] != null ? options[0] : '');
    result.B = String(options[1] != null ? options[1] : '');
    result.C = String(options[2] != null ? options[2] : '');
    result.D = String(options[3] != null ? options[3] : '');
    return result;
  }

  var keyMap = {
    A: ['A', 'a', 'option_a', 'optionA', '0'],
    B: ['B', 'b', 'option_b', 'optionB', '1'],
    C: ['C', 'c', 'option_c', 'optionC', '2'],
    D: ['D', 'd', 'option_d', 'optionD', '3']
  };

  ['A', 'B', 'C', 'D'].forEach(function(letter) {
    var keys = keyMap[letter];
    for (var i = 0; i < keys.length; i++) {
      var val = options[keys[i]];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        result[letter] = String(val);
        break;
      }
    }
  });

  return result;
}

function parseQuestionRow_(row, includeAnswer, col) {
  col = col || QCOL;
  var question = {
    id: Number(row[col.NUM]),
    question: row[col.TEXT],
    chapter: col.CHAPTER >= 0 ? String(row[col.CHAPTER] || '').trim() : '',
    options: normalizeQuestionOptions_({
      A: row[col.OPTION_A],
      B: row[col.OPTION_B],
      C: row[col.OPTION_C],
      D: row[col.OPTION_D]
    })
  };
  if (includeAnswer) {
    question.correctAnswer = normalizeCorrectAnswer_(row[col.CORRECT]);
  }
  return question;
}

function chapterFromQuestions_(questions) {
  for (var i = 0; i < questions.length; i++) {
    if (questions[i].chapter) {
      return questions[i].chapter;
    }
  }
  return '';
}

/** Use question 1 book_reference as the canonical chapter label for a quiz. */
function primaryBookReferenceFromQuestions_(questions) {
  if (!questions || questions.length === 0) return '';
  return String(questions[0].chapter || '').trim();
}

function buildQuizTitle_(book, scheduleChapter, bookReference) {
  bookReference = String(bookReference || '').trim();
  scheduleChapter = String(scheduleChapter || '').trim();
  book = String(book || '').trim();

  if (bookReference) {
    var fromRef = parseBookReference_(bookReference);
    if (fromRef.book && fromRef.chapter) {
      return fromRef.book + ' ' + fromRef.chapter;
    }
    if (fromRef.chapter && !fromRef.book && book && /^(Chapter\s+\d+|\d+)$/i.test(fromRef.chapter)) {
      return book + ' ' + fromRef.chapter;
    }
  }

  if (book && scheduleChapter) {
    return book + ' ' + scheduleChapter;
  }
  return bookReference || book || scheduleChapter || '';
}

function useFirestoreForQuiz_() {
  var cache = CacheService.getScriptCache();
  var cachedMode = cache.get('quiz_src_mode');
  if (cachedMode === '1') return true;
  if (cachedMode === '0') return false;

  var setting = String(getSetting_('quiz_data_source') || CONFIG.QUIZ_DATA_SOURCE || 'auto').toLowerCase();
  var result = false;
  if (setting === 'sheet') {
    result = false;
  } else if (setting === 'firestore') {
    result = true;
  } else {
    try {
      getFirebaseProjectId_();
      if (getFirestoreAuthMode_() === 'service_account') {
        getFirebaseCredentials_();
      }
      result = true;
    } catch (e) {
      result = false;
    }
  }

  cache.put('quiz_src_mode', result ? '1' : '0', QUIZ_SOURCE_CACHE_SEC);
  return result;
}

function getScheduleForDateFromSheet_(today) {
  var schedule = getSheetData_(CONFIG.SHEETS.SCHEDULE);
  for (var i = 1; i < schedule.length; i++) {
    var dateStr = normalizeSheetDate_(schedule[i][0]);
    if (dateStr === today) {
      return {
        quizId: String(schedule[i][3] || schedule[i][2] || ''),
        book: String(schedule[i][1] || ''),
        chapter: String(schedule[i][2] || ''),
        title: '',
        source: 'sheet'
      };
    }
  }
  return null;
}

function getCachedScheduleEntry_(today) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('sched:' + today);
  if (!cached) return null;
  try {
    return JSON.parse(cached);
  } catch (e) {
    return null;
  }
}

function cacheScheduleEntry_(today, entry) {
  if (!entry) return;
  try {
    CacheService.getScriptCache().put('sched:' + today, JSON.stringify(entry), SCHEDULE_CACHE_TTL_SEC);
  } catch (e) {}
}

function getScheduleForDate_(today) {
  var cached = getCachedScheduleEntry_(today);
  if (cached) return cached;

  if (useFirestoreForQuiz_()) {
    try {
      var doc = getFirestoreScheduleForDate_(today);
      if (doc && doc.quizId) {
        var entry = {
          quizId: String(doc.quizId),
          book: String(doc.book || ''),
          chapter: String(doc.chapter || ''),
          title: String(doc.title || ''),
          source: 'firestore'
        };
        cacheScheduleEntry_(today, entry);
        return entry;
      }
    } catch (err) {
      Logger.log('Firestore schedule read failed, using sheet: ' + (err.message || err));
    }
  }

  var fromSheet = getScheduleForDateFromSheet_(today);
  if (fromSheet && fromSheet.quizId) {
    cacheScheduleEntry_(today, fromSheet);
  }
  return fromSheet;
}

function countQuestionsForQuiz_(quizId, language) {
  return loadQuestionsForQuiz_(quizId, language, false).length;
}

function validateQuizReady_(quizId, book, chapter, language) {
  var count = countQuestionsForQuiz_(quizId, language);
  var minRequired = CONFIG.MIN_QUESTIONS_PER_QUIZ;

  if (count < minRequired) {
    var label = (book && chapter) ? book + ' ' + chapter : quizId;
    throw new Error(
      'Today\'s quiz (' + label + ') is not ready yet. ' +
      'It needs at least ' + minRequired + ' questions but only has ' + count + '. ' +
      'Please ask an admin to add more questions in the sheet.'
    );
  }

  return count;
}

function getTodayQuiz_(user, language, requestedDate) {
  var lang = normalizeLanguage_(language);
  var today = todayDate_();
  var quizDate = resolveQuizDate_(requestedDate);

  if (useFirestoreForQuiz_()) {
    try {
      return getTodayQuizFromFirestoreFast_(user, lang, quizDate, today);
    } catch (err) {
      Logger.log('Fast Firestore quiz load failed, falling back: ' + (err.message || err));
    }
  }

  return getTodayQuizLegacy_(user, lang, quizDate, today);
}

function getTodayQuizFromFirestoreFast_(user, lang, quizDate, today) {
  var token = getFirestoreAccessToken_();
  var projectId = getFirebaseProjectId_();
  var cache = CacheService.getScriptCache();
  var email = (user.email || '').toLowerCase();

  var schedule = getCachedScheduleEntry_(quizDate);
  var submission = null;
  var subCache = cache.get(submissionLookupCacheKey_(email, quizDate));
  if (subCache === '__none__') {
    submission = false; // known miss
  } else if (subCache) {
    try { submission = JSON.parse(subCache); } catch (e) { submission = null; }
  }

  var requests = [];
  var labels = [];

  if (!schedule) {
    requests.push(buildFirestoreGetRequest_('schedule', quizDate, token, projectId));
    labels.push('schedule');
  }
  if (submission === null) {
    requests.push(buildFirestoreGetRequest_(
      'submissions',
      firestoreSubmissionDocId_(email, quizDate),
      token,
      projectId
    ));
    labels.push('submission');
  }

  if (requests.length) {
    var boot = UrlFetchApp.fetchAll(requests);
    for (var i = 0; i < labels.length; i++) {
      if (labels[i] === 'schedule') {
        var schedDoc = parseFirestoreGetResponse_(boot[i]);
        if (schedDoc && schedDoc.quizId) {
          schedule = {
            quizId: String(schedDoc.quizId),
            book: String(schedDoc.book || ''),
            chapter: String(schedDoc.chapter || ''),
            title: String(schedDoc.title || ''),
            source: 'firestore'
          };
          cacheScheduleEntry_(quizDate, schedule);
        }
      } else if (labels[i] === 'submission') {
        var subDoc = parseFirestoreGetResponse_(boot[i]);
        if (subDoc && subDoc.email) {
          var answersObj = {};
          try { answersObj = JSON.parse(subDoc.answersJson || '{}'); } catch (e) { answersObj = {}; }
          submission = {
            row: null,
            score: Number(subDoc.score) || 0,
            totalQuestions: Number(subDoc.totalQuestions) || 0,
            answers: answersObj,
            submittedAt: subDoc.submittedAt || '',
            locked: subDoc.locked !== false,
            source: 'firestore'
          };
          try {
            cache.put(submissionLookupCacheKey_(email, quizDate), JSON.stringify(submission), SUBMISSION_LOOKUP_CACHE_SEC);
          } catch (e) {}
        } else {
          submission = false;
          try {
            cache.put(submissionLookupCacheKey_(email, quizDate), '__none__', SUBMISSION_LOOKUP_CACHE_SEC);
          } catch (e) {}
        }
      }
    }
  }

  if (!schedule || !schedule.quizId) {
    var fromSheet = getScheduleForDateFromSheet_(quizDate);
    if (fromSheet && fromSheet.quizId) {
      schedule = fromSheet;
      cacheScheduleEntry_(quizDate, fromSheet);
    }
  }

  if (!schedule || !schedule.quizId) {
    return {
      date: quizDate,
      available: false,
      testDatePicker: isTestDatePickerEnabled_(),
      isTestDate: quizDate !== today,
      message: quizDate === today
        ? 'No quiz scheduled for today. Check back tomorrow!'
        : 'No quiz scheduled for ' + quizDate + '.'
    };
  }

  var completed = submission && submission.locked &&
    submission.answers && Object.keys(submission.answers).length
    ? submission
    : null;

  // Parallel: remaining submission check + questions (common warm path)
  var qCacheKey = 'fq:' + lang + ':' + schedule.quizId + ':' + (completed ? 'a' : 'q');
  var questions = null;
  var qCached = cache.get(qCacheKey);
  if (qCached) {
    try { questions = JSON.parse(qCached); } catch (e) { questions = null; }
  }

  if (!questions || submission === null) {
    var round2 = [];
    var labels2 = [];
    if (submission === null) {
      round2.push(buildFirestoreGetRequest_(
        'submissions',
        firestoreSubmissionDocId_(email, quizDate),
        token,
        projectId
      ));
      labels2.push('submission');
    }
    if (!questions) {
      round2.push(buildFirestoreQueryRequest_(
        quizQuestionsQuery_(schedule.quizId, lang),
        token,
        projectId
      ));
      labels2.push('questions');
      if (completed) {
        round2.push(buildFirestoreQueryRequest_(
          quizAnswerKeysQuery_(schedule.quizId, lang),
          token,
          projectId
        ));
        labels2.push('answers');
      }
    }
    if (round2.length) {
      var res2 = UrlFetchApp.fetchAll(round2);
      var answerMap = {};
      for (var j = 0; j < labels2.length; j++) {
        if (labels2[j] === 'submission') {
          var subDoc2 = parseFirestoreGetResponse_(res2[j]);
          if (subDoc2 && subDoc2.email) {
            var answersObj2 = {};
            try { answersObj2 = JSON.parse(subDoc2.answersJson || '{}'); } catch (e) { answersObj2 = {}; }
            submission = {
              row: null,
              score: Number(subDoc2.score) || 0,
              totalQuestions: Number(subDoc2.totalQuestions) || 0,
              answers: answersObj2,
              submittedAt: subDoc2.submittedAt || '',
              locked: subDoc2.locked !== false,
              source: 'firestore'
            };
            try {
              cache.put(submissionLookupCacheKey_(email, quizDate), JSON.stringify(submission), SUBMISSION_LOOKUP_CACHE_SEC);
            } catch (e) {}
          } else {
            submission = false;
            try {
              cache.put(submissionLookupCacheKey_(email, quizDate), '__none__', SUBMISSION_LOOKUP_CACHE_SEC);
            } catch (e) {}
          }
          completed = submission && submission.locked &&
            submission.answers && Object.keys(submission.answers).length
            ? submission
            : null;
        } else if (labels2[j] === 'questions') {
          var docs = parseFirestoreQueryResponse_(res2[j]);
          if (!docs.length && lang !== 'en') {
            docs = queryFirestoreByQuizAndLanguage_('questions', schedule.quizId, 'en');
          }
          questions = [];
          for (var q = 0; q < docs.length; q++) {
            questions.push({
              id: Number(docs[q].questionNum),
              question: docs[q].question,
              chapter: String(docs[q].bookReference || '').trim(),
              options: normalizeQuestionOptions_(docs[q].options || {})
            });
          }
          questions.sort(function(a, b) { return a.id - b.id; });
        } else if (labels2[j] === 'answers') {
          var keys = parseFirestoreQueryResponse_(res2[j]);
          for (var k = 0; k < keys.length; k++) {
            answerMap[String(keys[k].questionNum)] = normalizeCorrectAnswer_(keys[k].correctAnswer);
          }
        }
      }
      if (questions && completed && Object.keys(answerMap).length) {
        attachAnswerMapToQuestions_(questions, answerMap);
      }
      if (questions && questions.length) {
        try {
          var json = JSON.stringify(questions);
          if (json.length < 95000) {
            cache.put('fq:' + lang + ':' + schedule.quizId + ':' + (completed ? 'a' : 'q'), json, 300);
          }
        } catch (e) {}
      }
    }
  }

  if (!questions || !questions.length) {
    questions = loadQuestionsFromFirestore_(schedule.quizId, lang, !!completed);
  }
  if (!questions.length) {
    questions = loadQuestionsForQuiz_(schedule.quizId, lang, !!completed);
  }

  var questionCount = questions.length;
  var minRequired = CONFIG.MIN_QUESTIONS_PER_QUIZ;
  if (questionCount < minRequired) {
    var label = (schedule.book && schedule.chapter)
      ? schedule.book + ' ' + schedule.chapter
      : schedule.quizId;
    return {
      date: quizDate,
      available: false,
      quizId: schedule.quizId,
      book: schedule.book,
      chapter: schedule.chapter,
      language: lang,
      dataSource: schedule.source || 'firestore',
      testDatePicker: isTestDatePickerEnabled_(),
      isTestDate: quizDate !== today,
      message:
        'Today\'s quiz (' + label + ') is not ready yet. ' +
        'It needs at least ' + minRequired + ' questions but only has ' + questionCount + '. ' +
        'Please ask an admin to sync questions to Firestore or add more in the sheet.'
    };
  }

  var bookReference = primaryBookReferenceFromQuestions_(questions);
  var title = schedule.title || buildQuizTitle_(schedule.book, schedule.chapter, bookReference);
  var displayChapter = title || schedule.chapter;

  if (completed) {
    return {
      date: quizDate,
      available: true,
      quizId: schedule.quizId,
      book: schedule.book,
      chapter: displayChapter,
      title: title,
      language: lang,
      dataSource: schedule.source || 'firestore',
      testDatePicker: isTestDatePickerEnabled_(),
      isTestDate: quizDate !== today,
      questionCount: completed.totalQuestions,
      submitted: true,
      score: completed.score,
      totalQuestions: completed.totalQuestions,
      answers: completed.answers,
      questions: questions
    };
  }

  return {
    date: quizDate,
    available: true,
    quizId: schedule.quizId,
    book: schedule.book,
    chapter: displayChapter,
    title: title,
    language: lang,
    dataSource: schedule.source || 'firestore',
    testDatePicker: isTestDatePickerEnabled_(),
    isTestDate: quizDate !== today,
    questionCount: questionCount,
    submitted: false,
    questions: questions
  };
}

function getTodayQuizLegacy_(user, language, quizDate, today) {
  var scheduleEntry = getScheduleForDate_(quizDate);

  if (!scheduleEntry || !scheduleEntry.quizId) {
    return {
      date: quizDate,
      available: false,
      testDatePicker: isTestDatePickerEnabled_(),
      isTestDate: quizDate !== today,
      message: quizDate === today
        ? 'No quiz scheduled for today. Check back tomorrow!'
        : 'No quiz scheduled for ' + quizDate + '.'
    };
  }

  var quizId = scheduleEntry.quizId;
  var book = scheduleEntry.book;
  var chapter = scheduleEntry.chapter;
  var dataSource = scheduleEntry.source;

  var submission = getCompletedSubmission_(user.email, quizDate);
  var includeAnswers = !!submission;
  var questions = loadQuestionsForQuiz_(quizId, language, includeAnswers);
  var questionCount = questions.length;
  var minRequired = CONFIG.MIN_QUESTIONS_PER_QUIZ;

  if (questionCount < minRequired) {
    var label = (book && chapter) ? book + ' ' + chapter : quizId;
    return {
      date: quizDate,
      available: false,
      quizId: quizId,
      book: book,
      chapter: chapter,
      language: language,
      dataSource: dataSource,
      testDatePicker: isTestDatePickerEnabled_(),
      isTestDate: quizDate !== today,
      message:
        'Today\'s quiz (' + label + ') is not ready yet. ' +
        'It needs at least ' + minRequired + ' questions but only has ' + questionCount + '. ' +
        'Please ask an admin to sync questions to Firestore or add more in the sheet.'
    };
  }

  var bookReference = primaryBookReferenceFromQuestions_(questions);
  var title = scheduleEntry.title || buildQuizTitle_(book, chapter, bookReference);
  var displayChapter = title || chapter;

  if (submission) {
    return {
      date: quizDate,
      available: true,
      quizId: quizId,
      book: book,
      chapter: displayChapter,
      title: title,
      language: language,
      dataSource: dataSource,
      testDatePicker: isTestDatePickerEnabled_(),
      isTestDate: quizDate !== today,
      questionCount: submission.totalQuestions,
      submitted: true,
      score: submission.score,
      totalQuestions: submission.totalQuestions,
      answers: submission.answers,
      questions: questions
    };
  }

  return {
    date: quizDate,
    available: true,
    quizId: quizId,
    book: book,
    chapter: displayChapter,
    title: title,
    language: language,
    dataSource: dataSource,
    testDatePicker: isTestDatePickerEnabled_(),
    isTestDate: quizDate !== today,
    questionCount: questionCount,
    submitted: false,
    questions: questions
  };
}

function loadQuestionsForQuiz_(quizId, language, includeAnswers) {
  var lang = normalizeLanguage_(language);

  if (useFirestoreForQuiz_()) {
    try {
      var fromFirestore = loadQuestionsFromFirestore_(quizId, lang, includeAnswers);
      if (fromFirestore.length) {
        return fromFirestore;
      }
    } catch (err) {
      Logger.log('Firestore questions read failed, using sheet: ' + (err.message || err));
    }
  }

  var cache = CacheService.getScriptCache();
  var cacheKey = 'qq:' + lang + ':' + quizId + ':' + (includeAnswers ? 'a' : 'q');
  var cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  var sheetName = CONFIG.LANGUAGES[lang].sheet;
  var sheet = getSheet_(sheetName);
  var col = getQuestionColumnMapForSheet_(sheet);
  var data = getSheetData_(sheetName);
  if (!data.length && lang !== 'en') {
    sheetName = CONFIG.LANGUAGES.en.sheet;
    sheet = getSheet_(sheetName);
    col = getQuestionColumnMapForSheet_(sheet);
    data = getSheetData_(sheetName);
  }

  var questions = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][col.QUIZ_ID]) === String(quizId)) {
      if (!String(data[i][col.TEXT] || '').trim()) continue;
      questions.push(parseQuestionRow_(data[i], includeAnswers, col));
    }
  }

  questions.sort(function(a, b) { return a.id - b.id; });

  if (includeAnswers && questions.length) {
    attachCorrectAnswersToQuestions_(questions, quizId, lang);
  }

  try {
    var json = JSON.stringify(questions);
    if (json.length < 95000) {
      cache.put(cacheKey, json, 300);
    }
  } catch (e) {}

  return questions;
}

/** Read correct answers from the sheet (fallback when Firestore answerKeys are missing). */
function getCorrectAnswersFromSheet_(quizId, language) {
  var lang = normalizeLanguage_(language);
  var cache = CacheService.getScriptCache();
  var cacheKey = 'cans:' + lang + ':' + quizId;
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  var sheetName = CONFIG.LANGUAGES[lang].sheet;
  var sheet = getSheet_(sheetName);
  var col = getQuestionColumnMapForSheet_(sheet);
  var data = getSheetData_(sheetName);

  if (!data.length && lang !== 'en') {
    sheetName = CONFIG.LANGUAGES.en.sheet;
    sheet = getSheet_(sheetName);
    col = getQuestionColumnMapForSheet_(sheet);
    data = getSheetData_(sheetName);
  }

  var answers = {};
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][col.QUIZ_ID]) !== String(quizId)) continue;
    answers[String(data[i][col.NUM])] = normalizeCorrectAnswer_(data[i][col.CORRECT]);
  }

  try {
    cache.put(cacheKey, JSON.stringify(answers), SHEET_ANSWERS_CACHE_SEC);
  } catch (e) {}

  return answers;
}

function attachCorrectAnswersToQuestions_(questions, quizId, language) {
  var sheetAnswers = getCorrectAnswersFromSheet_(quizId, language);
  for (var i = 0; i < questions.length; i++) {
    var qid = String(questions[i].id);
    questions[i].correctAnswer = normalizeCorrectAnswer_(
      questions[i].correctAnswer || sheetAnswers[qid] || ''
    );
  }
  return questions;
}

function getQuestions_(quizId, language) {
  return loadQuestionsForQuiz_(quizId, language, false);
}

function getQuestionsForReview_(quizId, language) {
  return loadQuestionsForQuiz_(quizId, language, true);
}

function getSubmissionsSnapshot_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('subsnap:v1');
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  var sheet = getSheet_(CONFIG.SHEETS.SUBMISSIONS);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { rows: [] };
  }

  var numCols = Math.max(sheet.getLastColumn(), 7);
  var data = sheet.getRange(1, 1, lastRow, numCols).getValues();
  var display = sheet.getRange(1, 1, lastRow, numCols).getDisplayValues();
  var rows = [];

  for (var i = 1; i < data.length; i++) {
    rows.push({
      email: String(data[i][0] || '').trim().toLowerCase(),
      date: normalizeSheetDate_(data[i][1]) || normalizeSheetDate_(display[i][1]),
      answersJson: data[i][2],
      score: Number(data[i][3]) || 0,
      totalQuestions: Number(data[i][4]) || 0,
      submittedAt: data[i][5],
      locked: isSheetTruthy_(data[i][6]),
      row: i + 1
    });
  }

  var snapshot = { rows: rows };
  try {
    var json = JSON.stringify(snapshot);
    if (json.length < 95000) {
      cache.put('subsnap:v1', json, SUBMISSION_SNAPSHOT_CACHE_SEC);
    }
  } catch (e) {}

  return snapshot;
}

function invalidateSubmissionsSnapshot_() {
  CacheService.getScriptCache().remove('subsnap:v1');
}

function submissionLookupCacheKey_(email, date) {
  return 'sub:' + String(email || '').toLowerCase() + ':' + normalizeSheetDate_(date);
}

function invalidateSubmissionLookup_(email, date) {
  CacheService.getScriptCache().remove(submissionLookupCacheKey_(email, date));
}

function parseSubmissionRow_(row) {
  var answers = {};
  try {
    answers = JSON.parse(row.answersJson || '{}');
  } catch (err) {
    answers = {};
  }

  return {
    row: row.row,
    score: row.score,
    totalQuestions: row.totalQuestions,
    answers: answers,
    submittedAt: row.submittedAt,
    locked: row.locked
  };
}

function getSubmission_(email, date) {
  email = (email || '').toLowerCase();
  var targetDate = normalizeSheetDate_(date);
  if (!email || !targetDate) {
    return null;
  }

  var cache = CacheService.getScriptCache();
  var lookupKey = submissionLookupCacheKey_(email, targetDate);
  var cachedLookup = cache.get(lookupKey);
  if (cachedLookup === '__none__') {
    return null;
  }
  if (cachedLookup) {
    try {
      return JSON.parse(cachedLookup);
    } catch (e) {}
  }

  var fsSub = getFirestoreSubmissionByEmailDate_(email, targetDate);
  if (fsSub) {
    try {
      cache.put(lookupKey, JSON.stringify(fsSub), SUBMISSION_LOOKUP_CACHE_SEC);
    } catch (e) {}
    return fsSub;
  }

  // Firestore is primary for submissions — skip slow Sheet scan on hot path
  if (useFirestoreForRuntime_()) {
    try {
      cache.put(lookupKey, '__none__', SUBMISSION_LOOKUP_CACHE_SEC);
    } catch (e) {}
    return null;
  }

  var snapshot = getSubmissionsSnapshot_();
  var found = null;

  for (var i = 0; i < snapshot.rows.length; i++) {
    var row = snapshot.rows[i];
    if (row.email === email && row.date === targetDate) {
      found = parseSubmissionRow_(row);
    }
  }

  if (found) {
    writeFirestoreSubmission_({
      email: email,
      quizDate: targetDate,
      answers: found.answers,
      score: found.score,
      totalQuestions: found.totalQuestions,
      submittedAt: found.submittedAt,
      locked: found.locked
    });
  }

  try {
    cache.put(lookupKey, found ? JSON.stringify(found) : '__none__', SUBMISSION_LOOKUP_CACHE_SEC);
  } catch (e) {}

  return found;
}

function saveSubmissionStandbyToSheet_(email, quizDate, submissionRow, existing) {
  var subSheet = getSheet_(CONFIG.SHEETS.SUBMISSIONS);
  if (existing && existing.row) {
    subSheet.getRange(existing.row, 1, 1, 7).setValues([submissionRow]);
    return;
  }

  try {
    var snapshot = getSubmissionsSnapshot_();
    for (var i = 0; i < snapshot.rows.length; i++) {
      if (snapshot.rows[i].email === email.toLowerCase() &&
          snapshot.rows[i].date === normalizeSheetDate_(quizDate) &&
          snapshot.rows[i].row) {
        subSheet.getRange(snapshot.rows[i].row, 1, 1, 7).setValues([submissionRow]);
        return;
      }
    }
  } catch (e) {}

  subSheet.appendRow(submissionRow);
}

/** Completed quiz for display — must be locked with saved answers. */
function getCompletedSubmission_(email, date) {
  var submission = getSubmission_(email, date);
  if (!submission || !submission.locked) {
    return null;
  }
  if (!submission.answers || !Object.keys(submission.answers).length) {
    return null;
  }
  return submission;
}

function buildSubmittedQuizPayload_(quizDate, scheduleEntry, questions, submissionResult, lang) {
  var today = todayDate_();
  var book = scheduleEntry.book;
  var chapter = scheduleEntry.chapter;
  var quizId = scheduleEntry.quizId;
  var bookReference = primaryBookReferenceFromQuestions_(questions);
  var title = scheduleEntry.title || buildQuizTitle_(book, chapter, bookReference);
  var displayChapter = title || chapter;

  return {
    date: quizDate,
    available: true,
    quizId: quizId,
    book: book,
    chapter: displayChapter,
    title: title,
    language: lang,
    dataSource: scheduleEntry.source,
    testDatePicker: isTestDatePickerEnabled_(),
    isTestDate: quizDate !== today,
    questionCount: submissionResult.totalQuestions,
    submitted: true,
    score: submissionResult.score,
    totalQuestions: submissionResult.totalQuestions,
    answers: submissionResult.answers,
    questions: questions
  };
}

function getAnswerKeyMap_(quizId, language) {
  var lang = normalizeLanguage_(language);
  var cache = CacheService.getScriptCache();
  var cacheKey = 'ak:' + lang + ':' + quizId;
  var cached = cache.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {}
  }

  var answers = {};
  if (useFirestoreForQuiz_()) {
    try {
      var keys = queryFirestoreByQuizAndLanguage_('answerKeys', quizId, lang);
      if (!keys.length && lang !== 'en') {
        keys = queryFirestoreByQuizAndLanguage_('answerKeys', quizId, 'en');
      }
      for (var k = 0; k < keys.length; k++) {
        answers[String(keys[k].questionNum)] = normalizeCorrectAnswer_(keys[k].correctAnswer);
      }
    } catch (err) {
      Logger.log('Firestore answerKeys read failed: ' + (err.message || err));
    }
  }

  if (!Object.keys(answers).length) {
    answers = getCorrectAnswersFromSheet_(quizId, lang);
  }

  try {
    cache.put(cacheKey, JSON.stringify(answers), SHEET_ANSWERS_CACHE_SEC || 300);
  } catch (e) {}

  return answers;
}

function computeStreakFast_(email, quizDate, previousStreak) {
  var dayBefore = new Date(quizDate + 'T12:00:00');
  dayBefore.setDate(dayBefore.getDate() - 1);
  var prevDate = Utilities.formatDate(dayBefore, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  var prevSub = getFirestoreSubmissionByEmailDate_(email, prevDate);
  if (prevSub && prevSub.locked) {
    return (Number(previousStreak) || 0) + 1;
  }
  return 1;
}

function attachAnswerMapToQuestions_(questions, answerMap) {
  for (var i = 0; i < questions.length; i++) {
    var qid = String(questions[i].id);
    questions[i].correctAnswer = normalizeCorrectAnswer_(
      questions[i].correctAnswer || (answerMap && answerMap[qid]) || ''
    );
  }
  return questions;
}

function submitQuiz_(user, answers, language, requestedDate) {
  var lang = normalizeLanguage_(language);
  var today = todayDate_();
  var quizDate = resolveQuizDate_(requestedDate);
  var email = (user.email || '').toLowerCase();

  var scheduleEntry = getCachedScheduleEntry_(quizDate);
  var correctAnswers = null;
  var existing = null;

  // Parallel: submission lock check + answer keys (+ schedule if needed)
  if (useFirestoreForQuiz_() || useFirestoreForRuntime_()) {
    try {
      var token = getFirestoreAccessToken_();
      var projectId = getFirebaseProjectId_();
      var requests = [];
      var labels = [];

      var subCache = CacheService.getScriptCache().get(submissionLookupCacheKey_(email, quizDate));
      if (subCache === '__none__') {
        existing = null;
      } else if (subCache) {
        try { existing = JSON.parse(subCache); } catch (e) { existing = null; }
      } else {
        requests.push(buildFirestoreGetRequest_(
          'submissions',
          firestoreSubmissionDocId_(email, quizDate),
          token,
          projectId
        ));
        labels.push('submission');
      }

      if (!scheduleEntry) {
        requests.push(buildFirestoreGetRequest_('schedule', quizDate, token, projectId));
        labels.push('schedule');
      }

      var quizIdForKeys = scheduleEntry && scheduleEntry.quizId;
      var akCacheKey = quizIdForKeys ? ('ak:' + lang + ':' + quizIdForKeys) : '';
      if (quizIdForKeys) {
        var akCached = CacheService.getScriptCache().get(akCacheKey);
        if (akCached) {
          try { correctAnswers = JSON.parse(akCached); } catch (e) { correctAnswers = null; }
        }
      }

      if (quizIdForKeys && !correctAnswers) {
        requests.push(buildFirestoreQueryRequest_(quizAnswerKeysQuery_(quizIdForKeys, lang), token, projectId));
        labels.push('answers');
      }

      if (requests.length) {
        var responses = UrlFetchApp.fetchAll(requests);
        for (var ri = 0; ri < labels.length; ri++) {
          if (labels[ri] === 'submission') {
            var subDoc = parseFirestoreGetResponse_(responses[ri]);
            if (subDoc && subDoc.email) {
              var answersObj = {};
              try { answersObj = JSON.parse(subDoc.answersJson || '{}'); } catch (e) { answersObj = {}; }
              existing = {
                row: null,
                score: Number(subDoc.score) || 0,
                totalQuestions: Number(subDoc.totalQuestions) || 0,
                answers: answersObj,
                submittedAt: subDoc.submittedAt || '',
                locked: subDoc.locked !== false,
                source: 'firestore'
              };
            }
          } else if (labels[ri] === 'schedule') {
            var schedDoc = parseFirestoreGetResponse_(responses[ri]);
            if (schedDoc && schedDoc.quizId) {
              scheduleEntry = {
                quizId: String(schedDoc.quizId),
                book: String(schedDoc.book || ''),
                chapter: String(schedDoc.chapter || ''),
                title: String(schedDoc.title || ''),
                source: 'firestore'
              };
              cacheScheduleEntry_(quizDate, scheduleEntry);
            }
          } else if (labels[ri] === 'answers') {
            var keyDocs = parseFirestoreQueryResponse_(responses[ri]);
            correctAnswers = {};
            for (var k = 0; k < keyDocs.length; k++) {
              correctAnswers[String(keyDocs[k].questionNum)] =
                normalizeCorrectAnswer_(keyDocs[k].correctAnswer);
            }
            try {
              CacheService.getScriptCache().put(
                'ak:' + lang + ':' + quizIdForKeys,
                JSON.stringify(correctAnswers),
                SHEET_ANSWERS_CACHE_SEC || 300
              );
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      Logger.log('Parallel submit prefetch failed: ' + (err.message || err));
    }
  }

  if (existing && existing.locked) {
    throw new Error('You have already submitted this quiz. Answers cannot be changed.');
  }

  if (!scheduleEntry) {
    scheduleEntry = getScheduleForDate_(quizDate);
  }
  var quizId = scheduleEntry ? scheduleEntry.quizId : null;

  if (!quizId) {
    throw new Error(quizDate === today
      ? 'No quiz available for today'
      : 'No quiz available for ' + quizDate);
  }

  if (!correctAnswers || !Object.keys(correctAnswers).length) {
    correctAnswers = getAnswerKeyMap_(quizId, lang);
  }

  var totalQuestions = Object.keys(correctAnswers).length;
  if (totalQuestions < CONFIG.MIN_QUESTIONS_PER_QUIZ) {
    throw new Error(
      'Today\'s quiz is not ready yet. It needs at least ' +
      CONFIG.MIN_QUESTIONS_PER_QUIZ + ' questions but only has ' + totalQuestions + '.'
    );
  }

  var score = 0;
  var answerMap = {};
  var answeredCount = 0;

  for (var qId in answers) {
    if (answers.hasOwnProperty(qId)) {
      answeredCount++;
      var userAnswer = String(answers[qId]).toUpperCase();
      answerMap[qId] = userAnswer;
      if (correctAnswers[qId] === userAnswer) {
        score++;
      }
    }
  }

  if (answeredCount < totalQuestions) {
    throw new Error('Please answer all ' + totalQuestions + ' questions before submitting.');
  }

  var totalPoints = score * (CONFIG.POINTS_PER_CORRECT || 1);
  var isPerfect = score === totalQuestions && totalQuestions > 0;
  var submittedAt = new Date();

  var profile = null;
  try {
    profile = getUserProfileByEmail_(user.email);
  } catch (e) {
    profile = null;
  }

  var totalScore = ((profile && profile.totalScore) || 0) + totalPoints;
  var totalQuizzes = ((profile && profile.totalQuizzes) || 0) + 1;
  var perfectScores = ((profile && profile.perfectScores) || 0) + (isPerfect ? 1 : 0);
  // Avoid extra Firestore round-trip: treat each new quiz day as continuing streak if prior streak > 0
  var streak = (Number(profile && profile.streak) || 0) + 1;
  var displayName = user.displayName || (profile && profile.displayName) || '';
  var passwordHash = (profile && profile.passwordHash) || '';
  var mustChange = profile ? profile.mustChangePassword === true : false;

  try {
    firestoreCommitWrites_([
      buildFirestoreUpdateWrite_(
        'submissions',
        firestoreSubmissionDocId_(user.email, quizDate),
        {
          email: email,
          quizDate: quizDate,
          answersJson: JSON.stringify(answerMap),
          score: totalPoints,
          totalQuestions: totalQuestions,
          submittedAt: submittedAt.toISOString(),
          locked: true,
          updatedAt: submittedAt.toISOString()
        }
      ),
      buildFirestoreUpdateWrite_(
        'users',
        firestoreEmailDocId_(user.email),
        {
          email: email,
          displayName: displayName,
          totalScore: totalScore,
          totalQuizzes: totalQuizzes,
          perfectScores: perfectScores,
          streak: streak,
          mustChangePassword: mustChange,
          passwordHash: passwordHash,
          updatedAt: submittedAt.toISOString()
        }
      )
    ]);
  } catch (err) {
    throw new Error('Could not save submission. Please try again. (' + (err.message || err) + ')');
  }

  invalidateUserProfileCache_(user.email);
  invalidateSubmissionLookup_(user.email, quizDate);
  invalidateLeaderboardCache_();
  try {
    CacheService.getScriptCache().put(
      submissionLookupCacheKey_(user.email, quizDate),
      JSON.stringify({
        row: null,
        score: totalPoints,
        totalQuestions: totalQuestions,
        answers: answerMap,
        submittedAt: submittedAt.toISOString(),
        locked: true,
        source: 'firestore'
      }),
      SUBMISSION_LOOKUP_CACHE_SEC
    );
  } catch (e) {}

  var result = {
    score: totalPoints,
    correct: score,
    totalQuestions: totalQuestions,
    percentage: totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0,
    isPerfect: isPerfect,
    answers: answerMap,
    correctAnswers: correctAnswers,
    submitted: true,
    quizDate: quizDate
  };

  var book = scheduleEntry.book;
  var chapter = scheduleEntry.chapter;
  var title = scheduleEntry.title || buildQuizTitle_(book, chapter, '');
  result.quiz = {
    date: quizDate,
    available: true,
    quizId: quizId,
    book: book,
    chapter: title || chapter,
    title: title,
    language: lang,
    dataSource: scheduleEntry.source,
    testDatePicker: isTestDatePickerEnabled_(),
    isTestDate: quizDate !== today,
    questionCount: totalQuestions,
    submitted: true,
    score: totalPoints,
    totalQuestions: totalQuestions,
    answers: answerMap,
    correctAnswers: correctAnswers
  };

  return result;
}

function invalidateQuestionCacheForQuiz_(quizId) {
  if (!quizId) return;
  var cache = CacheService.getScriptCache();
  for (var lang in CONFIG.LANGUAGES) {
    if (!CONFIG.LANGUAGES.hasOwnProperty(lang)) continue;
    cache.remove('qq:' + lang + ':' + quizId + ':q');
    cache.remove('qq:' + lang + ':' + quizId + ':a');
    cache.remove('fq:' + lang + ':' + quizId + ':q');
    cache.remove('fq:' + lang + ':' + quizId + ':a');
  }
}

function getCorrectAnswers_(quizId, language) {
  var questions = loadQuestionsForQuiz_(quizId, language, true);
  var answers = {};

  for (var i = 0; i < questions.length; i++) {
    answers[String(questions[i].id)] = questions[i].correctAnswer;
  }
  return answers;
}

function updateUserStats_(user, points, isPerfect, today, streakSnapshot) {
  var email = (user.email || '').toLowerCase();
  var profile = null;
  try {
    profile = getUserProfileByEmail_(email);
  } catch (e) {
    profile = null;
  }

  var totalScore = ((profile && profile.totalScore) || 0) + points;
  var totalQuizzes = ((profile && profile.totalQuizzes) || 0) + 1;
  var perfectScores = ((profile && profile.perfectScores) || 0) + (isPerfect ? 1 : 0);
  var streak = calculateStreak_(email, today);
  var passwordHash = (profile && profile.passwordHash) || '';
  var displayName = user.displayName || (profile && profile.displayName) || '';
  var mustChange = profile ? profile.mustChangePassword === true : false;

  writeFirestoreUserProfile_({
    email: email,
    displayName: displayName,
    totalScore: totalScore,
    totalQuizzes: totalQuizzes,
    perfectScores: perfectScores,
    streak: streak,
    mustChangePassword: mustChange,
    passwordHash: passwordHash
  });
  invalidateUserProfileCache_(email);

  try {
    var sheet = getSheet_(CONFIG.SHEETS.USERS);
    var data = getSheetData_(CONFIG.SHEETS.USERS);
    for (var i = 1; i < data.length; i++) {
      if ((data[i][0] || '').toLowerCase() === email) {
        sheet.getRange(i + 1, 7, 1, 4).setValues([[
          totalScore,
          totalQuizzes,
          perfectScores,
          streak
        ]]);
        invalidateSheetCache_(CONFIG.SHEETS.USERS);
        break;
      }
    }
  } catch (err) {
    Logger.log('Sheet user stats standby write failed: ' + (err.message || err));
  }
}

function calculateStreakFromDates_(email, today, dates) {
  dates = dates || [];
  dates.sort().reverse();
  var uniqueDates = [];
  for (var j = 0; j < dates.length; j++) {
    if (dates[j] && uniqueDates.indexOf(dates[j]) === -1) {
      uniqueDates.push(dates[j]);
    }
  }

  var streak = 0;
  var checkDate = new Date(today + 'T12:00:00');

  for (var k = 0; k < uniqueDates.length; k++) {
    var expected = Utilities.formatDate(checkDate, CONFIG.TIMEZONE, 'yyyy-MM-dd');
    if (uniqueDates[k] === expected) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else if (k === 0 && uniqueDates[k] !== expected) {
      checkDate.setDate(checkDate.getDate() - 1);
      expected = Utilities.formatDate(checkDate, CONFIG.TIMEZONE, 'yyyy-MM-dd');
      if (uniqueDates[k] === expected) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return streak;
}

function calculateStreakFromSnapshot_(email, today, snapshot) {
  snapshot = snapshot || getSubmissionsSnapshot_();
  var dates = [];
  for (var i = 0; i < snapshot.rows.length; i++) {
    var row = snapshot.rows[i];
    if (row.email === email.toLowerCase() && row.date) {
      dates.push(row.date);
    }
  }
  return calculateStreakFromDates_(email, today, dates);
}

function calculateStreak_(email, today) {
  var fsDates = listFirestoreSubmissionDatesForEmail_(email);
  if (fsDates) {
    return calculateStreakFromDates_(email, today, fsDates);
  }
  return calculateStreakFromSnapshot_(email, today, null);
}
