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

function parseQuestionRow_(row, includeAnswer) {
  var question = {
    id: Number(row[QCOL.NUM]),
    question: row[QCOL.TEXT],
    chapter: String(row[QCOL.CHAPTER] || '').trim(),
    options: {
      A: row[QCOL.OPTION_A],
      B: row[QCOL.OPTION_B],
      C: row[QCOL.OPTION_C],
      D: row[QCOL.OPTION_D]
    }
  };
  if (includeAnswer) {
    question.correctAnswer = normalizeCorrectAnswer_(row[QCOL.CORRECT]);
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
  var schedule = getSheetData_(CONFIG.SHEETS.SCHEDULE);

  var quizId = null;
  var chapter = '';
  var book = '';

  for (var i = 1; i < schedule.length; i++) {
    var rowDate = schedule[i][0];
    var dateStr = rowDate instanceof Date
      ? Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy-MM-dd')
      : String(rowDate).substring(0, 10);

    if (dateStr === today) {
      quizId = schedule[i][3] || schedule[i][2];
      book = schedule[i][1] || '';
      chapter = schedule[i][2] || '';
      break;
    }
  }

  if (!quizId) {
    return {
      date: today,
      available: false,
      message: 'No quiz scheduled for today. Check back tomorrow!'
    };
  }

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
      message:
        'Today\'s quiz (' + label + ') is not ready yet. ' +
        'It needs at least ' + minRequired + ' questions but only has ' + questionCount + '. ' +
        'Please ask an admin to add more questions in the sheet.'
    };
  }

  var bookReference = primaryBookReferenceFromQuestions_(questions);
  var title = buildQuizTitle_(book, chapter, bookReference);
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
    questionCount: questionCount,
    submitted: false,
    questions: questions
  };
}

function loadQuestionsForQuiz_(quizId, language, includeAnswers) {
  var lang = normalizeLanguage_(language);
  var cache = CacheService.getScriptCache();
  var cacheKey = 'qq:' + lang + ':' + quizId + ':' + (includeAnswers ? 'a' : 'q');
  var cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  var sheetName = CONFIG.LANGUAGES[lang].sheet;
  var data = getSheetData_(sheetName);
  if (!data.length && lang !== 'en') {
    data = getSheetData_(CONFIG.LANGUAGES.en.sheet);
  }

  var questions = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][QCOL.QUIZ_ID]) === String(quizId)) {
      if (!String(data[i][QCOL.TEXT] || '').trim()) continue;
      questions.push(parseQuestionRow_(data[i], includeAnswers));
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

  for (var i = 1; i < data.length; i++) {
    var rowDate = data[i][1];
    var dateStr = rowDate instanceof Date
      ? Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy-MM-dd')
      : String(rowDate).substring(0, 10);

    if ((data[i][0] || '').toLowerCase() === email.toLowerCase() && dateStr === date) {
      return {
        row: i + 1,
        score: Number(data[i][3]) || 0,
        totalQuestions: Number(data[i][4]) || 0,
        answers: JSON.parse(data[i][2] || '{}'),
        submittedAt: data[i][5],
        locked: data[i][6] === true || data[i][6] === 'TRUE'
      };
    }
  }
  return null;
}

function submitQuiz_(user, answers, language) {
  var lang = normalizeLanguage_(language);
  var today = todayDate_();

  // Block re-submission
  var existing = getSubmission_(user.email, today);
  if (existing && existing.locked) {
    throw new Error('You have already submitted today\'s quiz. Answers cannot be changed.');
  }

  var schedule = getSheetData_(CONFIG.SHEETS.SCHEDULE);
  var quizId = null;

  for (var i = 1; i < schedule.length; i++) {
    var rowDate = schedule[i][0];
    var dateStr = rowDate instanceof Date
      ? Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy-MM-dd')
      : String(rowDate).substring(0, 10);
    if (dateStr === today) {
      quizId = schedule[i][3] || schedule[i][2];
      break;
    }
  }

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

  var pointsPerQuestion = 10;
  var totalPoints = score * pointsPerQuestion;
  var isPerfect = score === totalQuestions && totalQuestions > 0;

  // Save submission (locked = true, immutable)
  var subSheet = getSheet_(CONFIG.SHEETS.SUBMISSIONS);
  subSheet.appendRow([
    user.email,
    today,
    JSON.stringify(answerMap),
    totalPoints,
    totalQuestions,
    new Date(),
    true  // locked
  ]);
  invalidateSheetCache_(CONFIG.SHEETS.SUBMISSIONS);

  // Update user stats
  updateUserStats_(user, totalPoints, isPerfect, today);

  return {
    score: totalPoints,
    correct: score,
    totalQuestions: totalQuestions,
    percentage: totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0,
    isPerfect: isPerfect
  };
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
      var rowDate = data[i][1];
      var dateStr = rowDate instanceof Date
        ? Utilities.formatDate(rowDate, CONFIG.TIMEZONE, 'yyyy-MM-dd')
        : String(rowDate).substring(0, 10);
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
