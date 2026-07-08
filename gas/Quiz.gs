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

function buildQuizTitle_(book, chapterRef, scheduleChapter) {
  var chapter = chapterRef || scheduleChapter || '';
  if (book && chapter) return book + ' ' + chapter;
  return chapter || book || '';
}

function countQuestionsForQuiz_(quizId) {
  var sheet = getSheet_(CONFIG.SHEETS.QUESTIONS);
  var data = sheet.getDataRange().getValues();
  var count = 0;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][QCOL.QUIZ_ID]) === String(quizId) && String(data[i][QCOL.TEXT] || '').trim()) {
      count++;
    }
  }
  return count;
}

function validateQuizReady_(quizId, book, chapter) {
  var count = countQuestionsForQuiz_(quizId);
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

function getTodayQuiz_(user) {
  var today = todayDate_();
  var scheduleSheet = getSheet_(CONFIG.SHEETS.SCHEDULE);
  var schedule = scheduleSheet.getDataRange().getValues();

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

  var questionCount;
  try {
    questionCount = validateQuizReady_(quizId, book, chapter);
  } catch (err) {
    return {
      date: today,
      available: false,
      quizId: quizId,
      book: book,
      chapter: chapter,
      message: err.message
    };
  }

  var reviewQuestions = getQuestionsForReview_(quizId);
  var chapterRef = chapterFromQuestions_(reviewQuestions) || chapter;
  var title = buildQuizTitle_(book, chapterRef, chapter);

  // Check if user already submitted today
  var submission = getSubmission_(user.email, today);
  if (submission) {
    return {
      date: today,
      available: true,
      quizId: quizId,
      book: book,
      chapter: chapterRef,
      title: title,
      questionCount: submission.totalQuestions,
      submitted: true,
      score: submission.score,
      totalQuestions: submission.totalQuestions,
      answers: submission.answers,
      questions: reviewQuestions
    };
  }

  var questions = getQuestions_(quizId);
  return {
    date: today,
    available: true,
    quizId: quizId,
    book: book,
    chapter: chapterRef,
    title: title,
    questionCount: questionCount,
    submitted: false,
    questions: questions
  };
}

function getQuestions_(quizId) {
  var sheet = getSheet_(CONFIG.SHEETS.QUESTIONS);
  var data = sheet.getDataRange().getValues();
  var questions = [];

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][QCOL.QUIZ_ID]) === String(quizId)) {
      questions.push(parseQuestionRow_(data[i], false));
    }
  }

  questions.sort(function(a, b) { return a.id - b.id; });
  return questions;
}

function getQuestionsForReview_(quizId) {
  var sheet = getSheet_(CONFIG.SHEETS.QUESTIONS);
  var data = sheet.getDataRange().getValues();
  var questions = [];

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][QCOL.QUIZ_ID]) === String(quizId)) {
      questions.push(parseQuestionRow_(data[i], true));
    }
  }

  questions.sort(function(a, b) { return a.id - b.id; });
  return questions;
}

function getSubmission_(email, date) {
  var sheet = getSheet_(CONFIG.SHEETS.SUBMISSIONS);
  var data = sheet.getDataRange().getValues();

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

function submitQuiz_(user, answers) {
  var today = todayDate_();

  // Block re-submission
  var existing = getSubmission_(user.email, today);
  if (existing && existing.locked) {
    throw new Error('You have already submitted today\'s quiz. Answers cannot be changed.');
  }

  var scheduleSheet = getSheet_(CONFIG.SHEETS.SCHEDULE);
  var schedule = scheduleSheet.getDataRange().getValues();
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

  validateQuizReady_(quizId);

  // Score the answers
  var correctAnswers = getCorrectAnswers_(quizId);
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

function getCorrectAnswers_(quizId) {
  var sheet = getSheet_(CONFIG.SHEETS.QUESTIONS);
  var data = sheet.getDataRange().getValues();
  var answers = {};

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][QCOL.QUIZ_ID]) === String(quizId)) {
      answers[String(data[i][QCOL.NUM])] = normalizeCorrectAnswer_(data[i][QCOL.CORRECT]);
    }
  }
  return answers;
}

function updateUserStats_(user, points, isPerfect, today) {
  var sheet = getSheet_(CONFIG.SHEETS.USERS);
  var data = sheet.getDataRange().getValues();

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
      break;
    }
  }
}

function calculateStreak_(email, today) {
  var sheet = getSheet_(CONFIG.SHEETS.SUBMISSIONS);
  var data = sheet.getDataRange().getValues();
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
