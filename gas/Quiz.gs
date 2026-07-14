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
  var setting = String(getSetting_('quiz_data_source') || CONFIG.QUIZ_DATA_SOURCE || 'auto').toLowerCase();
  if (setting === 'sheet') return false;
  if (setting === 'firestore') return true;

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

function getScheduleForDate_(today) {
  if (useFirestoreForQuiz_()) {
    try {
      var doc = getFirestoreScheduleForDate_(today);
      if (doc && doc.quizId) {
        return {
          quizId: String(doc.quizId),
          book: String(doc.book || ''),
          chapter: String(doc.chapter || ''),
          title: String(doc.title || ''),
          source: 'firestore'
        };
      }
    } catch (err) {
      Logger.log('Firestore schedule read failed, using sheet: ' + (err.message || err));
    }
  }

  var schedule = getSheetData_(CONFIG.SHEETS.SCHEDULE);
  for (var i = 1; i < schedule.length; i++) {
    var rowDate = schedule[i][0];
    var dateStr = rowDate instanceof Date
      ? Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy-MM-dd')
      : String(rowDate).substring(0, 10);

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

function getTodayQuiz_(user, language) {
  var lang = normalizeLanguage_(language);
  var today = todayDate_();
  var scheduleEntry = getScheduleForDate_(today);

  if (!scheduleEntry || !scheduleEntry.quizId) {
    return {
      date: today,
      available: false,
      message: 'No quiz scheduled for today. Check back tomorrow!'
    };
  }

  var quizId = scheduleEntry.quizId;
  var book = scheduleEntry.book;
  var chapter = scheduleEntry.chapter;
  var dataSource = scheduleEntry.source;

  var submission = getSubmission_(user.email, today);
  var includeAnswers = !!submission;
  var questions = loadQuestionsForQuiz_(quizId, lang, includeAnswers);
  var questionCount = questions.length;
  var minRequired = CONFIG.MIN_QUESTIONS_PER_QUIZ;

  if (questionCount < minRequired) {
    var label = (book && chapter) ? book + ' ' + chapter : quizId;
    return {
      date: today,
      available: false,
      quizId: quizId,
      book: book,
      chapter: chapter,
      language: lang,
      dataSource: dataSource,
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
      date: today,
      available: true,
      quizId: quizId,
      book: book,
      chapter: displayChapter,
      title: title,
      language: lang,
      dataSource: dataSource,
      questionCount: submission.totalQuestions,
      submitted: true,
      score: submission.score,
      totalQuestions: submission.totalQuestions,
      answers: submission.answers,
      questions: questions
    };
  }

  return {
    date: today,
    available: true,
    quizId: quizId,
    book: book,
    chapter: displayChapter,
    title: title,
    language: lang,
    dataSource: dataSource,
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

  try {
    var json = JSON.stringify(questions);
    if (json.length < 95000) {
      cache.put(cacheKey, json, 300);
    }
  } catch (e) {}

  return questions;
}

function getQuestions_(quizId, language) {
  return loadQuestionsForQuiz_(quizId, language, false);
}

function getQuestionsForReview_(quizId, language) {
  return loadQuestionsForQuiz_(quizId, language, true);
}

function getSubmission_(email, date) {
  var data = getSheetData_(CONFIG.SHEETS.SUBMISSIONS);
  email = (email || '').toLowerCase();
  var targetDate = normalizeSheetDate_(date);
  var found = null;

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() !== email) {
      continue;
    }
    if (normalizeSheetDate_(data[i][1]) !== targetDate) {
      continue;
    }

    var answers = {};
    try {
      answers = JSON.parse(data[i][2] || '{}');
    } catch (err) {
      answers = {};
    }

    found = {
      row: i + 1,
      score: Number(data[i][3]) || 0,
      totalQuestions: Number(data[i][4]) || 0,
      answers: answers,
      submittedAt: data[i][5],
      locked: isSheetTruthy_(data[i][6])
    };
  }
  return found;
}

function submitQuiz_(user, answers, language) {
  var lang = normalizeLanguage_(language);
  var today = todayDate_();

  // Block re-submission
  var existing = getSubmission_(user.email, today);
  if (existing && existing.locked) {
    throw new Error('You have already submitted today\'s quiz. Answers cannot be changed.');
  }

  var scheduleEntry = getScheduleForDate_(today);
  var quizId = scheduleEntry ? scheduleEntry.quizId : null;

  if (!quizId) {
    throw new Error('No quiz available for today');
  }

  validateQuizReady_(quizId, null, null, lang);

  // Score the answers
  var correctAnswers = getCorrectAnswers_(quizId, lang);
  var totalQuestions = Object.keys(correctAnswers).length;
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

  // Save submission (locked = true, immutable)
  var subSheet = getSheet_(CONFIG.SHEETS.SUBMISSIONS);
  var submissionRow = [
    user.email,
    today,
    JSON.stringify(answerMap),
    totalPoints,
    totalQuestions,
    new Date(),
    true
  ];

  if (existing) {
    subSheet.getRange(existing.row, 1, 1, 7).setValues([submissionRow]);
  } else {
    subSheet.appendRow(submissionRow);
  }

  invalidateSheetCache_(CONFIG.SHEETS.SUBMISSIONS);
  invalidateQuestionCacheForQuiz_(quizId);

  // Update user stats
  updateUserStats_(user, totalPoints, isPerfect, today);

  return {
    score: totalPoints,
    correct: score,
    totalQuestions: totalQuestions,
    percentage: totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0,
    isPerfect: isPerfect,
    answers: answerMap,
    submitted: true
  };
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

function updateUserStats_(user, points, isPerfect, today) {
  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = getSheetData_(CONFIG.SHEETS.USERS);

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === user.email.toLowerCase()) {
      var totalScore = (Number(data[i][6]) || 0) + points;
      var totalQuizzes = (Number(data[i][7]) || 0) + 1;
      var perfectScores = (Number(data[i][8]) || 0) + (isPerfect ? 1 : 0);
      var streak = calculateStreak_(user.email, today);

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
}

function calculateStreak_(email, today) {
  var data = getSheetData_(CONFIG.SHEETS.SUBMISSIONS);
  var dates = [];

  for (var i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === email.toLowerCase()) {
      var dateStr = normalizeSheetDate_(data[i][1]);
      dates.push(dateStr);
    }
  }

  dates.sort().reverse();
  var uniqueDates = [];
  for (var j = 0; j < dates.length; j++) {
    if (uniqueDates.indexOf(dates[j]) === -1) {
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
      // Today might not be in list yet during calculation; check yesterday
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
